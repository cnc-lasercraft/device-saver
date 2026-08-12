# Device Saver

Custom Component für Home Assistant: `device_saver`.
Quellcode liegt auf dem HA-Server unter `/homeassistant/custom_components/device_saver/`.

## SSH-Zugang
```
ssh has
```
Config: Host `has`, HostName `has.sood4.ch`, User `advanced_ssh`, Key `~/.ssh/ha_key`

## HA Logs
Kein `home-assistant.log` vorhanden — siehe `ha_quirks.md` → "HA Logs". Nutze MCP `ha_get_logs`.

## Funktionsweise
- Auto-Discovery aller Devices, O(n) Cache-Build
- IGNORED_INTEGRATIONS: `{"unifi", "browser_mod"}`
- IGNORED_PLATFORMS: `{"battery_notes", "unifi"}`
- Exclusion-Liste: 28 Devices in BOTH `data` AND `options` (synchron halten!)
- Connection Type: Zigbee/Matter/HomeKit/WLAN/Solar/Andere via CONNECTION_TYPE_MAP (inkl. smlight). Matter/HomeKit statt „Thread", da HA den Transport nicht zuverlässig exponiert.
- Timeouts: Critical=15min, Slow=90min (in config entry data gespeichert)
- Power-Gates: Options-Key `power_gates` = Map `{device_id: gate_entity_id}` (Options-Flow-Menü „Power-Gate hinzufügen/entfernen"). Gate-Entity darf `switch`, `input_boolean` oder `binary_sensor` sein (seit v0.0.13; z.B. `binary_sensor.honda_wn7_wach` für das WiCan der Honda WN7). Gate `off` ⇒ `gated=True`, `down=False`, `reason="gated"` (Karte: Gruppe „Stromlos", 🔌). Gate `on` ⇒ normale Logik, Timeout zählt ab Gate-Einschaltzeit (`max(last_ok, gate.last_changed)` — Boot-Fenster). Gate `unavailable` ⇒ normale Down-Logik (toter Shelly maskiert keinen Ausfall). Kein Recovered-Push/Event beim Übergang down→gated. Options-Änderungen lösen via Update-Listener einen Entry-Reload aus (gilt auch für devices_excluded).

## Sensor-Attribute (Performance)
- `sensor.down_devices.state` = down_count (int), Attribute = `{down_count}` — KEINE Device-Liste
- Volllisten-Zugriff für Lovelace-Karte: WS-Command `device_saver/get_devices` (registriert in `__init__.py`)
- Grund: State >255 chars und Attribute >16 KB würden Recorder-Warning + WebSocket-Overload auslösen (siehe `ha_quirks.md`)

## Dashboard / Karte
- "Grundeinstellungen → Probleme" gruppiert nach Connection Type
- Lovelace-Resource `/local/device-saver-card.js?v=N` — nach JS-Update Version bumpen via `ha_config_set_dashboard_resource` (Browser-Cache)

## Sidebar-Badge (Down-Count)
- Roter Kreis mit Down-Count kommt NICHT (mehr) aus `device-saver-card.js` — der hand-injizierte Badge wurde von Sidebar Organizer (accordion_mode) gestrippt. NICHT wieder einbauen.
- Quelle ist Sidebar Organizers native `notification:`-Map in `/homeassistant/www/sidebar-organizer.yaml`, keyed nach `url_path` (`device-saver`) → `sensor.down_count`. Greift nur im SO-Modus „Use YAML File" (sonst localStorage, pro Gerät). Details: `ha_quirks.md` → „Sidebar Organizer (accordion_mode) frisst injizierte Badges".

## GitHub
- Repo: https://github.com/cnc-lasercraft/device-saver
- Branch: main

## Wichtig
- Exclusion-Listen in data UND options synchron halten
- Nicht hetzen, jede Änderung verifizieren
