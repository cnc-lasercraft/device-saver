from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_DEVICES,
    CONF_TIMEOUT_MIN,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    DEFAULT_TIMEOUT_MIN,
    DEFAULT_NOTIFY_RECOVERED,
    STATE_BAD,
)


@dataclass
class DeviceHealth:
    device_id: str
    down: bool
    reason: str
    last_ok: dt_util.dt.datetime | None


class DeviceSaverCoordinator(DataUpdateCoordinator[dict[str, DeviceHealth]]):
    """Tracks health of selected devices."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            logger=None,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=30),
        )
        self.hass = hass
        self.entry = entry

        self._dr = dr.async_get(hass)
        self._er = er.async_get(hass)

        self._unsub = None
        self._last_ok: dict[str, dt_util.dt.datetime] = {}
        self._down_state: dict[str, bool] = {}

    def _cfg(self, key: str, default: Any = None) -> Any:
        if key in self.entry.options:
            return self.entry.options[key]
        return self.entry.data.get(key, default)

    def _watched_devices(self) -> list[str]:
        return list(self._cfg(CONF_DEVICES, []))

    def _timeout(self) -> timedelta:
        minutes = int(self._cfg(CONF_TIMEOUT_MIN, DEFAULT_TIMEOUT_MIN))
        return timedelta(minutes=minutes)

    def _device_name(self, device_id: str) -> str:
        dev = self._dr.devices.get(device_id)
        if not dev:
            return device_id
        return dev.name_by_user or dev.name or device_id

    def _device_entity_ids(self, device_id: str) -> list[str]:
        # Entities belonging to this device_id
        return [
            ent.entity_id
            for ent in self._er.entities.values()
            if ent.device_id == device_id
        ]

    async def async_config_entry_first_refresh(self) -> None:
        # Subscribe to all state changes; filter inside callback to watched devices.
        if self._unsub is None:
            self._unsub = async_track_state_change_event(self.hass, [], self._handle_state_event)
        await super().async_config_entry_first_refresh()

    @callback
    def _handle_state_event(self, event) -> None:
        watched = set(self._watched_devices())
        entity_id = event.data.get("entity_id")
        if not entity_id:
            return

        ent = self._er.async_get(entity_id)
        if not ent or ent.device_id not in watched:
            return

        new_state = event.data.get("new_state")
        if new_state and new_state.state not in STATE_BAD:
            self._last_ok[ent.device_id] = dt_util.utcnow()

    async def _async_update_data(self) -> dict[str, DeviceHealth]:
        watched = self._watched_devices()
        timeout = self._timeout()
        now = dt_util.utcnow()

        data: dict[str, DeviceHealth] = {}

        for device_id in watched:
            entity_ids = self._device_entity_ids(device_id)

            if not entity_ids:
                down = True
                reason = "no_entities"
            else:
                states = [self.hass.states.get(eid) for eid in entity_ids]
                good = [s for s in states if s and s.state not in STATE_BAD]

                if good:
                    down = False
                    reason = "ok"
                    # initialize last_ok if not present
                    self._last_ok[device_id] = self._last_ok.get(device_id, now)
                else:
                    last_ok = self._last_ok.get(device_id)
                    if last_ok is None:
                        down = True
                        reason = "never_ok"
                    else:
                        down = (now - last_ok) > timeout
                        reason = "timeout" if down else "waiting"

            last_ok = self._last_ok.get(device_id)
            health = DeviceHealth(device_id=device_id, down=down, reason=reason, last_ok=last_ok)
            data[device_id] = health

            # transitions -> notifications
            prev = self._down_state.get(device_id, False)
            if down != prev:
                self._down_state[device_id] = down
                await self._notify_transition(device_id, down, health)

        return data

    async def _notify_transition(self, device_id: str, down: bool, health: DeviceHealth) -> None:
        name = self._device_name(device_id)
        notif_id = f"{DOMAIN}_{self.entry.entry_id}_{device_id}"

        notify_service: str = (self._cfg(CONF_NOTIFY_SERVICE, "") or "").strip()
        notify_recovered: bool = bool(self._cfg(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED))

        if down:
            msg = f"Gerät **{name}** reagiert nicht mehr. (Grund: {health.reason})"
            await self.hass.services.async_call(
                "persistent_notification",
                "create",
                {"notification_id": notif_id, "title": "Device Saver", "message": msg},
                blocking=False,
            )
            await self._maybe_notify(notify_service, "Device Saver", msg)

            self.hass.bus.async_fire("device_saver_device_down", {"device_id": device_id, "device_name": name, "reason": health.reason})

        else:
            await self.hass.services.async_call(
                "persistent_notification",
                "dismiss",
                {"notification_id": notif_id},
                blocking=False,
            )
            if notify_recovered:
                msg = f"Gerät **{name}** ist wieder erreichbar."
                await self._maybe_notify(notify_service, "Device Saver", msg)

            self.hass.bus.async_fire("device_saver_device_recovered", {"device_id": device_id, "device_name": name})

    async def _maybe_notify(self, notify_service: str, title: str, message: str) -> None:
        if not notify_service:
            return
        if "." in notify_service:
            domain, service = notify_service.split(".", 1)
        else:
            domain, service = "notify", notify_service
        await self.hass.services.async_call(domain, service, {"title": title, "message": message}, blocking=False)
