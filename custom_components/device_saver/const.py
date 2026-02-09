
DOMAIN = "device_saver"

CONF_DEVICES = "devices"
CONF_TIMEOUT_MIN = "timeout_minutes"
CONF_NOTIFY_SERVICE = "notify_service"
CONF_NOTIFY_RECOVERED = "notify_recovered"

DEFAULT_TIMEOUT_MIN = 10
DEFAULT_NOTIFY_RECOVERED = True

PLATFORMS = ["binary_sensor", "sensor"]

STATE_BAD = {"unavailable", "unknown"}
