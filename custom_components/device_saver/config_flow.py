from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers import device_registry as dr, area_registry as ar

from .const import (
    DOMAIN,
    CONF_DEVICES_CRIT,
    CONF_DEVICES_NORM,
    CONF_DEVICES_SLOW,
    CONF_TIMEOUT_CRIT_MIN,
    CONF_TIMEOUT_NORM_MIN,
    CONF_TIMEOUT_SLOW_MIN,
    DEFAULT_TIMEOUT_CRIT_MIN,
    DEFAULT_TIMEOUT_NORM_MIN,
    DEFAULT_TIMEOUT_SLOW_MIN,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    DEFAULT_NOTIFY_RECOVERED,
)


def _device_label(hass, dev) -> str:
    name = dev.name_by_user or dev.name or "Unnamed device"
    model = dev.model or dev.manufacturer or ""
    tail = dev.id[-6:] if dev.id else ""
    area_name = ""
    if dev.area_id:
        area_reg = ar.async_get(hass)
        area = area_reg.areas.get(dev.area_id)
        area_name = area.name if area else ""
    parts = []
    if area_name:
        parts.append(area_name)
    parts.append(name)
    if model:
        parts.append(model)
    if tail:
        parts.append(f"…{tail}")
    return " · ".join(parts)


def _device_options(hass):
    dev_reg = dr.async_get(hass)
    opts = [
        selector.SelectOptionDict(value=dev.id, label=_device_label(hass, dev))
        for dev in dev_reg.devices.values()
    ]
    opts.sort(key=lambda o: o["label"].lower())
    return opts


def _device_multiselect(hass):
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=_device_options(hass),
            multiple=True,
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    )


def _minutes_selector(default: int):
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=1,
            max=10080,  # 1 week
            step=1,
            mode=selector.NumberSelectorMode.BOX,
            unit_of_measurement="min",
        )
    )


class DeviceSaverConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 3

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="Device Saver", data=user_input)

        schema = vol.Schema(
            {
                vol.Optional(CONF_DEVICES_CRIT, default=[]): _device_multiselect(self.hass),
                vol.Optional(CONF_DEVICES_NORM, default=[]): _device_multiselect(self.hass),
                vol.Optional(CONF_DEVICES_SLOW, default=[]): _device_multiselect(self.hass),

                vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=DEFAULT_TIMEOUT_CRIT_MIN): _minutes_selector(DEFAULT_TIMEOUT_CRIT_MIN),
                vol.Optional(CONF_TIMEOUT_NORM_MIN, default=DEFAULT_TIMEOUT_NORM_MIN): _minutes_selector(DEFAULT_TIMEOUT_NORM_MIN),
                vol.Optional(CONF_TIMEOUT_SLOW_MIN, default=DEFAULT_TIMEOUT_SLOW_MIN): _minutes_selector(DEFAULT_TIMEOUT_SLOW_MIN),

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
                vol.Optional(CONF_DEVICES_CRIT, default=current.get(CONF_DEVICES_CRIT, [])): _device_multiselect(self.hass),
                vol.Optional(CONF_DEVICES_NORM, default=current.get(CONF_DEVICES_NORM, [])): _device_multiselect(self.hass),
                vol.Optional(CONF_DEVICES_SLOW, default=current.get(CONF_DEVICES_SLOW, [])): _device_multiselect(self.hass),

                vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=current.get(CONF_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_CRIT_MIN)): _minutes_selector(DEFAULT_TIMEOUT_CRIT_MIN),
                vol.Optional(CONF_TIMEOUT_NORM_MIN, default=current.get(CONF_TIMEOUT_NORM_MIN, DEFAULT_TIMEOUT_NORM_MIN)): _minutes_selector(DEFAULT_TIMEOUT_NORM_MIN),
                vol.Optional(CONF_TIMEOUT_SLOW_MIN, default=current.get(CONF_TIMEOUT_SLOW_MIN, DEFAULT_TIMEOUT_SLOW_MIN)): _minutes_selector(DEFAULT_TIMEOUT_SLOW_MIN),

                vol.Optional(CONF_NOTIFY_SERVICE, default=current.get(CONF_NOTIFY_SERVICE, "")): selector.TextSelector(),
                vol.Optional(CONF_NOTIFY_RECOVERED, default=current.get(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)): selector.BooleanSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
