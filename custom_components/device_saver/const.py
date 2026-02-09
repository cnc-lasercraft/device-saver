DOMAIN = "device_saver"

CONF_DEVICES_CRIT = "devices_critical"
CONF_DEVICES_NORM = "devices_normal"
CONF_DEVICES_SLOW = "devices_slow"

# fixed tiers (can be made configurable later)
TIMEOUT_CRIT = 1          # minutes
TIMEOUT_NORM = 180        # 3 hours
TIMEOUT_SLOW = 10080      # 1 week

CONF_NOTIFY_SERVICE = "notify_service"
CONF_NOTIFY_RECOVERED = "notify_recovered"

DEFAULT_NOTIFY_RECOVERED = True

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
