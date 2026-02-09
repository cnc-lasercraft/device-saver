DOMAIN = "device_saver"

CONF_DEVICES_CRIT = "devices_critical"
CONF_DEVICES_NORM = "devices_normal"
CONF_DEVICES_SLOW = "devices_slow"

CONF_TIMEOUT_CRIT_MIN = "timeout_critical_minutes"
CONF_TIMEOUT_NORM_MIN = "timeout_normal_minutes"
CONF_TIMEOUT_SLOW_MIN = "timeout_slow_minutes"

DEFAULT_TIMEOUT_CRIT_MIN = 1          # 1 minute
DEFAULT_TIMEOUT_NORM_MIN = 180        # 3 hours
DEFAULT_TIMEOUT_SLOW_MIN = 10080      # 1 week

CONF_NOTIFY_SERVICE = "notify_service"
CONF_NOTIFY_RECOVERED = "notify_recovered"
DEFAULT_NOTIFY_RECOVERED = True

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
