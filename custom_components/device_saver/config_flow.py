from homeassistant.helpers import device_registry as dr, selector
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    CONF_DEVICES_EXCLUDED,
    CONF_POWER_GATES,
    CONF_TIMEOUT_CRIT_MIN,
    CONF_TIMEOUT_SLOW_MIN,
    DEFAULT_TIMEOUT_CRIT_MIN,
    DEFAULT_TIMEOUT_SLOW_MIN,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    DEFAULT_NOTIFY_RECOVERED,
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
            vol.Optional(CONF_DEVICES_EXCLUDED, default=[]): _DEVICE_MULTI,
            vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=DEFAULT_TIMEOUT_CRIT_MIN): _minutes_selector(),
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

    def _current(self) -> dict:
        return {**self.entry.data, **self.entry.options}

    def _gates(self) -> dict[str, str]:
        return dict(self._current().get(CONF_POWER_GATES, {}) or {})

    def _save(self, changes: dict):
        # Options are replaced wholesale on save — merge so other keys survive
        return self.async_create_entry(title="", data={**self.entry.options, **changes})

    async def async_step_init(self, user_input=None):
        return self.async_show_menu(
            step_id="init",
            menu_options=["settings", "add_gate", "remove_gate"],
        )

    async def async_step_settings(self, user_input=None):
        if user_input is not None:
            return self._save(user_input)

        current = self._current()

        schema = vol.Schema({
            vol.Optional(CONF_DEVICES_EXCLUDED, default=current.get(CONF_DEVICES_EXCLUDED, [])): _DEVICE_MULTI,
            vol.Optional(CONF_TIMEOUT_CRIT_MIN, default=current.get(CONF_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_CRIT_MIN)): _minutes_selector(),
            vol.Optional(CONF_TIMEOUT_SLOW_MIN, default=current.get(CONF_TIMEOUT_SLOW_MIN, DEFAULT_TIMEOUT_SLOW_MIN)): _minutes_selector(),
            vol.Optional(CONF_NOTIFY_SERVICE, default=current.get(CONF_NOTIFY_SERVICE, "")): selector.TextSelector(),
            vol.Optional(CONF_NOTIFY_RECOVERED, default=current.get(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)): selector.BooleanSelector(),
        })
        return self.async_show_form(step_id="settings", data_schema=schema)

    async def async_step_add_gate(self, user_input=None):
        if user_input is not None:
            gates = self._gates()
            gates[user_input["device"]] = user_input["gate_entity"]
            return self._save({CONF_POWER_GATES: gates})

        schema = vol.Schema({
            vol.Required("device"): selector.DeviceSelector(),
            vol.Required("gate_entity"): selector.EntitySelector(
                selector.EntitySelectorConfig(domain=["switch", "input_boolean"])
            ),
        })
        return self.async_show_form(step_id="add_gate", data_schema=schema)

    async def async_step_remove_gate(self, user_input=None):
        gates = self._gates()

        if user_input is not None:
            for device_id in user_input.get("remove", []):
                gates.pop(device_id, None)
            return self._save({CONF_POWER_GATES: gates})

        if not gates:
            return self.async_abort(reason="no_gates")

        dev_reg = dr.async_get(self.hass)
        options = []
        for device_id, gate_entity in sorted(gates.items()):
            dev = dev_reg.async_get(device_id)
            name = (dev.name_by_user or dev.name) if dev else device_id
            options.append(
                selector.SelectOptionDict(value=device_id, label=f"{name} → {gate_entity}")
            )

        schema = vol.Schema({
            vol.Required("remove"): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=options,
                    multiple=True,
                    mode=selector.SelectSelectorMode.LIST,
                )
            ),
        })
        return self.async_show_form(step_id="remove_gate", data_schema=schema)
