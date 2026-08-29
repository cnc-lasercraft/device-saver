
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PLATFORMS
from .coordinator import DeviceSaverCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

LOVELACE_CARDS = ("device-saver-card.js",)


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
                    "reason": h.reason,
                    "timeout_minutes": h.timeout_minutes,
                    "timeout": h.timeout_label,
                    "connection_type": h.connection_type,
                    "last_ok": h.last_ok.isoformat() if h.last_ok else None,
                }
            )
    connection.send_result(msg["id"], {"devices": items})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve and auto-load the bundled Lovelace card.

    The card ships inside the integration, so HACS installs it along with the
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
        websocket_api.async_register_command(hass, _ws_get_devices)
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
