"""
Places connector — Nominatim (OSM) primary, Overpass for POI nearby search.

No API key required. Nominatim terms of service require:
  • User-Agent identifying the app
  • Max 1 req/sec (enforced via time.sleep)
  • No bulk geocoding
"""

import time
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OVERPASS_URL  = "https://overpass-api.de/api/interpreter"
USER_AGENT    = "TARS-PersonalAssistant/1.0 (personal-use)"

# OSM tag mapping: our category → list of (key, value) pairs
_CATEGORY_TAGS: dict[str, list[tuple[str, str]]] = {
    "restaurant":  [("amenity", "restaurant")],
    "fast_food":   [("amenity", "fast_food")],
    "cafe":        [("amenity", "cafe")],
    "bar":         [("amenity", "bar"), ("amenity", "pub")],
    "hotel":       [("tourism", "hotel")],
    "hostel":      [("tourism", "hostel"), ("tourism", "guest_house")],
    "grocery":     [("shop", "supermarket"), ("shop", "convenience")],
    "supermarket": [("shop", "supermarket")],
    "pharmacy":    [("amenity", "pharmacy")],
    "hospital":    [("amenity", "hospital")],
    "clinic":      [("amenity", "clinic"), ("amenity", "doctors")],
    "bank":        [("amenity", "bank")],
    "atm":         [("amenity", "atm")],
    "gas_station": [("amenity", "fuel")],
    "fuel":        [("amenity", "fuel")],
    "parking":     [("amenity", "parking")],
    "school":      [("amenity", "school")],
    "university":  [("amenity", "university"), ("amenity", "college")],
    "gym":         [("leisure", "fitness_centre"), ("amenity", "gym")],
    "park":        [("leisure", "park")],
    "museum":      [("tourism", "museum")],
    "mall":        [("shop", "mall"), ("building", "retail")],
    "cinema":      [("amenity", "cinema")],
    "spa":         [("leisure", "spa")],
    "salon":       [("shop", "hairdresser"), ("shop", "beauty")],
    "dentist":     [("amenity", "dentist")],
    "church":      [("amenity", "place_of_worship")],
}


def _result_to_place(r: dict) -> dict:
    """Normalise a Nominatim search result to our internal place dict."""
    osm_type = r.get("osm_type", "node")
    osm_id   = str(r.get("osm_id", ""))
    lat      = float(r.get("lat", 0))
    lng      = float(r.get("lon", 0))
    addr     = r.get("address", {})

    # Build a human-readable address from components
    parts = []
    for field in ("road", "neighbourhood", "suburb", "city_district", "city", "town",
                  "village", "county", "state", "country"):
        v = addr.get(field)
        if v and v not in parts:
            parts.append(v)
    address = ", ".join(parts[:4]) if parts else r.get("display_name", "")

    # Derive category from OSM class/type
    category = r.get("type") or r.get("class") or None

    return {
        "name":     r.get("namedetails", {}).get("name") or r.get("display_name", "").split(",")[0].strip(),
        "address":  address,
        "lat":      lat,
        "lng":      lng,
        "category": category,
        "osm_id":   osm_id,
        "osm_type": osm_type,
        "source":   "osm",
        "display_name": r.get("display_name", ""),
    }


def _overpass_element_to_place(el: dict) -> Optional[dict]:
    """Normalise an Overpass API element to our internal place dict."""
    tags = el.get("tags", {})
    name = tags.get("name") or tags.get("name:en")
    if not name:
        return None

    lat = el.get("lat") or el.get("center", {}).get("lat")
    lng = el.get("lon") or el.get("center", {}).get("lon")
    if lat is None or lng is None:
        return None

    # Build address
    addr_parts = []
    for field in ("addr:housenumber", "addr:street", "addr:suburb", "addr:city"):
        v = tags.get(field)
        if v:
            addr_parts.append(v)
    address = " ".join(addr_parts) if addr_parts else None

    # Category from amenity/shop/tourism/leisure
    category = (
        tags.get("amenity")
        or tags.get("shop")
        or tags.get("tourism")
        or tags.get("leisure")
    )

    return {
        "name":     name,
        "address":  address,
        "lat":      float(lat),
        "lng":      float(lng),
        "category": category,
        "osm_id":   str(el.get("id", "")),
        "osm_type": el.get("type", "node"),
        "source":   "osm",
        "display_name": f"{name}{', ' + address if address else ''}",
    }


class PlacesClient:
    """
    Thin wrapper around Nominatim (text search / geocoding) and
    Overpass (nearby POI search). Synchronous — run in executor.
    """

    def __init__(self, timeout: float = 10.0):
        self._timeout = timeout
        self._last_req: float = 0.0

    def _throttle(self) -> None:
        """Nominatim requires ≤1 req/sec."""
        elapsed = time.monotonic() - self._last_req
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)
        self._last_req = time.monotonic()

    # ── Text search ───────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        near: Optional[str] = None,
        limit: int = 10,
    ) -> list[dict]:
        """
        Free-text place search via Nominatim.
        Optionally bias towards a location string (e.g. 'Makati, Metro Manila').
        """
        self._throttle()
        params: dict = {
            "q":              query if not near else f"{query} {near}",
            "format":         "json",
            "addressdetails": 1,
            "namedetails":    1,
            "limit":          limit,
            "extratags":      1,
        }
        try:
            resp = httpx.get(
                f"{NOMINATIM_URL}/search",
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            results = resp.json()
            return [_result_to_place(r) for r in results]
        except Exception as exc:
            log.warning("Nominatim search failed (%s): %s", query, exc)
            return []

    def reverse_geocode(self, lat: float, lng: float) -> Optional[dict]:
        """Reverse-geocode coordinates to a place dict."""
        self._throttle()
        try:
            resp = httpx.get(
                f"{NOMINATIM_URL}/reverse",
                params={
                    "lat":            lat,
                    "lon":            lng,
                    "format":         "json",
                    "addressdetails": 1,
                    "namedetails":    1,
                },
                headers={"User-Agent": USER_AGENT},
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                return None
            return _result_to_place(data)
        except Exception as exc:
            log.warning("Nominatim reverse geocode failed: %s", exc)
            return None

    # ── Nearby POI search (Overpass) ──────────────────────────────────────────

    def search_nearby(
        self,
        lat: float,
        lng: float,
        category: str,
        radius: int = 1000,
        limit: int = 10,
    ) -> list[dict]:
        """
        Search for POIs of a given category within radius metres of a point.
        Uses Overpass API; returns up to `limit` results sorted by proximity.
        """
        tags = _CATEGORY_TAGS.get(category.lower(), [])
        if not tags:
            # Fall back to Nominatim text search near the coordinates
            near_str = f"{lat},{lng}"
            return self.search(category, near=near_str, limit=limit)

        # Build Overpass query for all matching tags
        # e.g.  node["amenity"="restaurant"](around:1000,14.55,121.03);
        node_clauses = []
        for k, v in tags:
            node_clauses.append(f'node["{k}"="{v}"](around:{radius},{lat},{lng});')
            node_clauses.append(f'way["{k}"="{v}"](around:{radius},{lat},{lng});')

        ql = (
            "[out:json][timeout:15];\n"
            "(\n"
            + "\n".join(node_clauses)
            + "\n);\n"
            "out center body;\n"
        )

        try:
            resp = httpx.post(
                OVERPASS_URL,
                data={"data": ql},
                headers={"User-Agent": USER_AGENT},
                timeout=20.0,
            )
            resp.raise_for_status()
            elements = resp.json().get("elements", [])

            places: list[dict] = []
            for el in elements:
                p = _overpass_element_to_place(el)
                if p:
                    # Compute approximate distance for sorting
                    dlat = p["lat"] - lat
                    dlng = p["lng"] - lng
                    p["_dist"] = (dlat ** 2 + dlng ** 2) ** 0.5
                    places.append(p)

            # Sort by distance, return top N
            places.sort(key=lambda x: x.get("_dist", 0))
            return places[:limit]

        except Exception as exc:
            log.warning("Overpass search_nearby failed (%s): %s", category, exc)
            # Fall back to Nominatim
            return self.search(f"{category} near {lat},{lng}", limit=limit)
