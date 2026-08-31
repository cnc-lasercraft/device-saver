# Device Saver

Custom Component für Home Assistant: `device_saver`.
**Quelle ist dieses Repo** — seit v1.0.0 (29.08.2026) wird über HACS deployt, nicht mehr von Hand per SSH:
Tag + GitHub-Release erstellen → `ha_manage_hacs(action="update_information")` (HACS pollt sonst nur alle ~48 h)
→ `ha_manage_hacs(action="download", version="vX.Y.Z")` → HA-Restart. Der Pfad auf dem Server
(`/homeassistant/custom_components/device_saver/`) ist dann HACS-verwaltet — nicht mehr direkt editieren,
sonst weicht HACS' Buchhaltung vom Dateistand ab (war bis 29.08. der Fall: HACS meldete v0.0.11, live lief v0.0.17).

## SSH-Zugang
```
ssh has
```
Config: Host `has`, HostName `has.sood4.ch`, User `advanced_ssh`, Key `~/.ssh/ha_key`

## HA Logs
Kein `home-assistant.log` vorhanden — siehe `ha_quirks.md` → "HA Logs". Nutze MCP `ha_get_logs`.

## Funktionsweise
- Auto-Discovery aller Devices, O(n) Cache-Build
- Ignored Integrations/Platforms: seit v0.0.16 über Options-Flow „Einstellungen" konfigurierbar (`ignored_integrations`, `ignored_platforms`); Defaults: Integrations `{"unifi", "browser_mod"}`, Platforms `{"battery_notes", "unifi"}` (in `const.py`)
- Startup-Grace (v0.0.16): In den ersten 5 min nach Start (`STARTUP_GRACE_MIN`) werden keine NEUEN Downs deklariert — verhindert den Restart-Spike (down_count sprang auf 145–285, Notification-Schwall). Vorher schon done Devices bleiben down (keine False-Recoveries).
- Timeout-Basis (v0.0.17): `_last_ok` wird auch beim Übergang gut→schlecht auf `now` gesetzt. Vorher zählte der Timeout ab dem letzten *guten State-Change* — ruhige Geräte (Switch seit Stunden unverändert) waren beim Wechsel nach `unavailable` sofort down (26.08.: ~1000 Entities 2 min unavailable → 160 False-Downs in 65 s). Code-Änderungen an der CC brauchen einen HA-Restart, Entry-Reload reicht nicht.
- Store-Hygiene (v0.0.16): Beim Persistieren werden `last_ok`/`down_state` auf aktuell getrackte Device-IDs gefiltert — keine verwaisten Einträge mehr.
- Exclusion-Liste (`devices_excluded`): **`options` ist massgebend** (`_cfg()` liest options vor data). Stand 26.08.2026: 17 Devices in options (16 Huawei-Optimizer `2102313TTENSP…` + browser_mod), 4 verwaiste IDs entfernt; `data` enthält noch die alte 28er-Liste aus der Erstkonfiguration — irrelevant, nicht pflegen. Pflege über Options-Flow «Einstellungen» (MCP: `ha_set_integration` mit `next_step_id: settings` + ALLE Felder mitschicken). Verwaiste IDs erkennt man über Abgleich mit `core.device_registry`.
- Connection Type: Zigbee/Matter/HomeKit/WLAN/LAN/Solar/Andere via CONNECTION_TYPE_MAP (inkl. smlight; `vitogate_wp` → LAN). Matter/HomeKit statt „Thread", da HA den Transport nicht zuverlässig exponiert. MQTT ist NICHT pauschal Zigbee (seit v0.0.14): nur Devices mit Registry-Identifier `mqtt/zigbee2mqtt*` gelten als Zigbee, generische MQTT-Discovery-Devices (z.B. WiCAN) seit v0.0.15 als „WLAN" (überstimmbar durch spezifischeren Config-Entry am selben Device).
- Timeouts: Critical=15min, Slow=90min (in config entry data gespeichert)
- Power-Gates: Options-Key `power_gates` = Map `{device_id: gate_entity_id}` (Options-Flow-Menü „Power-Gate hinzufügen/entfernen"). Gate-Entity darf `switch`, `input_boolean` oder `binary_sensor` sein (seit v0.0.13; z.B. `binary_sensor.honda_wn7_wach` für das WiCan der Honda WN7). Gate `off` ⇒ `gated=True`, `down=False`, `reason="gated"` (Karte: Gruppe „Stromlos", 🔌). Gate `on` ⇒ normale Logik, Timeout zählt ab Gate-Einschaltzeit (`max(last_ok, gate.last_changed)` — Boot-Fenster). Gate `unavailable` ⇒ normale Down-Logik (toter Shelly maskiert keinen Ausfall). Kein Recovered-Push/Event beim Übergang down→gated. Options-Änderungen lösen via Update-Listener einen Entry-Reload aus (gilt auch für devices_excluded). 7 Gates aktiv: Klima DG, Walldisplay OG, Honda WN7 (`binary_sensor.honda_wn7_wach`), ESP32 Klima Büro (`switch.shelly_1pm_g4_eg_klima_buero`, Shelly 1PM Gen4 16 A @ 10.1.5.160, seit 26.08.2026 — ersetzt den PM Mini + Template-Helper `binary_sensor.buro_klima_zuleitung`), sowie die 3 Prusa Core One (prusa-core-one/-02/-l, alle → `switch.shelly_1pm_g4_eg_buero_prusa_3d` = gemeinsame Büro-Dose; Auto-Off-Automation „Prusa Drucker Auto-Off" schaltet sie ab).

## Sensor-Attribute (Performance)
- `sensor.down_devices.state` = down_count (int), Attribute = `{down_count}` — KEINE Device-Liste
- Volllisten-Zugriff für Lovelace-Karte: WS-Command `device_saver/get_devices` (registriert in `__init__.py`)
- Grund: State >255 chars und Attribute >16 KB würden Recorder-Warning + WebSocket-Overload auslösen (siehe `ha_quirks.md`)

## Dashboard / Karte
- "Grundeinstellungen → Probleme" gruppiert nach Connection Type
- **Karte ist seit v1.0.0 in der Integration gebündelt**: liegt unter `custom_components/device_saver/www/`,
  wird von `async_setup` via `StaticPathConfig` + `add_extra_js_url` unter `/device_saver/device-saver-card.js`
  selbst registriert. **Keine Lovelace-Resource mehr** — der alte Eintrag `/local/device-saver-card.js?v=N` und
  die Datei in `/homeassistant/www/` wurden am 29.08.2026 entfernt. Kein Versions-Bump nötig; `cache_headers=False`.
- Die Karte ist in eine IIFE gewickelt; die Registrierung selbst hängt seit v1.1.2 am `load`-Event
  (`register()` am Dateiende, Guard + `try/catch` darin). Grund: HA installiert mit `app.js` den
  Scoped-Custom-Element-Registry-Polyfill; ein `define()` davor landet nur in der nativen Registry und ist
  für Lovelace unsichtbar → sporadischer „Konfigurationsfehler", den erst ein Reload heilt. Der frühere
  Guard am Modulanfang ist bewusst entfernt — er hätte im Doppelload-Fall `register()` verhindert.
  Details: `ha_quirks.md` → „`define()` vor `app.js` landet in der falschen Registry".
- Manifest braucht deshalb `dependencies: [frontend, http]` und ein `config_entry_only`-`CONFIG_SCHEMA`.

## Entities (v1.1.0)
- Die drei Entities hängen an einem Service-Device „Device Saver" (`entity.py` → `device_info()`).
- **Diese Instanz behält die alten IDs** `sensor.down_count`, `sensor.down_devices`, `binary_sensor.problem` —
  `entity_registry.async_get_or_create` leitet eine `entity_id` nur beim ersten Auftauchen einer `unique_id` ab
  und ruft für bekannte `async_update_entity()` ohne `new_entity_id`. Verifiziert nach dem Restart 29.08.
  Neuinstallationen bekommen `sensor.device_saver_down_count` etc.
- Nebeneffekt: Die Anzeigenamen tragen jetzt das Device-Präfix („Device Saver Down Count" statt „Down Count").
- Kein Self-Monitoring: der Coordinator überspringt `DeviceEntryType.SERVICE`.

## Sidebar-Badge (Down-Count)
- Roter Kreis mit Down-Count kommt NICHT (mehr) aus `device-saver-card.js` — der hand-injizierte Badge wurde von Sidebar Organizer (accordion_mode) gestrippt. NICHT wieder einbauen.
- Quelle ist Sidebar Organizers native `notification:`-Map in `/homeassistant/www/sidebar-organizer.yaml`, keyed nach `url_path` (`device-saver`) → `sensor.down_count`. Greift nur im SO-Modus „Use YAML File" (sonst localStorage, pro Gerät). Details: `ha_quirks.md` → „Sidebar Organizer (accordion_mode) frisst injizierte Badges".

## GitHub
- Repo: https://github.com/cnc-lasercraft/device-saver
- Branch: main

## Wichtig
- Exclusion-Liste nur in `options` pflegen (data ist historisch)
- Nicht hetzen, jede Änderung verifizieren
