from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            DeviceSaverDownCountSensor(coordinator, entry),
            DeviceSaverDownDevicesSensor(coordinator, entry),
        ],
        True,
    )


class DeviceSaverDownCountSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Down Count"

    def __init__(self, coordinator, entry: ConfigEntry) -> None:
        self.coordinator = coordinator
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_down_count"

    @property
    def native_value(self) -> int:
        data = self.coordinator.data or {}
        return sum(1 for h in data.values() if h.down)

    async def async_update(self) -> None:
        await self.coordinator.async_request_refresh()


class DeviceSaverDownDevicesSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Down Devices"

    def __init__(self, coordinator, entry: ConfigEntry) -> None:
        self.coordinator = coordinator
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_down_devices"

    @property
    def native_value(self) -> str:
        data = self.coordinator.data or {}
        down = [
            f"{h.device_name} ({h.tier}, {h.timeout}m)"
            for h in data.values()
            if h.down
        ]
        return ", ".join(down) if down else ""

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data or {}
        # nice structured attributes for dashboards/templating
        return {
            h.device_id: {
                "name": h.device_name,
                "tier": h.tier,
                "down": h.down,
                "reason": h.reason,
                "timeout_minutes": h.timeout,
                "last_ok": h.last_ok.isoformat() if h.last_ok else None,
            }
            for h in data.values()
        }

    async def async_update(self) -> None:
        await self.coordinator.async_request_refresh()
