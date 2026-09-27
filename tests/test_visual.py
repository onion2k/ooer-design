"""Tests for the visual tells added from the research: the purple accent,
the tasteful-default palette, glows, blobs, template chrome, the card kit,
reflex icons, display type, layout, motion and dark mode.

As in test_scan.py, each tell is checked both ways. The left-alone cases
are the considered choice that sits nearest the tell: a blue that is not
indigo, a tracked label that is not uppercase, a shadow that is grey.

Run with: python3 -m unittest discover tests
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "polish"))

import scan  # noqa: E402


def categories(line):
    return [category for category, _ in scan.scan_line(line)]


def matches(line, category):
    return [snippet for c, snippet in scan.scan_line(line) if c == category]


def site(files):
    root = tempfile.mkdtemp()
    for path, text in files.items():
        full = os.path.join(root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)
    return root


def file_findings(text, name="page.html"):
    return scan.scan(site({name: text}))


class Fonts(unittest.TestCase):
    def test_the_tasteful_substitutes_are_found(self):
        for font in ("Space Grotesk", "Instrument Serif", "Fraunces", "Playfair Display", "General Sans", "Sora"):
            self.assertIn("font", categories(f'font-family: "{font}", serif;'), font)

    def test_fontsource_imports_are_found(self):
        self.assertIn("font", categories('import "@fontsource/inter";'))
        self.assertIn("font", categories('import "@fontsource-variable/space-grotesk";'))

    def test_roboto_or_arial_as_the_chosen_face_is_found(self):
        self.assertIn("font", categories("font-family: Roboto, sans-serif;"))
        self.assertIn("font", categories("font-family: 'Arial', sans-serif;"))

    def test_arial_as_a_fallback_is_left_alone(self):
        self.assertEqual(categories('font-family: "Söhne", "Helvetica Neue", Arial, sans-serif;'), [])

    def test_the_segoe_stack_is_found(self):
        self.assertIn("font", categories("font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;"))


class Purple(unittest.TestCase):
    def test_tailwind_indigo_violet_and_purple_are_found(self):
        for text in ('<button class="bg-indigo-600 text-white">', '<a class="text-violet-500">', 'class="border-purple-300 ring-fuchsia-500"'):
            self.assertIn("purple", categories(text), text)

    def test_the_tailwind_hexes_are_found_as_colours(self):
        for hex_ in ("#6366f1", "#4f46e5", "#8b5cf6", "#7c3aed", "#a855f7", "#615fff", "#8e51ff"):
            self.assertIn("purple", categories(f"color: {hex_};"), hex_)

    def test_oklch_purple_is_found(self):
        self.assertIn("purple", categories("--primary: oklch(58.5% 0.233 277.117);"))
        self.assertIn("purple", categories("--chart-4: oklch(0.627 0.265 303.9);"))

    def test_a_shadcn_hsl_primary_in_the_purple_range_is_found(self):
        self.assertIn("purple", categories("--primary: 262 83% 58%;"))

    def test_blues_and_greys_are_left_alone(self):
        for text in ("color: #2563eb;", "color: #3b82f6;", "color: #2b3bff;", "--primary: 221.2 83.2% 53.3%;", "--primary: oklch(0.205 0 0);", 'class="bg-blue-600"'):
            self.assertNotIn("purple", categories(text), text)

    def test_a_blue_in_oklch_is_left_alone(self):
        self.assertEqual(categories("--primary: oklch(62.3% 0.214 259.815);"), [])

    def test_purple_inside_a_gradient_is_the_gradients_finding_not_a_second_one(self):
        found = scan.scan_line("background: linear-gradient(135deg, #7c3aed, #4f46e5);")
        self.assertEqual([c for c, _ in found], ["gradient"])

    def test_tailwind_gradient_stops_are_not_double_counted(self):
        found = scan.scan_line('class="bg-gradient-to-r from-purple-600 to-indigo-600"')
        self.assertEqual([c for c, _ in found], ["gradient", "gradient"])


class Tasteful(unittest.TestCase):
    def test_the_clay_hexes_are_found(self):
        self.assertIn("tasteful", categories("--clay: #D97757;"))
        self.assertIn("tasteful", categories("--rust: #B04A3F;"))

    def test_cream_with_terracotta_in_one_file_is_the_default(self):
        text = ":root {\n  --ground: #f4f1ea;\n  --accent: #c8532b;\n}\n"
        findings = [f for f in file_findings(text, "tokens.css") if f["category"] == "tasteful"]
        self.assertEqual([f["match"] for f in findings], ["cream and terracotta"])
        self.assertEqual(findings[0]["line"], 2)

    def test_cream_alone_or_terracotta_alone_is_not(self):
        self.assertEqual([f for f in file_findings(":root { --ground: #f4f1ea; }\n", "a.css") if f["category"] == "tasteful"], [])
        self.assertEqual([f for f in file_findings(":root { --accent: #c8532b; }\n", "a.css") if f["category"] == "tasteful"], [])

    def test_cream_with_a_warm_grey_is_not_the_default(self):
        text = ":root {\n  --ground: #f4f1ea;\n  --ink-muted: #8a7f78;\n}\n"
        self.assertEqual([f for f in file_findings(text, "a.css") if f["category"] == "tasteful"], [])


class Gradients(unittest.TestCase):
    def test_gradient_text_is_found(self):
        self.assertIn("gradient", categories('<h1 class="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">'))
        self.assertIn("gradient", categories("-webkit-background-clip: text;"))
        self.assertIn("gradient", categories("background-clip: text; color: transparent;"))

    def test_the_chatgpt_gradient_is_found(self):
        self.assertIn("gradient", categories("background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"))
        self.assertIn("gradient", categories("background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);"))

    def test_a_gradient_button_is_found(self):
        self.assertIn("gradient", categories('<button class="bg-gradient-to-r from-sky-500 to-teal-500">Go</button>'))

    def test_a_flat_button_and_a_single_hue_gradient_are_left_alone(self):
        self.assertEqual(categories('<button class="bg-sky-700 text-white">Go</button>'), [])
        self.assertEqual(categories("background: linear-gradient(#0a3d2e, #0c4a37);"), [])


class Glow(unittest.TestCase):
    def test_coloured_glows_are_found(self):
        for text in (
            'class="shadow-[0_0_40px_rgba(139,92,246,0.5)]"',
            "box-shadow: 0 0 20px rgba(16,185,129,0.4);",
            "text-shadow: 0 0 12px #22d3ee;",
            'class="shadow-cyan-500/50"',
            "--shadow-glow: 0 0 40px hsl(var(--primary-glow) / 0.4);",
        ):
            self.assertIn("glow", categories(text), text)

    def test_a_grey_shadow_is_not_a_glow(self):
        self.assertEqual(categories("box-shadow: 0 0 8px rgba(0,0,0,0.2);"), [])
        self.assertEqual(matches("box-shadow: 0 0 4px #ccc;", "glow"), [])


class Glass(unittest.TestCase):
    def test_a_white_tint_with_a_white_hairline_is_glass(self):
        self.assertIn("glass", categories('class="bg-white/10 border border-white/20 rounded-lg"'))

    def test_a_white_tint_alone_is_left_alone(self):
        self.assertEqual(categories('class="bg-white/10 p-4"'), [])


class Backdrops(unittest.TestCase):
    def test_blur_blobs_are_found(self):
        for text in (
            'class="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-purple-500 opacity-30 blur-3xl"',
            'class="absolute blur-[140px] bg-indigo-500/20"',
            ".orb::before { filter: blur(80px); }",
        ):
            self.assertIn("backdrop", categories(text), text)

    def test_the_tailwind_ui_blob_is_found(self):
        self.assertIn("backdrop", categories('class="relative aspect-[1155/678] w-[36.125rem] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30"'))

    def test_grid_dot_and_spotlight_patterns_are_found(self):
        for text in (
            'class="bg-grid-white/[0.02]"',
            'class="bg-[radial-gradient(#e4e4e7_1px,transparent_1px)] bg-[size:20px_20px]"',
            'class="[mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"',
            "background: radial-gradient(circle, #ccc 1px, transparent 1px);",
            "@keyframes aurora { from { background-position: 50% 50% } }",
        ):
            self.assertIn("backdrop", categories(text), text)

    def test_a_small_blur_on_content_is_left_alone(self):
        self.assertEqual(categories(".thumb { filter: blur(2px); }"), [])
        self.assertEqual(categories('class="blur-sm"'), [])

    def test_a_middling_blur_and_a_lone_blur_class_are_left_alone(self):
        self.assertEqual(categories(".thumb { filter: blur(12px); }"), [])
        self.assertEqual(categories('<img class="blur-2xl transition" src="/a.jpg" alt="Loading">'), [])


class Chrome(unittest.TestCase):
    def test_eyebrow_labels_are_found(self):
        self.assertIn("chrome", categories('<p class="text-xs uppercase tracking-widest text-muted-foreground">'))
        self.assertIn("chrome", categories(".eyebrow { text-transform: uppercase; letter-spacing: 0.1em; }"))
        self.assertIn("chrome", categories("<span>FEATURES</span>"))

    def test_pill_badges_are_found(self):
        self.assertIn("chrome", categories('<span class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">✨ New</span>'))

    def test_pulsing_dots_are_found(self):
        self.assertIn("chrome", categories('<span class="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>'))

    def test_numbered_markers_and_window_dots_are_found(self):
        self.assertIn("chrome", categories('<span class="font-mono text-xs">01</span>'))
        self.assertIn("chrome", categories('<div class="w-3 h-3 rounded-full bg-[#ff5f57]"></div>'))

    def test_tracked_lowercase_and_a_still_dot_are_left_alone(self):
        self.assertEqual(categories('<p class="tracking-wide text-sm">Chapter one</p>'), [])
        self.assertEqual(categories('<span class="h-2 w-2 rounded-full bg-green-500"></span>'), [])
        self.assertEqual(categories("<span>Step 1 of 3</span>"), [])


class Cards(unittest.TestCase):
    def test_the_icon_chip_is_found(self):
        self.assertIn("card", categories('<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100">'))
        self.assertIn("card", categories('<div class="w-10 h-10 rounded-xl bg-primary/10 p-2">'))

    def test_the_side_stripe_is_found(self):
        self.assertIn("card", categories('<div class="border-l-4 border-indigo-500 pl-4">'))
        self.assertIn("card", categories(".card { border-left: 4px solid #6366f1; }"))

    def test_the_stock_shadcn_card_string_is_found(self):
        self.assertIn("card", categories('className="rounded-lg border bg-card text-card-foreground shadow-sm"'))

    def test_a_hairline_rule_and_an_avatar_are_left_alone(self):
        self.assertEqual(categories(".quote { border-left: 4px solid var(--rule); }"), [])
        self.assertEqual(categories('<img class="h-12 w-12 rounded-full" src="/chris.jpg" alt="Chris Neale">'), [])


class Icons(unittest.TestCase):
    def test_the_worn_lucide_set_is_found(self):
        self.assertIn("icon", categories('import { Sparkles, Zap, Shield } from "lucide-react"'))
        self.assertIn("icon", categories('import { ArrowRight, Check, Star } from "lucide-react"'))
        self.assertIn("icon", categories("<Sparkles className=\"h-4 w-4\" />"))
        self.assertIn("icon", categories('import { SparklesIcon } from "@heroicons/react/24/outline"'))

    def test_the_sparkle_glyph_and_font_awesome_are_found(self):
        self.assertIn("icon", categories("<h2>✦ New</h2>"))
        self.assertIn("icon", categories('<i class="fas fa-rocket"></i>'))

    def test_two_ordinary_icons_are_left_alone(self):
        self.assertEqual(categories('import { Menu, X } from "lucide-react"'), [])

    def test_two_worn_icons_without_a_sparkle_are_left_alone(self):
        self.assertEqual(categories('import { ArrowRight, Check } from "lucide-react"'), [])


class DisplayType(unittest.TestCase):
    def test_crushed_tracking_on_display_sizes_is_found(self):
        self.assertIn("type", categories('<h1 class="text-6xl font-bold tracking-tight">'))

    def test_the_serif_italic_accent_word_is_found(self):
        self.assertIn("type", categories('<h1>Build <span class="font-serif italic">faster</span></h1>'))
        self.assertIn("type", categories('<h1>Build <em style="font-family: serif; font-style: italic;">faster</em></h1>'))

    def test_monospace_body_is_found(self):
        self.assertIn("type", categories('<body class="font-mono">'))
        self.assertEqual([f["match"] for f in file_findings("body {\n  font-family: 'JetBrains Mono', monospace;\n}\n", "a.css") if f["category"] == "type"], ["monospace body"])

    def test_tight_tracking_on_body_sizes_and_a_plain_em_are_left_alone(self):
        self.assertEqual(categories('<p class="text-base tracking-tight">'), [])
        self.assertEqual(categories("<h1>Build <em>faster</em></h1>"), [])


class Layout(unittest.TestCase):
    def test_three_column_grids_are_found(self):
        self.assertIn("layout", categories('<div class="grid grid-cols-1 md:grid-cols-3 gap-8">'))
        self.assertIn("layout", categories("grid-template-columns: repeat(3, 1fr);"))

    def test_bento_tiles_are_found(self):
        self.assertIn("layout", categories('<div class="md:col-span-2 md:row-span-2 rounded-2xl">'))

    def test_the_stock_section_order_is_one_finding(self):
        page = "\n".join([
            "<h1>Ship faster</h1>", "<p>Trusted by 500+ teams</p>", "<h2>Everything you need</h2>",
            "<h2>How it works</h2>", "<h2>What our customers say</h2>", "<h2>Pricing</h2> $9/mo",
            "<h2>FAQ</h2>", "<h2>Ready to get started?</h2>", "<footer></footer>",
        ]) + "\n"
        findings = [f for f in file_findings(page) if f["match"] == "stock section order"]
        self.assertEqual(len(findings), 1)
        self.assertIn("hero → logos → features", findings[0]["detail"])

    def test_a_page_with_a_few_of_the_sections_is_left_alone(self):
        page = "<h1>Panic & Wonder</h1>\n<h2>Features of the timeline</h2>\n<footer></footer>\n"
        self.assertEqual([f for f in file_findings(page) if f["match"] == "stock section order"], [])

    def test_uniform_section_padding_is_one_finding(self):
        page = '<section class="py-24">\n<section class="py-24">\n<section class="py-24">\n'
        findings = [f for f in file_findings(page) if f["match"] == "uniform section padding"]
        self.assertEqual(len(findings), 1)
        self.assertIn("3 sections", findings[0]["detail"])
        self.assertEqual([f for f in file_findings('<section class="py-24">\n<section class="py-8">\n') if f["match"] == "uniform section padding"], [])

    def test_a_two_column_grid_is_left_alone(self):
        self.assertEqual(categories('<div class="grid md:grid-cols-2 gap-8">'), [])


class Motion(unittest.TestCase):
    def test_reflex_motion_is_found(self):
        for text in (
            '<div data-aos="fade-up">',
            "<motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}>",
            '<div class="animate-fade-in-up">',
            "@keyframes fadeInUp { from { opacity: 0 } }",
            'class="hover:-translate-y-1 hover:shadow-lg transition"',
            'class="hover:scale-105"',
            "transition: all 0.3s ease;",
            "transition-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55);",
            '<div class="animate-marquee">',
            "<TypewriterEffect words={words} />",
            "<BorderBeam size={250} />",
            'class="animate-gradient bg-[length:200%_200%]"',
        ):
            self.assertIn("motion", categories(text), text)

    def test_the_hover_lift_is_read_from_the_whole_rule(self):
        css = ".card:hover {\n  transform: translateY(-5px);\n  box-shadow: 0 10px 20px rgba(0,0,0,.1);\n}\n"
        findings = [f for f in file_findings(css, "a.css") if f["category"] == "motion"]
        self.assertEqual([f["match"] for f in findings], ["hover lift"])
        self.assertEqual(findings[0]["line"], 1)

    def test_a_site_that_animates_without_a_reduced_motion_guard_is_told_once(self):
        root = site({"a.css": "@keyframes spin { to { transform: rotate(1turn) } }\n", "b.css": ".x { animation: spin 1s; }\n"})
        findings = [f for f in scan.scan(root) if f["match"] == "no reduced-motion guard"]
        self.assertEqual(len(findings), 1)
        self.assertIn("2 files animate", findings[0]["detail"])

    def test_a_guard_anywhere_in_the_site_is_enough(self):
        root = site({"a.css": "@keyframes spin { to { transform: rotate(1turn) } }\n", "global.css": "@media (prefers-reduced-motion: reduce) { * { animation: none } }\n"})
        self.assertEqual([f for f in scan.scan(root) if f["match"] == "no reduced-motion guard"], [])

    def test_a_single_property_transition_and_a_settled_curve_are_left_alone(self):
        self.assertEqual(categories("transition: box-shadow 200ms ease-out;"), [])
        self.assertEqual(categories("transition-timing-function: cubic-bezier(0.2, 0, 0, 1);"), [])


class Dark(unittest.TestCase):
    def test_dark_by_default_is_found(self):
        self.assertIn("dark", categories('<html lang="en" class="dark">'))
        self.assertIn("dark", categories('<body class="bg-zinc-950 text-white">'))
        self.assertIn("dark", categories('<div class="bg-zinc-950 border border-white/10 rounded-xl">'))
        findings = [f for f in file_findings("body {\n  color: #fff;\n  background: #000;\n}\n", "a.css") if f["category"] == "dark"]
        self.assertEqual([f["match"] for f in findings], ["black page background"])

    def test_a_dark_card_on_a_light_site_and_a_near_black_ink_are_left_alone(self):
        self.assertEqual(categories('<div class="bg-zinc-900 text-white p-4">'), [])
        self.assertEqual([f for f in file_findings("body {\n  color: #111;\n  background: #fff;\n}\n", "a.css") if f["category"] == "dark"], [])


class Imagery(unittest.TestCase):
    def test_the_scrim_and_stock_photo_sources_are_found(self):
        self.assertIn("imagery", categories('<div class="absolute inset-0 bg-black/50"></div>'))
        self.assertIn("imagery", categories("background: linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(hero.jpg);"))
        self.assertIn("imagery", categories('<img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4">'))
        self.assertIn("imagery", categories('<img src="/undraw_team.svg">'))

    def test_a_chosen_image_is_left_alone(self):
        self.assertEqual(categories('<img src="/photos/trinity-1945.jpg" alt="The Trinity fireball">'), [])


class Shadcn(unittest.TestCase):
    def test_untouched_theme_values_are_found(self):
        for text in (
            "--primary: 222.2 47.4% 11.2%;",
            "--primary: oklch(0.205 0 0);",
            '"baseColor": "zinc",',
            "--radius: 0.5rem;",
            "--muted-foreground: 215.4 16.3% 46.9%;",
        ):
            self.assertIn("shadcn", categories(text), text)

    def test_a_changed_theme_is_left_alone(self):
        self.assertEqual(categories("--primary: 160 84% 30%;"), [])
        self.assertEqual(categories("--radius: 0;"), [])


class Scaffold(unittest.TestCase):
    def test_starter_leftovers_are_found(self):
        for text in (
            '<script src="https://cdn.tailwindcss.com"></script>',
            "a { color: #646cff; }",
            "--background: #0a0a0a;",
            "<p>Get started by editing app/page.tsx</p>",
            "<p>Start prompting (or editing) to see magic happen :)</p>",
            "background: linear-gradient(83.21deg, #3245ff 0%, #bc52ee 100%);",
        ):
            self.assertIn("scaffold", categories(text), text)


class Components(unittest.TestCase):
    def test_components_json_is_scanned_whatever_its_extension(self):
        root = site({"components.json": '{ "style": "new-york", "baseColor": "slate" }\n'})
        self.assertEqual([f["category"] for f in scan.scan(root)], ["shadcn"])


if __name__ == "__main__":
    unittest.main()
