"""Check latest-source policy independently of recorded artifact consistency."""

import unittest

from scripts.check_latest_theme import verify_latest_source


class LatestThemeSourceTests(unittest.TestCase):
    """Future versions remain valid while stale or unpublished source is rejected."""

    def setUp(self):
        self.manifest = {"artifacts": [{"name": "@f5-sales-demo/docs-theme", "version": "99.2.3"}]}
        self.release = {"tag_name": "v99.2.3", "draft": False, "prerelease": False}

    def test_current_source_is_accepted(self):
        self.assertEqual(verify_latest_source(self.manifest, self.release), "99.2.3")

    def test_consistent_but_stale_source_is_rejected(self):
        self.release["tag_name"] = "v99.2.4"
        with self.assertRaisesRegex(ValueError, "refreshed to latest"):
            verify_latest_source(self.manifest, self.release)

    def test_unpublished_or_unknown_latest_is_rejected(self):
        for change in ({"draft": True}, {"prerelease": True}, {"tag_name": None}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                verify_latest_source(self.manifest, {**self.release, **change})

    def test_ambiguous_source_receipt_is_rejected(self):
        self.manifest["artifacts"] *= 2
        with self.assertRaisesRegex(ValueError, "exactly one"):
            verify_latest_source(self.manifest, self.release)


if __name__ == "__main__":
    unittest.main()
