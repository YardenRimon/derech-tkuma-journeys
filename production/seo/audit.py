"""Bounded read-only SEO drafts from Derech's published CMS projection.

Exactly two fixed GETs; no page crawling, CMS writes, queueing or publishing.
Staging output always stays internal. Public mode requires an explicit live gate.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape

SCHEMA = "derech-new-site-seo-drafts/v1"
PATHS = ("/api/public/collections/tour", "/api/public/collections/occurrence")
LIMIT = 2 * 1024 * 1024
MAX_ITEMS = 200
PUBLIC_HOSTS = {"derech-tkuma.com", "www.derech-tkuma.com"}
TOUR_FIELDS = {"title", "slug", "description", "image", "imageAlt"}
OCCURRENCE_FIELDS = {"tourId", "startsAt", "endsAt", "timezone", "meetingPoint",
                     "priceMinor", "currency", "capacity"}


class AuditError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _origin(url, allow_loopback=False):
    try:
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or
                parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
            raise AuditError("endpoint_invalid")
        host = parsed.hostname.lower()
        local = host in ("localhost", "127.0.0.1", "::1")
        if host not in PUBLIC_HOSTS and not (allow_loopback and local):
            raise AuditError("off_origin_endpoint_rejected")
        if not local and parsed.port not in (None, 443):
            raise AuditError("endpoint_port_rejected")
        if parsed.scheme != "https" and not (allow_loopback and local):
            raise AuditError("https_required")
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        for item in addresses:
            address = ipaddress.ip_address(item[4][0])
            if not address.is_global and not (allow_loopback and local and address.is_loopback):
                raise AuditError("private_endpoint_rejected")
        if not addresses:
            raise AuditError("endpoint_unresolved")
        return parsed.scheme + "://" + parsed.netloc.lower()
    except (socket.gaierror, ValueError) as exc:
        if isinstance(exc, AuditError):
            raise
        raise AuditError("endpoint_unresolved") from None


def fetch_projection(base_url, *, mode, new_site_live_verified=False, allow_loopback=False, opener=None):
    if mode not in ("staging", "public"):
        raise AuditError("mode_invalid")
    if mode == "public" and new_site_live_verified is not True:
        raise AuditError("new_site_live_verified_required")
    if mode == "public" and allow_loopback:
        raise AuditError("public_loopback_forbidden")
    origin = _origin(base_url, allow_loopback=allow_loopback and mode == "staging")
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    projection = {}
    remaining = LIMIT
    for path, name in zip(PATHS, ("tours", "occurrences")):
        request = urllib.request.Request(origin + path, headers={"Accept": "application/json", "User-Agent": "DerechSeoAudit/1.0"}, method="GET")
        try:
            with opener.open(request, timeout=8) as response:
                if response.status != 200 or response.geturl() != origin + path:
                    raise AuditError("projection_http_or_redirect")
                if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise AuditError("projection_type_invalid")
                raw = response.read(remaining + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise AuditError("projection_fetch_failed") from None
        if len(raw) > remaining:
            raise AuditError("projection_oversized")
        remaining -= len(raw)
        try:
            projection[name] = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, UnicodeDecodeError):
            raise AuditError("projection_json_invalid") from None
    return origin, projection


def _canonical_path(path):
    if not isinstance(path, str) or not path.startswith("/") or not path.endswith("/") or "//" in path or "\\" in path:
        raise AuditError("candidate_path_invalid")
    decoded = urllib.parse.unquote(path)
    if any(x in decoded for x in ("?", "#", "\\", "//")) or any(part in (".", "..") for part in decoded.split("/")):
        raise AuditError("candidate_path_invalid")
    return path


def _text(value, name, *, required=False, limit=5000):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise AuditError(name + "_invalid")
    clean = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()
    if required and not clean:
        raise AuditError(name + "_missing")
    return clean


def _digest(item):
    return hashlib.sha256(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()[:24]


def audit(projection, *, origin, mode, new_site_live_verified=False, observed_at=None):
    if mode not in ("staging", "public") or mode == "public" and new_site_live_verified is not True:
        raise AuditError("new_site_live_verified_required")
    if not isinstance(projection, dict) or set(projection) != {"tours", "occurrences"}:
        raise AuditError("projection_missing")
    collections = {}
    for name in ("tours", "occurrences"):
        envelope = projection[name]
        if not isinstance(envelope, dict) or set(envelope) != {"records"}:
            raise AuditError("projection_shape_invalid")
        records = envelope["records"]
        if not isinstance(records, list) or len(records) > MAX_ITEMS:
            raise AuditError("projection_shape_invalid")
        collections[name] = records
    tours, occurrences = collections["tours"], collections["occurrences"]
    ids, paths, proposals = set(), set(), []

    def record_content(record, fields, kind):
        if not isinstance(record, dict) or set(record) != {"id", "content", "version"}:
            raise AuditError(kind + "_schema_invalid")
        rid = record["id"]
        if not isinstance(rid, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", rid):
            raise AuditError(kind + "_id_invalid")
        if type(record["version"]) is not int or not 1 <= record["version"] <= 2**53 - 1:
            raise AuditError(kind + "_version_invalid")
        content = record["content"]
        if not isinstance(content, dict) or set(content) != fields:
            raise AuditError(kind + "_schema_invalid")
        return rid, content

    for record in tours:
        tour_id, tour = record_content(record, TOUR_FIELDS, "tour")
        if tour_id in ids:
            raise AuditError("tour_id_invalid")
        ids.add(tour_id)
        slug = _text(tour["slug"], "slug", required=True, limit=160)
        if slug != tour["slug"] or not all(c.isalnum() or c == "-" for c in slug):
            raise AuditError("slug_invalid")
        path = _canonical_path("/" + slug + "/")
        if path in paths:
            raise AuditError("slug_collision")
        paths.add(path)
        title = _text(tour["title"], "title", required=True, limit=160)
        description = _text(tour["description"], "description", limit=10000)
        image = _text(tour["image"], "image", limit=2000)
        _text(tour["imageAlt"], "imageAlt", limit=500)
        if image and (not image.startswith("/") or image.startswith("//") or re.search(r"[\s<>\"']", tour["image"])):
            raise AuditError("image_invalid")
        revision = str(record["version"]) + "-" + _digest(record)
        canonical = origin + path
        for field, proposal, reason in (
            ("seo_title", title, "Review source title before setting SEO metadata"),
            ("meta_description", description[:155] if description else None, "Source description only; editorial review required"),
            ("canonical", canonical, "Slug-derived candidate only; verify frontend route and original URL mapping"),
            ("sitemap_entry", canonical, "Check route and sitemap inclusion on the verified public site"),
        ):
            proposals.append({"action_id": f"derech-site-seo:{tour_id}:{field}:{revision}",
                              "tour_id": tour_id, "field": field, "source_revision": revision,
                              "published_version": record["version"],
                              "draft_value": proposal, "reason": reason, "state": "proposed",
                              "publication_allowed": False, "canonical_url_candidate": canonical})
    occurrence_ids = set()
    for record in occurrences:
        oid, item = record_content(record, OCCURRENCE_FIELDS, "occurrence")
        parent = item["tourId"]
        if oid in occurrence_ids or not isinstance(parent, str) or parent not in ids:
            raise AuditError("occurrence_parent_invalid")
        occurrence_ids.add(oid)
        _text(item["meetingPoint"], "meetingPoint", required=True, limit=1000)
        _text(item["timezone"], "timezone", required=True, limit=80)
        for key in ("startsAt", "endsAt"):
            value = item[key]
            if (not isinstance(value, str) or len(value) > 40 or not re.fullmatch(
                    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})", value)):
                raise AuditError("occurrence_time_invalid")
        try:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
            ZoneInfo(item["timezone"])
            start, end = (datetime.fromisoformat(item[key].replace("Z", "+00:00")) for key in ("startsAt", "endsAt"))
            if start.utcoffset() is None or end.utcoffset() is None or end <= start:
                raise ValueError()
        except (KeyError, TypeError, ValueError, AttributeError, ZoneInfoNotFoundError):
            raise AuditError("occurrence_time_invalid") from None
        if (type(item["capacity"]) is not int or not 1 <= item["capacity"] <= 100000 or
                type(item["priceMinor"]) is not int or not 0 <= item["priceMinor"] <= 100000000 or
                item["currency"] != "ILS"):
            raise AuditError("occurrence_schema_invalid")
    observed_at = observed_at or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        raise AuditError("observed_time_invalid")
    return {"schema": SCHEMA, "tenant_slug": "derech", "mode": mode,
            "audience": "internal_only", "status": "review_required" if tours else "no_published_tours",
            "observed_at": observed_at.isoformat(), "origin": origin,
            "source_sha256": _digest(projection), "published_tours": len(tours),
            "published_occurrences": len(occurrences), "proposals": proposals,
            "inventory_may_be_capped": len(tours) == MAX_ITEMS or len(occurrences) == MAX_ITEMS,
            "source_adapter": "platform-cms-public-collections/v1",
            "new_site_live_verified": bool(new_site_live_verified), "auto_publish": False, "no_publish": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--mode", choices=("staging", "public"), required=True)
    parser.add_argument("--new-site-live-verified", action="store_true")
    parser.add_argument("--allow-loopback", action="store_true")
    args = parser.parse_args()
    try:
        origin, projection = fetch_projection(args.origin, mode=args.mode,
            new_site_live_verified=args.new_site_live_verified, allow_loopback=args.allow_loopback)
        result = audit(projection, origin=origin, mode=args.mode,
            new_site_live_verified=args.new_site_live_verified)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except AuditError as exc:
        print(json.dumps({"schema": SCHEMA, "tenant_slug": "derech", "status": "blocked", "reason": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
