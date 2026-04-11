DOMAIN = "device_saver"

CONF_DEVICES_EXCLUDED = "devices_excluded"

CONF_TIMEOUT_CRIT_MIN = "timeout_critical_minutes"
CONF_TIMEOUT_SLOW_MIN = "timeout_slow_minutes"

DEFAULT_TIMEOUT_CRIT_MIN = 15       # 15 minutes
DEFAULT_TIMEOUT_SLOW_MIN = 90    # 90 minutes

CONF_NOTIFY_SERVICE = "notify_service"
CONF_NOTIFY_RECOVERED = "notify_recovered"
DEFAULT_NOTIFY_RECOVERED = True

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
