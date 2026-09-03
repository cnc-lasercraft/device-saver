/*
 * Device Saver Panel
 *
 * The sidebar entry registered by panel.py. It hosts the two bundled cards so
 * a fresh installation has a working UI without anyone building a dashboard
 * first — the cards themselves stay usable on any dashboard as before.
 *
 * Home Assistant loads this as an ES module via panel_custom's module_url and
 * sets the `hass`, `narrow`, `route` and `panel` properties on the element.
 */
(() => {
  const TABS = [
    { id: "devices", label: "Geräte", tag: "device-saver-card", admin: false },
    { id: "settings", label: "Einstellungen", tag: "device-saver-settings-card", admin: true },
  ];

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  class DeviceSaverPanel extends HTMLElement {
    constructor() {
      super();
      this._tab = TABS[0].id;
      this._wantedTab = null;
      this._cards = {};
      this._built = false;
      this._narrow = false;
      this._panelUrl = "device-saver";
    }

    set hass(hass) {
      this._hass = hass;
      this._build();
      this._pushHass();
    }

    set narrow(value) {
      this._narrow = !!value;
      this._syncMenuButton();
    }

    set route(value) {
      this._route = value;
      // HA hands us the sub-path below the panel, e.g. "/settings", so a
      // bookmarked tab reopens on the right one.
      const wanted = (value && value.path ? value.path : "").replace(/^\/+/, "");
      // Held rather than applied: `route` can arrive before `hass`, and until
      // then we don't know whether the user is an admin, so the settings tab
      // isn't in the visible list yet and the wish would be thrown away.
      if (wanted && TABS.some((t) => t.id === wanted)) {
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
      return TABS.filter((t) => !t.admin || this._isAdmin);
    }

    _build() {
      if (this._built || !this._hass) return;
      this._built = true;

      this.innerHTML = `
        <style>
          device-saver-panel { display: block; min-height: 100vh; background: var(--primary-background-color, #111); }
          .dsp-bar {
            position: sticky; top: 0; z-index: 4;
            display: flex; align-items: center; gap: 8px;
            padding: 0 8px; height: var(--header-height, 56px);
            background: var(--app-header-background-color, var(--primary-color, #03a9f4));
            color: var(--app-header-text-color, #fff);
            box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.2));
          }
          .dsp-menu {
            display: none; flex: 0 0 auto; background: none; border: none; cursor: pointer;
            color: inherit; padding: 8px; border-radius: 50%; line-height: 0;
          }
          .dsp-menu:hover { background: rgba(255,255,255,0.12); }
          .dsp-menu.show { display: block; }
          .dsp-title { font-size: 1.25em; font-weight: 400; flex: 1 1 auto; padding-left: 8px; }
          .dsp-tabs { display: flex; gap: 4px; flex: 0 0 auto; }
          .dsp-tab {
            background: none; border: none; cursor: pointer; font-family: inherit;
            color: inherit; opacity: 0.7; font-size: 0.95em;
            padding: 0 14px; height: var(--header-height, 56px);
            border-bottom: 2px solid transparent;
          }
          .dsp-tab:hover { opacity: 1; }
          .dsp-tab.active { opacity: 1; font-weight: 500; border-bottom-color: currentColor; }
          .dsp-body { padding: 8px; }
          .dsp-body > * { display: block; }
          .dsp-hidden { display: none !important; }
        </style>
        <div class="dsp-bar">
          <button class="dsp-menu" id="dsp-menu" title="Menü" aria-label="Menü">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2Z"/>
            </svg>
          </button>
          <span class="dsp-title">Device Saver</span>
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
      this._syncTabs();
    }

    _syncMenuButton() {
      const btn = this.querySelector("#dsp-menu");
      if (btn) btn.classList.toggle("show", this._narrow);
    }

    _selectTab(id) {
      if (id === this._tab) return;
      this._tab = id;
      // Keep the URL in step so the tab is bookmarkable and the back button works.
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
      }
      // Single tab (a non-admin sees only the device list) — no tab bar at all.
      if (bar) bar.classList.toggle("dsp-hidden", tabs.length < 2);

      this._mountTab();
    }

    async _mountTab() {
      const body = this.querySelector("#dsp-body");
      if (!body) return;
      const tab = TABS.find((t) => t.id === this._tab);
      if (!tab) return;

      if (!this._cards[tab.id]) {
        // The cards register themselves on the window load event, which may not
        // have fired yet. Creating an element before its definition exists would
        // make our `hass` assignment an own property that shadows the class
        // setter after upgrade — so wait for the definition first.
        await customElements.whenDefined(tab.tag);
        if (this._cards[tab.id]) return;   // a second call won the race
        const card = document.createElement(tab.tag);
        if (typeof card.setConfig === "function") card.setConfig({});
        this._cards[tab.id] = card;
        body.appendChild(card);
        if (this._hass) card.hass = this._hass;
      }

      for (const [id, card] of Object.entries(this._cards)) {
        card.classList.toggle("dsp-hidden", id !== this._tab);
      }
    }

    _pushHass() {
      for (const card of Object.values(this._cards)) {
        card.hass = this._hass;
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
