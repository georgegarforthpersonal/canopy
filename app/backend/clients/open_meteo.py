"""
Open-Meteo API Client for weather snapshots on survey creation.

API Documentation: https://open-meteo.com/en/docs
Free, no API key required.
"""

import logging
import requests
from datetime import datetime
from typing import Optional, Dict, Any, Self

logger = logging.getLogger(__name__)

# TODO: Coordinates are hardcoded to Cannwood for now.
# Each site should have its own lat/lon on the Location model,
# and the client should accept coordinates as parameters.
CANNWOOD_LAT = 51.087
CANNWOOD_LON = -2.432

# WMO Weather interpretation codes
# https://open-meteo.com/en/docs#weathervariables
WMO_WEATHER_DESCRIPTIONS: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


class OpenMeteoClient:
    """Client for fetching weather data from the Open-Meteo API."""

    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, timeout: int = 10):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "CanopyWeather/1.0"
        })

    def fetch_weather(self, hour: int) -> Optional[Dict[str, Any]]:
        """
        Fetch weather snapshot for Cannwood at the given hour.

        Args:
            hour: Hour of day (0-23) to extract from hourly forecast

        Returns:
            Weather snapshot dict, or None on failure
        """
        try:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "latitude": CANNWOOD_LAT,
                    "longitude": CANNWOOD_LON,
                    "hourly": "temperature_2m,precipitation,wind_speed_10m,cloud_cover,weather_code",
                    "timezone": "Europe/London",
                    "forecast_days": 1,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            hourly = data.get("hourly", {})
            index = max(0, min(hour, 23))

            weather_code = hourly["weather_code"][index]
            description = WMO_WEATHER_DESCRIPTIONS.get(weather_code, f"Unknown ({weather_code})")

            return {
                "temperature_c": hourly["temperature_2m"][index],
                "precipitation_mm": hourly["precipitation"][index],
                "wind_speed_kmh": hourly["wind_speed_10m"][index],
                "cloud_cover_percent": hourly["cloud_cover"][index],
                "weather_description": description,
                "latitude": CANNWOOD_LAT,
                "longitude": CANNWOOD_LON,
                "fetched_at": datetime.utcnow().isoformat(),
            }
        except Exception:
            logger.warning("Failed to fetch weather from Open-Meteo", exc_info=True)
            return None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: Any) -> None:
        self.session.close()
