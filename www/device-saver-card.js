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
    const sig = (dsState ? `${dsState.state}|${dsState.attributes.down_count ?? ""}` : "") +
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

  async _fetchDevices() {
    if (!this._hass || this._fetchInFlight) return;
    this._fetchInFlight = true;
    try {
      const res = await this._hass.callWS({ type: "device_saver/get_devices" });
      this._fetchedDevices = (res && res.devices) || [];
      this._updateTable();
    } catch (e) {
      console.error("device-saver-card: WS fetch failed", e);
    } finally {
      this._fetchInFlight = false;
    }
  }

  _fullRender() {
    const dsState = this._hass.states[this._dsEntity];
    if (!dsState) {
      this.innerHTML = `<ha-card header="Device Saver"><div class="card-content">Entity not found: ${this._dsEntity}</div></ha-card>`;
      return;
    }
    const msState0 = this._msEntity ? this._hass.states[this._msEntity] : null;
    this._lastStateSig = `${dsState.state}|${dsState.attributes.down_count ?? ""}::` +
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

    let devices = this._mergeData();
    const total = devices.length;
    const downCount = devices.filter(d => d.down).length;
    const onlineCount = total - downCount;

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
    const CC = allCols.length;

    const theadEl = this.querySelector("#ds-thead");
    if (theadEl) {
      theadEl.innerHTML = `<tr>${allCols.map(([f, l]) => this._th(f, l)).join("")}</tr>`;
    }

    if (this._filter) {
      devices = devices.filter((d) => {
        const parts = [d.name, d.connection_type, d.tier, d.down ? "down" : "online", d.timeout];
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
        va = a.down ? 0 : 1; vb = b.down ? 0 : 1;
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
      case "down": return d.down ? "Down" : "Online";
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
    const statusIcon = d.down ? "\uD83D\uDD34" : "\uD83D\uDFE2";
    const statusText = d.down ? "down" : "online";
    const rowClass = d.down ? "ds-down-row" : "";

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

    html += `</tr>`;
    return html;
  }

  _connectionHtml(conn) {
    const colors = {
      "Zigbee": "#ffb300", "Matter": "#9c27b0", "HomeKit": "#00bcd4",
      "WLAN": "#03a9f4", "Solar": "#ff9800", "Andere": "#78909c",
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

customElements.define("device-saver-card", DeviceSaverCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "device-saver-card",
  name: "Device Saver Card",
  description: "Device health overview with optional Matter Saver integration",
});

/*
 * Sidebar down-count badge is provided by Sidebar Organizer's native
 * `notification:` config (sidebar-organizer.yaml → device-saver), keyed to
 * sensor.down_count. The previous hand-injected badge was removed because
 * Sidebar Organizer (accordion_mode) re-renders the sidebar and strips
 * externally injected slot="end" elements, so the badge never survived.
 */
