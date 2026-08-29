from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo

from .const import DEVICE_NAME, DOMAIN


def device_info(entry: ConfigEntry) -> DeviceInfo:
    """Service device grouping the integration's own entities.

    The coordinator skips SERVICE devices, so Device Saver never monitors
    itself. Existing installations keep their current entity IDs: the entity
    registry only derives an entity_id when it first sees a unique_id, so
    attaching a device changes ID generation for new installs only.
    """
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=DEVICE_NAME,
        entry_type=DeviceEntryType.SERVICE,
    )
