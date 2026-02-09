from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([DeviceSaverProblemBinarySensor(coordinator, entry)], True)


class DeviceSaverProblemBinarySensor(BinarySensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Problem"

    def __init__(self, coordinator, entry: ConfigEntry) -> None:
        self.coordinator = coordinator
        self.entry = entry
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_problem"

    @property
    def is_on(self) -> bool:
        data = self.coordinator.data or {}
        return any(h.down for h in data.values())

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data or {}
        down = [device_id for device_id, h in data.items() if h.down]
        return {"down_devices": down, "down_count": len(down)}

    async def async_update(self) -> None:
        await self.coordinator.async_request_refresh()
