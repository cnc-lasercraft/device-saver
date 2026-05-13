
from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PLATFORMS
from .coordinator import DeviceSaverCoordinator


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
                    "reason": h.reason,
                    "timeout_minutes": h.timeout_minutes,
                    "timeout": h.timeout_label,
                    "connection_type": h.connection_type,
                    "last_ok": h.last_ok.isoformat() if h.last_ok else None,
                }
            )
    connection.send_result(msg["id"], {"devices": items})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = DeviceSaverCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    domain_data = hass.data.setdefault(DOMAIN, {})
    if "_ws_registered" not in domain_data:
        websocket_api.async_register_command(hass, _ws_get_devices)
        domain_data["_ws_registered"] = True

    domain_data[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    coordinator = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if isinstance(coordinator, DeviceSaverCoordinator):
        await coordinator.async_shutdown()
    return True
