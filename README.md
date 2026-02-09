
# Device Saver (Home Assistant)

Device Saver monitors selected devices and alerts when they stop responding (e.g., Zigbee2MQTT / MQTT devices, later extensible to ZHA/Matter).

## Features (v0.1)
- Select devices to monitor (Settings → Devices & services → Add integration → Device Saver)
- Per integration config:
  - Timeout (minutes)
  - Persistent notifications on DOWN
  - Auto-dismiss on RECOVERED
  - Optional mobile notify service (e.g. `notify.mobile_app_...`)
- Entities:
  - `binary_sensor.device_saver_problem`
  - `sensor.device_saver_down_count`
  - `sensor.device_saver_down_devices`

## Install (GitHub / HACS Custom Repo)
1. Put this repo into GitHub.
2. Add it in HACS as a custom repository (Integration).
3. Install "Device Saver".
4. Restart Home Assistant.
5. Add integration: Settings → Devices & services → Add integration → Device Saver

## Notes
- v0.1 uses generic device/entity availability and state-change tracking.
- Zigbee2MQTT-specific improvements (last_seen/availability) can be added in later versions.
