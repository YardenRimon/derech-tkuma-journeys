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
PATHS = ("/api/content/tours", "/api/content/occurrences")
LIMIT = 2 * 1024 * 1024
MAX_ITEMS = 100
PUBLIC_HOSTS = {"derech-tkuma.com", "www.derech-tkuma.com"}
TOUR_FIELDS = {"id", "title", "legacy_path", "excerpt", "content_html", "featured_media",
               "meeting_point", "duration_minutes", "audience", "status", "group_terms"}
OCCURRENCE_FIELDS = {"id", "tour_id", "title", "starts_at", "timezone", "capacity", "price",
                     "booking_url", "booking_enabled"}


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
        raise AuditError("legacy_path_invalid")
    decoded = urllib.parse.unquote(path)
    if any(x in decoded for x in ("?", "#", "\\", "//")) or any(part in (".", "..") for part in decoded.split("/")):
        raise AuditError("legacy_path_invalid")
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
    tours, occurrences = projection["tours"], projection["occurrences"]
    if not isinstance(tours, list) or not isinstance(occurrences, list) or len(tours) > MAX_ITEMS or len(occurrences) > MAX_ITEMS:
        raise AuditError("projection_shape_invalid")
    ids, paths, proposals = set(), set(), []
    for tour in tours:
        if not isinstance(tour, dict) or tour.get("post_status", "publish") != "publish" or tour.get("tenant_slug", "derech") != "derech":
            raise AuditError("cross_tenant_or_draft_source")
        if not TOUR_FIELDS.issubset(tour) or set(tour) - TOUR_FIELDS - {"post_status", "tenant_slug"}:
            raise AuditError("tour_schema_invalid")
        tour_id = tour.get("id")
        if type(tour_id) is not int or tour_id <= 0 or tour_id in ids:
            raise AuditError("tour_id_invalid")
        ids.add(tour_id)
        path = _canonical_path(tour.get("legacy_path"))
        if path in paths:
            raise AuditError("legacy_path_collision")
        paths.add(path)
        title = _text(tour.get("title"), "title", required=True, limit=300)
        excerpt = _text(tour.get("excerpt", ""), "excerpt", limit=2000)
        _text(tour.get("content_html", ""), "content_html", limit=200000)
        for key in ("meeting_point", "audience", "group_terms"):
            _text(tour[key], key)
        if (type(tour["duration_minutes"]) is not int or tour["duration_minutes"] <= 0 or
                tour["status"] not in ("planned", "open", "closed") or
                tour["featured_media"] is not None and not isinstance(tour["featured_media"], str)):
            raise AuditError("tour_schema_invalid")
        revision = _digest(tour)
        canonical = origin + path
        for field, proposal, reason in (
            ("seo_title", title, "CMS projection has no published SEO title field; review before setting"),
            ("meta_description", excerpt[:155] if excerpt else None, "Excerpt is the only source text; review before setting"),
            ("canonical", canonical, "Review exact legacy URL mapping and canonical before publication"),
            ("sitemap_entry", canonical, "Check sitemap inclusion on the verified public site before publication"),
        ):
            proposals.append({"action_id": f"derech-site-seo:{tour_id}:{field}:{revision}",
                              "tour_id": tour_id, "field": field, "source_revision": revision,
                              "draft_value": proposal, "reason": reason, "state": "proposed",
                              "publication_allowed": False, "canonical_url": canonical})
    occurrence_ids = set()
    for item in occurrences:
        if not isinstance(item, dict) or item.get("post_status", "publish") != "publish" or item.get("tenant_slug", "derech") != "derech":
            raise AuditError("cross_tenant_or_draft_source")
        if not OCCURRENCE_FIELDS.issubset(item) or set(item) - OCCURRENCE_FIELDS - {"post_status", "tenant_slug"}:
            raise AuditError("occurrence_schema_invalid")
        oid, parent = item.get("id"), item.get("tour_id")
        if type(oid) is not int or oid <= 0 or oid in occurrence_ids or type(parent) is not int or parent not in ids:
            raise AuditError("occurrence_parent_invalid")
        occurrence_ids.add(oid)
        _text(item.get("title"), "occurrence_title", required=True, limit=300)
        if item.get("timezone") != "Asia/Jerusalem" or type(item.get("booking_enabled")) is not bool:
            raise AuditError("occurrence_schema_invalid")
        price = item["price"]
        if (type(item["capacity"]) is not int or item["capacity"] <= 0 or not isinstance(price, dict) or
                set(price) != {"amount_minor", "currency"} or type(price["amount_minor"]) is not int or
                price["amount_minor"] < 0 or price["currency"] != "ILS"):
            raise AuditError("occurrence_schema_invalid")
        try:
            starts = datetime.fromisoformat(item["starts_at"])
            if starts.utcoffset() is None:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise AuditError("occurrence_time_invalid") from None
        if item.get("booking_url") is not None:
            if not isinstance(item["booking_url"], str):
                raise AuditError("booking_url_invalid")
            u = urllib.parse.urlsplit(item["booking_url"])
            if u.scheme != "https" or not u.hostname or u.username or u.password:
                raise AuditError("booking_url_invalid")
        if item["booking_enabled"] != bool(item["booking_url"]):
            raise AuditError("booking_url_invalid")
    observed_at = observed_at or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        raise AuditError("observed_time_invalid")
    return {"schema": SCHEMA, "tenant_slug": "derech", "mode": mode,
            "audience": "internal_only", "status": "review_required" if tours else "no_published_tours",
            "observed_at": observed_at.isoformat(), "origin": origin,
            "source_sha256": _digest(projection), "published_tours": len(tours),
            "published_occurrences": len(occurrences), "proposals": proposals,
            "inventory_may_be_capped": len(tours) == MAX_ITEMS or len(occurrences) == MAX_ITEMS,
            "new_site_live_verified": bool(new_site_live_verified), "auto_publish": False}


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
