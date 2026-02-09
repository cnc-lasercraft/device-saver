from homeassistant.helpers import selector
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    CONF_DEVICES_CRIT, CONF_DEVICES_NORM, CONF_DEVICES_SLOW,
    CONF_TIMEOUT_CRIT_MIN, CONF_TIMEOUT_NORM_MIN, CONF_TIMEOUT_SLOW_MIN,
    DEFAULT_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_NORM_MIN, DEFAULT_TIMEOUT_SLOW_MIN,
    CONF_NOTIFY_SERVICE, CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED,
)

def _minutes_selector():
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=1, max=10080, step=1,
            mode=selector.NumberSelectorMode.BOX,
            unit_of_measurement="min",
        )
    )

_DEVICE_MULTI = selector.DeviceSelector(selector.DeviceSelectorConfig(multiple=True))

class DeviceSaverConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 3

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="Device Saver", data=user_input)

        schema = vol.Schema({
            vol.Optional(CONF_DEVICES_CRIT, default=[]): _DEVICE_MULTI,
            vol.Optional(CONF_DEVICES_NORM, default=[]): _DEVICE_MULTI,
            vol.Optional(CONF_DEVICES_SLOW, default=[]): _DEVICE_MULTI,

            vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=DEFAULT_TIMEOUT_CRIT_MIN): _minutes_selector(),
            vol.Optional(CONF_TIMEOUT_NORM_MIN, default=DEFAULT_TIMEOUT_NORM_MIN): _minutes_selector(),
            vol.Optional(CONF_TIMEOUT_SLOW_MIN, default=DEFAULT_TIMEOUT_SLOW_MIN): _minutes_selector(),

            vol.Optional(CONF_NOTIFY_SERVICE, default=""): selector.TextSelector(),
            vol.Optional(CONF_NOTIFY_RECOVERED, default=DEFAULT_NOTIFY_RECOVERED): selector.BooleanSelector(),
        })
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return DeviceSaverOptionsFlow(config_entry)

class DeviceSaverOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, entry):
        self.entry = entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**self.entry.data, **self.entry.options}

        schema = vol.Schema({
            vol.Optional(CONF_DEVICES_CRIT, default=current.get(CONF_DEVICES_CRIT, [])): _DEVICE_MULTI,
            vol.Optional(CONF_DEVICES_NORM, default=current.get(CONF_DEVICES_NORM, [])): _DEVICE_MULTI,
            vol.Optional(CONF_DEVICES_SLOW, default=current.get(CONF_DEVICES_SLOW, [])): _DEVICE_MULTI,

            vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=current.get(CONF_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_CRIT_MIN)): _minutes_selector(),
            vol.Optional(CONF_TIMEOUT_NORM_MIN, default=current.get(CONF_TIMEOUT_NORM_MIN, DEFAULT_TIMEOUT_NORM_MIN)): _minutes_selector(),
            vol.Optional(CONF_TIMEOUT_SLOW_MIN, default=current.get(CONF_TIMEOUT_SLOW_MIN, DEFAULT_TIMEOUT_SLOW_MIN)): _minutes_selector(),

            vol.Optional(CONF_NOTIFY_SERVICE, default=current.get(CONF_NOTIFY_SERVICE, "")): selector.TextSelector(),
            vol.Optional(CONF_NOTIFY_RECOVERED, default=current.get(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)): selector.BooleanSelector(),
        })
        return self.async_show_form(step_id="init", data_schema=schema)
