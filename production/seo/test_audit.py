import copy
import io
import json
import unittest
from datetime import datetime, timezone
from email.message import Message
from pathlib import Path
from unittest.mock import patch

from audit import AuditError, NoRedirect, audit, fetch_projection, LIMIT, PATHS

TOUR = {"id": "tour-12", "version": 2, "content": {
    "title": "Existing tour", "slug": "existing-tour", "description": "Guided tour",
    "image": "/images/tour.jpg", "imageAlt": "Tour"}}
OCCURRENCE = {"id": "occ-91", "version": 1, "content": {
    "tourId": "tour-12", "startsAt": "2026-11-03T10:00:00+02:00",
    "endsAt": "2026-11-03T12:00:00+02:00", "timezone": "Asia/Jerusalem",
    "meetingPoint": "Jerusalem", "capacity": 20, "priceMinor": 0, "currency": "ILS"}}


def projection(tours=None, occurrences=None):
    return {"tours": {"records": [copy.deepcopy(TOUR)] if tours is None else tours},
            "occurrences": {"records": [copy.deepcopy(OCCURRENCE)] if occurrences is None else occurrences}}


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
        self.calls.append((request.full_url, timeout, request.get_method()))
        return Response(request.full_url, {"records": [TOUR] if request.full_url.endswith("/tour") else [OCCURRENCE]})


PUBLIC_DNS = [(None, None, None, None, ("93.184.215.14", 443))]


class AuditTests(unittest.TestCase):
    def run_audit(self, value):
        return audit(value, origin="https://derech-tkuma.com", mode="staging",
                     observed_at=datetime(2026, 10, 19, tzinfo=timezone.utc))

    def test_platform_published_version_keys_stable_and_draft_only(self):
        value = projection()
        result = self.run_audit(value)
        self.assertEqual("internal_only", result["audience"])
        self.assertTrue(result["no_publish"])
        self.assertEqual(4, len(result["proposals"]))
        self.assertTrue(all(p["state"] == "proposed" and not p["publication_allowed"] for p in result["proposals"]))
        self.assertEqual(result, self.run_audit(copy.deepcopy(value)))
        self.assertEqual(2, result["proposals"][0]["published_version"])
        for modify in (lambda r: r.update(version=3), lambda r: r["content"].update(description="Changed")):
            changed = copy.deepcopy(value)
            modify(changed["tours"]["records"][0])
            self.assertNotEqual(result["proposals"][0]["action_id"], self.run_audit(changed)["proposals"][0]["action_id"])

    def test_admin_private_cross_tenant_or_wordpress_shape_rejected(self):
        for record in (dict(TOUR, tenantId="gvanim"), dict(TOUR, draft={}),
                       {"id": 12, "title": "WordPress", "legacy_path": "/old/"}):
            with self.assertRaisesRegex(AuditError, "tour_schema_invalid"):
                self.run_audit(projection(tours=[record]))
        with self.assertRaisesRegex(AuditError, "occurrence_parent_invalid"):
            self.run_audit(projection(tours=[]))

    def test_missing_malformed_and_empty_sources(self):
        with self.assertRaisesRegex(AuditError, "projection_missing"):
            self.run_audit({"tours": {"records": []}})
        for data in ({"tours": [], "occurrences": []}, {"tours": {"records": {}}, "occurrences": {"records": []}}):
            with self.assertRaisesRegex(AuditError, "projection_shape_invalid"):
                self.run_audit(data)
        self.assertEqual("no_published_tours", self.run_audit(projection([], []))["status"])
        value = projection()
        value["tours"]["records"][0]["version"] = 0
        with self.assertRaisesRegex(AuditError, "tour_version_invalid"):
            self.run_audit(value)

    def test_occurrence_and_slug_validation(self):
        for field, value, error in (("endsAt", "2026-11-03T08:00:00Z", "occurrence_time_invalid"),
                                    ("capacity", "20", "occurrence_schema_invalid")):
            data = projection()
            data["occurrences"]["records"][0]["content"][field] = value
            with self.assertRaisesRegex(AuditError, error): self.run_audit(data)
        data = projection()
        data["tours"]["records"][0]["content"]["slug"] = "../private"
        with self.assertRaisesRegex(AuditError, "slug_invalid"): self.run_audit(data)

    def test_two_actual_collection_routes_hosts_and_timeout(self):
        opener = Opener()
        with patch("audit.socket.getaddrinfo", return_value=PUBLIC_DNS):
            origin, data = fetch_projection("https://derech-tkuma.com", mode="staging", opener=opener)
        self.assertEqual([("https://derech-tkuma.com" + path, 8, "GET") for path in PATHS], opener.calls)
        self.assertEqual(1, self.run_audit(data)["published_tours"])
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("10.0.0.2", 443))]):
            with self.assertRaisesRegex(AuditError, "private_endpoint_rejected"):
                fetch_projection("https://derech-tkuma.com", mode="staging", opener=opener)

    def test_off_origin_redirect_and_live_gate(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.example/"))
        class RedirectOpener:
            def open(self, request, timeout): return Response("https://other.example/api/public/collections/tour", {"records": []})
        with patch("audit.socket.getaddrinfo", return_value=PUBLIC_DNS):
            with self.assertRaisesRegex(AuditError, "projection_http_or_redirect"):
                fetch_projection("https://derech-tkuma.com", mode="staging", opener=RedirectOpener())
        with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
            fetch_projection("https://other.example", mode="staging", opener=Opener())
        with self.assertRaisesRegex(AuditError, "new_site_live_verified_required"):
            fetch_projection("https://derech-tkuma.com", mode="public", opener=Opener())

    def test_only_exact_review_host_in_staging_never_public(self):
        review = "https://derech-tkuma-review.22yarden22.workers.dev"
        opener = Opener()
        with patch("audit.socket.getaddrinfo", return_value=PUBLIC_DNS):
            origin, data = fetch_projection(review, mode="staging", opener=opener)
        self.assertEqual(review, origin)
        result = audit(data, origin=origin, mode="staging")
        self.assertEqual("internal_only", result["audience"])
        self.assertTrue(result["no_publish"])
        self.assertEqual(2, len(opener.calls))
        for bad in (review, review.replace("-review.", "-other.")):
            with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
                fetch_projection(bad, mode="public", new_site_live_verified=True, opener=Opener())
            with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
                audit(data, origin=bad, mode="public", new_site_live_verified=True)
        with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
            fetch_projection(review.replace("-review.", "-other."), mode="staging", opener=Opener())

    def test_loopback_requires_explicit_staging_flag(self):
        with self.assertRaises(AuditError):
            fetch_projection("http://127.0.0.1:5174", mode="staging", opener=Opener())
        with patch("audit.socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 5174))]):
            origin, data = fetch_projection("http://127.0.0.1:5174", mode="staging", allow_loopback=True, opener=Opener())
        self.assertEqual("http://127.0.0.1:5174", origin)
        self.assertEqual(1, len(data["tours"]["records"]))

    def source_projection(self):
        seed_path = Path(__file__).resolve().parents[2] / "platform-cms/lib/current-collections.json"
        seed = json.loads(seed_path.read_text())["records"]
        return {name: {"records": [{"id": row["id"], "content": copy.deepcopy(row["content"]), "version": 1}
                                  for row in seed if row["kind"] == kind]}
                for name, kind in (("tours", "tour"), ("occurrences", "occurrence"))}

    def test_current_authoritative_seed_and_unknown_business_fields(self):
        value = self.source_projection()
        before = copy.deepcopy(value)
        result = self.run_audit(value)
        self.assertEqual((4, 6, 16), (result["published_tours"], result["published_occurrences"], len(result["proposals"])))
        self.assertEqual(before, value, "unknown times/capacity must never be filled or mutated")
        self.assertEqual(6, len(result["unknown_occurrence_fields"]))
        self.assertTrue(all(row["fields"] == ["startsAt", "endsAt", "capacity", "meetingPoint"]
                            for row in result["unknown_occurrence_fields"]))
        for row in value["tours"]["records"]:
            proposals = [p for p in result["proposals"] if p["tour_id"] == row["id"]]
            self.assertTrue(all(p["canonical_url_candidate"] == "https://derech-tkuma.com" + row["content"]["sourcePath"]
                                for p in proposals))
            self.assertTrue(all(p["state"] == "proposed" and not p["publication_allowed"] for p in proposals))
        self.assertTrue(result["no_publish"])
        self.assertFalse(result["auto_publish"])
        self.assertEqual("internal_only", result["audience"])

    def test_source_path_exact_identity_and_legacy_fallback(self):
        for source_path in ("/maslulim/עוז-מול-תופת/", "/maslulim/%D7%A2%D7%95%D7%96/", "/existing-route"):
            with self.subTest(source_path=source_path):
                value = projection()
                value["tours"]["records"][0]["content"]["sourcePath"] = source_path
                self.assertEqual("https://derech-tkuma.com" + source_path,
                                 self.run_audit(value)["proposals"][0]["canonical_url_candidate"])
        self.assertEqual("https://derech-tkuma.com/existing-tour/",
                         self.run_audit(projection())["proposals"][0]["canonical_url_candidate"])

    def test_injected_or_malformed_source_paths_fail_closed(self):
        for source_path in (None, "https://other.example/", "//other.example/", "/\\other.example/",
                            "/%2f%2fother.example/", "/a?destination=x", "/a#fragment", "/a/../b/",
                            "/%2e%2e/b/", "/%252e%252e/b/", "/a%20b/", "/a%0ab/", "/bad%zz/",
                            "/%ff/", "/<script>/", "/%27/", "/" + "a" * 500):
            with self.subTest(source_path=source_path):
                value = projection()
                value["tours"]["records"][0]["content"]["sourcePath"] = source_path
                with self.assertRaisesRegex(AuditError, "candidate_path_invalid"):
                    self.run_audit(value)

    def test_source_path_collision_after_decoding_or_trailing_slash(self):
        value = projection(occurrences=[])
        value["tours"]["records"][0]["content"]["sourcePath"] = "/same/"
        other = copy.deepcopy(value["tours"]["records"][0])
        other["id"] = "other-tour"
        other["content"].update(slug="other-tour", sourcePath="/%73ame")
        value["tours"]["records"].append(other)
        with self.assertRaisesRegex(AuditError, "slug_collision"):
            self.run_audit(value)

    def test_current_optional_fields_do_not_accept_private_or_arbitrary_schema(self):
        for kind in ("tours", "occurrences"):
            for field in ("tenantId", "siteId", "draft", "webhookUrl", "providerToken"):
                with self.subTest(kind=kind, field=field):
                    value = self.source_projection()
                    value[kind]["records"][0]["content"][field] = "injected"
                    with self.assertRaisesRegex(AuditError, "tour_schema_invalid|occurrence_schema_invalid"):
                        self.run_audit(value)
        for field, replacement in (("title", []), ("dateLabel", ""), ("note", "x" * 1001),
                                   ("capacity", True), ("capacity", 0), ("priceMinor", True), ("priceMinor", 100000001)):
            with self.subTest(field=field):
                value = self.source_projection()
                value["occurrences"]["records"][0]["content"][field] = replacement
                with self.assertRaises(AuditError):
                    self.run_audit(value)

    def test_known_dates_and_paired_times_remain_strict(self):
        for update in ({"date": "2026-02-30"}, {"date": None}, {"startsAt": "2026-10-16T10:00:00+03:00"},
                       {"startsAt": "2026-10-16T10:00:00+03:00", "endsAt": "2026-10-16T09:00:00+03:00"},
                       {"date": "2026-10-17", "startsAt": "2026-10-16T10:00:00+03:00", "endsAt": "2026-10-16T11:00:00+03:00"},
                       {"timezone": "Not/A_Zone"}):
            with self.subTest(update=update):
                value = self.source_projection()
                value["occurrences"]["records"][0]["content"].update(update)
                with self.assertRaisesRegex(AuditError, "occurrence_date_invalid|occurrence_time_invalid"):
                    self.run_audit(value)
        value = self.source_projection()
        del value["occurrences"]["records"][0]["content"]["date"]
        with self.assertRaisesRegex(AuditError, "occurrence_date_invalid"):
            self.run_audit(value)

    def test_programmatic_origin_and_public_gate_stay_scoped(self):
        for origin in ("https://other.example", "http://derech-tkuma.com", "https://derech-tkuma.com:8443",
                       "https://user@derech-tkuma.com", "https://derech-tkuma.com/private", "https://derech-tkuma.com?x=y",
                       "http://localhost:bad", "http://127.0.0.1:99999"):
            with self.subTest(origin=origin):
                with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
                    audit(projection(), origin=origin, mode="staging")
        with self.assertRaisesRegex(AuditError, "new_site_live_verified_required"):
            audit(projection(), origin="https://derech-tkuma.com", mode="public")
        with self.assertRaisesRegex(AuditError, "off_origin_endpoint_rejected"):
            audit(projection(), origin="http://127.0.0.1:5174", mode="public", new_site_live_verified=True)

    def test_current_seed_transport_remains_exactly_two_fixed_gets(self):
        value = self.source_projection()
        class CurrentOpener(Opener):
            def open(self, request, timeout):
                self.calls.append((request.full_url, timeout, request.get_method()))
                return Response(request.full_url, value["tours" if request.full_url.endswith("/tour") else "occurrences"])
        opener = CurrentOpener()
        with patch("audit.socket.getaddrinfo", return_value=PUBLIC_DNS):
            origin, fetched = fetch_projection("https://derech-tkuma.com", mode="staging", opener=opener)
        self.assertEqual([("https://derech-tkuma.com" + path, 8, "GET") for path in PATHS], opener.calls)
        self.assertEqual(16, len(audit(fetched, origin=origin, mode="staging")["proposals"]))

    def test_invalid_json_and_aggregate_limit_block(self):
        class BadOpener:
            def __init__(self, raw): self.raw = raw
            def open(self, request, timeout):
                response = Response(request.full_url, {})
                response.body = io.BytesIO(self.raw)
                return response
        with patch("audit.socket.getaddrinfo", return_value=PUBLIC_DNS):
            for raw, error in ((b"{", "projection_json_invalid"), (b"x" * (LIMIT + 1), "projection_oversized")):
                with self.assertRaisesRegex(AuditError, error):
                    fetch_projection("https://derech-tkuma.com", mode="staging", opener=BadOpener(raw))


if __name__ == "__main__": unittest.main()
