"""Preserve CMS field identities across explicitly imported template changes.

The initial registry is seeded from the already generated pages, keeping every
existing numeric id. Candidates are ordered exactly as Annotator emits them:
texts in source order, then images in source order. This module never writes
files or mutates its arguments. The build owns persisting the returned registry.

Normal builds must call require_source_template before assigning fields. A
changed/new source is accepted only with import_source=True, passed solely from
the explicit --import-source build path. After that gate, the caller records the
new transformed source SHA on the returned page, alongside its generated output.
Do not reseed from a newly numbered build: that would rebind saved CMS edits.
"""

from collections import Counter
from copy import deepcopy
import hashlib
import json
import re

FORMAT = 1
ID_PATTERN = re.compile(r"^(text|image)-([1-9][0-9]*)$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _candidate(value):
    if not isinstance(value, dict) or not isinstance(value.get("type"), str) or value["type"] not in {"text", "image"}:
        raise ValueError("field must be a text or image object")
    if not isinstance(value.get("value"), str):
        raise ValueError("field value must be a string")
    result = {"type": value["type"], "value": value["value"]}
    if "alt" in value or value["type"] == "image":
        alt = value.get("alt", "")
        if not isinstance(alt, str):
            raise ValueError("field alt must be a string")
        result["alt"] = alt
    return result


def _fingerprint(value):
    return value["type"], value["value"], value.get("alt", "")


def candidate_sequence_sha256(candidates):
    """Hash the ordered original content, including type and image alt text."""
    values = [_fingerprint(_candidate(candidate)) for candidate in candidates]
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _page(slug, page):
    if not isinstance(page, dict):
        raise ValueError("invalid registry page: " + slug)
    source_sha = page.get("sourceTemplateSha256")
    if source_sha is not None and not (isinstance(source_sha, str) and SHA_PATTERN.fullmatch(source_sha)):
        raise ValueError("invalid source template SHA: " + slug)
    if not isinstance(page.get("active"), list) or not isinstance(page.get("retired"), list):
        raise ValueError("invalid active/retired fields: " + slug)
    next_number = page.get("nextNumber")
    if type(next_number) is not int or next_number < 1:
        raise ValueError("invalid next field number: " + slug)
    used = set()
    used_numbers = set()
    maximum = 0
    for entry in page["active"] + page["retired"]:
        candidate = _candidate(entry)
        field_id = entry.get("id")
        match = ID_PATTERN.fullmatch(field_id) if isinstance(field_id, str) else None
        if not match or match[1] != candidate["type"] or field_id in used or int(match[2]) in used_numbers:
            raise ValueError("invalid, reused or duplicate field id: " + slug)
        used.add(field_id)
        used_numbers.add(int(match[2]))
        maximum = max(maximum, int(match[2]))
    if next_number <= maximum:
        raise ValueError("field counter would reuse an allocated number: " + slug)
    if page.get("candidateSequenceSha256") != candidate_sequence_sha256(page["active"]):
        raise ValueError("registry active content fingerprint mismatch: " + slug)
    return page


def validate_registry(registry):
    if not isinstance(registry, dict) or registry.get("format") != FORMAT or not isinstance(registry.get("pages"), dict):
        raise ValueError("unsupported field identity registry")
    for slug, page in registry["pages"].items():
        if not isinstance(slug, str) or not slug.startswith("/"):
            raise ValueError("invalid field registry route")
        _page(slug, page)
    return registry


def require_source_template(slug, source_sha256, registry, *, import_source=False):
    """Refuse source drift in normal builds; grant no implicit import approval.

    The caller passes the SHA of transformed, unannotated source bytes. This
    function does not change that recorded SHA, even on an explicit import.
    """
    if not isinstance(source_sha256, str) or not SHA_PATTERN.fullmatch(source_sha256):
        raise ValueError("source template requires a full lowercase SHA256")
    if type(import_source) is not bool:
        raise ValueError("import_source must be an explicit boolean")
    validate_registry(registry)
    page = registry["pages"].get(slug)
    if not import_source and (page is None or page.get("sourceTemplateSha256") != source_sha256):
        raise ValueError("source template changed; explicit --import-source required: " + slug)


def assign_fields(slug, candidates, registry, *, source_sha256=None):
    """Return (ids, retired original values, new registry), with no mutation.

    Unique original content may move. Repeated content retains its positions
    only when the entire ordered sequence is identical. If that sequence has
    changed, repeated content is ambiguous and gets fresh ids. Every new id uses
    one increasing page-wide counter shared by text and images. Retired ids are
    retained for recovery and never allocated again.
    """
    validate_registry(registry)
    if not isinstance(slug, str) or not slug.startswith("/"):
        raise ValueError("field identities require an absolute route")
    if not isinstance(candidates, list):
        raise ValueError("candidates must be an ordered list")
    supplied = [_candidate(candidate) for candidate in candidates]
    updated = deepcopy(registry)
    page = updated["pages"].setdefault(slug, {
        "sourceTemplateSha256": None,
        "candidateSequenceSha256": candidate_sequence_sha256([]),
        "nextNumber": 1, "active": [], "retired": [],
    })
    old = page["active"]
    old_fingerprints = [_fingerprint(entry) for entry in old]
    new_fingerprints = [_fingerprint(entry) for entry in supplied]
    if source_sha256 is not None and not SHA_PATTERN.fullmatch(source_sha256):
        raise ValueError("invalid current source SHA")
    # Identical repeated values cannot prove that their DOM locations survived.
    # Production supplies the whole source hash: any template change retires
    # ambiguous duplicates even when their value sequence stayed the same.
    same_sequence = old_fingerprints == new_fingerprints and (
        source_sha256 is None or source_sha256 == page.get("sourceTemplateSha256"))
    old_counts = Counter(old_fingerprints)
    new_counts = Counter(new_fingerprints)
    old_unique = {fingerprint: entry["id"] for fingerprint, entry in zip(old_fingerprints, old)
                  if old_counts[fingerprint] == 1}
    ids = []
    for index, (candidate, fingerprint) in enumerate(zip(supplied, new_fingerprints)):
        if same_sequence:
            field_id = old[index]["id"]
        elif old_counts[fingerprint] == 1 and new_counts[fingerprint] == 1:
            field_id = old_unique[fingerprint]
        else:
            field_id = candidate["type"] + "-" + str(page["nextNumber"])
            page["nextNumber"] += 1
        ids.append(field_id)
    retained = set(ids)
    page["retired"].extend(deepcopy(entry) for entry in old if entry["id"] not in retained)
    page["active"] = [{"id": field_id, **candidate} for field_id, candidate in zip(ids, supplied)]
    page["candidateSequenceSha256"] = candidate_sequence_sha256(supplied)
    _page(slug, page)
    retired_originals = {entry["id"]: entry["value"] for entry in page["retired"]}
    return ids, retired_originals, updated


def seed_registry(pages, source_hashes, generated_pages_sha256):
    """One-time seed from frozen existing output, preserving its exact ids.

    source_hashes maps routes to their transformed, unannotated source SHA256.
    The generated file SHA makes the initial identity proof explicit. A build
    must load the committed registry after seeding, never call this to refresh.
    """
    if not isinstance(generated_pages_sha256, str) or not SHA_PATTERN.fullmatch(generated_pages_sha256):
        raise ValueError("seed requires the exact generated page file SHA256")
    if set(pages) != set(source_hashes):
        raise ValueError("seed source hashes must cover the exact existing routes")
    registry = {"format": FORMAT, "seedGeneratedPagesSha256": generated_pages_sha256, "pages": {}}
    for slug, base in pages.items():
        if not isinstance(source_hashes[slug], str) or not SHA_PATTERN.fullmatch(source_hashes[slug]):
            raise ValueError("seed requires a source template SHA256: " + slug)
        fields = base["fields"]
        active = [{"id": field_id, **_candidate(field)} for field_id, field in fields.items()]
        suffixes = []
        for field_id in fields:
            match = ID_PATTERN.fullmatch(field_id)
            if not match:
                raise ValueError("seed requires existing numeric field ids: " + slug)
            suffixes.append(int(match[2]))
        registry["pages"][slug] = {
            "sourceTemplateSha256": source_hashes[slug],
            "candidateSequenceSha256": candidate_sequence_sha256(active),
            "nextNumber": max(suffixes, default=0) + 1,
            "active": active, "retired": [],
        }
    return validate_registry(registry)
