# Device Saver

A Home Assistant integration that watches **every** device in your registry and tells you when one stops responding — without drowning you in false alarms.

Most availability monitoring fails in the same two ways: it screams after a restart while integrations are still connecting, and it reports a device as broken when you simply switched it off. Device Saver is built around avoiding both.

## What it does

- **Auto-discovery.** No device picking. Every device in the registry is monitored; you maintain a short exclusion list instead of a long inclusion list.
- **Two speed tiers.** Battery-powered devices report in slowly by nature, so they get their own, longer timeout (default 90 min). Everything else is treated as critical (default 15 min).
- **Power gates.** Map a device to the switch that feeds it. Gate off → the device is reported as *unpowered*, not *down*: no notification, no red count. See [Power gates](#power-gates).
- **Startup grace.** For 5 minutes after a Home Assistant restart, no *new* devices are declared down. This is what stops the classic post-restart notification avalanche. Devices already down before the restart stay down, so nothing is silently "recovered".
- **Connection types.** Devices are classified as Zigbee, Matter, HomeKit, WLAN, LAN, Solar or Other, so the dashboard can group an outage by transport — often the fastest way to see that it is one coordinator failing rather than nine devices.
- **A sidebar entry**, registered automatically. Device list and settings are usable straight after setup — no dashboard to build first.
- **Bundled Lovelace cards**, installed and registered automatically: a device list and a settings card that configures everything from the dashboard.

## Installation

### HACS (recommended)

Device Saver is in the HACS default catalogue.

1. HACS → Integrations → search for **Device Saver** → Download.
2. Restart Home Assistant.
3. Settings → Devices & Services → **Add integration** → Device Saver.

That's it — a **Device Saver** entry appears in the sidebar with the device list and the settings. The cards ship inside the integration and register themselves, so you do **not** need to add a resource under Settings → Dashboards → Resources, and you do not need to build a dashboard to get started.

### Manual

Copy `custom_components/device_saver/` into your `config/custom_components/` directory and restart Home Assistant.

> **Upgrading from 0.0.x?** Earlier versions required copying `device-saver-card.js` into `www/` by hand and registering it as a Lovelace resource. That resource is now redundant — delete it and the file in `www/`. The card is safe against being loaded twice, so nothing breaks if you leave it for a while.

## Configuration

Everything below can be set two ways, and both write the same config entry options, so they are interchangeable:

- **Settings → Devices & Services → Device Saver → Configure** — the options flow.
- **The settings card** on a dashboard — see [The settings card](#the-settings-card).

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
| Sidebar entry | on | Whether to register the panel. See [The sidebar panel](#the-sidebar-panel). |
| Sidebar entry path | `device-saver` | The URL the panel lives at. |

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

**Configure → Remove power gate** lists the existing mappings for removal. The settings card
does both in one place, and the device list offers *Power-Gate setzen* straight from a device's
row menu — where you already have the device in front of you instead of hunting for its ID.

## Entities

The integration's entities are grouped under a **Device Saver** service device:

| Entity | State | Attributes |
| --- | --- | --- |
| `sensor.device_saver_down_count` | number of devices down | — |
| `sensor.device_saver_down_devices` | number of devices down | `down_count`, `gated_count` |
| `binary_sensor.device_saver_problem` | `on` if anything is down | `down_devices`, `down_count` |

> **Installed before 1.1.0?** Your entities were created before they had a device, so they carry the shorter IDs `sensor.down_count`, `sensor.down_devices` and `binary_sensor.problem`. They keep them — the entity registry derives an entity ID only when it first sees a unique ID, so upgrading changes nothing and no dashboard, automation or template breaks. Rename them in the entity settings if you want the longer form; the integration addresses its entities by unique ID.

**The device list is deliberately not exposed as a state attribute.** With a few hundred devices it would exceed Home Assistant's 16 KB attribute limit and hammer the recorder on every change. The full list is available on demand over WebSocket instead:

```js
const { devices } = await hass.connection.sendMessagePromise({
  type: "device_saver/get_devices",
});
```

Each entry has `device_id`, `name`, `tier`, `down`, `gated`, `gate_entity`, `reason`, `timeout_minutes`, `timeout`, `connection_type` and `last_ok`. This is what the bundled card uses.

Three further commands back the settings card. All are **admin-only** and validate their payload
server-side — the card is just another client:

| Command | Purpose |
| --- | --- |
| `device_saver/get_config` | Current options plus the device catalogue (excluded devices included, so they can be un-excluded), the configured gates, and the integration domains and entity platforms present in this installation. |
| `device_saver/set_config` | Merge validated options into the config entry. Reloads the entry. |
| `device_saver/set_device` | Exclude/re-include a single device or set/clear its power gate. The read-modify-write happens server-side, so two open browser tabs cannot clobber each other's list. |

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

## The sidebar panel

The integration registers its own sidebar entry, so a fresh install has a working UI
immediately. It carries the device list and — for administrators — the settings, as two
tabs; each tab is deep-linkable (`/device-saver/settings`).

**It never takes a path that is already in use.** Registration happens after Home
Assistant has fully started, once every dashboard has claimed its own path. If the path is
taken — typically by a hand-made dashboard of the same name — the panel is skipped and
says so in the log rather than overwriting it:

```
Device Saver: sidebar panel not registered, 'device-saver' is already in use
(usually a dashboard of the same name). Pick another path in the Device Saver
settings, or switch the panel off
```

Registering during setup instead would race the Lovelace component, and winning that race
would silently cost a user their dashboard's sidebar entry. So the two settings — *Sidebar
entry* and *Sidebar entry path* — let you run the panel alongside an existing dashboard,
or switch it off entirely. Changing either applies immediately; no restart.

## The cards

Both ship inside the integration and register themselves — no Lovelace resource to add.

### The device card

Add a **Device Saver Card** from the card picker, or in YAML:

```yaml
type: custom:device-saver-card
```

It lists every monitored device with its state, tier, connection type and time since last contact; it is sortable and filterable, groups problems by connection type, and shows gated devices separately as *unpowered*. If [Matter Saver](https://github.com/cnc-lasercraft/matter-saver) is installed, its data is picked up as well.

`entity` is optional: left out, the card finds the summary sensor itself — the prefixed ID
on installs since 1.1.0, the short one on older installs, and failing both, any sensor
carrying the integration's attributes, which also covers a renamed one.

Administrators additionally get a **⋮ row menu** per device: stop monitoring it, or set, change and
remove its power gate. Non-admins do not see the column at all.

### The settings card

```yaml
type: custom:device-saver-settings-card
```

The whole configuration on one dashboard view: timeouts (with the value spelled out in hours and
days as you type), the notify service, the exclusion list with a search box and *excluded first*
ordering, the power gates including each gate's live state, and the ignore lists as chips picked
from the domains actually present in your installation.

Two details worth knowing:

- **Saving is explicit.** Every write reloads the config entry to rebuild the device cache, so the
  card collects changes and applies them on *Speichern*; *Verwerfen* drops them. The button stays
  disabled until something actually differs.
- **It flags dead entries.** An excluded device that no longer exists in the registry is marked
  *verwaist*, and one that would be skipped anyway — because it belongs only to an ignored
  integration, or has no usable entities — is marked *redundant*. Both used to be findable only by
  hand-diffing the options against `core.device_registry`.

The card is admin-only: everyone else gets a short notice instead, and the backend rejects the
calls regardless of what the frontend shows.

## How detection works

A device is considered healthy while at least one of its entities holds a usable state. `unavailable` and `unknown` count as bad. When every checked entity goes bad, the clock starts — and it starts at the moment of that good → bad transition, not at the last state *change*.

That distinction matters more than it sounds. A switch that has not changed state for six hours has a six-hour-old last change; measuring from there, it would be declared down the instant it blinked out. In one such episode roughly a thousand entities went unavailable for two minutes and produced 160 false downs in about a minute. Measuring from the transition makes a brief hiccup cost nothing.

The device, entity and tier caches are rebuilt on registry changes — a re-commissioning, a rename or a new device — with a 5 s debounce, so a renamed entity no longer strands its device in a permanent down state.

## Requirements

Home Assistant 2024.6.0 or newer.

## License

MIT — see [LICENSE](LICENSE).
