"""Versioned URLs for the bundled frontend assets.

Lives in its own module because both `__init__` (which registers the cards) and
`panel` (which registers the panel module) need it, and importing it from
`__init__` would close an import cycle — `__init__` imports `panel`.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN


async def async_asset_url(hass: HomeAssistant, filename: str) -> str:
    """URL for a bundled asset, carrying the integration version.

    Browsers cache these modules by URL, and do so even though the static path is
    served with cache_headers=False. Without the version an update silently keeps
    serving the previous release's card or panel — no error, no console warning,
    just old behaviour, until someone clears the cache by hand. Making every
    release a distinct URL breaks the cache by itself.
    """
    integration = await async_get_integration(hass, DOMAIN)
    return f"/{DOMAIN}/{filename}?v={integration.version or 'dev'}"
