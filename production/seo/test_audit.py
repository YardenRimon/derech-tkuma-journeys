import copy
import io
import json
import unittest
from datetime import datetime, timezone
from email.message import Message
from unittest.mock import patch

from audit import AuditError, NoRedirect, audit, fetch_projection, LIMIT


TOUR = {"id": 12, "title": "מסלול קיים", "legacy_path": "/existing-tour/",
        "excerpt": "סיור מודרך", "content_html": "<p>סיור מודרך</p>", "featured_media": None,
        "meeting_point": "ירושלים", "duration_minutes": 90, "audience": "קבוצות",
        "status": "open", "group_terms": ""}
OCCURRENCE = {"id": 91, "tour_id": 12, "title": "מועד ראשון",
              "starts_at": "2026-11-03T10:00:00+02:00", "timezone": "Asia/Jerusalem",
              "booking_enabled": False, "booking_url": None, "capacity": 20,
              "price": {"amount_minor": 0, "currency": "ILS"}}


class Response:
    def __init__(self, url, body):
        self.status = 200
        self.url = url
        self.body = io.BytesIO(json.dumps(body).encode())
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"

    def __enter__(self): return self
    def __exit__(self, *args): return False
    def geturl(self): return self.url
    def read(self, size): return self.body.read(size)


class Opener:
    def __init__(self): self.calls = []
    def open(self, request, timeout):
        self.calls.append((request.full_url, timeout))
        body = [TOUR] if request.full_url.endswith("/tours") else [OCCURRENCE]
        return Response(request.full_url, body)


class AuditTests(unittest.TestCase):
    def test_published_drafts_stable_and_internal(self):
        projection = {"tours": [TOUR], "occurrences": [OCCURRENCE]}
        now = datetime(2026, 10, 19, tzinfo=timezone.utc)
        result = audit(projection, origin="https://derech-tkuma.com", mode="staging", observed_at=now)
        self.assertEqual("internal_only", result["audience"])
        self.assertEqual(4, len(result["proposals"]))
        self.assertTrue(all(not p["publication_allowed"] and p["state"] == "proposed" for p in result["proposals"]))
        self.assertEqual([p["action_id"] for p in result["proposals"]],
                         [p["action_id"] for p in audit(copy.deepcopy(projection), origin="https://derech-tkuma.com", mode="staging", observed_at=now)["proposals"]])
        changed = copy.deepcopy(projection)
        changed["tours"][0]["excerpt"] = "נוסח חדש"
        self.assertNotEqual(result["proposals"][0]["action_id"],
                            audit(changed, origin="https://derech-tkuma.com", mode="staging")["proposals"][0]["action_id"])

    def test_draft_private_and_cross_tenant_block(self):
        for field, value in (("post_status", "draft"), ("tenant_slug", "ilans")):
            tour = dict(TOUR, **{field: value})
            with self.assertRaisesRegex(AuditError, "cross_tenant_or_draft_source"):
                audit({"tours": [tour], "occurrences": []}, origin="https://derech-tkuma.com", mode="staging")
        with self.assertRaisesRegex(AuditError, "occurrence_parent_invalid"):
            audit({"tours": [], "occurrences": [OCCURRENCE]}, origin="https://derech-tkuma.com", mode="staging")

    def test_missing_source_and_live_gate(self):
        with self.assertRaisesRegex(AuditError, "projection_missing"):
            audit({"tours": [TOUR]}, origin="https://derech-tkuma.com", mode="staging")
        with self.assertRaisesRegex(AuditError, "new_site_live_verified_required"):
            audit({"tours": [], "occurrences": []}, origin="https://derech-tkuma.com", mode="public")

    def test_fixed_bounded_requests_and_private_endpoint_rejected(self):
        opener = Opener()
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.215.14", 443))]):
            origin, data = fetch_projection("https://derech-tkuma.com", mode="staging", opener=opener)
        self.assertEqual(2, len(opener.calls))
        self.assertEqual({"tours", "occurrences"}, set(data))
        self.assertTrue(all(timeout == 8 for _, timeout in opener.calls))
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("10.0.0.2", 443))]):
            with self.assertRaisesRegex(AuditError, "private_endpoint_rejected"):
                fetch_projection("https://derech-tkuma.com", mode="staging", opener=opener)
        with self.assertRaisesRegex(AuditError, "new_site_live_verified_required"):
            fetch_projection("https://derech-tkuma.com", mode="public", opener=opener)

    def test_non_derech_and_malformed_schema(self):
        for tour in ({"id": 12, "name": "other cms"}, dict(TOUR, duration_minutes="90")):
            with self.assertRaisesRegex(AuditError, "tour_schema_invalid"):
                audit({"tours": [tour], "occurrences": []}, origin="https://derech-tkuma.com", mode="staging")
        with self.assertRaisesRegex(AuditError, "projection_shape_invalid"):
            audit({"tours": {}, "occurrences": []}, origin="https://derech-tkuma.com", mode="staging")

    def test_off_origin_redirect_and_endpoint_block(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.example/"))
        class RedirectOpener:
            def open(self, request, timeout):
                return Response("https://other.example/api/content/tours", [TOUR])
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.215.14", 443))]):
            with self.assertRaisesRegex(AuditError, "projection_http_or_redirect"):
                fetch_projection("https://derech-tkuma.com", mode="staging", opener=RedirectOpener())
        with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
            fetch_projection("https://other.example", mode="staging", opener=Opener())

    def test_loopback_requires_explicit_staging_flag(self):
        with self.assertRaises(AuditError):
            fetch_projection("http://127.0.0.1:8782", mode="staging", opener=Opener())
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 8782))]):
            origin, data = fetch_projection("http://127.0.0.1:8782", mode="staging", allow_loopback=True, opener=Opener())
        self.assertEqual("http://127.0.0.1:8782", origin)
        self.assertEqual(1, len(data["tours"]))

    def test_invalid_json_and_aggregate_limit_block(self):
        class BadOpener:
            def __init__(self, raw): self.raw = raw
            def open(self, request, timeout):
                response = Response(request.full_url, [])
                response.body = io.BytesIO(self.raw)
                return response
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.215.14", 443))]):
            for raw, error in ((b"{", "projection_json_invalid"), (b"x" * (LIMIT + 1), "projection_oversized")):
                with self.assertRaisesRegex(AuditError, error):
                    fetch_projection("https://derech-tkuma.com", mode="staging", opener=BadOpener(raw))


if __name__ == "__main__": unittest.main()
