"""Tests for the scanner that the polish skill starts its audit from.

Each tell is checked both ways: the stereotypical form is found, and the
nearby considered choice is left alone. A scanner that cries wolf on white
backgrounds or 4px corners would train the reader to ignore it.

Run with: python3 -m unittest discover tests
"""

import os
import sys
import contextlib
import io
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "polish"))

import scan  # noqa: E402


def categories(line):
    return [category for category, _ in scan.scan_line(line)]


class Fonts(unittest.TestCase):
    def test_inter_in_a_font_stack_is_found(self):
        self.assertIn("font", categories("body { font-family: Inter, system-ui, sans-serif; }"))

    def test_quoted_inter_in_tailwind_config_is_found(self):
        self.assertIn("font", categories("fontFamily: { sans: ['Inter', 'sans-serif'] },"))

    def test_google_fonts_link_is_found(self):
        self.assertIn("font", categories('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400">'))

    def test_next_font_import_is_found(self):
        self.assertIn("font", categories("import { Inter } from 'next/font/google'"))

    def test_inter_tight_is_reported_by_its_own_name(self):
        self.assertIn(("font", "Inter Tight"), scan.scan_line('font-family: "Inter Tight", sans-serif;'))

    def test_a_chosen_font_is_left_alone(self):
        self.assertEqual(categories('font-family: "Söhne", "Helvetica Neue", sans-serif;'), [])

    def test_words_that_start_with_inter_are_left_alone(self):
        self.assertEqual(categories("<p>'International' shipping</p>"), [])

    def test_hyphenated_words_that_start_with_inter_are_left_alone(self):
        self.assertEqual(categories("<p>'Inter-company' transfers</p>"), [])


class Beige(unittest.TestCase):
    def test_cream_hex_is_found(self):
        self.assertIn("beige", categories("background: #faf7f2;"))

    def test_short_hex_is_found(self):
        self.assertIn("beige", categories("background: #fed;"))

    def test_rgb_and_hsl_are_found(self):
        self.assertIn("beige", categories("color: rgb(245, 240, 230);"))
        self.assertIn("beige", categories("color: hsl(40, 40%, 94%);"))

    def test_named_beige_is_found(self):
        self.assertIn("beige", categories("background-color: beige;"))

    def test_tailwind_stone_background_is_found(self):
        self.assertIn("beige", categories('<main class="bg-stone-50 text-stone-900">'))

    def test_white_grey_and_black_are_left_alone(self):
        self.assertEqual(categories("color: #ffffff; background: #f4f4f4; border-color: #111;"), [])

    def test_a_strong_yellow_is_left_alone(self):
        self.assertEqual(categories("background: #ffd400;"), [])

    def test_a_cool_off_white_is_left_alone(self):
        self.assertEqual(categories("background: #f2f6fb;"), [])

    def test_an_imperceptibly_warm_white_is_left_alone(self):
        self.assertEqual(categories("background: #fafaf9;"), [])

    def test_a_pale_peach_is_too_tinted_to_be_beige(self):
        self.assertEqual(categories("background: #ffe0b0;"), [])

    def test_a_dark_warm_brown_is_left_alone(self):
        self.assertEqual(categories("color: #5c4a32;"), [])


class Radius(unittest.TestCase):
    def test_large_px_radius_is_found(self):
        self.assertIn("radius", categories("border-radius: 16px;"))

    def test_rem_radius_is_converted(self):
        self.assertIn("radius", categories("border-radius: 1rem;"))

    def test_corner_specific_radius_is_found(self):
        self.assertIn("radius", categories("border-top-left-radius: 24px;"))

    def test_tailwind_large_rounding_is_found(self):
        self.assertIn("radius", categories('<div class="rounded-2xl p-6">'))

    def test_a_radius_custom_property_is_found(self):
        self.assertIn("radius", categories(":root { --radius: 1rem; }"))
        self.assertIn("radius", categories("--card-radius: 20px;"))

    def test_a_radius_in_tailwind_config_is_found(self):
        self.assertIn("radius", categories("borderRadius: { lg: '1rem' },"))

    def test_a_small_radius_custom_property_is_left_alone(self):
        self.assertEqual(categories(":root { --radius: 0.25rem; }"), [])

    def test_small_radius_is_left_alone(self):
        self.assertEqual(categories("border-radius: 4px;"), [])
        self.assertEqual(categories('<button class="rounded-sm">'), [])


class GradientsShadowsGlassCopy(unittest.TestCase):
    def test_purple_css_gradient_is_found(self):
        self.assertIn("gradient", categories("background: linear-gradient(135deg, #7c3aed, #4f46e5);"))

    def test_tailwind_purple_gradient_is_found(self):
        self.assertIn("gradient", categories('<h1 class="bg-gradient-to-r from-purple-600 to-pink-500">'))

    def test_a_non_purple_gradient_is_left_alone(self):
        self.assertEqual(categories("background: linear-gradient(#000, #333);"), [])

    def test_a_blue_to_green_gradient_is_left_alone(self):
        self.assertEqual(categories("background: linear-gradient(90deg, #0ea5e9, #10b981);"), [])

    def test_diffuse_shadow_is_found(self):
        self.assertIn("shadow", categories("box-shadow: 0 10px 40px rgba(0,0,0,0.08);"))

    def test_tight_shadow_is_left_alone(self):
        self.assertEqual(categories("box-shadow: 0 1px 2px rgba(0,0,0,0.2);"), [])

    def test_a_colour_written_first_is_not_read_as_a_blur(self):
        self.assertEqual(categories("box-shadow: rgb(0 40 80) 0 1px 2px;"), [])

    def test_backdrop_blur_is_found(self):
        self.assertIn("glass", categories("backdrop-filter: blur(12px);"))
        self.assertIn("glass", categories('<nav class="backdrop-blur-md">'))

    def test_stock_copy_is_found(self):
        self.assertIn("copy", categories("<h1>Elevate your workflow, seamlessly.</h1>"))


class Walking(unittest.TestCase):
    def test_a_project_is_scanned_and_dependencies_are_skipped(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "src"))
            os.makedirs(os.path.join(root, "node_modules", "lib"))
            with open(os.path.join(root, "src", "app.css"), "w") as f:
                f.write("body {\n  font-family: Inter;\n  background: #faf7f2;\n}\n")
            with open(os.path.join(root, "node_modules", "lib", "x.css"), "w") as f:
                f.write("a { border-radius: 99px; }\n")
            with open(os.path.join(root, "src", "bundle.min.css"), "w") as f:
                f.write("a { border-radius: 99px; }\n")

            findings = scan.scan(root)

        self.assertEqual(
            [(f["category"], f["file"], f["line"]) for f in findings],
            [("font", os.path.join("src", "app.css"), 2), ("beige", os.path.join("src", "app.css"), 3)],
        )

    def test_strict_exits_1_only_when_something_is_found(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "a.css")
            with open(path, "w") as f:
                f.write("a { color: #111; }\n")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(scan.main([root, "--strict", "--json"]), 0)
            with open(path, "w") as f:
                f.write("a { border-radius: 20px; }\n")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(scan.main([root, "--strict", "--json"]), 1)


if __name__ == "__main__":
    unittest.main()
