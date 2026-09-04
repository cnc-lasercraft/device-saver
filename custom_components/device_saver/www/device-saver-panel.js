/*
 * Device Saver Panel
 *
 * The sidebar entry registered by panel.py. It hosts the bundled cards so a
 * fresh installation has a working UI without anyone building a dashboard
 * first — the cards themselves stay usable on any dashboard as before.
 *
 * Tabs are declarative (TAB_SPECS) and hold ordinary Lovelace card configs,
 * rendered through the frontend's own card helpers. That is what lets the panel
 * show built-in cards (the tiles on the Matter tab) next to custom ones, and it
 * keeps "which tabs exist" a data question rather than a code one.
 *
 * Companion integrations are detected, never required: a tab appears only when
 * the integration that owns its cards is actually installed. Same approach the
 * device card already takes with Matter Saver's extra columns.
 *
 * Home Assistant loads this as an ES module via panel_custom's module_url and
 * sets the `hass`, `narrow`, `route` and `panel` properties on the element.
 */
(() => {
  /** True when any entity with this prefix exists — survives a renamed entity. */
  function hasPrefix(hass, prefix) {
    for (const eid in hass.states) {
      if (eid.startsWith(prefix)) return true;
    }
    return false;
  }

  /*
   * Home Assistant draws its own network map for these protocols. Since 2026.9
   * Matter has one too, fed straight from the Matter Server — it knows the real
   * transport and per-direction signal strength, which is more than any card can
   * reconstruct from entity attributes. So link to them instead of competing.
   * Both paths are the ones the integrations' own config dashboards use.
   */
  const NETWORK_MAPS = [
    { component: "matter", label: "Matter-Netzwerkkarte", icon: "mdi:lan", path: "/config/matter/visualization" },
    { component: "zha", label: "Zigbee-Netzwerkkarte", icon: "mdi:zigbee", path: "/config/zha/visualization" },
  ];

  /** Which of those the running installation actually has. */
  const availableMaps = (hass) => {
    const loaded = (hass.config && hass.config.components) || [];
    return NETWORK_MAPS.filter((m) => loaded.includes(m.component));
  };

  const hasMatterSaver = (hass) =>
    !!hass.states["sensor.matter_saver_devices"] || hasPrefix(hass, "sensor.matter_saver_");
  const hasHerold = (hass) =>
    !!hass.states["sensor.herold_letzte_meldung"] || hasPrefix(hass, "sensor.herold_");

  /*
   * Zigbee2MQTT has no Home Assistant network map — it is not an HA integration,
   * its devices arrive through MQTT discovery, and its own map lives inside the
   * add-on's web UI, which cannot be linked into or embedded (the ingress session
   * is not transferable). The community card reads the same data over MQTT, so
   * the map can be shown here after all. The sensor is what the card needs, and
   * it only exists once someone has set this up deliberately.
   */
  const Z2M_MAP_ENTITY = "sensor.zigbee2mqtt_networkmap";
  const hasZigbeeMap = (hass) => !!hass.states[Z2M_MAP_ENTITY];

  /*
   * `requires` gates a tab on its owning integration; `admin` restricts it to
   * administrators. The Matter and Herold entries mirror the views a dashboard
   * would hold for those integrations, so the panel is a full replacement
   * rather than a reduced version of one.
   */
  const TAB_SPECS = [
    {
      id: "devices",
      label: "Geräte",
      cards: [{ type: "custom:device-saver-card" }],
    },
    {
      id: "matter",
      label: "Matter Status",
      requires: hasMatterSaver,
      cards: [
        {
          type: "vertical-stack",
          cards: [
            {
              type: "horizontal-stack",
              cards: [
                { type: "tile", entity: "sensor.matter_saver_devices", name: "Total Devices", icon: "mdi:devices" },
                { type: "tile", entity: "sensor.matter_saver_online", name: "Online", icon: "mdi:check-network", color: "green" },
                { type: "tile", entity: "sensor.matter_saver_offline", name: "Offline", icon: "mdi:close-network", color: "red" },
              ],
            },
            { type: "custom:matter-saver-card", entity: "sensor.matter_saver_devices" },
          ],
        },
      ],
    },
    {
      id: "log",
      label: "Aktivität",
      requires: hasMatterSaver,
      cards: [{ type: "custom:matter-saver-log-card", entity: "sensor.matter_saver_activity_log" }],
    },
    {
      id: "maps",
      label: "Netzwerkkarten",
      requires: (hass) => availableMaps(hass).length > 0,
      cards: (hass) => [
        {
          type: "grid",
          columns: 2,
          square: false,
          cards: availableMaps(hass).map((m) => ({
            type: "button",
            name: m.label,
            icon: m.icon,
            tap_action: { action: "navigate", navigation_path: m.path },
          })),
        },
      ],
    },
    {
      id: "zigbee",
      label: "Zigbee",
      requires: hasZigbeeMap,
      cards: [
        {
          type: "custom:zigbee2mqtt-networkmap",
          entity: Z2M_MAP_ENTITY,
          // A dedicated tab is a whole page; the card's own default of 400 would
          // leave it stranded in white space.
          height: 600,
        },
      ],
    },
    {
      id: "herold",
      label: "Herold",
      requires: hasHerold,
      cards: [{ type: "custom:herold-log-card" }],
    },
    {
      id: "herold-admin",
      label: "Herold Verwaltung",
      requires: hasHerold,
      admin: true,
      cards: [{ type: "custom:herold-admin-card" }],
    },
    {
      id: "settings",
      label: "Einstellungen",
      admin: true,
      cards: [{ type: "custom:device-saver-settings-card" }],
    },
  ];

  // How long to wait for a custom element that a tab needs. Its integration is
  // installed (the tab wouldn't exist otherwise), so this only covers load
  // ordering — past it, the helpers render their own "unknown card" notice.
  const CUSTOM_ELEMENT_TIMEOUT_MS = 5000;

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /** Resolve once the element is defined, or after the timeout either way. */
  function whenDefinedOrTimeout(tag) {
    return Promise.race([
      customElements.whenDefined(tag),
      new Promise((resolve) => setTimeout(resolve, CUSTOM_ELEMENT_TIMEOUT_MS)),
    ]);
  }

  /** Every `custom:` element used anywhere in a card config, however nested. */
  function customTags(config, found = []) {
    if (Array.isArray(config)) {
      for (const item of config) customTags(item, found);
      return found;
    }
    if (!config || typeof config !== "object") return found;
    if (typeof config.type === "string" && config.type.startsWith("custom:")) {
      const tag = config.type.slice(7);
      if (!found.includes(tag)) found.push(tag);
    }
    for (const value of Object.values(config)) {
      if (value && typeof value === "object") customTags(value, found);
    }
    return found;
  }

  class DeviceSaverPanel extends HTMLElement {
    constructor() {
      super();
      this._tab = TAB_SPECS[0].id;
      this._wantedTab = null;
      this._cards = {};
      this._mounting = {};
      this._built = false;
      this._narrow = false;
      this._panelUrl = "device-saver";
    }

    /*
     * Rescue properties Home Assistant set before this element was defined.
     *
     * `ha-panel-custom` waits for the module to load and then creates the
     * element and assigns hass/narrow/route/panel. Our module loads early but
     * defers `define()` to the load event — it has to, or the definition lands
     * in the wrong custom element registry (see register() at the bottom). In
     * that window the assignments become plain own properties on the instance,
     * which then shadow these accessors forever after the upgrade: the setters
     * never run, nothing is built, and the panel is simply blank.
     *
     * The standard lazy-upgrade dance fixes it: take the value, delete the own
     * property, assign again — now it reaches the setter. Order matters, hass
     * last, because it is what triggers the build.
     */
    connectedCallback() {
      for (const prop of ["panel", "narrow", "route", "hass"]) {
        if (Object.prototype.hasOwnProperty.call(this, prop)) {
          const value = this[prop];
          delete this[prop];
          this[prop] = value;
        }
      }
    }

    set hass(hass) {
      const hadHass = !!this._hass;
      this._hass = hass;
      this._build();
      // Companion integrations can finish loading after the panel does, so the
      // tab list is re-evaluated on the first update rather than fixed at build.
      if (hadHass) this._syncTabsIfChanged();
      this._pushHass();
    }

    set narrow(value) {
      this._narrow = !!value;
      this._syncMenuButton();
    }

    set route(value) {
      this._route = value;
      const wanted = (value && value.path ? value.path : "").replace(/^\/+/, "");
      // Held rather than applied: `route` can arrive before `hass`, and until
      // then we know neither whether the user is an admin nor which companion
      // integrations are present — so the wanted tab isn't in the list yet and
      // the wish would be thrown away.
      if (wanted && TAB_SPECS.some((t) => t.id === wanted)) {
        this._wantedTab = wanted;
        this._syncTabs();
      }
    }

    set panel(value) {
      this._panelConfig = value;
      if (value && value.url_path) this._panelUrl = value.url_path;
    }

    get _isAdmin() {
      return !!(this._hass && this._hass.user && this._hass.user.is_admin);
    }

    _visibleTabs() {
      return TAB_SPECS.filter((t) => {
        if (t.admin && !this._isAdmin) return false;
        if (t.requires && !(this._hass && t.requires(this._hass))) return false;
        return true;
      });
    }

    _syncTabsIfChanged() {
      const signature = this._visibleTabs().map((t) => t.id).join(",");
      if (signature === this._tabSignature) return;
      this._tabSignature = signature;
      this._syncTabs();
    }

    _build() {
      if (this._built || !this._hass) return;
      this._built = true;

      this.innerHTML = `
        <style>
          device-saver-panel { display: block; min-height: 100vh; background: var(--primary-background-color, #111); }
          .dsp-head {
            position: sticky; top: 0; z-index: 4;
            background: var(--app-header-background-color, var(--primary-color, #03a9f4));
            color: var(--app-header-text-color, #fff);
            box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.2));
          }
          .dsp-bar { display: flex; align-items: center; gap: 8px; padding: 0 8px; height: var(--header-height, 56px); }
          .dsp-menu {
            display: none; flex: 0 0 auto; background: none; border: none; cursor: pointer;
            color: inherit; padding: 8px; border-radius: 50%; line-height: 0;
          }
          .dsp-menu:hover { background: rgba(255,255,255,0.12); }
          .dsp-menu.show { display: block; }
          .dsp-title { font-size: 1.25em; font-weight: 400; flex: 1 1 auto; padding-left: 8px; }
          /* Eight tabs do not fit a phone: scroll rather than wrap or squeeze. */
          .dsp-tabs {
            display: flex; overflow-x: auto; scrollbar-width: none;
            border-top: 1px solid rgba(255,255,255,0.12);
          }
          .dsp-tabs::-webkit-scrollbar { display: none; }
          .dsp-tabs.dsp-hidden { display: none; }
          .dsp-tab {
            flex: 0 0 auto; background: none; border: none; cursor: pointer; font-family: inherit;
            color: inherit; opacity: 0.7; font-size: 0.9em; white-space: nowrap;
            padding: 12px 16px; border-bottom: 2px solid transparent;
          }
          .dsp-tab:hover { opacity: 1; }
          .dsp-tab.active { opacity: 1; font-weight: 500; border-bottom-color: currentColor; }
          .dsp-body { padding: 8px; }
          .dsp-body > * { display: block; }
          .dsp-hidden { display: none !important; }
        </style>
        <div class="dsp-head">
          <div class="dsp-bar">
            <button class="dsp-menu" id="dsp-menu" title="Menü" aria-label="Menü">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                <path d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2Z"/>
              </svg>
            </button>
            <span class="dsp-title">Device Saver</span>
          </div>
          <div class="dsp-tabs" id="dsp-tabs"></div>
        </div>
        <div class="dsp-body" id="dsp-body"></div>
      `;

      this.querySelector("#dsp-menu").addEventListener("click", () => {
        // The standard way for a panel to open the sidebar on narrow screens.
        this.dispatchEvent(
          new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }),
        );
      });

      this.querySelector("#dsp-tabs").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-tab]");
        if (btn) this._selectTab(btn.dataset.tab);
      });

      this._syncMenuButton();
      this._tabSignature = this._visibleTabs().map((t) => t.id).join(",");
      this._syncTabs();
    }

    _syncMenuButton() {
      const btn = this.querySelector("#dsp-menu");
      if (btn) btn.classList.toggle("show", this._narrow);
    }

    _selectTab(id) {
      if (id === this._tab) return;
      this._tab = id;
      const url = `/${this._panelUrl}/${id}`;
      if (window.location.pathname !== url) {
        try {
          history.pushState(null, "", url);
          this.dispatchEvent(
            new CustomEvent("location-changed", { bubbles: true, composed: true }),
          );
        } catch (e) {
          // A rejected pushState must not cost the user the tab switch.
          console.warn("device-saver-panel: could not update the URL", e);
        }
      }
      this._syncTabs();
    }

    _syncTabs() {
      const tabs = this._visibleTabs();
      if (!tabs.length) return;
      if (this._wantedTab && tabs.some((t) => t.id === this._wantedTab)) {
        this._tab = this._wantedTab;
        this._wantedTab = null;
      }
      if (!tabs.some((t) => t.id === this._tab)) this._tab = tabs[0].id;

      const bar = this.querySelector("#dsp-tabs");
      if (bar) {
        bar.innerHTML = tabs
          .map(
            (t) =>
              `<button class="dsp-tab ${t.id === this._tab ? "active" : ""}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`,
          )
          .join("");
        // A lone tab (a non-admin without companions) needs no tab bar.
        bar.classList.toggle("dsp-hidden", tabs.length < 2);
      }

      this._mountTab();
    }

    /**
     * Build a card element from a Lovelace card config.
     *
     * Goes through the frontend's own helpers so built-in cards (the tiles and
     * stacks on the Matter tab) work exactly as they would on a dashboard.
     * loadCardHelpers is a long-standing frontend global but not a promised API,
     * hence the fallback for the custom cards, which is all we can build alone.
     */
    async _createCard(config) {
      for (const tag of customTags(config)) {
        if (!customElements.get(tag)) await whenDefinedOrTimeout(tag);
      }

      if (typeof window.loadCardHelpers === "function") {
        try {
          const helpers = await window.loadCardHelpers();
          const card = await helpers.createCardElement(config);
          if (card) return card;
        } catch (e) {
          console.warn("device-saver-panel: card helpers failed", config.type, e);
        }
      }

      if (typeof config.type === "string" && config.type.startsWith("custom:")) {
        const card = document.createElement(config.type.slice(7));
        if (typeof card.setConfig === "function") card.setConfig(config);
        return card;
      }

      const fallback = document.createElement("div");
      fallback.textContent = `Karte ${config.type} kann hier nicht dargestellt werden.`;
      return fallback;
    }

    async _mountTab() {
      const body = this.querySelector("#dsp-body");
      if (!body) return;
      const spec = TAB_SPECS.find((t) => t.id === this._tab);
      if (!spec) return;
      const id = spec.id;

      if (!this._cards[id] && !this._mounting[id]) {
        this._mounting[id] = true;
        try {
          // A tab may compute its cards from hass — the map tab lists only the
          // protocols this installation actually has.
          const configs =
            typeof spec.cards === "function" ? spec.cards(this._hass) : spec.cards;
          const container = document.createElement("div");
          // `data-pane`, not `data-tab`: the tab buttons already use that, and
          // one attribute meaning two different things makes the DOM a puzzle.
          container.dataset.pane = id;
          for (const config of configs) {
            const card = await this._createCard(config);
            if (this._hass) card.hass = this._hass;
            container.appendChild(card);
          }
          this._cards[id] = container;
          body.appendChild(container);
        } finally {
          this._mounting[id] = false;
        }
      }

      for (const [key, container] of Object.entries(this._cards)) {
        container.classList.toggle("dsp-hidden", key !== this._tab);
      }
    }

    _pushHass() {
      for (const container of Object.values(this._cards)) {
        for (const card of container.children) card.hass = this._hass;
      }
    }
  }

  /*
   * Same deferred registration as the cards: defining before HA's app.js
   * installs the scoped custom element registry polyfill puts the element in
   * the native registry only, where the frontend cannot see it.
   */
  function register() {
    if (customElements.get("device-saver-panel")) return;
    try {
      customElements.define("device-saver-panel", DeviceSaverPanel);
    } catch (e) {
      /* already defined by a double load */
    }
  }

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
})();
