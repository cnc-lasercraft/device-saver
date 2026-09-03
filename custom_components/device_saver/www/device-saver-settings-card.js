/*
 * Device Saver Settings Card
 *
 * Bundled with the integration and auto-registered at
 * /device_saver/device-saver-settings-card.js. Reads and writes the config
 * entry's options through the device_saver/get_config and /set_config
 * WebSocket commands — the same options the "Konfigurieren" flow writes, so
 * both ways stay interchangeable.
 *
 * Saving is explicit: every write reloads the config entry (the update listener
 * rebuilds the coordinator cache), so auto-saving on each keystroke would mean
 * a reload per character.
 *
 * Registration is deferred to the load event for the same reason as the main
 * card — see the comment at the bottom.
 */
(() => {
  const OPT = {
    EXCLUDED: "devices_excluded",
    CRIT: "timeout_critical_minutes",
    SLOW: "timeout_slow_minutes",
    NOTIFY: "notify_service",
    RECOVERED: "notify_recovered",
    IGN_INT: "ignored_integrations",
    IGN_PLAT: "ignored_platforms",
    GATES: "power_gates",
  };

  // How long to wait after a save before re-reading. The write triggers a
  // config entry reload; reading too early returns the pre-reload coordinator.
  const RELOAD_SETTLE_MS = 1500;

  const CONN_COLORS = {
    Zigbee: "#ffb300", Matter: "#9c27b0", HomeKit: "#00bcd4",
    WLAN: "#03a9f4", LAN: "#3f51b5", Solar: "#ff9800", Andere: "#78909c",
  };

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /** 15 -> "15 min", 90 -> "1 h 30 min", 10080 -> "7 d" */
  function humanMinutes(m) {
    m = Number(m);
    if (!Number.isFinite(m) || m <= 0) return "";
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const min = m % 60;
    const parts = [];
    if (d) parts.push(`${d} d`);
    if (h) parts.push(`${h} h`);
    if (min || !parts.length) parts.push(`${min} min`);
    return parts.join(" ");
  }

  /** Stable shape for dirty-comparison — list order must not count as a change. */
  function normalize(o) {
    if (!o) return "";
    return JSON.stringify({
      [OPT.EXCLUDED]: [...(o[OPT.EXCLUDED] || [])].sort(),
      [OPT.CRIT]: Number(o[OPT.CRIT]),
      [OPT.SLOW]: Number(o[OPT.SLOW]),
      [OPT.NOTIFY]: (o[OPT.NOTIFY] || "").trim(),
      [OPT.RECOVERED]: !!o[OPT.RECOVERED],
      [OPT.IGN_INT]: [...(o[OPT.IGN_INT] || [])].sort(),
      [OPT.IGN_PLAT]: [...(o[OPT.IGN_PLAT] || [])].sort(),
      [OPT.GATES]: Object.keys(o[OPT.GATES] || {}).sort()
        .map((k) => `${k}=${o[OPT.GATES][k]}`),
    });
  }

  class DeviceSaverSettingsCard extends HTMLElement {
    constructor() {
      super();
      this._uid = "ds" + Math.random().toString(36).slice(2, 8);
      this._state = "init";   // init | loading | ready | denied | error
      this._error = "";
      this._saved = null;     // options as they are on the server
      this._draft = null;     // working copy
      this._catalogue = [];
      this._known = { integrations: [], platforms: [] };
      this._nameById = {};
      this._maxTimeout = 10080;
      this._gateDomains = ["switch", "input_boolean", "binary_sensor"];
      this._exFilter = "";
      this._exOnlyExcluded = false;
      this._busy = false;
      this._status = "";
      this._settleTimer = null;
    }

    disconnectedCallback() {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }

    setConfig(config) {
      this.config = config || {};
      this._entryId = this.config.entry_id || null;
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) {
        this._load();
      } else if (this._state === "ready") {
        // Gate entity states are the only live data on this card.
        this._renderGates();
      }
    }

    async _load() {
      this._state = "loading";
      this._renderShell();
      try {
        const msg = { type: "device_saver/get_config" };
        if (this._entryId) msg.entry_id = this._entryId;
        const res = await this._hass.callWS(msg);

        this._entryId = res.entry_id;
        this._saved = res.options;
        this._draft = JSON.parse(JSON.stringify(res.options));
        this._catalogue = res.devices || [];
        this._known = res.known || { integrations: [], platforms: [] };
        this._maxTimeout = res.max_timeout_minutes || 10080;
        this._gateDomains = res.gate_domains || this._gateDomains;

        this._nameById = {};
        for (const d of this._catalogue) this._nameById[d.device_id] = d.name;
        for (const g of res.gates || []) {
          if (!this._nameById[g.device_id]) this._nameById[g.device_id] = g.device_name;
        }

        this._state = "ready";
        this._renderShell();
      } catch (e) {
        if (e && e.code === "unauthorized") {
          this._state = "denied";
        } else {
          this._state = "error";
          this._error = (e && (e.message || e.code)) || String(e);
        }
        this._renderShell();
      }
    }

    _dirty() {
      return normalize(this._draft) !== normalize(this._saved);
    }

    // ---------------------------------------------------------------- shell

    _renderShell() {
      if (this._state === "loading" || this._state === "init") {
        this.innerHTML = `<ha-card header="Device Saver · Einstellungen">
          <div class="card-content">Lade Konfiguration …</div></ha-card>`;
        return;
      }
      if (this._state === "denied") {
        this.innerHTML = `<ha-card header="Device Saver · Einstellungen">
          <div class="card-content">Diese Karte ist Administratoren vorbehalten.</div></ha-card>`;
        return;
      }
      if (this._state === "error") {
        this.innerHTML = `<ha-card header="Device Saver · Einstellungen">
          <div class="card-content">Konfiguration nicht lesbar: ${esc(this._error)}</div></ha-card>`;
        return;
      }

      this.innerHTML = `
        <ha-card>
          ${this._styles()}
          <div class="dss-head">
            <span class="dss-title">Device Saver · Einstellungen</span>
          </div>
          <div class="dss-body">
            ${this._sectionTimeouts()}
            ${this._sectionNotify()}
            ${this._sectionExcluded()}
            ${this._sectionGates()}
            ${this._sectionIgnored()}
          </div>
          <div class="dss-foot">
            <span class="dss-status" id="dss-status"></span>
            <button class="dss-btn" id="dss-reset">Verwerfen</button>
            <button class="dss-btn primary" id="dss-save">Speichern</button>
          </div>
        </ha-card>
      `;

      this._wire();
      this._renderExcluded();
      this._renderGates();
      this._renderChips();
      this._updateFoot();
    }

    _styles() {
      return `<style>
        .dss-head { padding: 16px 16px 4px; }
        .dss-title { font-size: 1.2em; font-weight: 500; }
        .dss-body { padding: 0 16px; }
        .dss-sec { padding: 16px 0; border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08)); }
        .dss-sec:first-child { border-top: none; padding-top: 8px; }
        .dss-sec h3 {
          margin: 0 0 2px; font-size: 0.8em; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--secondary-text-color, #999);
        }
        .dss-hint { margin: 0 0 12px; font-size: 0.85em; color: var(--secondary-text-color, #999); line-height: 1.4; }
        .dss-row {
          display: flex; align-items: center; gap: 12px; padding: 6px 0;
          flex-wrap: wrap;
        }
        .dss-row > label { flex: 1 1 200px; font-size: 0.95em; }
        .dss-row .sub { display: block; font-size: 0.8em; color: var(--secondary-text-color, #999); }
        input[type="text"], input[type="number"], select {
          padding: 8px 10px; box-sizing: border-box; font-size: 0.9em; font-family: inherit;
          border: 1px solid var(--divider-color, #333); border-radius: 8px;
          background: var(--card-background-color, #1c1c1c);
          color: var(--primary-text-color, #fff); outline: none;
        }
        input:focus, select:focus { border-color: var(--primary-color, #03a9f4); }
        input::placeholder { color: var(--secondary-text-color, #999); }
        .dss-num { width: 110px; }
        .dss-grow { flex: 1 1 240px; min-width: 0; }
        .dss-unit { font-size: 0.85em; color: var(--secondary-text-color, #999); min-width: 90px; }
        .dss-switch { position: relative; width: 44px; height: 24px; flex: 0 0 auto; }
        .dss-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
        .dss-switch span {
          position: absolute; inset: 0; border-radius: 12px; pointer-events: none;
          background: var(--divider-color, #444); transition: background 0.15s;
        }
        .dss-switch span::after {
          content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
          border-radius: 50%; background: #fff; transition: transform 0.15s;
        }
        .dss-switch input:checked + span { background: var(--primary-color, #03a9f4); }
        .dss-switch input:checked + span::after { transform: translateX(20px); }

        .dss-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .dss-tools .grow { flex: 1 1 200px; }
        .dss-check { display: flex; align-items: center; gap: 6px; font-size: 0.85em; color: var(--secondary-text-color, #999); white-space: nowrap; }

        .dss-list {
          max-height: 320px; overflow-y: auto; border: 1px solid var(--divider-color, #333);
          border-radius: 8px;
        }
        .dss-dev {
          display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer;
          border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.05));
          font-size: 0.88em;
        }
        .dss-dev:last-child { border-bottom: none; }
        .dss-dev:hover { background: rgba(127,127,127,0.08); }
        .dss-dev.on { background: rgba(244,67,54,0.08); }
        .dss-dev .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dss-dev.on .nm { text-decoration: line-through; opacity: 0.75; }
        .dss-empty { padding: 16px; text-align: center; font-size: 0.85em; color: var(--secondary-text-color, #999); }

        .dss-badge { padding: 1px 7px; border-radius: 4px; font-size: 0.78em; white-space: nowrap; flex: 0 0 auto; }
        .dss-warn { color: #ff9800; border: 1px solid #ff980055; }
        .dss-stale { color: #f44336; border: 1px solid #f4433655; }

        .dss-gate {
          display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 0.88em;
          border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.05));
        }
        .dss-gate:last-child { border-bottom: none; }
        .dss-gate .dev { flex: 1 1 40%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dss-gate .ent { flex: 1 1 45%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary-text-color, #999); font-family: monospace; font-size: 0.92em; }
        .dss-gate .arrow { color: var(--secondary-text-color, #999); flex: 0 0 auto; }
        .dss-gs { font-style: normal; font-size: 0.85em; padding: 0 5px; border-radius: 4px; }
        .dss-gs.on { color: #4caf50; }
        .dss-gs.off { color: #78909c; }
        .dss-gs.bad { color: #ff9800; }

        .dss-x {
          flex: 0 0 auto; background: none; border: none; cursor: pointer; font-size: 1em; line-height: 1;
          color: var(--secondary-text-color, #999); padding: 2px 6px; border-radius: 4px;
        }
        .dss-x:hover { color: #f44336; background: rgba(244,67,54,0.1); }

        .dss-add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
        .dss-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .dss-chip {
          display: inline-flex; align-items: center; gap: 2px; padding: 3px 4px 3px 10px;
          border-radius: 14px; font-size: 0.85em;
          border: 1px solid var(--divider-color, #333); background: rgba(127,127,127,0.08);
        }
        .dss-none { font-size: 0.85em; color: var(--secondary-text-color, #999); }

        .dss-foot {
          display: flex; align-items: center; gap: 10px; padding: 12px 16px 16px;
          border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08));
        }
        .dss-status { flex: 1 1 auto; font-size: 0.85em; color: var(--secondary-text-color, #999); }
        .dss-status.dirty { color: #ff9800; }
        .dss-status.ok { color: #4caf50; }
        .dss-status.err { color: #f44336; }
        .dss-btn {
          padding: 8px 16px; border-radius: 8px; font-size: 0.9em; font-family: inherit; cursor: pointer;
          border: 1px solid var(--divider-color, #333); background: none;
          color: var(--primary-text-color, #fff);
        }
        .dss-btn:hover:not(:disabled) { border-color: var(--primary-color, #03a9f4); }
        .dss-btn.primary { background: var(--primary-color, #03a9f4); border-color: var(--primary-color, #03a9f4); color: #fff; }
        .dss-btn:disabled { opacity: 0.4; cursor: default; }
      </style>`;
    }

    // ------------------------------------------------------------- sections

    _sectionTimeouts() {
      const d = this._draft;
      return `
        <div class="dss-sec">
          <h3>Timeouts</h3>
          <p class="dss-hint">Wie lange ein Gerät unerreichbar sein darf, bevor es als down gilt.
          Geräte mit Batterie-Entity bekommen den Slow-, alle anderen den Critical-Timeout.</p>
          <div class="dss-row">
            <label>Critical<span class="sub">Netzgeräte</span></label>
            <input type="number" class="dss-num" id="dss-crit" min="1" max="${this._maxTimeout}"
                   value="${Number(d[OPT.CRIT])}">
            <span class="dss-unit" id="dss-crit-h">${esc(humanMinutes(d[OPT.CRIT]))}</span>
          </div>
          <div class="dss-row">
            <label>Slow<span class="sub">Batteriegeräte</span></label>
            <input type="number" class="dss-num" id="dss-slow" min="1" max="${this._maxTimeout}"
                   value="${Number(d[OPT.SLOW])}">
            <span class="dss-unit" id="dss-slow-h">${esc(humanMinutes(d[OPT.SLOW]))}</span>
          </div>
        </div>`;
    }

    _sectionNotify() {
      const d = this._draft;
      const services = Object.keys((this._hass.services || {}).notify || {})
        .map((s) => `notify.${s}`).sort();
      return `
        <div class="dss-sec">
          <h3>Benachrichtigung</h3>
          <p class="dss-hint">Zusätzlich zur persistenten Notification. Leer lassen, um nur
          die Notification im Dashboard zu erhalten.</p>
          <div class="dss-row">
            <label>Notify-Service</label>
            <input type="text" class="dss-grow" id="dss-notify" list="${this._uid}-notify"
                   placeholder="notify.mobile_app_…" value="${esc(d[OPT.NOTIFY] || "")}">
            <datalist id="${this._uid}-notify">
              ${services.map((s) => `<option value="${esc(s)}"></option>`).join("")}
            </datalist>
          </div>
          <div class="dss-row">
            <label>Auch bei Wiederherstellung melden<span class="sub">Gilt nicht für stromlose Geräte</span></label>
            <span class="dss-switch">
              <input type="checkbox" id="dss-recovered" ${d[OPT.RECOVERED] ? "checked" : ""}>
              <span></span>
            </span>
          </div>
        </div>`;
    }

    _sectionExcluded() {
      return `
        <div class="dss-sec">
          <h3>Ausgeschlossene Geräte <span id="dss-ex-count"></span></h3>
          <p class="dss-hint">Ausgeschlossene Geräte werden gar nicht überwacht — kein Down, keine Meldung.</p>
          <div class="dss-tools">
            <input type="text" class="grow" id="dss-ex-filter" placeholder="Gerät suchen …">
            <label class="dss-check">
              <input type="checkbox" id="dss-ex-only"> nur ausgeschlossene
            </label>
          </div>
          <div class="dss-list" id="dss-ex-list"></div>
        </div>`;
    }

    _sectionGates() {
      return `
        <div class="dss-sec">
          <h3>Power-Gates <span id="dss-gate-count"></span></h3>
          <p class="dss-hint">Ist die Gate-Entity <em>aus</em>, gilt das Gerät als bewusst stromlos statt down.
          Ist sie <em>an</em>, zählt der Timeout ab dem Einschalten — das Gerät bekommt sein Boot-Fenster.
          Eine <em>unavailable</em> Gate-Entity maskiert nichts: dann greift die normale Down-Logik.</p>
          <div class="dss-list" id="dss-gate-list"></div>
          <div class="dss-add">
            <input type="text" id="dss-gate-devfilter" placeholder="Gerät filtern …" style="flex:0 1 160px">
            <select id="dss-gate-dev" class="dss-grow"></select>
            <input type="text" id="dss-gate-ent" class="dss-grow" list="${this._uid}-gates"
                   placeholder="Gate-Entity, z.B. switch.…">
            <datalist id="${this._uid}-gates"></datalist>
            <button class="dss-btn" id="dss-gate-add">Hinzufügen</button>
          </div>
        </div>`;
    }

    _sectionIgnored() {
      return `
        <div class="dss-sec">
          <h3>Ignorieren</h3>
          <p class="dss-hint">Integrationen: Geräte, die <em>ausschliesslich</em> dazu gehören, tauchen gar nicht erst auf.
          Plattformen: deren Entities zählen nicht für die Gesundheit (sie melden oft statische Werte,
          auch wenn das Gerät längst offline ist).</p>
          <div style="margin-bottom:14px">
            <div class="dss-chips" id="dss-int-chips"></div>
            <div class="dss-add">
              <input type="text" class="dss-grow" id="dss-int-input" list="${this._uid}-int"
                     placeholder="Integration hinzufügen …">
              <datalist id="${this._uid}-int">
                ${this._known.integrations.map((s) => `<option value="${esc(s)}"></option>`).join("")}
              </datalist>
              <button class="dss-btn" id="dss-int-add">+</button>
            </div>
          </div>
          <div>
            <div class="dss-chips" id="dss-plat-chips"></div>
            <div class="dss-add">
              <input type="text" class="dss-grow" id="dss-plat-input" list="${this._uid}-plat"
                     placeholder="Plattform hinzufügen …">
              <datalist id="${this._uid}-plat">
                ${this._known.platforms.map((s) => `<option value="${esc(s)}"></option>`).join("")}
              </datalist>
              <button class="dss-btn" id="dss-plat-add">+</button>
            </div>
          </div>
        </div>`;
    }

    // ---------------------------------------------------------------- wiring

    _wire() {
      const q = (sel) => this.querySelector(sel);

      const num = (el, key, hintEl) => {
        el.addEventListener("input", () => {
          const v = parseInt(el.value, 10);
          if (Number.isFinite(v) && v >= 1 && v <= this._maxTimeout) {
            this._draft[key] = v;
            hintEl.textContent = humanMinutes(v);
          }
          this._updateFoot();
        });
      };
      num(q("#dss-crit"), OPT.CRIT, q("#dss-crit-h"));
      num(q("#dss-slow"), OPT.SLOW, q("#dss-slow-h"));

      q("#dss-notify").addEventListener("input", (e) => {
        this._draft[OPT.NOTIFY] = e.target.value;
        this._updateFoot();
      });
      q("#dss-recovered").addEventListener("change", (e) => {
        this._draft[OPT.RECOVERED] = e.target.checked;
        this._updateFoot();
      });

      q("#dss-ex-filter").addEventListener("input", (e) => {
        this._exFilter = e.target.value.toLowerCase();
        this._renderExcluded();
      });
      q("#dss-ex-only").addEventListener("change", (e) => {
        this._exOnlyExcluded = e.target.checked;
        this._renderExcluded();
      });
      // Delegated so toggling never re-renders the list — a row must not jump
      // out from under the cursor while you work through a long list.
      q("#dss-ex-list").addEventListener("change", (e) => {
        const box = e.target.closest("input[type=checkbox][data-id]");
        if (!box) return;
        const id = box.dataset.id;
        const list = this._draft[OPT.EXCLUDED].filter((d) => d !== id);
        if (box.checked) list.push(id);
        this._draft[OPT.EXCLUDED] = list;
        box.closest(".dss-dev").classList.toggle("on", box.checked);
        this._updateExCount();
        this._updateFoot();
      });

      q("#dss-gate-list").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-remove]");
        if (!btn) return;
        delete this._draft[OPT.GATES][btn.dataset.remove];
        this._renderGates();
        this._renderGateDeviceOptions();
        this._updateFoot();
      });
      q("#dss-gate-devfilter").addEventListener("input", () => this._renderGateDeviceOptions());
      q("#dss-gate-add").addEventListener("click", () => this._addGate());

      this._wireChips("int", OPT.IGN_INT);
      this._wireChips("plat", OPT.IGN_PLAT);

      q("#dss-reset").addEventListener("click", () => {
        this._draft = JSON.parse(JSON.stringify(this._saved));
        this._status = "";
        this._renderShell();
      });
      q("#dss-save").addEventListener("click", () => this._save());

      this._renderGateEntityOptions();
      this._renderGateDeviceOptions();
    }

    _wireChips(kind, key) {
      const input = this.querySelector(`#dss-${kind}-input`);
      const add = () => {
        const v = input.value.trim();
        if (!v) return;
        if (!this._draft[key].includes(v)) this._draft[key] = [...this._draft[key], v];
        input.value = "";
        this._renderChips();
        this._updateFoot();
      };
      this.querySelector(`#dss-${kind}-add`).addEventListener("click", add);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); add(); }
      });
      this.querySelector(`#dss-${kind}-chips`).addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-rm]");
        if (!btn) return;
        this._draft[key] = this._draft[key].filter((x) => x !== btn.dataset.rm);
        this._renderChips();
        this._updateFoot();
      });
    }

    // -------------------------------------------------------------- renderers

    _renderExcluded() {
      const el = this.querySelector("#dss-ex-list");
      if (!el) return;
      const excluded = new Set(this._draft[OPT.EXCLUDED]);

      let items = this._catalogue.filter((d) => {
        if (this._exOnlyExcluded && !excluded.has(d.device_id)) return false;
        if (!this._exFilter) return true;
        return [d.name, d.manufacturer, d.model, d.connection_type, d.device_id]
          .join(" ").toLowerCase().includes(this._exFilter);
      });

      // Excluded first — otherwise the handful in effect is lost among 150 rows.
      items.sort((a, b) => {
        const ax = excluded.has(a.device_id) ? 0 : 1;
        const bx = excluded.has(b.device_id) ? 0 : 1;
        if (ax !== bx) return ax - bx;
        return a.name.localeCompare(b.name);
      });

      if (!items.length) {
        el.innerHTML = `<div class="dss-empty">Kein Gerät gefunden</div>`;
      } else {
        el.innerHTML = items.map((d) => {
          const on = excluded.has(d.device_id);
          const color = CONN_COLORS[d.connection_type] || CONN_COLORS.Andere;
          let note = "";
          if (d.status === "missing") {
            note = `<span class="dss-badge dss-stale" title="Kein Gerät mit dieser ID in der Registry — Eintrag kann weg">verwaist</span>`;
          } else if (d.status === "not_monitored") {
            note = `<span class="dss-badge dss-warn" title="Würde ohnehin übersprungen (ignorierte Integration oder keine nutzbaren Entities)">redundant</span>`;
          }
          return `<label class="dss-dev ${on ? "on" : ""}">
            <input type="checkbox" data-id="${esc(d.device_id)}" ${on ? "checked" : ""}>
            <span class="nm" title="${esc(d.device_id)}">${esc(d.name)}</span>
            ${note}
            <span class="dss-badge" style="color:${color};border:1px solid ${color}44">${esc(d.connection_type)}</span>
          </label>`;
        }).join("");
      }
      this._updateExCount();
    }

    _updateExCount() {
      const el = this.querySelector("#dss-ex-count");
      if (el) el.textContent = `(${this._draft[OPT.EXCLUDED].length})`;
    }

    _renderGates() {
      const el = this.querySelector("#dss-gate-list");
      if (!el) return;
      const gates = this._draft[OPT.GATES];
      const ids = Object.keys(gates).sort((a, b) =>
        (this._nameById[a] || a).localeCompare(this._nameById[b] || b));

      const count = this.querySelector("#dss-gate-count");
      if (count) count.textContent = `(${ids.length})`;

      if (!ids.length) {
        el.innerHTML = `<div class="dss-empty">Kein Power-Gate konfiguriert</div>`;
        return;
      }

      el.innerHTML = ids.map((id) => {
        const entity = gates[id];
        const st = this._hass.states[entity];
        let cls = "bad", label = "fehlt";
        if (st) {
          if (st.state === "on") { cls = "on"; label = "an"; }
          else if (st.state === "off") { cls = "off"; label = "aus"; }
          else { cls = "bad"; label = st.state; }
        }
        const known = this._nameById[id];
        const name = known
          ? esc(known)
          : `<span class="dss-badge dss-stale">unbekanntes Gerät</span> ${esc(id)}`;
        return `<div class="dss-gate">
          <span class="dev" title="${esc(id)}">${name}</span>
          <span class="arrow">→</span>
          <span class="ent" title="${esc(entity)}">${esc(entity)} <em class="dss-gs ${cls}">${esc(label)}</em></span>
          <button class="dss-x" data-remove="${esc(id)}" title="Gate entfernen">✕</button>
        </div>`;
      }).join("");
    }

    _renderGateEntityOptions() {
      const dl = document.getElementById(`${this._uid}-gates`);
      if (!dl) return;
      const opts = Object.keys(this._hass.states)
        .filter((eid) => this._gateDomains.includes(eid.split(".")[0]))
        .sort()
        .map((eid) => {
          const fn = this._hass.states[eid].attributes.friendly_name || "";
          return `<option value="${esc(eid)}" label="${esc(fn)}"></option>`;
        });
      dl.innerHTML = opts.join("");
    }

    _renderGateDeviceOptions() {
      const sel = this.querySelector("#dss-gate-dev");
      if (!sel) return;
      const filterEl = this.querySelector("#dss-gate-devfilter");
      const filter = (filterEl ? filterEl.value : "").toLowerCase();
      const gated = this._draft[OPT.GATES];

      const items = this._catalogue
        .filter((d) => !gated[d.device_id] && d.status !== "missing")
        .filter((d) => !filter || `${d.name} ${d.model || ""} ${d.manufacturer || ""}`
          .toLowerCase().includes(filter))
        .sort((a, b) => a.name.localeCompare(b.name));

      const keep = sel.value;
      sel.innerHTML = items.length
        ? items.map((d) => `<option value="${esc(d.device_id)}">${esc(d.name)}</option>`).join("")
        : `<option value="">— kein Treffer —</option>`;
      if (keep && items.some((d) => d.device_id === keep)) sel.value = keep;
    }

    _addGate() {
      const dev = this.querySelector("#dss-gate-dev").value;
      const entInput = this.querySelector("#dss-gate-ent");
      const ent = entInput.value.trim();
      if (!dev) return this._flash("Kein Gerät gewählt.", "err");
      if (!ent) return this._flash("Keine Gate-Entity angegeben.", "err");
      if (!this._gateDomains.includes(ent.split(".")[0])) {
        return this._flash(`Gate-Entity muss ${this._gateDomains.join(", ")} sein.`, "err");
      }
      if (!this._hass.states[ent]) {
        return this._flash(`Entity ${ent} gibt es nicht.`, "err");
      }
      this._draft[OPT.GATES][dev] = ent;
      entInput.value = "";
      this._renderGates();
      this._renderGateDeviceOptions();
      this._updateFoot();
    }

    _renderChips() {
      const draw = (kind, key) => {
        const el = this.querySelector(`#dss-${kind}-chips`);
        if (!el) return;
        const list = this._draft[key];
        el.innerHTML = list.length
          ? list.map((v) => `<span class="dss-chip">${esc(v)}
              <button class="dss-x" data-rm="${esc(v)}" title="Entfernen">✕</button></span>`).join("")
          : `<span class="dss-none">${kind === "int" ? "Keine Integration" : "Keine Plattform"} ignoriert</span>`;
      };
      draw("int", OPT.IGN_INT);
      draw("plat", OPT.IGN_PLAT);
    }

    // ------------------------------------------------------------------ save

    _updateFoot() {
      const save = this.querySelector("#dss-save");
      const reset = this.querySelector("#dss-reset");
      const status = this.querySelector("#dss-status");
      if (!save) return;
      const dirty = this._dirty();
      save.disabled = this._busy || !dirty;
      reset.disabled = this._busy || !dirty;
      if (status && !this._status) {
        status.className = "dss-status" + (dirty ? " dirty" : "");
        status.textContent = dirty
          ? "Ungespeicherte Änderungen"
          : "Speichern lädt die Integration neu.";
      }
    }

    _flash(text, cls) {
      this._status = text;
      const status = this.querySelector("#dss-status");
      if (status) {
        status.className = "dss-status" + (cls ? ` ${cls}` : "");
        status.textContent = text;
      }
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => {
        this._status = "";
        this._updateFoot();
      }, 4000);
    }

    async _save() {
      if (this._busy) return;
      this._busy = true;
      this._status = "";
      this._flash("Speichere …", "");
      this._updateFoot();
      try {
        await this._hass.callWS({
          type: "device_saver/set_config",
          entry_id: this._entryId,
          options: this._draft,
        });
        // The write reloads the entry; read back only once that has settled, so
        // the card shows what the coordinator actually ended up with.
        this._saved = JSON.parse(JSON.stringify(this._draft));
        this._flash("Gespeichert — Integration wird neu geladen …", "ok");
        clearTimeout(this._settleTimer);
        this._settleTimer = setTimeout(() => {
          this._busy = false;
          this._load();
        }, RELOAD_SETTLE_MS);
      } catch (e) {
        this._busy = false;
        this._flash(`Fehler: ${(e && (e.message || e.code)) || e}`, "err");
        this._updateFoot();
      }
    }

    getCardSize() { return 14; }
  }

  /*
   * Same deferred registration as the main card: a module from extra_module_url
   * can run before HA's app.js installs the scoped custom element registry
   * polyfill, and a define() before that lands in the native registry only,
   * invisible to Lovelace ("Konfigurationsfehler" until reload).
   */
  function register() {
    if (customElements.get("device-saver-settings-card")) return;
    try {
      customElements.define("device-saver-settings-card", DeviceSaverSettingsCard);
    } catch (e) {
      return;
    }
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "device-saver-settings-card",
      name: "Device Saver Settings Card",
      description: "Alle Device-Saver-Einstellungen direkt im Dashboard",
    });
  }

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
})();
