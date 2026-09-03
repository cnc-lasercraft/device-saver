"""Sidebar panel registration.

The panel gives a fresh installation a working UI without the user having to
build a dashboard first. It is deliberately conservative about the URL path it
claims: an existing dashboard on the same path keeps it.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.start import async_at_started

from .const import (
    DOMAIN,
    DEVICE_NAME,
    CONF_PANEL,
    CONF_PANEL_PATH,
    DEFAULT_PANEL,
    DEFAULT_PANEL_PATH,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_MODULE,
)

LOGGER = logging.getLogger(__name__)


def _cfg(entry: ConfigEntry, key: str, default: Any) -> Any:
    if key in entry.options:
        return entry.options[key]
    return entry.data.get(key, default)


async def async_setup_panel(hass: HomeAssistant, entry: ConfigEntry) -> CALLBACK_TYPE:
    """Register the sidebar panel, returning a callable that removes it again."""
    if not _cfg(entry, CONF_PANEL, DEFAULT_PANEL):
        return lambda: None

    path = str(_cfg(entry, CONF_PANEL_PATH, DEFAULT_PANEL_PATH) or "").strip()
    if not path:
        return lambda: None

    # Registered path, or None while unregistered — closed over by the remover
    # because registration happens later, after HA has started.
    state: dict[str, str | None] = {"path": None}

    async def _register(_hass: HomeAssistant) -> None:
        """Claim the path once every dashboard has registered its own panel.

        Doing this during setup would race the lovelace component: if we won,
        a user's hand-made dashboard on the same path would silently lose its
        sidebar entry. Registering after start means a conflict is merely
        detected instead of caused.
        """
        try:
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path=path,
                webcomponent_name=PANEL_COMPONENT,
                module_url=f"/{DOMAIN}/{PANEL_MODULE}",
                sidebar_title=DEVICE_NAME,
                sidebar_icon=PANEL_ICON,
                require_admin=False,
                embed_iframe=False,
            )
        except ValueError:
            # async_register_built_in_panel raises when the path is taken and
            # update=False. Never overwrite — say so and leave it alone.
            LOGGER.warning(
                "Device Saver: sidebar panel not registered, '%s' is already in "
                "use (usually a dashboard of the same name). Pick another path "
                "in the Device Saver settings, or switch the panel off",
                path,
            )
            return
        state["path"] = path
        LOGGER.debug("Device Saver panel registered at /%s", path)

    cancel_start = async_at_started(hass, _register)

    @callback
    def _remove() -> None:
        cancel_start()
        if state["path"] is not None:
            frontend.async_remove_panel(hass, state["path"])
            state["path"] = None

    return _remove
