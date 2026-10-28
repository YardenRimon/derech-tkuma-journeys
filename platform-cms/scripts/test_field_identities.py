"""Identity invariants, including every existing page and random transitions."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("field_identities", Path(__file__).with_name("field-identities.py"))
IDENTITIES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IDENTITIES)
assign_fields = IDENTITIES.assign_fields
require_source_template = IDENTITIES.require_source_template
SHA = "a" * 64
# Frozen19October seed identity proof; current imports must never reseed/drop IDs.
LEGACY_ID_LIMITS = {
    "/": 647,
    "/maslulim/נקודות-החיבור/": 336,
    "/maslulim/עוז-מול-תופת/": 335,
    "/maslulim/קו-המגע/": 341,
    "/אודותינו/": 331,
    "/גבעת-התצפתניות/": 431,
    "/הבלוג/": 309,
    "/המדריכים/": 346,
    "/המסלולים/": 392,
    "/התצפיות/": 289,
    "/מסע-עוטף/": 332,
    "/מפת-האתר/": 318,
    "/מצפה-כרם-שלום/": 283,
    "/מצפה-נירים/": 300,
    "/סיורים/": 376,
    "/שאלות-נפוצות-נקודות-תצפית-בעוטף-עזה/": 386,
    "/שאלות-תשובות-דרך-התקומה/": 409,
    "/maslulim/": 291,
    "/אטרקציות-בעוטף-המדריך-המלא-לחוויות/": 356,
    "/הצעה/": 286,
    "/טיולים-בעוטף-עזה-להכיר-את-המרחב-דרך-ח/": 348,
    "/טיולים-עם-ילדים-בדרום-ובעוטף-עזה-חוויה/": 383,
    "/מדריך-לסיור-בעוטף-עזה-כך-תבחרו-את-החו/": 339,
    "/מסלול-נקודות-החיבור/": 329,
    "/מסלול-עוז-מול-תופת/": 332,
    "/מסלול-קו-המגע/": 350,
    "/סיור-באתר-הנובה-להבין-את-מה-שקרה-דרך-ה/": 331,
    "/סיור-בקיבוצי-העוטף-לחוות-להבין-ולהת/": 336,
    "/סיור-וביקור-בבארי-נחל-עוז-וכפר-עזה-לה/": 333,
    "/סיור-מודרך-בעוטף-עזה-מלחמת-חרבות-ברזל/": 339,
    "/סיורים-בעוטף-עזה-בעקבות-המלחמה/": 331,
    "/סיורים-לעוטף-עזה-לצוות-מורים-ותלמידים/": 331,
    "/refund_returns/": 280,
    "/הבלוג/2/": 239,
    "/מדיניות-פרטיות/": 280,
    "/תקנון-אתר/": 281,
    "/thanks/": 312
}
LEGACY_IDS_SHA256 = '14c0d4875db182310721bfea7db7fc69aca0b8bf4358673b8b70dad42c6a318e'
LEGACY_SEED_SHA256 = 'cae96d53a12d435e4095ce1081b24b2e7a11fd4faf59dfe07f1067203a3f2462'


def text(value):
    return {"type": "text", "value": value}


def image(value, alt=""):
    return {"type": "image", "value": value, "alt": alt}


def seed(candidates, slug="/"):
    fields = {candidate["type"] + "-" + str(index + 1): candidate for index, candidate in enumerate(candidates)}
    return IDENTITIES.seed_registry({slug: {"fields": fields}}, {slug: SHA}, SHA)


def signature(entry):
    return entry["type"], entry["value"], entry.get("alt", "")


class FieldIdentityTests(unittest.TestCase):
    def test_insert_delete_move_and_change(self):
        registry = seed([text("A"), text("B"), image("/old.webp", "old alt")])
        ids, retired, inserted = assign_fields("/", [text("new"), text("B"), text("A"), image("/old.webp", "old alt")], registry)
        self.assertEqual(ids, ["text-4", "text-2", "text-1", "image-3"])
        self.assertEqual(retired, {})
        ids, retired, deleted = assign_fields("/", [text("A"), image("/old.webp", "old alt")], inserted)
        self.assertEqual(ids, ["text-1", "image-3"])
        self.assertEqual(retired, {"text-4": "new", "text-2": "B"})
        ids, retired, changed = assign_fields("/", [text("Changed A"), image("/old.webp", "changed alt")], deleted)
        self.assertEqual(ids, ["text-5", "image-6"])
        self.assertEqual(retired["text-1"], "A")
        self.assertEqual(retired["image-3"], "/old.webp")
        self.assertEqual(changed["pages"]["/"]["nextNumber"], 7)

    def test_duplicates_only_keep_ids_on_exact_sequence(self):
        candidates = [text("same"), text("same"), text("unique"), image("/same.webp"), image("/same.webp")]
        registry = seed(candidates)
        ids, _, unchanged = assign_fields("/", candidates, registry)
        self.assertEqual(ids, ["text-1", "text-2", "text-3", "image-4", "image-5"])
        self.assertEqual(unchanged, registry)
        moved = [text("unique"), text("same"), text("same"), image("/same.webp"), image("/same.webp")]
        ids, retired, result = assign_fields("/", moved, registry)
        self.assertEqual(ids, ["text-3", "text-6", "text-7", "image-8", "image-9"])
        self.assertEqual(set(retired), {"text-1", "text-2", "image-4", "image-5"})
        self.assertEqual(assign_fields("/", moved, result)[0], ids)

    def test_changing_duplicate_count_retires_ambiguous_identity(self):
        ids, retired, _ = assign_fields("/", [text("A"), text("A")], seed([text("A")]))
        self.assertEqual(ids, ["text-2", "text-3"])
        self.assertEqual(retired, {"text-1": "A"})
        ids, retired, _ = assign_fields("/", [text("A")], seed([text("A"), text("A")]))
        self.assertEqual(ids, ["text-3"])
        self.assertEqual(set(retired), {"text-1", "text-2"})

    def test_retired_id_is_never_reused_when_content_returns(self):
        _, _, deleted = assign_fields("/", [], seed([text("A"), image("/a.webp")]))
        ids, retired, restored = assign_fields("/", [text("A"), image("/a.webp")], deleted)
        self.assertEqual(ids, ["text-3", "image-4"])
        self.assertEqual(set(retired), {"text-1", "image-2"})
        self.assertEqual(restored["pages"]["/"]["nextNumber"], 5)

    def test_type_and_original_alt_are_identity(self):
        registry = seed([text("same"), image("/a.webp", "first")])
        ids, retired, _ = assign_fields("/", [image("same"), image("/a.webp", "second")], registry)
        self.assertEqual(ids, ["image-3", "image-4"])
        self.assertEqual(set(retired), {"text-1", "image-2"})

    def test_pages_have_separate_identity_namespaces(self):
        registry = seed([text("A")])
        original = deepcopy(registry)
        ids, retired, other = assign_fields("/other/", [text("A")], registry)
        self.assertEqual(ids, ["text-1"])
        self.assertEqual(retired, {})
        self.assertEqual(other["pages"]["/"], registry["pages"]["/"])
        self.assertEqual(registry, original)
        self.assertIsNone(other["pages"]["/other/"]["sourceTemplateSha256"])

    def test_arguments_and_outputs_do_not_alias(self):
        candidates = [text("A"), image("/a.webp", "alt")]
        registry = seed(candidates)
        before = deepcopy(registry)
        supplied = deepcopy(candidates)
        _, _, result = assign_fields("/", candidates, registry)
        self.assertEqual(registry, before)
        self.assertEqual(candidates, supplied)
        result["pages"]["/"]["active"][0]["value"] = "mutated output"
        self.assertEqual(registry, before)
        self.assertEqual(candidates, supplied)

    def test_source_import_requires_explicit_gate(self):
        registry = seed([text("A")])
        before = deepcopy(registry)
        require_source_template("/", SHA, registry)
        with self.assertRaisesRegex(ValueError, "explicit --import-source"):
            require_source_template("/", "b" * 64, registry)
        with self.assertRaisesRegex(ValueError, "explicit --import-source"):
            require_source_template("/new/", SHA, registry)
        require_source_template("/", "b" * 64, registry, import_source=True)
        require_source_template("/new/", SHA, registry, import_source=True)
        with self.assertRaises(ValueError):
            require_source_template("/", SHA, registry, import_source="yes")
        self.assertEqual(registry, before)

    def test_invalid_registry_and_candidates_fail_closed(self):
        registry = seed([text("A")])
        for invalid in [None, [text("A"), {"type": "text", "value": 7}], [{"type": "image", "value": "/x", "alt": 3}]]:
            with self.assertRaises(ValueError):
                assign_fields("/", invalid, registry)
        corrupt = deepcopy(registry)
        corrupt["pages"]["/"]["nextNumber"] = 1
        with self.assertRaisesRegex(ValueError, "reuse"):
            assign_fields("/", [text("A")], corrupt)
        corrupt = deepcopy(registry)
        corrupt["pages"]["/"]["active"][0]["value"] = "changed without proof"
        with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
            assign_fields("/", [text("A")], corrupt)

    def test_unchanged_values_with_changed_dom_retire_ambiguous_duplicates(self):
        candidates = [text("repeated"), text("unique"), text("repeated")]
        registry = seed(candidates)
        ids, retired, _ = assign_fields("/", candidates, registry, source_sha256="b" * 64)
        self.assertEqual(ids[1], "text-2")
        self.assertNotIn("text-1", ids)
        self.assertNotIn("text-3", ids)
        self.assertEqual(retired, {"text-1": "repeated", "text-3": "repeated"})

    def test_all_current_real_pages_keep_every_active_and_retired_identity(self):
        raw = (ROOT / "lib/generated-pages.json").read_bytes()
        pages = json.loads(raw)
        registry = json.loads((ROOT / "source-pages/field-identities.json").read_text())
        manifest = json.loads((ROOT / "source-manifest.json").read_text())
        provenance=json.loads((ROOT / "source-pages/provenance.json").read_text())
        build=json.loads((ROOT / "source-pages/review-build.json").read_text())
        expected=51 if provenance.get("snapshotId")=="wordpress-public-20261028" else 37
        self.assertIn(provenance.get("snapshotId"), [None,"source-20261019","wordpress-public-20261028"])
        self.assertEqual(len(pages), expected)
        self.assertEqual(build["routeCount"], expected)
        self.assertEqual(provenance["logicalPageCount"], expected)
        self.assertEqual(build["payloadSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(registry["seedGeneratedPagesSha256"], LEGACY_SEED_SHA256)
        legacy_ids={}
        for slug,limit in LEGACY_ID_LIMITS.items():
            all_fields=registry["pages"][slug]["active"]+registry["pages"][slug]["retired"]
            legacy_ids[slug]=sorted([entry["id"] for entry in all_fields if int(entry["id"].rsplit("-",1)[1])<=limit],key=lambda value:int(value.rsplit("-",1)[1]))
            self.assertEqual(len(legacy_ids[slug]),limit,slug+" lost original identities")
        self.assertEqual(hashlib.sha256(json.dumps(legacy_ids,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest(),LEGACY_IDS_SHA256)
        if expected==37:self.assertEqual(registry["seedGeneratedPagesSha256"],hashlib.sha256(raw).hexdigest())
        self.assertEqual(set(pages), set(registry["pages"]))
        for slug, page in pages.items():
            require_source_template(slug, manifest[slug]["sha256"], registry)
            before = deepcopy(registry)
            candidates = list(page["fields"].values())
            ids, retired, updated = assign_fields(slug, candidates, registry, source_sha256=manifest[slug]["sha256"])
            self.assertEqual(ids, list(page["fields"]), slug)
            expected_retired={entry["id"]:entry["value"] for entry in registry["pages"][slug]["retired"]}
            self.assertEqual(retired, expected_retired, slug)
            self.assertEqual(page.get("retired",{}),expected_retired,slug)
            allocated=[int(entry["id"].rsplit("-",1)[1]) for entry in registry["pages"][slug]["active"]+registry["pages"][slug]["retired"]]
            self.assertEqual(sorted(allocated),list(range(1,registry["pages"][slug]["nextNumber"])),slug+" lost or reused allocated IDs")
            self.assertEqual(updated, registry, slug)
            self.assertEqual(registry, before, slug)
            self.assertEqual([entry["id"] for entry in registry["pages"][slug]["active"]], ids)

    def test_4000_deterministic_random_transition_sequences(self):
        rng = random.Random(20261020)
        pool = [text("A"), text("B"), text("C"), image("/a.webp", "one"), image("/b.webp", "two")]
        # Each sequence contains several transitions, including repeated and
        # returning content. The historical map catches any retired-id reuse.
        for _ in range(4000):
            candidates = deepcopy(rng.choices(pool, k=rng.randrange(0, 9)))
            registry = seed(candidates)
            historical = {entry["id"]: signature(entry) for entry in registry["pages"]["/"]["active"]}
            retired_ever = set()
            for _ in range(rng.randrange(2, 7)):
                previous = deepcopy(registry)
                old = {entry["id"]: signature(entry) for entry in registry["pages"]["/"]["active"]}
                operation = rng.randrange(5)
                if operation == 0 or not candidates:
                    candidates.insert(rng.randrange(len(candidates) + 1), deepcopy(rng.choice(pool)))
                elif operation == 1:
                    candidates.pop(rng.randrange(len(candidates)))
                elif operation == 2:
                    rng.shuffle(candidates)
                elif operation == 3:
                    candidates[rng.randrange(len(candidates))] = deepcopy(rng.choice(pool))
                else:
                    candidates[rng.randrange(len(candidates))] = image("/a.webp", str(rng.randrange(3)))
                original_candidates = deepcopy(candidates)
                ids, _, updated = assign_fields("/", candidates, registry)
                self.assertEqual(registry, previous)
                self.assertEqual(candidates, original_candidates)
                self.assertEqual(len(ids), len(set(ids)))
                self.assertEqual(len(ids), len({int(field_id.rsplit("-", 1)[1]) for field_id in ids}))
                self.assertFalse(set(ids) & retired_ever)
                for entry in updated["pages"]["/"]["active"]:
                    if entry["id"] in historical:
                        self.assertEqual(signature(entry), historical[entry["id"]])
                    if entry["id"] in old:
                        self.assertEqual(signature(entry), old[entry["id"]])
                    else:
                        self.assertGreaterEqual(int(entry["id"].rsplit("-", 1)[1]), previous["pages"]["/"]["nextNumber"])
                    historical[entry["id"]] = signature(entry)
                retired_ever.update(entry["id"] for entry in updated["pages"]["/"]["retired"])
                registry = updated


if __name__ == "__main__":
    unittest.main()
