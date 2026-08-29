DOMAIN = "device_saver"

DEVICE_NAME = "Device Saver"

CONF_DEVICES_EXCLUDED = "devices_excluded"

# Optional map device_id -> gate entity_id (e.g. a Shelly switch feeding the
# device). Gate off => device is deliberately unpowered, not "down".
CONF_POWER_GATES = "power_gates"

CONF_TIMEOUT_CRIT_MIN = "timeout_critical_minutes"
CONF_TIMEOUT_SLOW_MIN = "timeout_slow_minutes"

DEFAULT_TIMEOUT_CRIT_MIN = 15       # 15 minutes
DEFAULT_TIMEOUT_SLOW_MIN = 90    # 90 minutes

CONF_NOTIFY_SERVICE = "notify_service"
CONF_NOTIFY_RECOVERED = "notify_recovered"
DEFAULT_NOTIFY_RECOVERED = True

# Devices that exclusively belong to these integrations are silently ignored
CONF_IGNORED_INTEGRATIONS = "ignored_integrations"
DEFAULT_IGNORED_INTEGRATIONS = ["browser_mod", "unifi"]

# Entities from these platforms are excluded from health checks (they report
# static values even when the physical device is offline)
CONF_IGNORED_PLATFORMS = "ignored_platforms"
DEFAULT_IGNORED_PLATFORMS = ["battery_notes", "unifi"]

# After HA start, don't declare NEW devices down for this long — integrations
# are still connecting and most entities are transiently unavailable
STARTUP_GRACE_MIN = 5

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
