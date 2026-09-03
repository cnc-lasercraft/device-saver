/*
 * Device Saver Card
 *
 * Bundled with the integration and auto-registered at /device_saver/device-saver-card.js.
 * Wrapped in an IIFE; the registration itself is deferred and guarded (see register()
 * at the bottom), so that a leftover manual Lovelace resource (e.g.
 * /local/device-saver-card.js) loading the same file a second time is a no-op
 * instead of a "already declared" SyntaxError.
 */
(() => {
  // Backoff for re-asking after an empty answer, in ms. Bounded on purpose: an
  // empty device list can also be legitimate (fresh install, everything
  // excluded), so we settle after these instead of polling forever.
  const EMPTY_RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000];

  // Must match GATE_DOMAINS in const.py — the backend rejects anything else.
  const GATE_DOMAINS = ["switch", "input_boolean", "binary_sensor"];

  // A row action writes options, which reloads the config entry. Re-read only
  // once that has settled, or we'd fetch from the coordinator about to be torn
  // down.
  const RELOAD_SETTLE_MS = 1500;

  class DeviceSaverCard extends HTMLElement {
    constructor() {
      super();
      this._sortField = "down";
      this._sortAsc = true;
      this._filter = "";
      this._lastStateSig = "";
      this._initialized = false;
      this._devices = [];
      this._fetchedDevices = [];
      this._fetchInFlight = false;
      this._hasMatter = false;
      this._retryTimer = null;
      this._uid = "dsc" + Math.random().toString(36).slice(2, 8);
      this._admin = false;
      this._menu = null;
      this._onDocClick = null;
      this._onKeyDown = null;
    }

    disconnectedCallback() {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._closeMenu();
    }

    setConfig(config) {
      this.config = config;
      this._dsEntity = config.entity || "sensor.down_devices";
      this._msEntity = config.matter_entity !== undefined ? config.matter_entity : "sensor.matter_saver_devices";
    }

    set hass(hass) {
      this._hass = hass;
      const dsState = hass.states[this._dsEntity];
      const msState = this._msEntity ? hass.states[this._msEntity] : null;
      // Signature based only on state + down_count (not the full attribute blob),
      // so we don't re-render on unrelated attribute noise.
      const sig = (dsState ? `${dsState.state}|${dsState.attributes.down_count ?? ""}|${dsState.attributes.gated_count ?? ""}` : "") +
                  "::" +
                  (msState ? `${msState.state}` : "");
      if (!this._initialized) {
        this._fullRender();
        this._initialized = true;
        this._fetchDevices();
      } else if (sig !== this._lastStateSig) {
        this._lastStateSig = sig;
        this._fetchDevices();
      }
    }

    async _fetchDevices(attempt = 0) {
      if (!this._hass || this._fetchInFlight) return;
      this._fetchInFlight = true;
      let devices = null;
      try {
        const res = await this._hass.callWS({ type: "device_saver/get_devices" });
        devices = (res && res.devices) || [];
        this._fetchedDevices = devices;
        this._updateTable();
      } catch (e) {
        console.error("device-saver-card: WS fetch failed", e);
      } finally {
        this._fetchInFlight = false;
      }

      // An empty answer right after a Home Assistant restart is not a result,
      // it's a race: the coordinator hasn't built its cache yet. Since we only
      // re-fetch when the down count changes, that empty list would otherwise
      // stick until the count happens to move -- a card left open across a
      // restart stayed on "no devices found" indefinitely. Same for a failed
      // call, where devices stays null.
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      if ((devices === null || devices.length === 0) && attempt < EMPTY_RETRY_DELAYS.length) {
        this._retryTimer = setTimeout(
          () => this._fetchDevices(attempt + 1),
          EMPTY_RETRY_DELAYS[attempt],
        );
      }
    }

    _fullRender() {
      const dsState = this._hass.states[this._dsEntity];
      if (!dsState) {
        this.innerHTML = `<ha-card header="Device Saver"><div class="card-content">Entity not found: ${this._dsEntity}</div></ha-card>`;
        return;
      }
      this._admin = !!(this._hass.user && this._hass.user.is_admin);
      const msState0 = this._msEntity ? this._hass.states[this._msEntity] : null;
      this._lastStateSig = `${dsState.state}|${dsState.attributes.down_count ?? ""}|${dsState.attributes.gated_count ?? ""}::` +
        (msState0 ? `${msState0.state}` : "");

      this.innerHTML = `
        <ha-card>
          <style>
            .ds-header { padding: 16px 16px 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
            .ds-title { font-size: 1.2em; font-weight: 500; }
            .ds-stats { display: flex; gap: 12px; font-size: 0.9em; flex-wrap: wrap; }
            .ds-stat { display: flex; align-items: center; gap: 4px; }
            .ds-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
            .ds-dot.online { background: #4caf50; }
            .ds-dot.down { background: #f44336; }
            .ds-dot.gated { background: #78909c; }
            .ds-search-wrap { padding: 0 16px 8px; }
            .ds-search {
              width: 100%; padding: 8px 12px; box-sizing: border-box;
              border: 1px solid var(--divider-color, #333);
              border-radius: 8px; font-size: 0.9em;
              background: var(--card-background-color, #1c1c1c);
              color: var(--primary-text-color, #fff); outline: none;
            }
            .ds-search:focus { border-color: var(--primary-color, #03a9f4); }
            .ds-search::placeholder { color: var(--secondary-text-color, #999); }
            .ds-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
            .ds-table th {
              text-align: left; padding: 8px 12px; cursor: pointer; user-select: none;
              border-bottom: 2px solid var(--divider-color, #333);
              color: var(--secondary-text-color, #999);
              font-weight: 500; font-size: 0.85em; text-transform: uppercase; white-space: nowrap;
            }
            .ds-table th:hover { color: var(--primary-color, #03a9f4); }
            .ds-table th.sorted { color: var(--primary-color, #03a9f4); }
            .ds-table th .arrow { font-size: 0.7em; margin-left: 2px; }
            .ds-table td { padding: 6px 12px; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.05)); }
            .ds-table tr:last-child td { border-bottom: none; }
            .ds-group-header td {
              padding: 16px 12px 8px; font-weight: 700; font-size: 1.1em;
              color: var(--primary-color, #03a9f4);
              border-bottom: 2px solid var(--primary-color, #03a9f4);
              background: var(--card-background-color, transparent); letter-spacing: 0.02em;
            }
            .ds-status { display: flex; align-items: center; gap: 6px; }
            .ds-down-row { opacity: 0.7; }
            .ds-gated-row { opacity: 0.5; }
            .ds-no-results td { text-align: center; padding: 20px; color: var(--secondary-text-color, #999); }
            .ds-conn-badge {
              display: inline-block; padding: 2px 8px; border-radius: 4px;
              font-size: 0.85em; font-weight: 500;
            }
            .ds-tier { font-size: 0.85em; }
            .ds-tier.critical { color: #f44336; }
            .ds-tier.slow { color: #78909c; }
            .ds-battery { display: flex; align-items: center; gap: 4px; }
            .ds-battery.low { color: #ff9800; }
            .ds-battery.critical { color: #f44336; }
            .ds-errors .count { font-weight: 500; }
            .ds-errors .comment { font-size: 0.85em; color: var(--secondary-text-color, #999); font-style: italic; }
            .ds-lastseen { color: var(--secondary-text-color, #999); font-size: 0.9em; }
            .ds-actions { width: 34px; text-align: right; padding-right: 8px !important; }
            .ds-kebab {
              background: none; border: none; cursor: pointer; font-size: 1.1em; line-height: 1;
              color: var(--secondary-text-color, #999); padding: 2px 6px; border-radius: 4px;
            }
            .ds-kebab:hover { color: var(--primary-color, #03a9f4); background: rgba(127,127,127,0.12); }
            .ds-menu {
              position: fixed; z-index: 12; min-width: 230px; padding: 6px; border-radius: 10px;
              background: var(--card-background-color, #1c1c1c);
              border: 1px solid var(--divider-color, #333);
              box-shadow: 0 6px 24px rgba(0,0,0,0.4); font-size: 0.9em;
            }
            .ds-menu .head {
              padding: 6px 10px 8px; margin-bottom: 4px; font-size: 0.85em;
              color: var(--secondary-text-color, #999);
              border-bottom: 1px solid var(--divider-color, #333);
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .ds-menu .item {
              display: block; width: 100%; text-align: left; background: none; border: none;
              color: var(--primary-text-color, #fff); padding: 8px 10px; border-radius: 6px;
              cursor: pointer; font-size: 1em; font-family: inherit;
            }
            .ds-menu .item:hover { background: rgba(127,127,127,0.14); }
            .ds-menu .gateform { display: flex; gap: 6px; padding: 4px 6px; }
            .ds-menu .gateform input {
              flex: 1 1 auto; min-width: 0; padding: 6px 8px; border-radius: 6px;
              border: 1px solid var(--divider-color, #333);
              background: var(--card-background-color, #1c1c1c);
              color: var(--primary-text-color, #fff);
              font-size: 0.95em; font-family: inherit; outline: none;
            }
            .ds-menu .gateform input:focus { border-color: var(--primary-color, #03a9f4); }
            .ds-menu .gateform .item { width: auto; flex: 0 0 auto; border: 1px solid var(--divider-color, #333); }
            .ds-menu .err { padding: 4px 10px 6px; color: #f44336; font-size: 0.85em; }
          </style>
          <div class="ds-header">
            <span class="ds-title">Device Health</span>
            <div class="ds-stats" id="ds-stats"></div>
          </div>
          <div class="ds-search-wrap">
            <input type="text" class="ds-search" id="ds-search" placeholder="Filter devices..." />
          </div>
          <div class="card-content" style="padding: 0 8px 16px; overflow-x: auto;">
            <table class="ds-table">
              <thead id="ds-thead"></thead>
              <tbody id="ds-tbody"></tbody>
            </table>
          </div>
          ${this._admin ? `<datalist id="${this._uid}-gates">${this._gateOptions()}</datalist>` : ""}
        </ha-card>
      `;

      this.querySelector("#ds-thead").addEventListener("click", (e) => {
        const th = e.target.closest("th[data-field]");
        if (!th) return;
        const field = th.dataset.field;
        if (this._sortField === field) { this._sortAsc = !this._sortAsc; }
        else { this._sortField = field; this._sortAsc = true; }
        this._updateTable();
      });

      this.querySelector("#ds-search").addEventListener("input", (e) => {
        this._filter = e.target.value.toLowerCase();
        this._updateTable();
      });

      this.querySelector("#ds-tbody").addEventListener("click", (e) => {
        const btn = e.target.closest(".ds-kebab");
        if (!btn) return;
        e.stopPropagation();
        this._openMenu(btn, btn.dataset.id);
      });

      this._updateTable();
    }

    _mergeData() {
      let devices = this._fetchedDevices.map(d => ({...d}));

      const msState = this._msEntity ? this._hass.states[this._msEntity] : null;
      this._hasMatter = !!msState;

      if (msState) {
        const matterDevices = msState.attributes.devices || [];
        const matterByName = {};
        for (const md of matterDevices) {
          if (md.name) matterByName[md.name] = md;
        }
        for (const d of devices) {
          if (d.connection_type === "Matter" && matterByName[d.name]) {
            d._matter = matterByName[d.name];
          }
        }
      }
      return devices;
    }

    _updateTable() {
      const dsState = this._hass.states[this._dsEntity];
      if (!dsState) return;
      this._closeMenu();

      let devices = this._mergeData();
      const total = devices.length;
      const downCount = devices.filter(d => d.down).length;
      const gatedCount = devices.filter(d => d.gated).length;
      const onlineCount = total - downCount - gatedCount;

      // Stats by connection type
      const connStats = {};
      for (const d of devices) {
        if (d.down) {
          connStats[d.connection_type] = (connStats[d.connection_type] || 0) + 1;
        }
      }
      const connBreakdown = Object.entries(connStats)
        .map(([c, n]) => `${c}: ${n}`)
        .join(", ");

      const statsEl = this.querySelector("#ds-stats");
      if (statsEl) {
        statsEl.innerHTML = `
          <span class="ds-stat"><span class="ds-dot online"></span> ${onlineCount} online</span>
          <span class="ds-stat"><span class="ds-dot down"></span> ${downCount} down</span>
          ${gatedCount ? `<span class="ds-stat"><span class="ds-dot gated"></span> ${gatedCount} stromlos</span>` : ""}
          ${connBreakdown ? `<span class="ds-stat" style="color:var(--secondary-text-color,#999)">${connBreakdown}</span>` : ""}
        `;
      }

      // Dynamic columns
      const baseCols = [
        ["name", "Name"], ["connection_type", "Connection"], ["tier", "Tier"],
        ["down", "Status"], ["timeout", "Timeout"], ["last_ok", "Last OK"],
      ];
      const matterCols = this._hasMatter ? [
        ["thread_role", "Thread"], ["battery", "Battery"], ["firmware", "Firmware"], ["errors", "Errors"],
      ] : [];
      const allCols = [...baseCols, ...matterCols];
      const CC = allCols.length + (this._admin ? 1 : 0);

      const theadEl = this.querySelector("#ds-thead");
      if (theadEl) {
        theadEl.innerHTML = `<tr>${allCols.map(([f, l]) => this._th(f, l)).join("")}` +
          (this._admin ? `<th class="ds-actions"></th>` : "") + `</tr>`;
      }

      if (this._filter) {
        devices = devices.filter((d) => {
          const parts = [d.name, d.connection_type, d.tier, d.down ? "down" : d.gated ? "stromlos" : "online", d.timeout];
          if (d._matter) parts.push(d._matter.thread_role, d._matter.firmware);
          return parts.join(" ").toLowerCase().includes(this._filter);
        });
      }

      this._devices = devices;

      const tbodyEl = this.querySelector("#ds-tbody");
      if (tbodyEl) {
        if (devices.length === 0) {
          tbodyEl.innerHTML = `<tr class="ds-no-results"><td colspan="${CC}">No devices found</td></tr>`;
        } else {
          const sorted = this._sortDevices(devices);
          tbodyEl.innerHTML = this._groupDevices(sorted, CC);
        }
      }
    }

    _th(field, label) {
      const sorted = this._sortField === field;
      const arrow = sorted ? (this._sortAsc ? " \u25B2" : " \u25BC") : "";
      return `<th data-field="${field}" class="${sorted ? "sorted" : ""}">${label}<span class="arrow">${arrow}</span></th>`;
    }

    _sortDevices(devices) {
      const field = this._sortField;
      const asc = this._sortAsc;
      return [...devices].sort((a, b) => {
        let va, vb;
        // Handle Matter-enriched fields
        if (field === "thread_role") {
          va = a._matter ? a._matter.thread_role : "zzz";
          vb = b._matter ? b._matter.thread_role : "zzz";
        } else if (field === "battery") {
          va = a._matter && a._matter.battery != null ? a._matter.battery : 999;
          vb = b._matter && b._matter.battery != null ? b._matter.battery : 999;
        } else if (field === "firmware") {
          va = a._matter ? (a._matter.firmware || "") : "";
          vb = b._matter ? (b._matter.firmware || "") : "";
        } else if (field === "errors") {
          va = a._matter ? (a._matter.errors || 0) : 0;
          vb = b._matter ? (b._matter.errors || 0) : 0;
        } else if (field === "down") {
          va = a.down ? 0 : a.gated ? 1 : 2; vb = b.down ? 0 : b.gated ? 1 : 2;
        } else if (field === "last_ok") {
          va = a.last_ok || ""; vb = b.last_ok || "";
        } else {
          va = a[field]; vb = b[field];
        }
        if (va == null) va = "";
        if (vb == null) vb = "";
        if (typeof va === "number" && typeof vb === "number") {
          // keep as numbers
        } else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
      });
    }

    _groupDevices(devices, CC) {
      const field = this._sortField;
      let html = ""; let lastGroup = null;
      for (const d of devices) {
        let groupVal = this._groupValue(d, field);
        if (groupVal !== lastGroup) {
          html += `<tr class="ds-group-header"><td colspan="${CC}">${this._escHtml(groupVal)}</td></tr>`;
          lastGroup = groupVal;
        }
        html += this._deviceRow(d);
      }
      return html;
    }

    _groupValue(d, field) {
      switch (field) {
        case "down": return d.down ? "Down" : d.gated ? "Stromlos" : "Online";
        case "connection_type": return d.connection_type || "Andere";
        case "tier": return d.tier === "critical" ? "Critical" : "Slow (Battery)";
        case "timeout": return d.timeout || "Unknown";
        case "thread_role":
          if (!d._matter) return "No Thread Data";
          return this._threadRoleLabel(d._matter.thread_role);
        case "battery":
          if (!d._matter || d._matter.battery == null) return "No Battery";
          if (d._matter.battery < 20) return "Critical (< 20%)";
          if (d._matter.battery < 50) return "Low (< 50%)";
          return "Good (50%+)";
        case "errors":
          if (!d._matter) return "No Data";
          if (!d._matter.errors || d._matter.errors === 0) return "No Errors";
          if (d._matter.errors > 100000) return "Critical";
          if (d._matter.errors > 10000) return "High";
          return "Low";
        default: return "";
      }
    }

    _deviceRow(d) {
      const statusIcon = d.down ? "\uD83D\uDD34" : d.gated ? "\uD83D\uDD0C" : "\uD83D\uDFE2";
      const statusText = d.down ? "down" : d.gated ? "stromlos" : "online";
      const rowClass = d.down ? "ds-down-row" : d.gated ? "ds-gated-row" : "";

      let html = `<tr class="${rowClass}">
        <td>${this._escHtml(d.name)}</td>
        <td>${this._connectionHtml(d.connection_type)}</td>
        <td>${this._tierHtml(d.tier)}</td>
        <td><span class="ds-status">${statusIcon} ${statusText}</span></td>
        <td>${d.timeout || "-"}</td>
        <td>${this._lastOkHtml(d.last_ok)}</td>`;

      if (this._hasMatter) {
        const m = d._matter;
        html += `<td>${m ? this._threadRoleHtml(m.thread_role) : "-"}</td>`;
        html += `<td>${m ? this._batteryHtml(m.battery) : "-"}</td>`;
        html += `<td>${m ? this._firmwareHtml(m.firmware, m.update_available) : "-"}</td>`;
        html += `<td>${m ? this._errorsHtml(m.errors, m.error_comment) : "-"}</td>`;
      }

      if (this._admin) {
        html += `<td class="ds-actions"><button class="ds-kebab" data-id="${this._escHtml(d.device_id)}"
          title="Aktionen">\u22EE</button></td>`;
      }

      html += `</tr>`;
      return html;
    }

    // ------------------------------------------------------------- row menu

    _gateOptions() {
      return Object.keys(this._hass.states)
        .filter((eid) => GATE_DOMAINS.includes(eid.split(".")[0]))
        .sort()
        .map((eid) => {
          const fn = this._hass.states[eid].attributes.friendly_name || "";
          return `<option value="${this._escHtml(eid)}" label="${this._escHtml(fn)}"></option>`;
        })
        .join("");
    }

    _closeMenu() {
      if (this._onDocClick) {
        document.removeEventListener("click", this._onDocClick, true);
        this._onDocClick = null;
      }
      if (this._onKeyDown) {
        document.removeEventListener("keydown", this._onKeyDown, true);
        this._onKeyDown = null;
      }
      if (this._menu) {
        this._menu.remove();
        this._menu = null;
      }
    }

    _openMenu(anchor, deviceId) {
      this._closeMenu();
      const dev = this._fetchedDevices.find((d) => d.device_id === deviceId);
      if (!dev) return;

      const menu = document.createElement("div");
      menu.className = "ds-menu";
      this._menu = menu;
      this.appendChild(menu);
      this._renderMenu(dev);

      const rect = anchor.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;

      this._onDocClick = (e) => {
        if (!menu.contains(e.target)) this._closeMenu();
      };
      this._onKeyDown = (e) => {
        if (e.key === "Escape") this._closeMenu();
      };
      // Capture phase: some HA containers stop propagation before it bubbles up.
      document.addEventListener("click", this._onDocClick, true);
      document.addEventListener("keydown", this._onKeyDown, true);
    }

    _renderMenu(dev) {
      const menu = this._menu;
      if (!menu) return;
      menu.innerHTML = `
        <div class="head">${this._escHtml(dev.name)}</div>
        <button class="item" data-act="exclude">Nicht mehr \u00FCberwachen</button>
        <button class="item" data-act="gate">${dev.gate_entity ? "Power-Gate \u00E4ndern \u2026" : "Power-Gate setzen \u2026"}</button>
        ${dev.gate_entity ? `<button class="item" data-act="ungate">Power-Gate entfernen</button>` : ""}
        <div class="msg"></div>`;

      menu.querySelector('[data-act="exclude"]').addEventListener("click", () =>
        this._deviceAction(dev.device_id, { excluded: true }));
      menu.querySelector('[data-act="gate"]').addEventListener("click", () =>
        this._renderGateForm(dev));
      const ungate = menu.querySelector('[data-act="ungate"]');
      if (ungate) {
        ungate.addEventListener("click", () =>
          this._deviceAction(dev.device_id, { gate_entity: null }));
      }
    }

    _renderGateForm(dev) {
      const menu = this._menu;
      if (!menu) return;
      menu.innerHTML = `
        <div class="head">${this._escHtml(dev.name)}</div>
        <div class="gateform">
          <input type="text" list="${this._uid}-gates" placeholder="switch.\u2026"
                 value="${this._escHtml(dev.gate_entity || "")}">
          <button class="item">OK</button>
        </div>
        <div class="msg"></div>`;

      const input = menu.querySelector("input");
      const submit = () => {
        const value = input.value.trim();
        if (!GATE_DOMAINS.includes(value.split(".")[0])) {
          this._menuError(`Gate-Entity muss ${GATE_DOMAINS.join(", ")} sein.`);
          return;
        }
        if (!this._hass.states[value]) {
          this._menuError(`Entity ${value} gibt es nicht.`);
          return;
        }
        this._deviceAction(dev.device_id, { gate_entity: value });
      };
      menu.querySelector("button.item").addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
      });
      input.focus();
      input.select();
    }

    _menuError(text) {
      const msg = this._menu && this._menu.querySelector(".msg");
      if (msg) msg.innerHTML = `<div class="err">${this._escHtml(text)}</div>`;
    }

    async _deviceAction(deviceId, payload) {
      try {
        await this._hass.callWS(
          Object.assign({ type: "device_saver/set_device", device_id: deviceId }, payload),
        );
        this._closeMenu();
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this._fetchDevices(), RELOAD_SETTLE_MS);
      } catch (e) {
        this._menuError((e && (e.message || e.code)) || String(e));
      }
    }

    _connectionHtml(conn) {
      const colors = {
        "Zigbee": "#ffb300", "Matter": "#9c27b0", "HomeKit": "#00bcd4",
        "WLAN": "#03a9f4", "LAN": "#3f51b5", "Solar": "#ff9800", "Andere": "#78909c",
      };
      const color = colors[conn] || "#78909c";
      return `<span class="ds-conn-badge" style="color:${color};border:1px solid ${color}44">${this._escHtml(conn)}</span>`;
    }

    _tierHtml(tier) {
      return `<span class="ds-tier ${tier}">${tier}</span>`;
    }

    _lastOkHtml(isoStr) {
      if (!isoStr) return `<span class="ds-lastseen">-</span>`;
      const then = new Date(isoStr);
      const now = new Date();
      const diffMin = Math.floor((now - then) / 60000);
      let text;
      if (diffMin < 1) text = "just now";
      else if (diffMin < 60) text = `${diffMin}m ago`;
      else if (diffMin < 1440) text = `${Math.floor(diffMin / 60)}h ago`;
      else text = `${Math.floor(diffMin / 1440)}d ago`;
      return `<span class="ds-lastseen">${text}</span>`;
    }

    _threadRoleLabel(role) {
      const labels = {
        "leader": "Leader", "router": "Router", "reed": "REED",
        "end_device": "End Device", "sed": "Sleepy End Device",
        "unassigned": "Unassigned", "unspecified": "Unspecified",
      };
      return labels[role] || role || "Unknown";
    }

    _threadRoleHtml(role) {
      const label = this._threadRoleLabel(role);
      let color = "var(--secondary-text-color, #999)";
      if (role === "leader") color = "#ffb300";
      else if (role === "router") color = "#4caf50";
      else if (role === "reed") color = "#8bc34a";
      return `<span style="color:${color};font-weight:${role === "leader" ? 700 : 400}">${label}</span>`;
    }

    _batteryHtml(battery) {
      if (battery == null) return "-";
      let cls = "";
      if (battery < 20) cls = "critical";
      else if (battery < 50) cls = "low";
      return `<span class="ds-battery ${cls}">${Math.round(battery)}%</span>`;
    }

    _firmwareHtml(firmware, updateAvailable) {
      if (!firmware) return "-";
      const dot = updateAvailable
        ? `<span class="ds-dot down" style="width:8px;height:8px;display:inline-block;vertical-align:middle;margin-right:4px" title="Update available"></span>`
        : `<span class="ds-dot online" style="width:8px;height:8px;display:inline-block;vertical-align:middle;margin-right:4px" title="Up to date"></span>`;
      return `${dot}${this._escHtml(firmware)}`;
    }

    _errorsHtml(errors, comment) {
      if (!errors || errors === 0) return `<span style="color:#4caf50">0</span>`;
      let color = "#4caf50";
      if (errors > 100000) color = "#f44336";
      else if (errors > 10000) color = "#ff9800";
      else if (errors > 1000) color = "#ffb300";
      const countStr = errors > 999999 ? `${(errors / 1000000).toFixed(1)}M` : errors > 999 ? `${(errors / 1000).toFixed(1)}k` : String(errors);
      let html = `<span class="ds-errors"><span class="count" style="color:${color}">${countStr}</span>`;
      if (comment) html += ` <span class="comment">${this._escHtml(comment)}</span>`;
      html += `</span>`;
      return html;
    }

    _escHtml(str) {
      const div = document.createElement("div");
      div.textContent = str || "";
      return div.innerHTML;
    }

    getCardSize() { return 8; }
  }

  /*
   * Register only once the frontend is loaded. HA's app.js installs the scoped
   * custom element registry polyfill, which replaces customElements with its own
   * map. A module from extra_module_url can run before app.js; defining then puts
   * the element in the native registry only, where Lovelace's customElements.get()
   * cannot see it -> "configuration error" until the page is reloaded. The guard
   * and try/catch stay as a net against a double load (e.g. a leftover /local/
   * resource pointing at the same file).
   */
  function register() {
    if (customElements.get("device-saver-card")) return;
    try {
      customElements.define("device-saver-card", DeviceSaverCard);
    } catch (e) {
      return;
    }
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "device-saver-card",
      name: "Device Saver Card",
      description: "Device health overview with optional Matter Saver integration",
    });
  }

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }

  /*
   * Sidebar down-count badge is provided by Sidebar Organizer's native
   * `notification:` config (sidebar-organizer.yaml → device-saver), keyed to
   * sensor.down_count. The previous hand-injected badge was removed because
   * Sidebar Organizer (accordion_mode) re-renders the sidebar and strips
   * externally injected slot="end" elements, so the badge never survived.
   */

})();
