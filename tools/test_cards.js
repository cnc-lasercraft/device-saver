/*
 * Headless smoke test for both Device Saver cards.
 *
 * Renders them against a fake hass and drives the interactions: row menu,
 * exclusion toggles, power gates, dirty state and save payload. Lives outside
 * custom_components/, so it is not shipped to users.
 *
 *   npm install jsdom && node tools/test_cards.js
 */
const fs = require("fs");
const { JSDOM } = require("jsdom");

const path = require("path");
const WWW = path.join(__dirname, "..", "custom_components", "device_saver", "www");

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? "  -> " + extra : ""}`);
  }
}

// ---------------------------------------------------------------- fake hass
const CATALOGUE = [
  { device_id: "d_klima", name: "Klima DG", manufacturer: "Tado", model: "X",
    connection_type: "WLAN", tier: "critical", entity_count: 5, excluded: false, status: "ok" },
  { device_id: "d_slzb", name: "SLZB Garage", manufacturer: "SMLIGHT", model: "06Mg",
    connection_type: "Zigbee", tier: "critical", entity_count: 9, excluded: false, status: "ok" },
  { device_id: "d_opt1", name: "Huawei Optimizer 1", manufacturer: "Huawei", model: "SUN",
    connection_type: "Solar", tier: "critical", entity_count: 2, excluded: true, status: "ok" },
  { device_id: "d_gone", name: "d_gone", manufacturer: null, model: null,
    connection_type: "Andere", tier: "critical", entity_count: 0, excluded: true, status: "missing" },
  { device_id: "d_bm", name: "Walldisplay browser_mod", manufacturer: null, model: null,
    connection_type: "Andere", tier: "critical", entity_count: 0, excluded: true, status: "not_monitored" },
];

const SAVED_OPTIONS = {
  devices_excluded: ["d_opt1", "d_gone", "d_bm"],
  timeout_critical_minutes: 15,
  timeout_slow_minutes: 90,
  notify_service: "notify.mobile_app_x",
  notify_recovered: true,
  ignored_integrations: ["browser_mod", "unifi"],
  ignored_platforms: ["battery_notes", "unifi"],
  power_gates: { d_klima: "switch.shelly_klima" },
  panel: true,
  panel_path: "device-saver",
};

const DEVICES = [
  { device_id: "d_klima", name: "Klima DG", tier: "critical", down: false, gated: true,
    gate_entity: "switch.shelly_klima", reason: "gated", timeout_minutes: 15, timeout: "15m",
    connection_type: "WLAN", last_ok: new Date().toISOString() },
  { device_id: "d_slzb", name: "SLZB Garage", tier: "critical", down: true, gated: false,
    gate_entity: null, reason: "timeout", timeout_minutes: 15, timeout: "15m",
    connection_type: "Zigbee", last_ok: new Date(Date.now() - 3600e3).toISOString() },
];

function makeHass(calls) {
  return {
    user: { is_admin: true },
    services: { notify: { mobile_app_x: {}, persistent_notification: {} } },
    states: {
      "sensor.down_devices": { state: "1", attributes: { down_count: 1, gated_count: 1 } },
      "switch.shelly_klima": { state: "off", attributes: { friendly_name: "Shelly Klima" } },
      "switch.shelly_prusa": { state: "on", attributes: { friendly_name: "Shelly Prusa" } },
      "binary_sensor.honda_wach": { state: "on", attributes: { friendly_name: "Honda wach" } },
      "input_boolean.test": { state: "on", attributes: { friendly_name: "Test" } },
      "light.wohnzimmer": { state: "on", attributes: { friendly_name: "Licht" } },
    },
    callWS: async (msg) => {
      calls.push(msg);
      if (msg.type === "device_saver/get_devices") return { devices: DEVICES };
      if (msg.type === "device_saver/get_config") {
        return {
          entry_id: "entry1",
          title: "Device Saver",
          options: JSON.parse(JSON.stringify(SAVED_OPTIONS)),
          defaults: {},
          gate_domains: ["switch", "input_boolean", "binary_sensor"],
          max_timeout_minutes: 10080,
          panel_defaults: { panel: true, panel_path: "device-saver" },
          devices: JSON.parse(JSON.stringify(CATALOGUE)),
          gates: [{ device_id: "d_klima", device_name: "Klima DG",
                    gate_entity: "switch.shelly_klima", device_missing: false }],
          known: { integrations: ["browser_mod", "unifi", "shelly"], platforms: ["battery_notes", "unifi"] },
        };
      }
      if (msg.type === "device_saver/set_config") return { changed: true };
      if (msg.type === "device_saver/set_device") return { changed: true };
      throw new Error("unexpected WS " + msg.type);
    },
  };
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  runScripts: "outside-only", pretendToBeVisual: true,
  // pushState is refused against about:blank, so give the document a real origin
  url: "http://home-assistant.local/device-saver-hub",
});
const { window } = dom;
global.window = window;

for (const f of ["device-saver-card.js", "device-saver-settings-card.js", "device-saver-panel.js"]) {
  window.eval(fs.readFileSync(`${WWW}/${f}`, "utf8"));
}
window.dispatchEvent(new window.Event("load"));

const tick = () => new Promise((r) => setTimeout(r, 0));

// jsdom (nwsapi) resolves "#id" through document.getElementById and then checks
// containment, so a second card carrying the same element ids resolves to null.
// Real browsers scope querySelector to the subtree, so this is a harness limit,
// not a card defect — mount one card at a time to work around it.
function mount(tag) {
  window.document.body.innerHTML = "";
  const el = window.document.createElement(tag);
  window.document.body.appendChild(el);
  return el;
}

(async () => {
  console.log("\ndevice-saver-card");
  check("registered", !!window.customElements.get("device-saver-card"));
  check("listed in customCards",
    (window.customCards || []).some((c) => c.type === "device-saver-card"));

  const calls = [];
  const hass = makeHass(calls);
  const card = mount("device-saver-card");
  card.setConfig({ entity: "sensor.down_devices", matter_entity: null });
  card.hass = hass;
  await tick(); await tick();

  const rows = card.querySelectorAll("#ds-tbody tr:not(.ds-group-header)");
  check("rows rendered", rows.length === 2, `got ${rows.length}`);

  const kebabs = card.querySelectorAll(".ds-kebab");
  check("kebab per row for admin", kebabs.length === 2, `got ${kebabs.length}`);

  const headerCells = card.querySelectorAll("#ds-thead th").length;
  const bodyCells = rows[0].querySelectorAll("td").length;
  check("header/body column count match", headerCells === bodyCells,
    `head ${headerCells} vs body ${bodyCells}`);

  const groupSpan = Number(card.querySelector(".ds-group-header td").getAttribute("colspan"));
  check("group header spans every column", groupSpan === headerCells,
    `colspan ${groupSpan} vs ${headerCells}`);

  // open the row menu for the non-gated device
  const slzbKebab = [...kebabs].find((k) => k.dataset.id === "d_slzb");
  slzbKebab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  let menu = card.querySelector(".ds-menu");
  check("menu opens", !!menu);
  check("no ungate entry without a gate", !menu.querySelector('[data-act="ungate"]'));

  menu.querySelector('[data-act="exclude"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick();
  const excludeCall = calls.find((c) => c.type === "device_saver/set_device");
  check("exclude sends set_device",
    excludeCall && excludeCall.device_id === "d_slzb" && excludeCall.excluded === true,
    JSON.stringify(excludeCall));
  check("menu closed after action", !card.querySelector(".ds-menu"));

  // gated device offers removal
  const klimaKebab = [...card.querySelectorAll(".ds-kebab")].find((k) => k.dataset.id === "d_klima");
  klimaKebab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  menu = card.querySelector(".ds-menu");
  check("ungate entry present when gated", !!menu.querySelector('[data-act="ungate"]'));

  // gate form: reject a wrong domain, then accept a real switch
  menu.querySelector('[data-act="gate"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  menu = card.querySelector(".ds-menu");
  let input = menu.querySelector("input");
  check("gate form prefilled with current gate", input.value === "switch.shelly_klima", input.value);

  input.value = "light.wohnzimmer";
  menu.querySelector("button.item").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick();
  check("wrong domain rejected client-side", !!menu.querySelector(".err"));
  check("wrong domain not sent",
    !calls.some((c) => c.type === "device_saver/set_device" && c.gate_entity === "light.wohnzimmer"));

  input.value = "switch.shelly_prusa";
  menu.querySelector("button.item").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick();
  const gateCall = calls.filter((c) => c.type === "device_saver/set_device").pop();
  check("valid gate sent",
    gateCall && gateCall.device_id === "d_klima" && gateCall.gate_entity === "switch.shelly_prusa",
    JSON.stringify(gateCall));

  const gateOpts = card.querySelectorAll("datalist option").length;
  check("gate datalist holds only gateable domains", gateOpts === 4, `got ${gateOpts}`);

  // non-admin gets no action column at all
  const calls2 = [];
  const hass2 = makeHass(calls2);
  hass2.user = { is_admin: false };
  const card2 = mount("device-saver-card");
  card2.setConfig({ entity: "sensor.down_devices", matter_entity: null });
  card2.hass = hass2;
  await tick(); await tick();
  check("no kebabs for non-admin", card2.querySelectorAll(".ds-kebab").length === 0);
  check("non-admin column count unchanged",
    card2.querySelectorAll("#ds-thead th").length ===
    card2.querySelector("#ds-tbody tr:not(.ds-group-header)").querySelectorAll("td").length);

  // entity resolution: a fresh install has the prefixed id, an old one does not
  console.log("\nentity resolution");
  for (const [label, id] of [
    ["legacy install", "sensor.down_devices"],
    ["fresh install", "sensor.device_saver_down_devices"],
    ["renamed sensor", "sensor.geraete_ueberwachung"],
  ]) {
    const c = [];
    const h = makeHass(c);
    delete h.states["sensor.down_devices"];
    h.states[id] = { state: "1", attributes: { down_count: 1, gated_count: 1 } };
    const el = mount("device-saver-card");
    el.setConfig({ matter_entity: null });
    el.hass = h;
    await tick(); await tick();
    check(`resolves the sensor on a ${label}`,
      !!el.querySelector("#ds-tbody") && el._dsEntity === id, `${el._dsEntity}`);
  }

  // no sensor yet (restart in progress) must not latch the error state
  const cWait = [];
  const hWait = makeHass(cWait);
  delete hWait.states["sensor.down_devices"];
  const waitCard = mount("device-saver-card");
  waitCard.setConfig({ matter_entity: null });
  waitCard.hass = hWait;
  await tick();
  check("waits instead of failing when the sensor is absent",
    /waiting for the integration/.test(waitCard.textContent), waitCard.textContent.trim());
  hWait.states["sensor.down_devices"] = { state: "1", attributes: { down_count: 1, gated_count: 1 } };
  waitCard.hass = hWait;
  await tick(); await tick();
  check("recovers once the sensor appears", !!waitCard.querySelector("#ds-tbody"));

  // ------------------------------------------------------------------------
  console.log("\ndevice-saver-settings-card");
  check("registered", !!window.customElements.get("device-saver-settings-card"));

  const c3 = [];
  const hass3 = makeHass(c3);
  const sc = mount("device-saver-settings-card");
  sc.setConfig({});
  sc.hass = hass3;
  await tick(); await tick();

  check("loaded config", !!sc.querySelector("#dss-ex-list"));
  check("timeout prefilled", sc.querySelector("#dss-crit").value === "15");
  check("timeout hint humanised", sc.querySelector("#dss-slow-h").textContent === "1 h 30 min",
    sc.querySelector("#dss-slow-h").textContent);
  check("notify prefilled", sc.querySelector("#dss-notify").value === "notify.mobile_app_x");
  check("recovered toggle on", sc.querySelector("#dss-recovered").checked);
  check("excluded count", sc.querySelector("#dss-ex-count").textContent === "(3)",
    sc.querySelector("#dss-ex-count").textContent);
  check("stale exclusion flagged", !!sc.querySelector(".dss-stale"));
  check("redundant exclusion flagged", !!sc.querySelector(".dss-warn"));
  check("excluded devices sort first",
    sc.querySelector(".dss-dev").classList.contains("on"));
  check("gate row rendered", sc.querySelectorAll(".dss-gate").length === 1);
  check("gate state shown as off",
    sc.querySelector(".dss-gs").textContent === "aus", sc.querySelector(".dss-gs").textContent);
  check("ignore chips rendered", sc.querySelectorAll("#dss-int-chips .dss-chip").length === 2);
  check("save disabled while clean", sc.querySelector("#dss-save").disabled);

  // toggle an exclusion
  const box = sc.querySelector('#dss-ex-list input[data-id="d_klima"]');
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("dirty after toggle", !sc.querySelector("#dss-save").disabled);
  check("count updated", sc.querySelector("#dss-ex-count").textContent === "(4)",
    sc.querySelector("#dss-ex-count").textContent);
  check("row did not re-sort under the cursor",
    sc.querySelector('#dss-ex-list input[data-id="d_klima"]') === box);

  // filter
  sc.querySelector("#dss-ex-filter").value = "slzb";
  sc.querySelector("#dss-ex-filter").dispatchEvent(new window.Event("input", { bubbles: true }));
  check("filter narrows list", sc.querySelectorAll(".dss-dev").length === 1,
    String(sc.querySelectorAll(".dss-dev").length));
  sc.querySelector("#dss-ex-filter").value = "";
  sc.querySelector("#dss-ex-filter").dispatchEvent(new window.Event("input", { bubbles: true }));

  // chips
  sc.querySelector("#dss-plat-input").value = "esphome";
  sc.querySelector("#dss-plat-add").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("platform chip added", sc.querySelectorAll("#dss-plat-chips .dss-chip").length === 3);
  sc.querySelector('#dss-int-chips button[data-rm="unifi"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("integration chip removed", sc.querySelectorAll("#dss-int-chips .dss-chip").length === 1);

  // add a gate
  const devSel = sc.querySelector("#dss-gate-dev");
  check("already-gated device not offered again",
    ![...devSel.options].some((o) => o.value === "d_klima"));
  check("missing device not offered as gate target",
    ![...devSel.options].some((o) => o.value === "d_gone"));
  devSel.value = "d_slzb";
  sc.querySelector("#dss-gate-ent").value = "binary_sensor.honda_wach";
  sc.querySelector("#dss-gate-add").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("gate added to draft", sc.querySelectorAll(".dss-gate").length === 2);

  // reject bad gate entity
  devSel.value = devSel.options[0] ? devSel.options[0].value : "";
  sc.querySelector("#dss-gate-ent").value = "light.wohnzimmer";
  sc.querySelector("#dss-gate-add").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("bad gate domain refused", sc.querySelector("#dss-status").classList.contains("err"));

  // panel section
  check("panel toggle reflects config", sc.querySelector("#dss-panel").checked);
  check("panel path prefilled", sc.querySelector("#dss-panel-path").value === "device-saver");
  const pp = sc.querySelector("#dss-panel-path");
  pp.value = "Device Saver!";
  pp.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("invalid panel path flagged",
    sc.querySelector("#dss-panel-url").textContent === "ungültig",
    sc.querySelector("#dss-panel-url").textContent);
  pp.value = "device-saver-hub";
  pp.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("valid panel path shown as url",
    sc.querySelector("#dss-panel-url").textContent === "/device-saver-hub",
    sc.querySelector("#dss-panel-url").textContent);

  // save
  sc.querySelector("#dss-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(); await tick();
  const save = c3.filter((c) => c.type === "device_saver/set_config").pop();
  check("save sent", !!save);
  if (save) {
    const o = save.options;
    check("save carries entry_id", save.entry_id === "entry1");
    check("save keeps all option keys", Object.keys(o).sort().join(",") ===
      Object.keys(SAVED_OPTIONS).sort().join(","), Object.keys(o).sort().join(","));
    check("exclusion added", o.devices_excluded.includes("d_klima"));
    check("gate added", o.power_gates.d_slzb === "binary_sensor.honda_wach");
    check("existing gate kept", o.power_gates.d_klima === "switch.shelly_klima");
    check("chip edits applied",
      o.ignored_platforms.includes("esphome") && !o.ignored_integrations.includes("unifi"),
      JSON.stringify([o.ignored_platforms, o.ignored_integrations]));
    check("timeouts are numbers",
      typeof o.timeout_critical_minutes === "number" && typeof o.timeout_slow_minutes === "number");
    check("panel path saved", o.panel_path === "device-saver-hub", o.panel_path);
    check("panel flag saved", o.panel === true);
  }

  // reset restores the server state
  const c4 = [];
  const hass4 = makeHass(c4);
  const sc2 = mount("device-saver-settings-card");
  sc2.setConfig({});
  sc2.hass = hass4;
  await tick(); await tick();
  const b2 = sc2.querySelector('#dss-ex-list input[data-id="d_klima"]');
  b2.checked = true;
  b2.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("dirty before reset", !sc2.querySelector("#dss-save").disabled);
  sc2.querySelector("#dss-reset").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("reset clears dirty", sc2.querySelector("#dss-save").disabled);
  check("reset restores count", sc2.querySelector("#dss-ex-count").textContent === "(3)");

  // non-admin
  const c5 = [];
  const hass5 = makeHass(c5);
  hass5.callWS = async (msg) => {
    if (msg.type === "device_saver/get_config") throw { code: "unauthorized", message: "no" };
    return {};
  };
  const sc3 = mount("device-saver-settings-card");
  sc3.setConfig({});
  sc3.hass = hass5;
  await tick(); await tick();
  check("non-admin sees a clear message",
    /Administratoren/.test(sc3.textContent), sc3.textContent.trim());

  // ------------------------------------------------------------------------
  console.log("\ndevice-saver-panel");
  check("registered", !!window.customElements.get("device-saver-panel"));

  const cp = [];
  const hp = makeHass(cp);
  const panel = mount("device-saver-panel");
  panel.panel = { url_path: "device-saver-hub" };
  panel.narrow = false;
  panel.hass = hp;
  await tick(); await tick(); await tick();

  check("chrome rendered", !!panel.querySelector(".dsp-bar"));
  check("both tabs for admin", panel.querySelectorAll(".dsp-tab").length === 2,
    String(panel.querySelectorAll(".dsp-tab").length));
  check("device card mounted", !!panel.querySelector("device-saver-card"));
  check("device card got hass", !!panel.querySelector("device-saver-card").querySelector("#ds-tbody"));
  check("hamburger hidden when wide", !panel.querySelector("#dsp-menu").classList.contains("show"));
  panel.narrow = true;
  check("hamburger shown when narrow", panel.querySelector("#dsp-menu").classList.contains("show"));

  // switching tabs mounts the settings card lazily and updates the URL
  const settingsTab = [...panel.querySelectorAll(".dsp-tab")].find((b) => b.dataset.tab === "settings");
  settingsTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(); await tick(); await tick();
  check("settings card mounted on demand", !!panel.querySelector("device-saver-settings-card"));
  check("url follows the tab", window.location.pathname === "/device-saver-hub/settings",
    window.location.pathname);
  check("device card hidden, settings shown",
    panel.querySelector("device-saver-card").classList.contains("dsp-hidden") &&
    !panel.querySelector("device-saver-settings-card").classList.contains("dsp-hidden"));

  // deep link straight into a tab
  const panel2 = mount("device-saver-panel");
  panel2.panel = { url_path: "device-saver-hub" };
  panel2.route = { path: "/settings" };
  panel2.hass = makeHass([]);
  await tick(); await tick(); await tick();
  check("route selects the tab",
    [...panel2.querySelectorAll(".dsp-tab")].find((b) => b.classList.contains("active")).dataset.tab === "settings");

  // non-admin gets the device list only, with no tab bar
  const panel3 = mount("device-saver-panel");
  const hp3 = makeHass([]);
  hp3.user = { is_admin: false };
  panel3.panel = { url_path: "device-saver-hub" };
  panel3.hass = hp3;
  await tick(); await tick(); await tick();
  check("non-admin has no settings tab",
    ![...panel3.querySelectorAll(".dsp-tab")].some((b) => b.dataset.tab === "settings"));
  check("tab bar hidden with a single tab",
    panel3.querySelector("#dsp-tabs").classList.contains("dsp-hidden"));
  check("non-admin still gets the device list", !!panel3.querySelector("device-saver-card"));

  console.log(`\n${failures ? failures + " FAILURES" : "all checks passed"}`);
  process.exit(failures ? 1 : 0);
})();
