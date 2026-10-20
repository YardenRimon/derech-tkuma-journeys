"""Prepare task-29 effects and verify private CMS readback for the existing gateway.

Offline only: no HTTP transport, HMAC secret, queue, scheduler or publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from audit import AuditError, audit

SCHEMA = "derech-seo-execution-plan/v1"
ORIGIN = "https://derech-tkuma-review.22yarden22.workers.dev"
FIELDS = ("seo_title", "meta_description", "canonical", "sitemap_entry")
JS_WHITESPACE = r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def integer(value, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1


def recipe_values(source):
    content = source["content"]
    def plain(value):
        if re.search(r"<|>|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value, re.I):
            raise AuditError("seo_source_editorial_review_required")
        return re.sub(JS_WHITESPACE, " ", value).strip(" ")
    title, description = plain(content["title"]), plain(content["description"])
    canonical = ORIGIN + content.get("sourcePath", "/" + content["slug"] + "/")
    return dict(seo_title=title, meta_description=description[:155] if description else None,
                canonical=canonical, sitemap_entry=canonical)


def identity(effect):
    return {key: effect[key] for key in ("kind", "itemId", "target", "origin", "source")}


def request_hash(effect):
    return digest(dict(identity(effect), values=effect["values"], publicationAllowed=False))


def _readback(value, source):
    if (not isinstance(value, dict) or set(value) != {"tourId", "recordRevision", "source", "draft", "history", "receipt"}
            or value["tourId"] != source["id"] or value["source"] != source
            or not integer(value["recordRevision"], 1) or not isinstance(value["history"], list)):
        raise AuditError("seo_protected_source_mismatch")
    draft = value["draft"]
    if draft is not None and (not isinstance(draft, dict) or draft.get("tenantId") != "derech"
            or draft.get("siteId") != "derech-main" or draft.get("tourId") != source["id"]
            or not integer(draft.get("revision"), 1) or draft.get("publicationAllowed") is not False
            or draft.get("state") not in ("proposed", "withdrawn")):
        raise AuditError("seo_draft_readback_invalid")
    return value


def prepare(projection, readbacks, *, origin=ORIGIN):
    if origin != ORIGIN:
        raise AuditError("seo_review_origin_required")
    result = audit(projection, origin=origin, mode="staging")
    sources = projection["tours"]["records"]
    if not isinstance(readbacks, list) or len(readbacks) != len(sources):
        raise AuditError("seo_readback_inventory_mismatch")
    indexed = {}
    for value in readbacks:
        if not isinstance(value, dict) or not isinstance(value.get("tourId"), str) or value["tourId"] in indexed:
            raise AuditError("seo_readback_inventory_mismatch")
        indexed[value["tourId"]] = value
    effects, settled = [], []
    for source in sources:
        if source["id"] not in indexed:
            raise AuditError("seo_readback_inventory_mismatch")
        readback = _readback(indexed[source["id"]], source)
        values = recipe_values(source)
        audited = {p["field"]: p["draft_value"] for p in result["proposals"] if p["tour_id"] == source["id"]}
        if values != audited:
            raise AuditError("seo_recipe_proposal_mismatch")
        effect = dict(kind="seo_draft", itemId=29, target=source["id"], origin=origin,
            source=source, values=values, expectedRecordRevision=readback["recordRevision"],
            expectedDraftRevision=readback["draft"]["revision"] if readback["draft"] else 0,
            publicationAllowed=False)
        effect["effectKey"] = digest(identity(effect))
        receipt = readback["receipt"]
        if receipt is not None:
            if (not isinstance(receipt, dict) or receipt.get("kind") != "seo_draft"
                    or receipt.get("effectKey") != effect["effectKey"]
                    or receipt.get("requestHash") != request_hash(effect)
                    or receipt.get("state") not in ("applied_draft", "rolled_back")):
                raise AuditError("seo_receipt_mismatch")
            settled.append({"effectKey": effect["effectKey"], "state": receipt["state"]})
        else:
            effects.append(effect)
    return {"schema": SCHEMA, "task_id": 29, "audience": "internal_only",
            "origin": origin, "effects": effects, "settled": settled,
            "source_sha256": result["source_sha256"], "auto_publish": False, "no_publish": True,
            "requires_existing_approved_execution": True}


def verify_readback(effect, readback):
    if (not isinstance(effect, dict) or set(effect) != {"kind", "effectKey", "itemId", "target", "origin", "source", "values", "expectedRecordRevision", "expectedDraftRevision", "publicationAllowed"} or effect.get("kind") != "seo_draft" or effect.get("itemId") != 29
            or effect.get("origin") != ORIGIN or effect.get("publicationAllowed") is not False
            or not integer(effect.get("expectedRecordRevision"), 1) or not integer(effect.get("expectedDraftRevision"))):
        raise AuditError("seo_effect_invalid")
    source = effect["source"]
    audit({"tours": {"records": [source]}, "occurrences": {"records": []}}, origin=ORIGIN, mode="staging")
    if (effect["target"] != source["id"] or effect["values"] != recipe_values(source)
            or effect["effectKey"] != digest(identity(effect))):
        raise AuditError("seo_effect_invalid")
    value = _readback(readback, source)
    receipt, draft = value["receipt"], value["draft"]
    if (not isinstance(receipt, dict) or receipt.get("kind") != "seo_draft"
            or receipt.get("effectKey") != effect["effectKey"] or receipt.get("requestHash") != request_hash(effect)):
        raise AuditError("seo_receipt_unconfirmed")
    if receipt.get("state") == "rolled_back":
        return {"effectKey": effect["effectKey"], "state": "rolled_back", "no_publish": True}
    expected_revision = effect["expectedDraftRevision"] + 1
    if (receipt.get("state") != "applied_draft" or receipt.get("revision") != expected_revision
            or draft != receipt.get("after") or draft is None
            or draft.get("state") != "proposed" or draft.get("revision") != expected_revision
            or draft.get("origin") != ORIGIN or draft.get("publicationAllowed") is not False
            or draft.get("values") != effect["values"] or draft.get("sourceHash") != digest(source)
            or draft.get("sourceRecordRevision") != effect["expectedRecordRevision"]
            or draft.get("sourcePublishedVersion") != source["version"]
            or value["recordRevision"] != effect["expectedRecordRevision"]):
        raise AuditError("seo_draft_unconfirmed_or_changed")
    return {"effectKey": effect["effectKey"], "state": "verified_private_draft",
            "revision": expected_revision, "source_unchanged": True, "no_publish": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("prepare")
    plan.add_argument("--projection", required=True, type=Path)
    plan.add_argument("--readbacks", required=True, type=Path)
    check = commands.add_parser("verify")
    check.add_argument("--effect", required=True, type=Path)
    check.add_argument("--readback", required=True, type=Path)
    args = parser.parse_args()
    try:
        def load(path):
            raw = path.read_bytes()
            if len(raw) > 2 * 1024 * 1024:
                raise AuditError("seo_input_oversized")
            return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        result = prepare(load(args.projection), load(args.readbacks)) if args.command == "prepare" else verify_readback(load(args.effect), load(args.readback))
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (AuditError, ValueError, TypeError, KeyError, OSError):
        print(json.dumps({"schema": SCHEMA, "status": "blocked", "reason": "invalid_or_unconfirmed_seo_execution", "no_publish": True}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
