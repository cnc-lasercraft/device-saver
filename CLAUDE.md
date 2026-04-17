# Device Saver

Custom Component für Home Assistant: `device_saver`.
Quellcode liegt auf dem HA-Server unter `/homeassistant/custom_components/device_saver/`.

## SSH-Zugang
```
ssh has
```
Config: Host `has`, HostName `has.sood4.ch`, User `advanced_ssh`, Key `~/.ssh/ha_key`

## HA Logs
```bash
ssh has 'ha core logs -n 200 | grep device_saver'
```

## Funktionsweise
- Auto-Discovery aller Devices, O(n) Cache-Build
- IGNORED_INTEGRATIONS: `{"unifi", "browser_mod"}`
- IGNORED_PLATFORMS: `{"battery_notes"}`
- Exclusion-Liste: 28 Devices in BOTH `data` AND `options` (synchron halten!)
- Connection Type: Zigbee/Thread/WLAN/Solar/Andere via CONNECTION_TYPE_MAP (inkl. smlight)
- Timeouts: Critical=15min, Slow=90min (in config entry data gespeichert)

## Dashboard
"Grundeinstellungen → Probleme" gruppiert nach Connection Type

## GitHub
Repo noch anzulegen.

## Wichtig
- Exclusion-Listen in data UND options synchron halten
- Nicht hetzen, jede Änderung verifizieren
