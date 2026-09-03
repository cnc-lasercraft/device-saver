from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import (
    DeviceEntry,
    DeviceEntryType,
    EVENT_DEVICE_REGISTRY_UPDATED,
)
from homeassistant.helpers.entity_registry import EVENT_ENTITY_REGISTRY_UPDATED
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

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
    CONF_IGNORED_INTEGRATIONS,
    DEFAULT_IGNORED_INTEGRATIONS,
    CONF_IGNORED_PLATFORMS,
    DEFAULT_IGNORED_PLATFORMS,
    STARTUP_GRACE_MIN,
    STATE_BAD,
)

LOGGER = logging.getLogger(__name__)

CONNECTION_TYPE_MAP: dict[str, str] = {
    "zha": "Zigbee",
    "matter": "Matter",
    "homekit_controller": "HomeKit",
    "esphome": "WLAN",
    "shelly": "WLAN",
    "tado": "WLAN",
    "vitogate_wp": "LAN",
    "huawei_solar": "Solar",
    "smlight": "Zigbee",
}


def _format_minutes(m: int) -> str:
    if m % 10080 == 0:
        return f"{m // 10080}w"
    if m % 1440 == 0:
        return f"{m // 1440}d"
    if m % 60 == 0:
        return f"{m // 60}h"
    return f"{m}m"


@dataclass
class DeviceHealth:
    device_id: str
    device_name: str
    tier: str  # "critical" | "slow"
    down: bool
    reason: str
    last_ok: dt_util.dt.datetime | None
    timeout_minutes: int
    timeout_label: str
    connection_type: str
    gated: bool = False
    gate_entity: str | None = None


class DeviceSaverCoordinator(DataUpdateCoordinator[dict[str, DeviceHealth]]):
    """Tracks health of all devices. Battery devices = slow, others = critical."""

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
        self._unsub_er_updated = None
        self._unsub_dr_updated = None
        self._cancel_rebuild = None
        self._started_at = dt_util.utcnow()
        self._last_ok: dict[str, dt_util.dt.datetime] = {}
        self._down_state: dict[str, bool] = {}
        self._store = Store(hass, 1, f"{DOMAIN}_{entry.entry_id}_data")

        # Cached maps — rebuilt once on start and on config change
        # device_id -> tier ("critical" | "slow")
        self._device_tier: dict[str, str] = {}
        self._device_conn: dict[str, str] = {}
        # device_id -> list of entity_ids
        self._device_entities: dict[str, list[str]] = {}
        # entity_id -> device_id (for fast lookup in state change handler)
        self._entity_to_device: dict[str, str] = {}

    def _cfg(self, key: str, default: Any = None) -> Any:
        if key in self.entry.options:
            return self.entry.options[key]
        return self.entry.data.get(key, default)

    def _device_entity_map(self, ignored_platforms: set[str]) -> dict[str, list[str]]:
        """device_id -> enabled entity_ids, minus the ignored platforms."""
        device_entities: dict[str, list[str]] = {}
        for ent in self._er.entities.values():
            if not ent.device_id or ent.disabled_by:
                continue
            if ent.platform in ignored_platforms:
                continue
            device_entities.setdefault(ent.device_id, []).append(ent.entity_id)
        return device_entities

    def _battery_devices(self) -> set[str]:
        """Single O(n) pass to find all devices with a battery entity."""
        battery_devices: set[str] = set()
        for ent in self._er.entities.values():
            if not ent.device_id:
                continue
            dc = ent.device_class or ent.original_device_class
            if dc == "battery":
                battery_devices.add(ent.device_id)
        return battery_devices

    def _candidate_devices(
        self,
        device_entities: dict[str, list[str]],
        ignored_integrations: set[str],
    ) -> Iterator[DeviceEntry]:
        """Devices eligible for monitoring. The exclusion list is NOT applied here.

        Shared by the cache build (which excludes on top) and the settings card,
        which has to offer excluded devices too — otherwise nothing could ever be
        un-excluded.
        """
        for dev in self._dr.devices.values():
            if dev.entry_type == DeviceEntryType.SERVICE:
                continue
            # Skip devices that belong exclusively to ignored integrations (e.g. UniFi
            # tracks all network clients as device_tracker — not HA-controlled devices)
            ce_domains: set[str] = set()
            for ce_id in dev.config_entries:
                ce = self.hass.config_entries.async_get_entry(ce_id)
                if ce:
                    ce_domains.add(ce.domain)
            if ce_domains and ce_domains <= ignored_integrations:
                continue
            if not device_entities.get(dev.id):
                continue
            yield dev

    def _connection_type(self, dev: DeviceEntry) -> str:
        """Determine connection type from the device's config entries."""
        conn = "Andere"
        for ce_id in dev.config_entries:
            ce = self.hass.config_entries.async_get_entry(ce_id)
            if not ce:
                continue
            if ce.domain == "mqtt":
                # Only Zigbee2MQTT devices are Zigbee; generic MQTT discovery
                # devices (e.g. WiCAN) count as WLAN, overridable by a more
                # specific config entry on the same device
                if any(
                    len(idf) >= 2 and idf[0] == "mqtt"
                    and str(idf[1]).startswith("zigbee2mqtt")
                    for idf in dev.identifiers
                ):
                    return "Zigbee"
                conn = "WLAN"
                continue
            if ce.domain in CONNECTION_TYPE_MAP:
                return CONNECTION_TYPE_MAP[ce.domain]
        return conn

    def _build_cache(self) -> None:
        """Build device/entity/tier caches. Called once at startup."""
        excluded = set(self._cfg(CONF_DEVICES_EXCLUDED, []))
        ignored_integrations = set(
            self._cfg(CONF_IGNORED_INTEGRATIONS, DEFAULT_IGNORED_INTEGRATIONS) or []
        )
        ignored_platforms = set(
            self._cfg(CONF_IGNORED_PLATFORMS, DEFAULT_IGNORED_PLATFORMS) or []
        )

        device_entities = self._device_entity_map(ignored_platforms)
        battery_devices = self._battery_devices()

        device_tier: dict[str, str] = {}
        device_conn: dict[str, str] = {}
        entity_to_device: dict[str, str] = {}

        for dev in self._candidate_devices(device_entities, ignored_integrations):
            if dev.id in excluded:
                continue

            device_tier[dev.id] = "slow" if dev.id in battery_devices else "critical"
            device_conn[dev.id] = self._connection_type(dev)

            for eid in device_entities[dev.id]:
                entity_to_device[eid] = dev.id

        self._device_tier = device_tier
        self._device_conn = device_conn
        self._device_entities = {
            did: device_entities[did]
            for did in device_tier
            if did in device_entities
        }
        self._entity_to_device = entity_to_device
        LOGGER.debug("Device Saver cache built: %d devices", len(device_tier))

    @callback
    def effective_options(self) -> dict[str, Any]:
        """The config as the coordinator actually reads it (options over data).

        The settings card writes every one of these keys back into `options`,
        which incidentally retires the stale `data` copy from the initial setup.
        """
        return {
            CONF_DEVICES_EXCLUDED: list(self._cfg(CONF_DEVICES_EXCLUDED, []) or []),
            CONF_TIMEOUT_CRIT_MIN: int(
                self._cfg(CONF_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_CRIT_MIN)
            ),
            CONF_TIMEOUT_SLOW_MIN: int(
                self._cfg(CONF_TIMEOUT_SLOW_MIN, DEFAULT_TIMEOUT_SLOW_MIN)
            ),
            CONF_NOTIFY_SERVICE: self._cfg(CONF_NOTIFY_SERVICE, "") or "",
            CONF_NOTIFY_RECOVERED: bool(
                self._cfg(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED)
            ),
            CONF_IGNORED_INTEGRATIONS: list(
                self._cfg(CONF_IGNORED_INTEGRATIONS, DEFAULT_IGNORED_INTEGRATIONS) or []
            ),
            CONF_IGNORED_PLATFORMS: list(
                self._cfg(CONF_IGNORED_PLATFORMS, DEFAULT_IGNORED_PLATFORMS) or []
            ),
            CONF_POWER_GATES: dict(self._cfg(CONF_POWER_GATES, {}) or {}),
        }

    @callback
    def device_catalogue(self) -> list[dict[str, Any]]:
        """Every device the settings UI may offer — excluded ones included.

        Each entry carries a `status`:
          ok             — a monitoring candidate
          not_monitored  — excluded, but would be skipped anyway (belongs only to
                           an ignored integration, or has no usable entities)
          missing        — excluded, but no such device in the registry any more
        The last two used to be findable only by hand-diffing the options against
        core.device_registry.
        """
        excluded = set(self._cfg(CONF_DEVICES_EXCLUDED, []) or [])
        ignored_integrations = set(
            self._cfg(CONF_IGNORED_INTEGRATIONS, DEFAULT_IGNORED_INTEGRATIONS) or []
        )
        ignored_platforms = set(
            self._cfg(CONF_IGNORED_PLATFORMS, DEFAULT_IGNORED_PLATFORMS) or []
        )

        device_entities = self._device_entity_map(ignored_platforms)
        battery_devices = self._battery_devices()

        items: list[dict[str, Any]] = []
        seen: set[str] = set()

        for dev in self._candidate_devices(device_entities, ignored_integrations):
            seen.add(dev.id)
            items.append(
                {
                    "device_id": dev.id,
                    "name": dev.name_by_user or dev.name or dev.id,
                    "manufacturer": dev.manufacturer,
                    "model": dev.model,
                    "connection_type": self._connection_type(dev),
                    "tier": "slow" if dev.id in battery_devices else "critical",
                    "entity_count": len(device_entities.get(dev.id, [])),
                    "excluded": dev.id in excluded,
                    "status": "ok",
                }
            )

        for device_id in sorted(excluded - seen):
            dev = self._dr.devices.get(device_id)
            items.append(
                {
                    "device_id": device_id,
                    "name": (dev.name_by_user or dev.name or device_id) if dev else device_id,
                    "manufacturer": dev.manufacturer if dev else None,
                    "model": dev.model if dev else None,
                    "connection_type": self._connection_type(dev) if dev else "Andere",
                    "tier": "critical",
                    "entity_count": len(device_entities.get(device_id, [])),
                    "excluded": True,
                    "status": "not_monitored" if dev else "missing",
                }
            )

        return items

    @callback
    def known_domains(self) -> dict[str, list[str]]:
        """Integration domains and entity platforms actually present in this
        installation, so the ignore lists can be picked instead of typed."""
        return {
            "integrations": sorted(
                {ce.domain for ce in self.hass.config_entries.async_entries()}
            ),
            "platforms": sorted(
                {ent.platform for ent in self._er.entities.values() if ent.platform}
            ),
        }

    @callback
    def gate_catalogue(self) -> list[dict[str, Any]]:
        """Configured power gates, resolved to device names for display."""
        gates: dict[str, str] = self._cfg(CONF_POWER_GATES, {}) or {}
        out: list[dict[str, Any]] = []
        for device_id, gate_entity in sorted(gates.items()):
            dev = self._dr.devices.get(device_id)
            out.append(
                {
                    "device_id": device_id,
                    "device_name": (dev.name_by_user or dev.name or device_id) if dev else device_id,
                    "gate_entity": gate_entity,
                    "device_missing": dev is None,
                }
            )
        return out

    def _timeout_minutes_for_tier(self, tier: str) -> int:
        if tier == "slow":
            return int(self._cfg(CONF_TIMEOUT_SLOW_MIN, DEFAULT_TIMEOUT_SLOW_MIN))
        return int(self._cfg(CONF_TIMEOUT_CRIT_MIN, DEFAULT_TIMEOUT_CRIT_MIN))

    def _device_name(self, device_id: str) -> str:
        dev = self._dr.devices.get(device_id)
        if not dev:
            return device_id
        return dev.name_by_user or dev.name or device_id

    async def _async_load_store(self) -> None:
        """Load persisted last_ok and down_state from storage."""
        data = await self._store.async_load()
        if data and isinstance(data, dict):
            for device_id, iso_str in data.get("last_ok", {}).items():
                try:
                    self._last_ok[device_id] = dt_util.parse_datetime(iso_str)
                except (ValueError, TypeError):
                    pass
            self._down_state = data.get("down_state", {})

    async def _async_save_store(self) -> None:
        """Persist last_ok and down_state to storage.

        Only currently tracked devices are written — entries for removed or
        excluded devices would otherwise accumulate forever.
        """
        tracked = self._device_tier
        await self._store.async_save({
            "last_ok": {
                did: ts.isoformat()
                for did, ts in self._last_ok.items()
                if did in tracked
            },
            "down_state": {
                did: v for did, v in self._down_state.items() if did in tracked
            },
        })

    async def async_config_entry_first_refresh(self) -> None:
        await self._async_load_store()
        self._build_cache()
        if self._unsub_state_changed is None:
            self._unsub_state_changed = self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._handle_state_changed
            )
        if self._unsub_er_updated is None:
            self._unsub_er_updated = self.hass.bus.async_listen(
                EVENT_ENTITY_REGISTRY_UPDATED, self._schedule_cache_rebuild
            )
        if self._unsub_dr_updated is None:
            self._unsub_dr_updated = self.hass.bus.async_listen(
                EVENT_DEVICE_REGISTRY_UPDATED, self._schedule_cache_rebuild
            )
        await super().async_config_entry_first_refresh()

    async def async_shutdown(self) -> None:
        """Detach listeners and pending callbacks. Called on unload."""
        for unsub_attr in ("_unsub_state_changed", "_unsub_er_updated", "_unsub_dr_updated"):
            unsub = getattr(self, unsub_attr)
            if unsub is not None:
                unsub()
                setattr(self, unsub_attr, None)
        if self._cancel_rebuild is not None:
            self._cancel_rebuild()
            self._cancel_rebuild = None

    @callback
    def _schedule_cache_rebuild(self, _event: Event) -> None:
        # Debounce: a single re-commission or rename can fire many registry
        # events back-to-back; coalesce them into one rebuild.
        if self._cancel_rebuild is not None:
            self._cancel_rebuild()
        self._cancel_rebuild = async_call_later(self.hass, 5.0, self._do_cache_rebuild)

    @callback
    def _do_cache_rebuild(self, _now) -> None:
        self._cancel_rebuild = None
        self._build_cache()
        self.hass.async_create_task(self.async_request_refresh())

    @callback
    def _handle_state_changed(self, event: Event) -> None:
        entity_id = event.data.get("entity_id")
        if not entity_id:
            return

        # O(1) lookup via cache — no iteration
        device_id = self._entity_to_device.get(entity_id)
        if not device_id:
            return

        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if new_state and new_state.state not in STATE_BAD:
            self._last_ok[device_id] = dt_util.utcnow()
        elif old_state and old_state.state not in STATE_BAD:
            # good -> bad transition: the device was demonstrably OK until
            # right now, so the timeout must count from here — not from the
            # last good state *change*, which for a quiet device (e.g. a
            # switch that hasn't toggled for hours) may be long ago and
            # would declare it down the instant it goes unavailable.
            self._last_ok[device_id] = dt_util.utcnow()

    async def _async_update_data(self) -> dict[str, DeviceHealth]:
        now = dt_util.utcnow()
        data: dict[str, DeviceHealth] = {}
        power_gates: dict[str, str] = self._cfg(CONF_POWER_GATES, {}) or {}

        for device_id, tier in self._device_tier.items():
            timeout_minutes = self._timeout_minutes_for_tier(tier)
            timeout_td = timedelta(minutes=timeout_minutes)
            timeout_label = _format_minutes(timeout_minutes)
            name = self._device_name(device_id)
            entity_ids = self._device_entities.get(device_id, [])

            # Startup baseline
            if device_id not in self._last_ok:
                states_now = [self.hass.states.get(eid) for eid in entity_ids]
                good_now = [s for s in states_now if s and s.state not in STATE_BAD]
                if good_now:
                    self._last_ok[device_id] = now
                else:
                    bad_states = [s for s in states_now if s and s.state in STATE_BAD]
                    if bad_states:
                        earliest = min(s.last_changed for s in bad_states)
                        self._last_ok[device_id] = earliest
                    else:
                        self._last_ok[device_id] = now

            states = [self.hass.states.get(eid) for eid in entity_ids]
            good = [s for s in states if s and s.state not in STATE_BAD]

            # Power gate: gate off => deliberately unpowered, never "down".
            # Gate unavailable/unknown => normal down logic (a dead gate must
            # not mask a real outage).
            gated = False
            gate_on_since = None
            gate_entity = power_gates.get(device_id)
            if gate_entity:
                gate_state = self.hass.states.get(gate_entity)
                if gate_state is not None:
                    if gate_state.state == "off":
                        gated = True
                    elif gate_state.state == "on":
                        gate_on_since = gate_state.last_changed

            if gated:
                down = False
                reason = "gated"
            elif good:
                down = False
                reason = "ok"
            else:
                last_ok = self._last_ok[device_id]
                # Timeout counts from gate power-on, so the device gets its
                # full boot window after being re-powered.
                if gate_on_since is not None and gate_on_since > last_ok:
                    last_ok = gate_on_since
                down = (now - last_ok) > timeout_td
                reason = "timeout" if down else "waiting"
                # Startup grace: right after HA start most entities are still
                # unavailable because integrations are connecting. Don't declare
                # NEW downs yet — devices already down before the restart stay
                # down (no false recovery), real new outages surface once the
                # grace window has passed.
                if (
                    down
                    and not self._down_state.get(device_id, False)
                    and (now - self._started_at) < timedelta(minutes=STARTUP_GRACE_MIN)
                ):
                    down = False
                    reason = "waiting"

            health = DeviceHealth(
                device_id=device_id,
                device_name=name,
                tier=tier,
                down=down,
                reason=reason,
                last_ok=self._last_ok.get(device_id),
                timeout_minutes=timeout_minutes,
                timeout_label=timeout_label,
                connection_type=self._device_conn.get(device_id, "Andere"),
                gated=gated,
                gate_entity=gate_entity,
            )
            data[device_id] = health

            prev = self._down_state.get(device_id, False)
            if down != prev:
                self._down_state[device_id] = down
                await self._notify_transition(device_id, down, health)

        # Persist to disk
        self.hass.async_create_task(self._async_save_store())

        return data

    async def _notify_transition(self, device_id: str, down: bool, health: DeviceHealth) -> None:
        name = health.device_name
        notif_id = f"{DOMAIN}_{self.entry.entry_id}_{device_id}"

        notify_service: str = (self._cfg(CONF_NOTIFY_SERVICE, "") or "").strip()
        notify_recovered: bool = bool(self._cfg(CONF_NOTIFY_RECOVERED, DEFAULT_NOTIFY_RECOVERED))

        if down:
            msg = (
                f"Gerät **{name}** reagiert nicht mehr.\n"
                f"- Tier: {health.tier}\n"
                f"- Grund: {health.reason}\n"
                f"- Timeout: {health.timeout_label}"
            )
            await self.hass.services.async_call(
                "persistent_notification", "create",
                {"notification_id": notif_id, "title": "Device Saver", "message": msg},
                blocking=False,
            )
            await self._maybe_notify(notify_service, "Device Saver", msg)
            self.hass.bus.async_fire(
                "device_saver_device_down",
                {
                    "device_id": device_id,
                    "device_name": name,
                    "tier": health.tier,
                    "reason": health.reason,
                    "timeout_minutes": health.timeout_minutes,
                },
            )
        else:
            await self.hass.services.async_call(
                "persistent_notification", "dismiss",
                {"notification_id": notif_id},
                blocking=False,
            )
            if health.gated:
                # Deliberately unpowered — "recovered" push/event would be
                # misleading; the device is off, not back.
                return
            if notify_recovered:
                msg = f"Gerät **{name}** ist wieder erreichbar."
                await self._maybe_notify(notify_service, "Device Saver", msg)
            self.hass.bus.async_fire(
                "device_saver_device_recovered",
                {"device_id": device_id, "device_name": name, "tier": health.tier},
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
