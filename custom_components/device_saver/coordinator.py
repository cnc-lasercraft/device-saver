from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_DEVICES_CRIT,
    CONF_DEVICES_NORM,
    CONF_DEVICES_SLOW,
    TIMEOUT_CRIT,
    TIMEOUT_NORM,
    TIMEOUT_SLOW,
    CONF_NOTIFY_SERVICE,
    CONF_NOTIFY_RECOVERED,
    DEFAULT_NOTIFY_RECOVERED,
    STATE_BAD,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class DeviceHealth:
    device_id: str
    down: bool
    reason: str
    last_ok: dt_util.dt.datetime | None
    timeout: int  # minutes


class DeviceSaverCoordinator(DataUpdateCoordinator[dict[str, DeviceHealth]]):
    """Tracks health of selected devices (tiered timeouts + startup grace)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            logger=LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=timedelta(seconds=30),
        )
        self.hass = hass
        self.entry = entry

        self._dr = dr.async_get(hass)
        self._er = er.async_get(hass)

        self._unsub_state_changed = None
        self._last_ok: dict[str, dt_util.dt.datetime] = {}
        self._down_state: dict[str, bool] = {}

    def _cfg(self, key: str, default: Any = None) -> Any:
        if key in self.entry.options:
            return self.entry.options[key]
        return self.entry.data.get(key, default)

    def _devices_by_tier(self) -> tuple[set[str], set[str], set[str]]:
        crit = set(self._cfg(CONF_DEVICES_CRIT, []))
        norm = set(self._cfg(CONF_DEVICES_NORM, []))
        slow = set(self._cfg(CONF_DEVICES_SLOW, []))
        return crit, norm, slow

    def _watched_devices(self) -> set[str]:
        crit, norm, slow = self._devices_by_tier()
        return crit | norm | slow

    def _timeout_minutes_for_device(self, device_id: str) -> int:
        crit, norm, slow = self._devices_by_tier()
        if device_id in crit:
            return int(TIMEOUT_CRIT)
        if device_id in slow:
            return int(TIMEOUT_SLOW)
        return int(TIMEOUT_NORM)

    def _timeout_for_device(self, device_id: str) -> timedelta:
        return timedelta(minutes=self._timeout_minutes_for_device(device_id))

    def _device_name(self, device_id: str) -> str:
        dev = self._dr.devices.get(device_id)
        if not dev:
            return device_id
        return dev.name_by_user or dev.name or device_id

    def _device_entity_ids(self, device_id: str) -> list[str]:
        return [
            ent.entity_id
            for ent in self._er.entities.values()
            if ent.device_id == device_id
        ]

    async def async_config_entry_first_refresh(self) -> None:
        # Listen to all state changes, filter ourselves (robust across HA versions)
        if self._unsub_state_changed is None:
            self._unsub_state_changed = self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._handle_state_changed
            )

        await super().async_config_entry_first_refresh()

    @callback
    def _handle_state_changed(self, event: Event) -> None:
        watched = self._watched_devices()

        entity_id = event.data.get("entity_id")
        if not entity_id:
            return

        ent = self._er.async_get(entity_id)
        if not ent or ent.device_id not in watched:
            return

        new_state = event.data.get("new_state")
        if new_state and new_state.state not in STATE_BAD:
            self._last_ok[ent.device_id] = dt_util.utcnow()

    # ✅ This must be named EXACTLY like this, inside the class.
    async def _async_update_data(self) -> dict[str, DeviceHealth]:
        watched = self._watched_devices()
        now = dt_util.utcnow()

        data: dict[str, DeviceHealth] = {}

        for device_id in watched:
            timeout_td = self._timeout_for_device(device_id)
            timeout_min = self._timeout_minutes_for_device(device_id)

            # ✅ Startup grace / first-seen baseline
            if device_id not in self._last_ok:
                self._last_ok[device_id] = now

            entity_ids = self._device_entity_ids(device_id)

            if not entity_ids:
                # don't alert immediately; only after timeout
                down = (now - self._last_ok[device_id]) > timeout_td
                reason = "no_entities_timeout" if down else "no_entities_waiting"
            else:
                states = [self.hass.states.get(eid) for eid in entity_ids]
                good = [s for s in states if s and s.state not in STATE_BAD]

                if good:
                    down = False
                    reason = "ok"
                    # keep last_ok initialized; actual updates come from state events too
                    self._last_ok[device_id] = self._last_ok.get(device_id, now)
                else:
                    down = (now - self._last_ok[device_id]) > timeout_td
                    reason = "timeout" if down else "waiting"

            last_ok = self._last_ok.get(device_id)
            health = DeviceHealth(
                device_id=device_id,
                down=down,
                reason=reason,
                last_ok=last_ok,
                timeout=timeout_min,
            )
            data[device_id] = health

            prev = self._down_state.get(device_id, False)
            if down != prev:
                self._down_state[device_id] = down
                await self._notify_transition(device_id, down, health)

        return data

    async def _notify_transition(self, device_id: str, down: bool, health: DeviceHealth) -> None:
        name = self._device_name(device_id)
        notif_id = f"{DOMAIN}_{self.entry.entry_id}_{device_id}"

        notify_service: str = (self._cfg(CONF_NOTIFY_SERVICE, "") or "").strip()
        notify_recovered: bool = bool(
            self._cfg(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)
        )

        if down:
            msg = (
                f"Gerät **{name}** reagiert nicht mehr.\n"
                f"- Grund: {health.reason}\n"
                f"- Timeout: {health.timeout} min"
            )
            await self.hass.services.async_call(
                "persistent_notification",
                "create",
                {"notification_id": notif_id, "title": "Device Saver", "message": msg},
                blocking=False,
            )
            await self._maybe_notify(notify_service, "Device Saver", msg)

            self.hass.bus.async_fire(
                "device_saver_device_down",
                {
                    "device_id": device_id,
                    "device_name": name,
                    "reason": health.reason,
                    "timeout_minutes": health.timeout,
                },
            )
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

            self.hass.bus.async_fire(
                "device_saver_device_recovered",
                {"device_id": device_id, "device_name": name},
            )

    async def _maybe_notify(self, notify_service: str, title: str, message: str) -> None:
        if not notify_service:
            return

        if "." in notify_service:
            domain, service = notify_service.split(".", 1)
        else:
            domain, service = "notify", notify_service

        await self.hass.services.async_call(
            domain, service, {"title": title, "message": message}, blocking=False
        )
