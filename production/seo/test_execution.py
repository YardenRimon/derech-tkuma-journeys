import copy
import unittest
from execution import ORIGIN, prepare, verify_readback, digest, identity, request_hash, recipe_values
from audit import AuditError

SOURCE = {"id": "fixture", "version": 1, "content": {"title": "סיור מקור", "slug": "source", "description": "קיים במקור בלבד", "image": "", "imageAlt": "", "sourcePath": "/original/source/"}}

def projection(source=None):
    return {"tours": {"records": [copy.deepcopy(source or SOURCE)]}, "occurrences": {"records": []}}

def readback(source=None):
    source = copy.deepcopy(source or SOURCE)
    return {"tourId": source["id"], "recordRevision": 2, "source": source, "draft": None, "history": [], "receipt": None}

def applied(effect):
    value = readback(effect["source"])
    draft = {"tenantId": "derech", "siteId": "derech-main", "tourId": effect["target"], "revision": 1,
        "state": "proposed", "origin": ORIGIN, "sourceHash": digest(effect["source"]),
        "sourceRecordRevision": 2, "sourcePublishedVersion": 1, "values": effect["values"], "publicationAllowed": False}
    value["draft"] = draft
    value["receipt"] = {"kind": "seo_draft", "effectKey": effect["effectKey"], "state": "applied_draft", "revision": 1, "requestHash": request_hash(effect), "before": None, "after": copy.deepcopy(draft)}
    return value

class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.plan = prepare(projection(), [readback()])
        self.effect = self.plan["effects"][0]

    def test_deterministic_scoped_task29_plan_never_publishes(self):
        self.assertEqual(self.plan, prepare(projection(), [readback()]))
        self.assertEqual(self.effect["effectKey"], digest(identity(self.effect)))
        self.assertEqual(self.effect["itemId"], 29)
        self.assertEqual(self.effect["values"]["canonical"], ORIGIN + "/original/source/")
        self.assertFalse(self.effect["publicationAllowed"])
        self.assertTrue(self.plan["requires_existing_approved_execution"])
        for origin in ["https://derech-tkuma.com", "https://other.workers.dev", "http://127.0.0.1:1234"]:
            with self.assertRaises(AuditError):
                prepare(projection(), [readback()], origin=origin)

    def test_source_revision_and_private_scope_are_required(self):
        for change in [{"recordRevision": 0}, {"recordRevision": True}, {"source": None}, {"tourId": "other"}]:
            with self.subTest(change=change), self.assertRaises(AuditError):
                prepare(projection(), [{**readback(), **change}])
        for value in [[], [readback(), readback()]]:
            with self.assertRaises(AuditError):
                prepare(projection(), value)
        private = applied(self.effect)
        private["draft"]["siteId"] = "another-site"
        with self.assertRaises(AuditError):
            prepare(projection(), [private])

    def test_exact_saved_readback_and_unchanged_source_prove_draft(self):
        value = applied(self.effect)
        self.assertEqual(verify_readback(self.effect, value)["state"], "verified_private_draft")
        for changed in [{"receipt": None}, {"recordRevision": 3}, {"draft": None}]:
            with self.subTest(changed=changed), self.assertRaises(AuditError):
                verify_readback(self.effect, {**value, **changed})
        for field, changed in [("values", {}), ("publicationAllowed", True), ("sourceHash", "bad"), ("origin", "https://derech-tkuma.com")]:
            broken = copy.deepcopy(value)
            broken["draft"][field] = changed
            broken["receipt"]["after"][field] = changed
            with self.subTest(field=field), self.assertRaises(AuditError):
                verify_readback(self.effect, broken)

    def test_replay_and_rollback_tombstones_never_create_another_effect(self):
        value = applied(self.effect)
        self.assertEqual(prepare(projection(), [value])["effects"], [])
        value["receipt"]["state"] = "rolled_back"
        value["receipt"]["rollbackRevision"] = 2
        value["draft"].update(revision=2, state="withdrawn", values=None)
        self.assertEqual(prepare(projection(), [value])["effects"], [])
        self.assertEqual(verify_readback(self.effect, value)["state"], "rolled_back")
        value["receipt"]["requestHash"] = "bad"
        with self.assertRaises(AuditError):
            prepare(projection(), [value])

    def test_missing_description_is_null_and_markup_needs_editorial_work(self):
        source = copy.deepcopy(SOURCE)
        source["content"]["description"] = ""
        self.assertIsNone(prepare(projection(source), [readback(source)])["effects"][0]["values"]["meta_description"])
        for content in ["<b>source</b>", "source &amp; text"]:
            source["content"]["description"] = content
            with self.assertRaises(AuditError):
                prepare(projection(source), [readback(source)])

    def test_changed_source_has_new_key_and_expected_draft_revision(self):
        value = applied(self.effect)
        source = copy.deepcopy(SOURCE)
        source["version"] = 2
        source["content"]["description"] = "עוד טקסט מקור"
        value.update(source=source, recordRevision=4, receipt=None)
        changed = prepare(projection(source), [value])["effects"][0]
        self.assertNotEqual(changed["effectKey"], self.effect["effectKey"])
        self.assertEqual(changed["expectedDraftRevision"], 1)
        self.assertEqual(changed["expectedRecordRevision"], 4)
        with self.assertRaises(AuditError):
            verify_readback({**self.effect, "operation": "publish"}, applied(self.effect))

    def test_unicode_description_truncates_by_codepoint(self):
        source = copy.deepcopy(SOURCE)
        source["content"]["description"] = "😀" * 156
        self.assertEqual(len(recipe_values(source)["meta_description"]), 155)

if __name__ == "__main__":
    unittest.main()
