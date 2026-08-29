# Device Saver

A Home Assistant integration that watches **every** device in your registry and tells you when one stops responding — without drowning you in false alarms.

Most availability monitoring fails in the same two ways: it screams after a restart while integrations are still connecting, and it reports a device as broken when you simply switched it off. Device Saver is built around avoiding both.

## What it does

- **Auto-discovery.** No device picking. Every device in the registry is monitored; you maintain a short exclusion list instead of a long inclusion list.
- **Two speed tiers.** Battery-powered devices report in slowly by nature, so they get their own, longer timeout (default 90 min). Everything else is treated as critical (default 15 min).
- **Power gates.** Map a device to the switch that feeds it. Gate off → the device is reported as *unpowered*, not *down*: no notification, no red count. See [Power gates](#power-gates).
- **Startup grace.** For 5 minutes after a Home Assistant restart, no *new* devices are declared down. This is what stops the classic post-restart notification avalanche. Devices already down before the restart stay down, so nothing is silently "recovered".
- **Connection types.** Devices are classified as Zigbee, Matter, HomeKit, WLAN, LAN, Solar or Other, so the dashboard can group an outage by transport — often the fastest way to see that it is one coordinator failing rather than nine devices.
- **A bundled Lovelace card**, installed and registered automatically.

## Installation

### HACS (recommended)

Device Saver is in the HACS default catalogue.

1. HACS → Integrations → search for **Device Saver** → Download.
2. Restart Home Assistant.
3. Settings → Devices & Services → **Add integration** → Device Saver.

The Lovelace card ships inside the integration and registers itself. You do **not** need to add a resource under Settings → Dashboards → Resources.

### Manual

Copy `custom_components/device_saver/` into your `config/custom_components/` directory and restart Home Assistant.

> **Upgrading from 0.0.x?** Earlier versions required copying `device-saver-card.js` into `www/` by hand and registering it as a Lovelace resource. That resource is now redundant — delete it and the file in `www/`. The card is safe against being loaded twice, so nothing breaks if you leave it for a while.

## Configuration

Set during initial setup, and changeable afterwards under **Configure → Settings**:

| Option | Default | Meaning |
| --- | --- | --- |
| Excluded devices | — | Devices to ignore entirely. Useful for things that are *meant* to be unreachable most of the time. |
| Critical timeout | 15 min | How long a mains-powered device may stay unavailable before it counts as down. |
| Slow timeout | 90 min | The same, for battery-powered devices. |
| Notify service | — | Optional, e.g. `notify.mobile_app_phone`. A persistent notification is always created regardless. |
| Notify on recovered | on | Whether recovery also sends a push. |
| Ignored integrations | `browser_mod`, `unifi` | Devices belonging *exclusively* to these integrations are skipped. UniFi, for example, registers every network client as a device — those are not devices you control. |
| Ignored platforms | `battery_notes`, `unifi` | Entities from these platforms are excluded from the health check because they keep reporting a static value even when the physical device is long gone, which would mask a real outage. |

Options changes reload the config entry immediately.

### Power gates

**Configure → Add power gate** maps a device to a gate entity — a `switch`, an `input_boolean` or a `binary_sensor`.

| Gate state | Result |
| --- | --- |
| `off` | Device is reported as **gated** (deliberately unpowered): `down = false`, reason `gated`. No notification. |
| `on` | Normal detection. The timeout counts from the moment the gate switched on, so the device gets its full boot window. |
| `unavailable` | Normal down detection. A dead smart plug must never mask a real outage. |

No "recovered" push is sent when a device moves from *down* to *gated* — it is switched off, not back.

This is what makes seasonal and scheduled hardware liveable: an air conditioner on a smart plug, a 3D printer on a shared socket, or a car dongle that sleeps with the vehicle, each simply drop out of the down count while their power is off.

**Configure → Remove power gate** lists the existing mappings for removal.

## Entities

| Entity | State | Attributes |
| --- | --- | --- |
| `sensor.down_count` | number of devices down | — |
| `sensor.down_devices` | number of devices down | `down_count`, `gated_count` |
| `binary_sensor.problem` | `on` if anything is down | `down_devices`, `down_count` |

The entity IDs are unprefixed because the entities are not attached to a device. If `sensor.down_count` or `binary_sensor.problem` collides with something you already have, rename it in the entity settings — the integration addresses its entities by unique ID, so a rename is safe.

**The device list is deliberately not exposed as a state attribute.** With a few hundred devices it would exceed Home Assistant's 16 KB attribute limit and hammer the recorder on every change. The full list is available on demand over WebSocket instead:

```js
const { devices } = await hass.connection.sendMessagePromise({
  type: "device_saver/get_devices",
});
```

Each entry has `device_id`, `name`, `tier`, `down`, `gated`, `reason`, `timeout_minutes`, `timeout`, `connection_type` and `last_ok`. This is what the bundled card uses.

## Events

| Event | Data |
| --- | --- |
| `device_saver_device_down` | `device_id`, `device_name`, `tier`, `reason`, `timeout_minutes` |
| `device_saver_device_recovered` | `device_id`, `device_name`, `tier` |

Both are ordinary bus events, so an automation can trigger on them:

```yaml
triggers:
  - trigger: event
    event_type: device_saver_device_down
conditions:
  - condition: template
    value_template: "{{ trigger.event.data.tier == 'critical' }}"
actions:
  - action: notify.persistent_notification
    data:
      message: "{{ trigger.event.data.device_name }} is down"
```

## The card

Add a **Device Saver Card** from the card picker, or in YAML:

```yaml
type: custom:device-saver-card
```

It lists every monitored device with its state, tier, connection type and time since last contact; it is sortable and filterable, groups problems by connection type, and shows gated devices separately as *unpowered*. If [Matter Saver](https://github.com/cnc-lasercraft/matter-saver) is installed, its data is picked up as well.

## How detection works

A device is considered healthy while at least one of its entities holds a usable state. `unavailable` and `unknown` count as bad. When every checked entity goes bad, the clock starts — and it starts at the moment of that good → bad transition, not at the last state *change*.

That distinction matters more than it sounds. A switch that has not changed state for six hours has a six-hour-old last change; measuring from there, it would be declared down the instant it blinked out. In one such episode roughly a thousand entities went unavailable for two minutes and produced 160 false downs in about a minute. Measuring from the transition makes a brief hiccup cost nothing.

The device, entity and tier caches are rebuilt on registry changes — a re-commissioning, a rename or a new device — with a 5 s debounce, so a renamed entity no longer strands its device in a permanent down state.

## Requirements

Home Assistant 2024.6.0 or newer.

## License

MIT — see [LICENSE](LICENSE).
