from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    PLATFORMS,
    CONF_DEVICES_EXCLUDED,
    CONF_POWER_GATES,
    CONF_TIMEOUT_CRIT_MIN,
    CONF_TIMEOUT_SLOW_MIN,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    CONF_IGNORED_INTEGRATIONS,
    CONF_IGNORED_PLATFORMS,
    DEFAULT_TIMEOUT_CRIT_MIN,
    DEFAULT_TIMEOUT_SLOW_MIN,
    DEFAULT_NOTIFY_RECOVERED,
    DEFAULT_IGNORED_INTEGRATIONS,
    DEFAULT_IGNORED_PLATFORMS,
    GATE_DOMAINS,
    MAX_TIMEOUT_MIN,
)
from .coordinator import DeviceSaverCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

LOVELACE_CARDS = ("device-saver-card.js", "device-saver-settings-card.js")


def _gate_entity(value: Any) -> str:
    """A power gate must be something with a meaningful on/off state."""
    entity_id = cv.entity_id(value)
    if entity_id.split(".", 1)[0] not in GATE_DOMAINS:
        raise vol.Invalid(f"gate entity must be one of {', '.join(GATE_DOMAINS)}")
    return entity_id


_MINUTES = vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_TIMEOUT_MIN))

# Only these keys may be written from the frontend, and only in these shapes —
# the card is a client like any other, its payload is not to be trusted.
_OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Optional(CONF_DEVICES_EXCLUDED): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional(CONF_TIMEOUT_CRIT_MIN): _MINUTES,
        vol.Optional(CONF_TIMEOUT_SLOW_MIN): _MINUTES,
        vol.Optional(CONF_NOTIFY_SERVICE): cv.string,
        vol.Optional(CONF_NOTIFY_RECOVERED): cv.boolean,
        vol.Optional(CONF_IGNORED_INTEGRATIONS): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional(CONF_IGNORED_PLATFORMS): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional(CONF_POWER_GATES): vol.Schema({cv.string: _gate_entity}),
    }
)


@callback
def _require_admin(connection) -> None:
    user = connection.user
    if user is None or not user.is_admin:
        raise Unauthorized()


@callback
def _coordinator(hass: HomeAssistant, msg: dict) -> DeviceSaverCoordinator | None:
    """The coordinator addressed by msg, or the only one if none was named."""
    entry_id = msg.get("entry_id")
    for eid, coordinator in hass.data.get(DOMAIN, {}).items():
        if not isinstance(coordinator, DeviceSaverCoordinator):
            continue
        if entry_id is None or eid == entry_id:
            return coordinator
    return None


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/get_devices"}
)
@callback
def _ws_get_devices(hass: HomeAssistant, connection, msg) -> None:
    """Return the full monitored device list on demand (not pushed via state)."""
    items: list[dict] = []
    for coordinator in hass.data.get(DOMAIN, {}).values():
        if not isinstance(coordinator, DeviceSaverCoordinator):
            continue
        data = coordinator.data or {}
        for h in data.values():
            items.append(
                {
                    "device_id": h.device_id,
                    "name": h.device_name,
                    "tier": h.tier,
                    "down": h.down,
                    "gated": h.gated,
                    "gate_entity": h.gate_entity,
                    "reason": h.reason,
                    "timeout_minutes": h.timeout_minutes,
                    "timeout": h.timeout_label,
                    "connection_type": h.connection_type,
                    "last_ok": h.last_ok.isoformat() if h.last_ok else None,
                }
            )
    connection.send_result(msg["id"], {"devices": items})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/get_config",
        vol.Optional("entry_id"): cv.string,
    }
)
@callback
def _ws_get_config(hass: HomeAssistant, connection, msg) -> None:
    """Everything the settings card needs: options, device and gate catalogue."""
    _require_admin(connection)
    coordinator = _coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No Device Saver entry loaded")
        return

    connection.send_result(
        msg["id"],
        {
            "entry_id": coordinator.entry.entry_id,
            "title": coordinator.entry.title,
            "options": coordinator.effective_options(),
            "defaults": {
                CONF_TIMEOUT_CRIT_MIN: DEFAULT_TIMEOUT_CRIT_MIN,
                CONF_TIMEOUT_SLOW_MIN: DEFAULT_TIMEOUT_SLOW_MIN,
                CONF_NOTIFY_RECOVERED: DEFAULT_NOTIFY_RECOVERED,
                CONF_IGNORED_INTEGRATIONS: DEFAULT_IGNORED_INTEGRATIONS,
                CONF_IGNORED_PLATFORMS: DEFAULT_IGNORED_PLATFORMS,
            },
            "gate_domains": list(GATE_DOMAINS),
            "max_timeout_minutes": MAX_TIMEOUT_MIN,
            "devices": coordinator.device_catalogue(),
            "gates": coordinator.gate_catalogue(),
            "known": coordinator.known_domains(),
        },
    )


@callback
def _apply_options(
    hass: HomeAssistant, coordinator: DeviceSaverCoordinator, changes: dict
) -> bool:
    """Merge into the entry's options — same semantics as the options flow.

    Returns whether anything actually changed; an unchanged write is a no-op and
    deliberately does not trigger the reload listener.
    """
    entry = coordinator.entry
    return hass.config_entries.async_update_entry(
        entry, options={**entry.options, **changes}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_config",
        vol.Optional("entry_id"): cv.string,
        vol.Required("options"): _OPTIONS_SCHEMA,
    }
)
@callback
def _ws_set_config(hass: HomeAssistant, connection, msg) -> None:
    """Write settings from the card. The update listener reloads the entry."""
    _require_admin(connection)
    coordinator = _coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No Device Saver entry loaded")
        return

    changed = _apply_options(hass, coordinator, msg["options"])
    connection.send_result(msg["id"], {"changed": changed})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_device",
        vol.Optional("entry_id"): cv.string,
        vol.Required("device_id"): cv.string,
        vol.Optional("excluded"): cv.boolean,
        vol.Optional("gate_entity"): vol.Maybe(_gate_entity),
    }
)
@callback
def _ws_set_device(hass: HomeAssistant, connection, msg) -> None:
    """Single-device actions for the row menu in the device list.

    Read-modify-write happens here rather than in the card so two browser tabs
    acting at once cannot clobber each other's list.
    """
    _require_admin(connection)
    coordinator = _coordinator(hass, msg)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "No Device Saver entry loaded")
        return

    device_id = msg["device_id"]
    current = coordinator.effective_options()
    changes: dict[str, Any] = {}

    if "excluded" in msg:
        excluded = list(current[CONF_DEVICES_EXCLUDED])
        if msg["excluded"]:
            if device_id not in excluded:
                excluded.append(device_id)
        else:
            excluded = [d for d in excluded if d != device_id]
        changes[CONF_DEVICES_EXCLUDED] = excluded

    if "gate_entity" in msg:
        gates = dict(current[CONF_POWER_GATES])
        if msg["gate_entity"] is None:
            gates.pop(device_id, None)
        else:
            gates[device_id] = msg["gate_entity"]
        changes[CONF_POWER_GATES] = gates

    if not changes:
        connection.send_error(msg["id"], "invalid_format", "Nothing to change")
        return

    changed = _apply_options(hass, coordinator, changes)
    connection.send_result(msg["id"], {"changed": changed})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve and auto-load the bundled Lovelace cards.

    The cards ship inside the integration, so HACS installs them along with the
    rest — no manual resource entry and no separate download needed.
    """
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                f"/{DOMAIN}",
                str(Path(__file__).parent / "www"),
                cache_headers=False,
            )
        ]
    )
    for card in LOVELACE_CARDS:
        add_extra_js_url(hass, f"/{DOMAIN}/{card}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = DeviceSaverCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    domain_data = hass.data.setdefault(DOMAIN, {})
    if "_ws_registered" not in domain_data:
        for command in (
            _ws_get_devices,
            _ws_get_config,
            _ws_set_config,
            _ws_set_device,
        ):
            websocket_api.async_register_command(hass, command)
        domain_data["_ws_registered"] = True

    domain_data[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload on options change so excluded devices / power gates apply immediately."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    coordinator = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if isinstance(coordinator, DeviceSaverCoordinator):
        await coordinator.async_shutdown()
    return True
