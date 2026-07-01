"""
Tests for Locations Router

Tests CRUD operations for the /api/locations endpoints.
"""

from fastapi.testclient import TestClient


class TestGetLocations:
    """Tests for GET /api/locations"""

    def test_get_locations_empty(self, client: TestClient, auth_headers: dict):
        """Should return empty list when no locations exist."""
        response = client.get("/api/locations", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_get_locations_returns_list(
        self, client: TestClient, auth_headers: dict, create_location
    ):
        """Should return list of locations sorted by name."""
        create_location(name="Woodland")
        create_location(name="Meadow")

        response = client.get("/api/locations", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 2
        assert data[0]["name"] == "Meadow"  # Sorted alphabetically
        assert data[1]["name"] == "Woodland"


class TestGetLocationById:
    """Tests for GET /api/locations/{id}"""

    def test_get_location_by_id(
        self, client: TestClient, auth_headers: dict, create_location
    ):
        """Should return location by ID."""
        location = create_location(name="Test Field")

        response = client.get(f"/api/locations/{location.id}", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == location.id
        assert data["name"] == "Test Field"

    def test_get_location_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent location."""
        response = client.get("/api/locations/99999", headers=auth_headers)
        assert response.status_code == 404


class TestCreateLocation:
    """Tests for POST /api/locations"""

    def test_create_location(self, client: TestClient, auth_headers: dict):
        """Should create a new location."""
        response = client.post(
            "/api/locations",
            json={"name": "New Meadow"},
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["name"] == "New Meadow"
        assert "id" in data

    def test_create_location_unauthorized(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post("/api/locations", json={"name": "Test"})
        assert response.status_code == 401


class TestUpdateLocation:
    """Tests for PUT /api/locations/{id}"""

    def test_update_location(
        self, client: TestClient, auth_headers: dict, create_location
    ):
        """Should update location name."""
        location = create_location(name="Old Name")

        response = client.put(
            f"/api/locations/{location.id}",
            json={"name": "New Name"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"

    def test_update_location_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent location."""
        response = client.put(
            "/api/locations/99999",
            json={"name": "Test"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestDeleteLocation:
    """Tests for DELETE /api/locations/{id}"""

    def test_delete_location(
        self, client: TestClient, auth_headers: dict, create_location
    ):
        """Should delete location."""
        location = create_location(name="To Delete")

        response = client.delete(
            f"/api/locations/{location.id}", headers=auth_headers
        )
        assert response.status_code == 204

        # Verify deleted
        get_response = client.get(
            f"/api/locations/{location.id}", headers=auth_headers
        )
        assert get_response.status_code == 404

    def test_delete_location_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent location."""
        response = client.delete("/api/locations/99999", headers=auth_headers)
        assert response.status_code == 404


# GeoJSON fixtures used across the geometry tests
POLYGON_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [-2.38, 51.15], [-2.37, 51.15], [-2.37, 51.16], [-2.38, 51.16], [-2.38, 51.15],
    ]],
}
LINESTRING_GEOMETRY = {
    "type": "LineString",
    "coordinates": [[-2.38, 51.15], [-2.375, 51.155], [-2.37, 51.16]],
}
POINT_GEOMETRY = {"type": "Point", "coordinates": [-2.38, 51.15]}

SECTOR_1_GEOMETRY = {
    "type": "LineString",
    "coordinates": [[-2.38, 51.15], [-2.375, 51.155]],
}
SECTOR_2_GEOMETRY = {
    "type": "LineString",
    "coordinates": [[-2.375, 51.155], [-2.37, 51.16]],
}


class TestLocationGeometry:
    """Tests for typed geometry (area / route / point / none)."""

    def test_default_location_type_is_none(self, client: TestClient, auth_headers: dict):
        """A location created without a type defaults to 'none'."""
        response = client.post(
            "/api/locations", json={"name": "Plain"}, headers=auth_headers
        )
        assert response.status_code == 201
        assert response.json()["location_type"] == "none"

    def test_create_area_with_polygon(self, client: TestClient, auth_headers: dict):
        """Should create an area location with a polygon boundary."""
        response = client.post(
            "/api/locations",
            json={"name": "Reserve", "location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["location_type"] == "area"

    def test_create_route_with_linestring(self, client: TestClient, auth_headers: dict):
        """Should create a route location with a line geometry."""
        response = client.post(
            "/api/locations",
            json={"name": "Transect 1", "location_type": "route", "geometry": LINESTRING_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["location_type"] == "route"

    def test_create_point_location(self, client: TestClient, auth_headers: dict):
        """Should create a point location."""
        response = client.post(
            "/api/locations",
            json={"name": "Nest", "location_type": "point", "geometry": POINT_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["location_type"] == "point"

    def test_none_type_rejects_geometry(self, client: TestClient, auth_headers: dict):
        """A 'none' location must not carry geometry."""
        response = client.post(
            "/api/locations",
            json={"name": "Nowhere", "location_type": "none", "geometry": POINT_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_geometry_type_mismatch_rejected(self, client: TestClient, auth_headers: dict):
        """An area must be a polygon, not a line."""
        response = client.post(
            "/api/locations",
            json={"name": "Bad", "location_type": "area", "geometry": LINESTRING_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_invalid_geojson_rejected(self, client: TestClient, auth_headers: dict):
        """Malformed GeoJSON returns 422 rather than a 500."""
        response = client.post(
            "/api/locations",
            json={
                "name": "Broken",
                "location_type": "point",
                "geometry": {"type": "Point", "coordinates": "not-coordinates"},
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_with_boundaries_returns_geometry(self, client: TestClient, auth_headers: dict):
        """with-boundaries returns GeoJSON geometry, type, and the polygon ring."""
        client.post(
            "/api/locations",
            json={"name": "Reserve", "location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        )
        client.post(
            "/api/locations",
            json={"name": "Transect", "location_type": "route", "geometry": LINESTRING_GEOMETRY},
            headers=auth_headers,
        )
        # A no-geometry location should be excluded.
        client.post("/api/locations", json={"name": "Plain"}, headers=auth_headers)

        response = client.get("/api/locations/with-boundaries", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        names = {row["name"] for row in data}
        assert names == {"Reserve", "Transect"}

        reserve = next(r for r in data if r["name"] == "Reserve")
        assert reserve["location_type"] == "area"
        assert reserve["geometry"]["type"] == "Polygon"
        # Backward-compatible outer ring for areas
        assert reserve["boundary_geometry"][0] == [-2.38, 51.15]

        transect = next(r for r in data if r["name"] == "Transect")
        assert transect["geometry"]["type"] == "LineString"
        # Routes have no polygon ring
        assert transect["boundary_geometry"] is None

    def test_update_sets_geometry(self, client: TestClient, auth_headers: dict, create_location):
        """Updating with geometry attaches a shape to an existing location."""
        location = create_location(name="Field")
        response = client.put(
            f"/api/locations/{location.id}",
            json={"location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        )
        assert response.status_code == 200

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        assert any(r["id"] == location.id for r in boundaries)

    def test_update_to_none_clears_geometry(self, client: TestClient, auth_headers: dict):
        """Switching a location to type 'none' removes its geometry."""
        created = client.post(
            "/api/locations",
            json={"name": "Reserve", "location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        ).json()

        response = client.put(
            f"/api/locations/{created['id']}",
            json={"location_type": "none"},
            headers=auth_headers,
        )
        assert response.status_code == 200

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        assert all(r["id"] != created["id"] for r in boundaries)

    def test_changing_type_without_geometry_clears_stale_shape(
        self, client: TestClient, auth_headers: dict
    ):
        """Switching to a different shape type without new geometry drops the old shape."""
        created = client.post(
            "/api/locations",
            json={"name": "Reserve", "location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        ).json()

        response = client.put(
            f"/api/locations/{created['id']}",
            json={"location_type": "route"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["location_type"] == "route"

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        assert all(r["id"] != created["id"] for r in boundaries)

    def test_update_name_only_preserves_geometry(self, client: TestClient, auth_headers: dict):
        """Omitting geometry on update leaves the existing shape intact."""
        created = client.post(
            "/api/locations",
            json={"name": "Reserve", "location_type": "area", "geometry": POLYGON_GEOMETRY},
            headers=auth_headers,
        ).json()

        client.put(
            f"/api/locations/{created['id']}",
            json={"name": "Renamed Reserve"},
            headers=auth_headers,
        )

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        match = next(r for r in boundaries if r["id"] == created["id"])
        assert match["name"] == "Renamed Reserve"
        assert match["geometry"]["type"] == "Polygon"


class TestRouteSectors:
    """Tests for sectors — sub-segments of a route stored as child locations."""

    def _create_route_with_sectors(self, client: TestClient, auth_headers: dict):
        return client.post(
            "/api/locations",
            json={
                "name": "Transect",
                "location_type": "route",
                "geometry": LINESTRING_GEOMETRY,
                "sectors": [
                    {"name": "Woodland ride", "geometry": SECTOR_1_GEOMETRY},
                    {"name": "Open meadow", "geometry": SECTOR_2_GEOMETRY},
                ],
            },
            headers=auth_headers,
        )

    def test_create_route_with_sectors_nests_them(self, client: TestClient, auth_headers: dict):
        """Sectors sent on create are returned nested under the route, in order."""
        resp = self._create_route_with_sectors(client, auth_headers)
        assert resp.status_code == 201
        route_id = resp.json()["id"]

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        route = next(r for r in boundaries if r["id"] == route_id)
        sectors = route["sectors"]
        assert [s["name"] for s in sectors] == ["Woodland ride", "Open meadow"]
        assert [s["ordinal"] for s in sectors] == [1, 2]
        assert sectors[0]["geometry"]["type"] == "LineString"

    def test_sectors_are_selectable_locations(self, client: TestClient, auth_headers: dict):
        """Sectors are ordinary selectable locations in GET /locations..."""
        self._create_route_with_sectors(client, auth_headers)

        flat = client.get("/api/locations", headers=auth_headers).json()
        names = {loc["name"] for loc in flat}
        assert "Transect" in names
        assert {"Woodland ride", "Open meadow"} <= names

        # ...but on the map they remain nested under their route, not top-level rows.
        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        assert [r["name"] for r in boundaries] == ["Transect"]

    def test_update_replaces_sector_set(self, client: TestClient, auth_headers: dict):
        """An explicit sectors list on update replaces the full set (add/remove)."""
        route_id = self._create_route_with_sectors(client, auth_headers).json()["id"]
        existing = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        first_sector = next(r for r in existing if r["id"] == route_id)["sectors"][0]

        resp = client.put(
            f"/api/locations/{route_id}",
            json={
                "sectors": [
                    # keep the first (by id), drop the second, add a third
                    {"id": first_sector["id"], "name": "Woodland ride", "geometry": SECTOR_1_GEOMETRY},
                    {"name": "New end", "geometry": SECTOR_2_GEOMETRY},
                ]
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200

        route = next(
            r for r in client.get("/api/locations/with-boundaries", headers=auth_headers).json()
            if r["id"] == route_id
        )
        assert [s["name"] for s in route["sectors"]] == ["Woodland ride", "New end"]
        # The kept sector retained its id
        assert route["sectors"][0]["id"] == first_sector["id"]

    def test_switching_route_to_non_route_drops_sectors(self, client: TestClient, auth_headers: dict):
        """A route that becomes an area/point/none sheds its sectors."""
        route_id = self._create_route_with_sectors(client, auth_headers).json()["id"]

        client.put(
            f"/api/locations/{route_id}",
            json={"location_type": "none"},
            headers=auth_headers,
        )

        flat = client.get("/api/locations", headers=auth_headers).json()
        # Only the (now none-type) parent remains; sectors are gone.
        assert len(flat) == 1

    def test_deleting_route_cascades_to_sectors(self, client: TestClient, auth_headers: dict):
        """Deleting a route removes its sectors too."""
        route_id = self._create_route_with_sectors(client, auth_headers).json()["id"]

        resp = client.delete(f"/api/locations/{route_id}", headers=auth_headers)
        assert resp.status_code == 204

        boundaries = client.get("/api/locations/with-boundaries", headers=auth_headers).json()
        assert boundaries == []

    def test_sectors_rejected_for_non_route(self, client: TestClient, auth_headers: dict):
        """Only routes may carry sectors."""
        resp = client.post(
            "/api/locations",
            json={
                "name": "Reserve",
                "location_type": "area",
                "geometry": POLYGON_GEOMETRY,
                "sectors": [{"name": "Nope", "geometry": SECTOR_1_GEOMETRY}],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422
