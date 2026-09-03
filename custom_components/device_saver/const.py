DOMAIN = "device_saver"

DEVICE_NAME = "Device Saver"

CONF_DEVICES_EXCLUDED = "devices_excluded"

# Optional map device_id -> gate entity_id (e.g. a Shelly switch feeding the
# device). Gate off => device is deliberately unpowered, not "down".
CONF_POWER_GATES = "power_gates"

# A gate must have a meaningful on/off state — a Shelly switch, a helper, or a
# template binary sensor standing in for one.
GATE_DOMAINS = ("switch", "input_boolean", "binary_sensor")

CONF_TIMEOUT_CRIT_MIN = "timeout_critical_minutes"
CONF_TIMEOUT_SLOW_MIN = "timeout_slow_minutes"

DEFAULT_TIMEOUT_CRIT_MIN = 15       # 15 minutes
DEFAULT_TIMEOUT_SLOW_MIN = 90    # 90 minutes
MAX_TIMEOUT_MIN = 10080             # one week

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

# Sidebar panel. A fresh install gets a sidebar entry without doing anything;
# an already-taken path (a hand-made dashboard of the same name, typically) is
# never overwritten — see panel.py.
CONF_PANEL = "panel"
DEFAULT_PANEL = True
CONF_PANEL_PATH = "panel_path"
DEFAULT_PANEL_PATH = "device-saver"
PANEL_COMPONENT = "device-saver-panel"
PANEL_MODULE = "device-saver-panel.js"
PANEL_ICON = "mdi:lan-disconnect"

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
