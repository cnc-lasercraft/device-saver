
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_DEVICES,
    CONF_TIMEOUT_MIN,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    DEFAULT_TIMEOUT_MIN,
    DEFAULT_NOTIFY_RECOVERED,
)


class DeviceSaverConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="Device Saver", data=user_input)

        schema = vol.Schema(
            {
                vol.Required(CONF_DEVICES): selector.DeviceSelector(
                    selector.DeviceSelectorConfig(multiple=True)
                ),
                vol.Optional(CONF_TIMEOUT_MIN, default=DEFAULT_TIMEOUT_MIN): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=1, max=10080, step=1, mode=selector.NumberSelectorMode.BOX, unit_of_measurement="min"
                    )
                ),
                vol.Optional(CONF_NOTIFY_SERVICE, default=""): selector.TextSelector(),
                vol.Optional(CONF_NOTIFY_RECOVERED, default=DEFAULT_NOTIFY_RECOVERED): selector.BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return DeviceSaverOptionsFlow(config_entry)


class DeviceSaverOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, entry: config_entries.ConfigEntry):
        self.entry = entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**self.entry.data, **self.entry.options}

        schema = vol.Schema(
            {
                vol.Required(CONF_DEVICES, default=current.get(CONF_DEVICES, [])): selector.DeviceSelector(
                    selector.DeviceSelectorConfig(multiple=True)
                ),
                vol.Optional(CONF_TIMEOUT_MIN, default=current.get(CONF_TIMEOUT_MIN, DEFAULT_TIMEOUT_MIN)): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=1, max=10080, step=1, mode=selector.NumberSelectorMode.BOX, unit_of_measurement="min"
                    )
                ),
                vol.Optional(CONF_NOTIFY_SERVICE, default=current.get(CONF_NOTIFY_SERVICE, "")): selector.TextSelector(),
                vol.Optional(CONF_NOTIFY_RECOVERED, default=current.get(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)): selector.BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
