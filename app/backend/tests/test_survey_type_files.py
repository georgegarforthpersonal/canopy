"""
Tests for Survey Type Files endpoints.

Covers upload / list / download-url / delete of reference files attached to a
survey type. R2 storage calls are patched so no real network/credentials are
needed.
"""

import io
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def patch_r2(monkeypatch):
    """Patch the R2 helpers used by the survey_types router."""
    uploaded: dict = {}
    deleted: list = []

    def fake_upload(file_data, filename, org_slug, media_type, content_type=None):
        key = f"{media_type.value}/{org_slug}/{filename}"
        uploaded[key] = file_data.read()
        return key

    def fake_presign(r2_key, expires_in=3600):
        return f"https://example.test/{r2_key}?sig=abc"

    def fake_delete(r2_key):
        deleted.append(r2_key)
        return True

    monkeypatch.setattr("routers.survey_types.upload_media_file", fake_upload)
    monkeypatch.setattr("routers.survey_types.generate_media_presigned_url", fake_presign)
    monkeypatch.setattr("routers.survey_types.delete_media_file", fake_delete)
    return {"uploaded": uploaded, "deleted": deleted}


def _upload(client, headers, survey_type_id, filename="methodology.pdf",
            content=b"%PDF-1.4 fake", content_type="application/pdf"):
    return client.post(
        f"/api/survey-types/{survey_type_id}/files",
        headers=headers,
        files={"file": (filename, io.BytesIO(content), content_type)},
    )


class TestListSurveyTypeFiles:
    def test_empty(self, client: TestClient, auth_headers: dict, create_survey_type):
        st = create_survey_type(name="Butterfly")
        resp = client.get(f"/api/survey-types/{st.id}/files", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_missing_survey_type(self, client: TestClient, auth_headers: dict):
        resp = client.get("/api/survey-types/99999/files", headers=auth_headers)
        assert resp.status_code == 404


class TestUploadSurveyTypeFile:
    def test_upload_returns_metadata(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        resp = _upload(client, auth_headers, st.id)
        assert resp.status_code == 201
        body = resp.json()
        assert body["filename"] == "methodology.pdf"
        assert body["content_type"] == "application/pdf"
        assert body["size_bytes"] == len(b"%PDF-1.4 fake")
        assert body["survey_type_id"] == st.id
        assert "r2_key" not in body  # never expose the storage key
        # File landed in (patched) R2 under reference/<org>/...
        assert any("reference/" in k and "methodology.pdf" in k for k in patch_r2["uploaded"])

    def test_upload_then_list(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        _upload(client, auth_headers, st.id, filename="form.xlsx")
        resp = client.get(f"/api/survey-types/{st.id}/files", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["filename"] == "form.xlsx"

    def test_upload_empty_file_rejected(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        resp = _upload(client, auth_headers, st.id, content=b"")
        assert resp.status_code == 400

    def test_upload_missing_survey_type(self, client, auth_headers, patch_r2):
        resp = _upload(client, auth_headers, 99999)
        assert resp.status_code == 404

    def test_upload_requires_admin(self, client, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        resp = _upload(client, {}, st.id)  # no auth headers
        assert resp.status_code == 401


class TestDownloadAndDelete:
    def test_download_url(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        file_id = _upload(client, auth_headers, st.id).json()["id"]
        resp = client.get(
            f"/api/survey-types/{st.id}/files/{file_id}/download", headers=auth_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["download_url"].startswith("https://example.test/")
        assert body["filename"] == "methodology.pdf"

    def test_download_missing_file(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        resp = client.get(
            f"/api/survey-types/{st.id}/files/99999/download", headers=auth_headers
        )
        assert resp.status_code == 404

    def test_delete_removes_file(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        file_id = _upload(client, auth_headers, st.id).json()["id"]
        resp = client.delete(
            f"/api/survey-types/{st.id}/files/{file_id}", headers=auth_headers
        )
        assert resp.status_code == 204
        assert len(patch_r2["deleted"]) == 1
        # Now gone from the list
        listed = client.get(f"/api/survey-types/{st.id}/files", headers=auth_headers).json()
        assert listed == []

    def test_delete_requires_admin(self, client, auth_headers, create_survey_type, patch_r2):
        st = create_survey_type(name="Butterfly")
        file_id = _upload(client, auth_headers, st.id).json()["id"]
        resp = client.delete(f"/api/survey-types/{st.id}/files/{file_id}")
        assert resp.status_code == 401
