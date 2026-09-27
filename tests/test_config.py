"""Tests for the decisions file the redesign skill leaves in a site.

`.ooer-design.json` is what stops a finding the user chose to keep from coming
back on every scan, and what keeps tests and prototypes out of the audit. If
it were read wrongly, the user would be asked the same question again, or
worse, a finding would be silently hidden that nobody decided to keep.

Run with: python3 -m unittest discover tests
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "polish"))

import scan  # noqa: E402


class Site:
    """A throwaway site: files by relative path, and an optional decisions file."""

    def __init__(self, files, config=None):
        self.directory = tempfile.TemporaryDirectory()
        self.root = self.directory.name
        for path, text in files.items():
            full = os.path.join(self.root, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w") as f:
                f.write(text)
        if config is not None:
            with open(os.path.join(self.root, ".ooer-design.json"), "w") as f:
                f.write(config if isinstance(config, str) else json.dumps(config))

    def run(self, *flags):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = scan.main([self.root, *flags])
        return code, out.getvalue(), err.getvalue()

    def json(self):
        code, out, _ = self.run("--json")
        return json.loads(out)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.directory.cleanup()


TOKENS = "a { background: #efe6d2; }\nb { border-radius: 14px; }\n"


class Keep(unittest.TestCase):
    def test_a_kept_finding_is_marked_with_its_reason(self):
        keep = {"match": "#efe6d2", "file": "tokens.css", "reason": "Antiquity parchment, chosen."}
        with Site({"tokens.css": TOKENS}, {"keep": [keep]}) as site:
            findings = site.json()["findings"]
        beige = [f for f in findings if f["category"] == "beige"][0]
        radius = [f for f in findings if f["category"] == "radius"][0]
        self.assertTrue(beige["kept"])
        self.assertEqual(beige["reason"], "Antiquity parchment, chosen.")
        self.assertFalse(radius["kept"])

    def test_a_keep_with_a_category_only_keeps_that_category(self):
        keep = {"category": "radius", "match": "#efe6d2", "reason": "wrong category"}
        with Site({"tokens.css": TOKENS}, {"keep": [keep]}) as site:
            findings = site.json()["findings"]
        self.assertFalse(any(f["kept"] for f in findings))

    def test_a_keep_with_a_file_pattern_only_keeps_matching_files(self):
        keep = {"match": "#efe6d2", "file": "src/*.css", "reason": "only in src"}
        files = {"src/a.css": TOKENS, "other/b.css": TOKENS}
        with Site(files, {"keep": [keep]}) as site:
            beige = {f["file"]: f["kept"] for f in site.json()["findings"] if f["category"] == "beige"}
        self.assertEqual(beige, {os.path.join("src", "a.css"): True, os.path.join("other", "b.css"): False})

    def test_kept_findings_are_listed_apart_and_not_counted(self):
        keep = {"match": "#efe6d2", "reason": "Antiquity parchment, chosen."}
        with Site({"tokens.css": TOKENS}, {"keep": [keep]}) as site:
            _, out, _ = site.run()
        self.assertIn("1 tells in 1 files.", out)
        self.assertIn("Kept (1)", out)
        self.assertIn("Antiquity parchment, chosen.", out)
        self.assertNotIn("Beige or cream colour", out)

    def test_strict_ignores_kept_findings(self):
        keep = [{"match": "#efe6d2", "reason": "a"}, {"match": "border-radius: 14px", "reason": "b"}]
        with Site({"tokens.css": TOKENS}, {"keep": keep}) as site:
            code, _, _ = site.run("--strict")
        self.assertEqual(code, 0)

    def test_a_keep_that_matches_nothing_is_reported_as_stale(self):
        keep = [{"match": "#efe6d2", "reason": "used"}, {"match": "#123456", "reason": "gone"}]
        with Site({"tokens.css": TOKENS}, {"keep": keep}) as site:
            stale = site.json()["stale_keeps"]
            _, out, _ = site.run()
        self.assertEqual([k["match"] for k in stale], ["#123456"])
        self.assertIn("no longer matches", out)
        self.assertIn("#123456", out)


class Exclude(unittest.TestCase):
    def test_excluded_patterns_are_not_scanned(self):
        files = {"src/a.css": TOKENS, "tests/t.css": TOKENS, "prototype/p.html": TOKENS}
        with Site(files, {"exclude": ["tests/**", "prototype/**"]}) as site:
            scanned = {f["file"] for f in site.json()["findings"]}
        self.assertEqual(scanned, {os.path.join("src", "a.css")})


class Generated(unittest.TestCase):
    def test_a_file_with_a_generated_header_is_marked(self):
        header = "/* Generated from design-system/tokens.json by src/tokens/css.ts. Do not edit by hand. */\n"
        files = {"gen.css": header + TOKENS, "hand.css": TOKENS}
        with Site(files) as site:
            findings = site.json()["findings"]
            _, out, _ = site.run()
        by_file = {f["file"]: f["generated"] for f in findings}
        self.assertEqual(by_file, {"gen.css": True, "hand.css": False})
        self.assertIn("gen.css:2  #efe6d2  (generated)", out)

    def test_other_header_styles_are_recognised(self):
        for header in ("// @generated\n", "/* This file is auto-generated. */\n", "<!-- DO NOT EDIT -->\n"):
            with Site({"gen.css": header + TOKENS}) as site:
                self.assertTrue(all(f["generated"] for f in site.json()["findings"]), header)

    def test_the_word_generated_in_ordinary_code_is_not_a_header(self):
        with Site({"a.css": "/* Buttons for the generated report. */\n" + TOKENS}) as site:
            self.assertFalse(any(f["generated"] for f in site.json()["findings"]))

    def test_a_header_below_the_top_of_the_file_does_not_count(self):
        body = "\n" * 10 + "/* Generated by x. Do not edit. */\n" + TOKENS
        with Site({"a.css": body}) as site:
            self.assertFalse(any(f["generated"] for f in site.json()["findings"]))


class BadConfig(unittest.TestCase):
    def test_invalid_json_stops_with_exit_2_and_names_the_file(self):
        with Site({"a.css": TOKENS}, "{ not json") as site:
            code, _, err = site.run()
        self.assertEqual(code, 2)
        self.assertIn(".ooer-design.json", err)

    def test_a_keep_without_a_reason_is_refused(self):
        with Site({"a.css": TOKENS}, {"keep": [{"match": "#efe6d2"}]}) as site:
            code, _, err = site.run()
        self.assertEqual(code, 2)
        self.assertIn("reason", err)

    def test_no_config_is_fine(self):
        with Site({"a.css": TOKENS}) as site:
            result = site.json()
        self.assertEqual(len(result["findings"]), 2)
        self.assertEqual(result["stale_keeps"], [])


if __name__ == "__main__":
    unittest.main()
