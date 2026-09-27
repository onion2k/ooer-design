#!/usr/bin/env python3
"""Find the tells of the stereotypical 'AI design' look in a website's source.

The polish skill uses this so that its audit starts from every occurrence in
the code rather than from whatever Claude happens to notice on a skim. Without
it, a beige hex in one stylesheet or a stray `rounded-2xl` in a component would
survive the polish and the site would still read as generated.

It only reports. It changes nothing, needs nothing beyond the standard library,
and exits 0 unless --strict is given and something not kept was found, or 2
if the decisions file cannot be read.

A site can hold a decisions file, .ooer-design.json, which the redesign skill
writes: "exclude" lists file patterns to leave out, and "keep" lists findings
the user chose to keep, each with its reason.

Most tells are found on one line. A few are only a tell in bulk, such as
marketing vocabulary and em dashes, so those are counted over a whole file and
reported once when the file crosses a threshold. The catalogue of what each
tell is, and where the evidence for it comes from, is in tells.md next door.
"""

import argparse
import colorsys
import datetime
import fnmatch
import json
import os
import re
import sys

SOURCE_EXTENSIONS = {
    ".css", ".scss", ".sass", ".less", ".styl",
    ".html", ".htm", ".vue", ".svelte", ".astro",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mdx",
    ".md", ".markdown",
    ".php", ".liquid", ".njk", ".hbs", ".ejs", ".twig", ".erb",
}

# Files scanned whatever their extension, because a tell lives in them.
SOURCE_NAMES = {"components.json"}

SKIPPED_DIRECTORIES = {
    "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".output",
    ".svelte-kit", ".astro", ".vercel", ".turbo", "vendor", "coverage",
    ".claude", ".github", ".vscode", ".idea", ".cache", ".parcel-cache",
    "test-results", "playwright-report", "storybook-static", "__pycache__", ".pytest_cache",
}


def is_skipped_directory(name):
    # Any dist-something is a build too: dist-test, dist-staging.
    return name in SKIPPED_DIRECTORIES or name.startswith("dist")

# Repository documents are about the code, not part of the site.
SKIPPED_STEMS = {"readme", "changelog", "contributing", "code_of_conduct", "license", "licence", "security"}

CURRENT_YEAR = datetime.date.today().year

# The order findings are reported in. The visual tells come first because
# they are what the plugin is for; the content tells follow.
CATEGORIES = {
    "font": "Default font",
    "beige": "Beige or cream colour",
    "tasteful": "The cream, serif and terracotta default",
    "purple": "Indigo, violet or purple accent",
    "radius": "Large rounded corners",
    "gradient": "Gradient where a colour would do",
    "shadow": "Soft oversized shadow",
    "glow": "Coloured glow or neon",
    "glass": "Frosted glass",
    "backdrop": "Decorative backdrop: blobs, aurora, grids, spotlights",
    "chrome": "Template chrome: eyebrows, pill badges, pulsing dots, 01 / 02 / 03",
    "card": "The card kit: icon chips, side stripes, stock cards",
    "icon": "Reflex icons: sparkles, bolts, rockets",
    "emoji": "Emoji as icon or bullet",
    "type": "Display type by reflex",
    "layout": "Layout by reflex: three-card grids, bento, stock section order",
    "motion": "Motion and stock effects by reflex",
    "dark": "Dark mode by default",
    "imagery": "Stock imagery",
    "alt": "Generic alt text",
    "shadcn": "Untouched shadcn theme",
    "scaffold": "Scaffolding and starter leftovers",
    "badge": "Builder badge or fingerprint",
    "placeholder": "Placeholder content left in",
    "link": "Dead link",
    "testimonial": "Fake-looking testimonial",
    "stat": "Fabricated statistic",
    "cta": "Generic call to action",
    "stock": "Stock section heading",
    "copy": "Generated-sounding copy",
    "buzzword": "Buzzword cluster",
    "dash": "Em dash density",
}


# ---------------------------------------------------------------------------
# Colours


HEX_PATTERN = re.compile(r"(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
RGB_PATTERN = re.compile(r"\brgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})")
HSL_PATTERN = re.compile(r"\bhsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%")
OKLCH_PATTERN = re.compile(r"\boklch\(\s*(\d*\.?\d+)(%?)\s+(\d*\.?\d+)\s+(\d*\.?\d+)")
# shadcn writes its tokens as bare HSL triplets: --primary: 262 83% 58%.
TOKEN_HSL_PATTERN = re.compile(r"--(?:primary|brand|accent)(?:-color)?\s*:\s*(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%")
GRADIENT_CALL_PATTERN = re.compile(r"\b(?:linear|radial|conic)-gradient\([^;{}]*", re.IGNORECASE)


def hex_to_rgb(digits):
    if len(digits) in (3, 4):
        digits = "".join(c * 2 for c in digits[:3])
    return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4))


def hue_chroma_lightness(r, g, b):
    hue, lightness, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return hue * 360, max(r, g, b) - min(r, g, b), lightness


def is_beige(r, g, b):
    """Warm, light and only faintly tinted: the cream and oat backgrounds.

    Tint is measured as chroma, the gap between the strongest and weakest
    channel, because HSL saturation climbs to 100% for any pale colour and
    would call a strong yellow and a whisper of cream the same thing. Pure
    white and greys have no chroma and are left alone.
    """
    hue, chroma, lightness = hue_chroma_lightness(r, g, b)
    return 20 <= hue <= 65 and 6 <= chroma <= 70 and lightness >= 0.85


def is_purple(r, g, b):
    """Indigo through violet: the accent every generator reaches for.

    The lower bound sits between Tailwind's blue-600 (221°) and indigo-500
    (239°), so an electric blue stays a blue.
    """
    hue, lightness, saturation = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return 237 <= hue * 360 <= 300 and saturation >= 0.35 and 0.25 <= lightness <= 0.8


def is_terracotta(r, g, b):
    hue, chroma, lightness = hue_chroma_lightness(r, g, b)
    return 8 <= hue <= 28 and chroma >= 80 and 0.3 <= lightness <= 0.65


def is_chromatic(r, g, b):
    return max(r, g, b) - min(r, g, b) >= 60


def colours_in(text):
    for match in HEX_PATTERN.finditer(text):
        yield match.group(0), hex_to_rgb(match.group(1))
    for match in RGB_PATTERN.finditer(text):
        rgb = tuple(min(int(v), 255) for v in match.groups())
        yield match.group(0) + ")", rgb
    for match in HSL_PATTERN.finditer(text):
        h, s, l = (float(v) for v in match.groups())
        r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
        yield match.group(0) + ")", (round(r * 255), round(g * 255), round(b * 255))


def purple_oklch(text):
    """OKLCH colours that are purple, without converting them: hue 265–310
    with enough chroma to be an accent rather than a tinted grey."""
    for match in OKLCH_PATTERN.finditer(text):
        lightness = float(match.group(1)) / (100 if match.group(2) else 1)
        chroma, hue = float(match.group(3)), float(match.group(4))
        if 265 <= hue <= 310 and chroma >= 0.12 and 0.3 <= lightness <= 0.8:
            yield match.group(0) + ")"


def to_px(value, unit):
    return abs(float(value)) * (16 if unit in ("rem", "em") else 1)


# ---------------------------------------------------------------------------
# Patterns, grouped by the category they report under


# Fonts that a generator reaches for when nobody chose one. Inter is the
# loudest tell; the rest are the substitutes it turns to when Inter is
# banned, including the current "tasteful" serifs.
DEFAULT_FONTS = [
    "Inter", "Inter Tight", "Inter Display", "Plus Jakarta Sans", "DM Sans", "Poppins",
    "Manrope", "Outfit", "Geist", "Figtree", "Space Grotesk", "Instrument Serif",
    "Instrument Sans", "Fraunces", "General Sans", "Playfair Display",
    "DM Serif Display", "DM Serif Text", "Syne", "Sora", "Cal Sans",
]
# Longest names first, so that "Inter Tight" is reported as itself and not as "Inter".
FONT_NAMES = "|".join(re.escape(f) for f in sorted(DEFAULT_FONTS, key=len, reverse=True))
FONT_PATTERN = re.compile(
    r"""(?:font-family\s*:[^;{}]*?|fontFamily\s*[:=][^;{}]*?|['"`]|family=)"""
    r"""\b(""" + FONT_NAMES + r""")\b(?![-\w])""",
    re.IGNORECASE,
)
FONT_IMPORT_PATTERN = re.compile(
    r"""\bimport\s*\{[^}]*\b(""" + "|".join(re.escape(f.replace(" ", "_")) for f in DEFAULT_FONTS)
    + r""")\b[^}]*\}\s*from\s*['"]next/font/google['"]"""
)
FONTSOURCE_PATTERN = re.compile(
    r"@fontsource(?:-variable)?/(" + "|".join(f.lower().replace(" ", "-") for f in DEFAULT_FONTS) + r")\b"
)
TAILWIND_FONT_PATTERN = re.compile(r"\bfont-(inter|jakarta|dm-sans|poppins|manrope|geist|grotesk|instrument)\b")
# Roboto and Arial are only a tell as the face that was chosen, not as the
# fallback at the end of a stack.
FIRST_FAMILY_PATTERN = re.compile(r"""font-family\s*:\s*['"]?(Roboto|Arial)\b""", re.IGNORECASE)
SEGOE_STACK_PATTERN = re.compile(r"""(['"]Segoe UI['"],\s*Tahoma,\s*Geneva,\s*Verdana)""")

# CSS named colours that are beige or cream by definition.
BEIGE_NAMES = [
    "beige", "linen", "oldlace", "ivory", "cornsilk", "antiquewhite",
    "floralwhite", "seashell", "bisque", "blanchedalmond", "papayawhip",
    "wheat", "navajowhite", "moccasin",
]
BEIGE_NAME_PATTERN = re.compile(
    r"(?:[:\s,(]|^)(" + "|".join(BEIGE_NAMES) + r")\b(?![-\w])", re.IGNORECASE
)
TAILWIND_BEIGE_PATTERN = re.compile(
    r"\b(?:bg|from|via|to|border|ring|fill)-(?:stone-(?:50|100|200)|amber-(?:50|100)|orange-50|yellow-50|neutral-50)\b"
)
# The clay and rust of the palette Anthropic's own examples use.
CLAY_PATTERN = re.compile(r"#(?:d97757|b04a3f|b84a2f)\b", re.IGNORECASE)

TAILWIND_PURPLE_PATTERN = re.compile(
    r"\b(?:bg|text|border|ring|fill|stroke|outline|decoration|accent|divide|caret|placeholder)-(?:indigo|violet|purple|fuchsia)-\d{2,3}\b"
)
VIOLET_BASE_PATTERN = re.compile(r'"baseColor"\s*:\s*"violet"')

# Radii are also set as tokens: a custom property such as shadcn's --radius,
# or a borderRadius entry in a Tailwind config written on one line.
RADIUS_PATTERN = re.compile(
    r"(?:\bborder(?:-[a-z]+)*-radius|--[\w-]*radius[\w-]*|\bborderRadius)\s*:\s*([^;}\n]+)",
    re.IGNORECASE,
)
TAILWIND_RADIUS_PATTERN = re.compile(r"\brounded(?:-[trblse]{1,2})?-(xl|2xl|3xl|4xl)\b")
PILL_BUTTON_PATTERN = re.compile(r"<(?:button|a|Button)\b[^>]*\brounded-full\b")
LENGTH_PATTERN = re.compile(r"(\d*\.?\d+)\s*(px|rem|em)\b")
SHADOW_LENGTH_PATTERN = re.compile(r"(?<![\w.])-?(\d*\.?\d+)(px|rem|em)?(?![\w.%])")

GRADIENT_PATTERN = re.compile(r"\b(?:linear|radial|conic)-gradient\(([^;]*)", re.IGNORECASE)
TAILWIND_GRADIENT_PATTERN = re.compile(r"\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b")
GRADIENT_TEXT_CSS_PATTERN = re.compile(r"-webkit-background-clip:\s*text|\bbackground-clip:\s*text|-webkit-text-fill-color:\s*transparent", re.IGNORECASE)
CHATGPT_GRADIENT_PATTERN = re.compile(r"#(?:667eea|764ba2)\b|#f5f7fa\b[^;]*#c3cfe2\b", re.IGNORECASE)
GRADIENT_BUTTON_PATTERN = re.compile(r"<(?:button|a|Button)\b[^>]*\bbg-gradient-to-")

SHADOW_PATTERN = re.compile(r"\bbox-shadow\s*:\s*([^;}\n]+)", re.IGNORECASE)
TAILWIND_SHADOW_PATTERN = re.compile(r"\bshadow-(xl|2xl)\b")

GLOW_CLASS_PATTERN = re.compile(r"\b(?:drop-)?shadow-\[0_0_[^\]]*\]|\bshadow-(?:indigo|violet|purple|pink|fuchsia|blue|sky|cyan|emerald|teal|lime|green|rose|amber|orange|red)-\d{3}(?:/\d+)?\b")
GLOW_CSS_PATTERN = re.compile(r"(?:box|text)-shadow\s*:\s*(0\s+0\s+\d*\.?\d+(?:px|rem|em)[^;}]*)", re.IGNORECASE)
GLOW_TOKEN_PATTERN = re.compile(r"--(?:shadow-glow|primary-glow)\b")

GLASS_PATTERN = re.compile(r"\bbackdrop-filter\s*:\s*[^;]*blur|\bbackdrop-blur(?:-\w+)?\b", re.IGNORECASE)
GLASS_FILL_PATTERNS = (re.compile(r"\bbg-white/(?:5|10|15|20)\b"), re.compile(r"\bborder-white/(?:10|20|30)\b"))

BLUR_CLASS_PATTERN = re.compile(r"\bblur-(?:2xl\b|3xl\b|\[\d{2,3}px\])")
BLUR_COMPANY_PATTERN = re.compile(r"\brounded-full\b|\babsolute\b|\bopacity-\d0\b|\bbg-\w+-\d{3}/\d+\b|\bmix-blend-multiply\b")
BLUR_CSS_PATTERN = re.compile(r"\bfilter\s*:\s*blur\((\d{2,3})px\)", re.IGNORECASE)
TAILWIND_UI_BLOB_PATTERN = re.compile(r"from-\[#ff80b5\]|to-\[#9089fc\]|aspect-\[1155/678\]|w-\[36\.125rem\]|w-\[72\.1875rem\]")
PATTERN_BACKDROP_PATTERN = re.compile(
    r"\bbg-grid-|\bbg-dot-|\bbg-\[linear-gradient\(to_right,#|\bbg-\[radial-gradient\(|\bbg-\[size:\d+px_\d+px\]"
    r"|mask-image:\s*radial-gradient|\[mask-image:radial-gradient|radial-gradient\((?:circle|ellipse)_at"
    r"|\banimate-spotlight\b|--aurora\b|@keyframes\s+aurora\b|#e4e4e7_1px|#80808008_1px"
    r"|\brepeating-linear-gradient\(|radial-gradient\(\s*circle,\s*#?\w+\s+1px,\s*transparent",
    re.IGNORECASE,
)

EYEBROW_PATTERNS = (re.compile(r"\buppercase\b"), re.compile(r"\btracking-(?:wide|wider|widest|\[)"))
EYEBROW_CSS_PATTERN = re.compile(r"text-transform\s*:\s*uppercase;?[^}]*letter-spacing\s*:\s*0?\.(?:0[5-9]|[1-9])\d*em", re.IGNORECASE)
EYEBROW_WORDS_PATTERN = re.compile(r">\s*(FEATURES|HOW IT WORKS|TESTIMONIALS|PRICING|FAQS?|WHY US|BENEFITS|OUR SERVICES)\s*<")
PILL_BADGE_PATTERN = re.compile(r"\binline-flex\b[^\"'`]*\brounded-full\b|\brounded-full\b[^\"'`]*\btext-(?:xs|sm)\b|\btext-(?:xs|sm)\b[^\"'`]*\brounded-full\b")
PULSING_DOT_PATTERNS = (re.compile(r"\banimate-(?:pulse|ping)\b"), re.compile(r"\brounded-full\b"), re.compile(r"\b(?:w|h|size)-(?:1\.5|2|2\.5|3)\b"))
NUMBERED_MARKER_PATTERN = re.compile(r">\s*[/\[(#]?\s*(0[1-9])\s*[\])]?\s*<")
WINDOW_DOTS_PATTERN = re.compile(r"#(?:ff5f57|febc2e|ffbd2e|28c840|27c93f)\b", re.IGNORECASE)

ICON_CHIP_PATTERNS = (
    re.compile(r"\b(?:w|h|size)-(?:8|9|10|11|12|14|16)\b"),
    re.compile(r"\brounded-(?:md|lg|xl|2xl|full)\b"),
    re.compile(r"\bbg-[a-z]+(?:-\d{2,3})?(?:/(?:5|10|15|20)|-(?:50|100))\b"),
)
SIDE_STRIPE_PATTERN = re.compile(r"\bborder-[lt]-(?:2|4|8)\b[^\"'`]*\bborder-(?:[a-z]+-[4-7]00|primary)\b|\bborder-(?:[a-z]+-[4-7]00|primary)\b[^\"'`]*\bborder-[lt]-(?:2|4|8)\b")
SIDE_STRIPE_CSS_PATTERN = re.compile(r"border-(?:left|top)\s*:\s*[2-9]px\s+solid\s+(?!(?:#(?:fff|ffffff|000|000000|eee|ddd|ccc|e5e7eb|f3f4f6)\b|transparent|currentcolor|inherit|var\(--(?:rule|border|line|hairline)))", re.IGNORECASE)
SHADCN_CARD_PATTERN = re.compile(r"rounded-(?:lg|xl) border bg-card (?:py-6 )?text-card-foreground shadow(?:-sm)?\b")

WORN_ICONS = "Sparkles|Sparkle|Zap|Rocket|Wand2|WandSparkles|BrainCircuit|ArrowRight|CheckCircle2?|Star|Shield|ShieldCheck|BarChart3|Check"
ICON_IMPORT_PATTERN = re.compile(r"\bimport\s*\{([^}]*)\}\s*from\s*['\"](?:lucide-react|lucide-\w+|@heroicons/react[^'\"]*)['\"]")
REFLEX_ICON_PATTERN = re.compile(r"\b(Sparkles|Sparkle|Zap|Rocket|Wand2|WandSparkles|SparklesIcon|BoltIcon|RocketLaunchIcon)\b")
ICON_GLYPH_PATTERN = re.compile(r"(?:lucide-sparkles|data-lucide=[\"']sparkles|[✦✧])")
FONT_AWESOME_PATTERN = re.compile(r"<i\s[^>]*class=[\"'][^\"']*\bfa[srb]?\s+fa-[\w-]+")

# The emoji a generator uses as icons. Flags and the symbols people type
# in prose are left out.
EMOJI_PATTERN = re.compile("[\U0001F300-\U0001FAFF⭐✅✨⚡✔✦❤⬆⬇]")
COMMENT_PATTERN = re.compile(r"/\*.*?\*/|<!--.*?-->")

DISPLAY_TRACKING_PATTERNS = (re.compile(r"\btext-(?:5|6|7|8|9)xl\b"), re.compile(r"\btracking-(?:tight|tighter)\b"))
SERIF_ACCENT_PATTERNS = (re.compile(r"<h[12]\b"), re.compile(r"<(?:span|em)\b[^>]*(?:\bitalic\b|\bfont-serif\b|font-style:\s*italic|font-family:\s*[\"']?serif)"))
MONO_BODY_PATTERN = re.compile(r"<(?:body|main|html)\b[^>]*\bfont-mono\b")
MONO_BODY_CSS_PATTERN = re.compile(r"\bbody\s*\{[^}]*font-family\s*:[^;}]*\bmono", re.IGNORECASE | re.DOTALL)

THREE_COLUMN_PATTERN = re.compile(r"\b(?:(?:sm|md|lg|xl|2xl):)?grid-cols-3\b|repeat\(\s*3\s*,\s*(?:minmax\([^)]*\)|1fr)\s*\)")
BENTO_PATTERNS = (re.compile(r"\b(?:(?:sm|md|lg|xl):)?col-span-2\b"), re.compile(r"\b(?:(?:sm|md|lg|xl):)?row-span-2\b"))
SECTION_MARKERS = [
    ("hero", re.compile(r"<h1\b")),
    ("logos", re.compile(r"\b(?:trusted|used|loved) by\b|\bteams at\b", re.IGNORECASE)),
    ("features", re.compile(r"\bfeatures\b|\beverything you need\b", re.IGNORECASE)),
    ("how it works", re.compile(r"\bhow it works\b", re.IGNORECASE)),
    ("testimonials", re.compile(r"\btestimonial|\bwhat (?:our )?(?:customers|users|clients) say\b", re.IGNORECASE)),
    ("pricing", re.compile(r"\bpricing\b|/\s*mo\b|\bper month\b", re.IGNORECASE)),
    ("faq", re.compile(r"\bfaq\b|\bfrequently asked\b", re.IGNORECASE)),
    ("cta", re.compile(r"\bready to (?:get started|start|try)\b|\bstart (?:your )?free\b", re.IGNORECASE)),
    ("footer", re.compile(r"<footer\b", re.IGNORECASE)),
]
SECTION_PADDING_PATTERN = re.compile(r"\bpy-(?:20|24|32)\b")

MOTION_PATTERN = re.compile(
    r"\bdata-aos=|\bAOS\.init\b|\bwhileInView\b|initial=\{\{\s*opacity:\s*0"
    r"|\banimate-fade-(?:in|up|in-up)\b|\bslide-in-from-bottom\b"
    r"|@keyframes\s+(?i:fade-?in-?up|fade-?in-?down|fade-?up|slide-?up|fade-?in|float|shimmer|marquee|scroll|ticker|gradient|blink|typing|bob)\b"
    r"|\bhover:-translate-y-\d|\bhover:scale-1(?:05|10)\b|\bwhileHover=|\bgroup-hover:scale-1"
    r"|transition\s*:\s*all\s+0?\.3s"
    r"|\banimate-(?:marquee|scroll|infinite-scroll|ticker|bounce)\b|<marquee\b|react-fast-marquee"
    r"|cubic-bezier\(\s*[\d.]+\s*,\s*-[\d.]+|cubic-bezier\([^)]*,\s*1\.[1-9]\d*\s*\)"
    r"|\b(?:easeOutBack|easeInOutBack|easeOutElastic|backOut)\b|type:\s*[\"']spring[\"']"
    r"|\btyped\.js\b|react-type-animation|\bTypewriterEffect\b|\bTextGenerateEffect\b"
    r"|\banimate-gradient(?:-x|-xy)?\b|background-size\s*:\s*(?:200|300|400)%|animate-\[shimmer"
    r"|<(?:BackgroundBeams|AnimatedBeam|ShimmerButton|BorderBeam|Meteors|SparklesCore|LampContainer|AuroraBackground"
    r"|DotPattern|GridPattern|RetroGrid|OrbitingCircles|HeroHighlight|WavyBackground|InfiniteMovingCards|MagicCard"
    r"|NeonGradientCard|ShineBorder|AnimatedGradientText|RainbowButton|FlipWords|HoverBorderGradient|MovingBorder|GlowingEffect|Spotlight)\b"
)
HOVER_LIFT_CSS_PATTERN = re.compile(r":hover\s*\{[^}]*transform\s*:\s*translateY\(-\d+px\)", re.IGNORECASE | re.DOTALL)
ANIMATES_PATTERN = re.compile(r"@keyframes\b|\banimation\s*:|\banimate-[\w\[]|framer-motion|\bmotion/react\b|\bgsap\b|data-aos")
REDUCED_MOTION_PATTERN = re.compile(r"prefers-reduced-motion|motion-reduce|motion-safe|useReducedMotion|reducedMotion")

DARK_HTML_PATTERN = re.compile(r"<html\b[^>]*\bclass(?:Name)?=[\"'][^\"']*\bdark\b")
DARK_ROOT_CLASS_PATTERN = re.compile(r"<(?:body|html|main)\b[^>]*\bbg-(?:black|(?:zinc|neutral|slate|gray|stone)-950)\b")
DARK_ROOT_CSS_PATTERN = re.compile(
    r"\b(?:html|body)\s*\{[^}]*background(?:-color)?\s*:\s*(#000\b|#000000\b|black\b|#0a0a0a|#09090b|#030712|#020617|#0f172a|#111827|#0b0b0b|#111\b)",
    re.IGNORECASE | re.DOTALL,
)
DARK_CARD_PATTERNS = (re.compile(r"\bbg-(?:zinc|gray|slate|neutral)-9(?:00|50)\b"), re.compile(r"\bborder-white/(?:5|10)\b"))

SCRIM_PATTERNS = (re.compile(r"\babsolute\b[^\"'`]*\binset-0\b|\binset-0\b[^\"'`]*\babsolute\b"), re.compile(r"\bbg-black/(?:40|50|60|70)\b|\bbg-gradient-to-t\b[^\"'`]*\bfrom-black\b"))
SCRIM_CSS_PATTERN = re.compile(r"linear-gradient\(\s*rgba\(\s*0,\s*0,\s*0,\s*0?\.[4-7]\d*\s*\)[^;]*?\)\s*,\s*url\(", re.IGNORECASE)
STOCK_PHOTO_PATTERN = re.compile(r"images\.unsplash\.com|images\.pexels\.com|\bundraw(?:[_.-]|\b)|\bstoryset\b|\bhumaaans\b|\bopendoodles\b", re.IGNORECASE)

ALT_PATTERN = re.compile(r"\balt=[\"']\s*(hero(?: image)?|image|img|photo|picture|placeholder|image description|icon|feature icon|logo|avatar|testimonial|screenshot|banner|thumbnail)\s*[\"']", re.IGNORECASE)

SHADCN_PATTERN = re.compile(
    r"--primary\s*:\s*(?:oklch\(0\.205 0 0\)|222\.2 47\.4% 11\.2%|240 5\.9% 10%|0 0% 9%|221\.2 83\.2% 53\.3%)"
    r"|\"baseColor\"\s*:\s*\"(?:zinc|slate|neutral|gray|stone)\"|--radius\s*:\s*0\.(?:5|625)rem\b"
    r"|oklch\(0\.145 0 0\)|oklch\(0\.556 0 0\)|oklch\(0\.922 0 0\)|oklch\(0\.708 0 0\)"
    r"|\b222\.2 84% 4\.9%|\b215\.4 16\.3% 46\.9%|\b214\.3 31\.8% 91\.4%"
)

SECTION_WORDS = r"hero|features?|testimonials?|pricing|faqs?|cta|footer|navigation|navbar|nav|header|about|contact|services|stats|team|benefits|how it works"
SCAFFOLD_PATTERN = re.compile(
    r"<!--\s*(?:" + SECTION_WORDS + r")(?:\s+section)?\s*-->|\{/\*\s*(?:" + SECTION_WORDS + r")(?:\s+section)?\s*\*/\}"
    r"|\bTODO:?\s*(?:replace|add|update|insert|swap)\s+(?:this\s+|these\s+)?(?:with\s+)?(?:real|actual|your|the real)\b"
    r"|cdn\.tailwindcss\.com"
    r"|#(?:646cff|535bf2|747bff|213547)\b|--background\s*:\s*#0a0a0a|--foreground\s*:\s*#ededed"
    r"|\bGet started by editing\b|\bStart prompting \(or editing\)|\bread-the-docs\b|\blogo-spin\b"
    r"|#(?:3245ff|bc52ee)\b|before:bg-gradient-radial|after:bg-gradient-conic|dark:via-\[#0141ff\]",
    re.IGNORECASE,
)

BADGE_PATTERN = re.compile(
    r"\b(?:edit|made|built|created) (?:with|in|on|using) (?:lovable|bolt|v0|framer|durable|replit|base44|gpt ?engineer)\b"
    r"|\blovable-(?:badge|tagger|uploads)\b|\bcomponentTagger\b|cdn\.gpteng\.co|\bgptengineer\b|lovable\.dev|Lovable Generated Project|content=[\"']Lovable[\"']"
    r"|\bmy-v0-project\b|\bv0\.(?:dev|app)\b|\bbolt\.new\b|replit-dev-banner"
    r"|name=[\"']generator[\"'][^>]*content=[\"'](?:v0|Lovable|Bolt)"
    r"|--(?:shadow-elegant|transition-smooth|gradient-subtle)\b"
    r"|\.(?:lovable\.app|lovableproject\.com|bolt\.host|replit\.app|repl\.co|base44\.app|vercel\.app|netlify\.app|pages\.dev|framer\.website|framer\.app|webflow\.io)\b",
    re.IGNORECASE,
)

PLACEHOLDER_PATTERN = re.compile(
    r"\blorem ipsum\b|\bdolor sit amet\b"
    r"|\byour company(?: name)?\b|\bcompany name(?: here)?\b|\bbrand name\b|\bproduct name\b|\bacme(?: inc\.?| corp\.?| co\.?)?\b"
    r"|\bjohn doe\b|\bjane (?:doe|smith)\b"
    r"|\b[\w.+-]+@(?:example|email|yourcompany|yourdomain|company|domain)\.com\b"
    r"|\(?555\)?[-. ]\d{3}[-. ]\d{4}\b|\b123 main st(?:reet)?\b|\banytown\b|\bcity, state \d{5}\b"
    r"|\[(?:insert|your|company|add|enter)[^\]]{0,40}\]"
    r"|placehold\.co|via\.placeholder\.com|placeholder\.svg\?|\bplacekitten\b|picsum\.photos|source\.unsplash\.com"
    r"|\bpravatar\.cc|randomuser\.me|ui-avatars\.com|\bdicebear\b|boringavatars|\brobohash\b|lorempixel|dummyimage\.com|loremflickr"
    r"|placeholder-user\.jpg|placeholder-logo\.(?:png|svg)|photo-1494790108377-be9c29b29330"
    r"|<title>\s*(?:vite \+ react|create next app|my app|react app|document|next\.js app|welcome to nuxt|vite app|svelte app)\s*</title>"
    r"|generated by create next app"
    r"|\bcoming soon\b|\bdescription goes here\b|\b(?:add )?your (?:text|content) here\b|\btext goes here\b|\bimage description\b"
    r"|\b(?:G|UA)-X{4,}\b"
    r"|\bAnim aute id magna aliqua\b|\bData to enrich your online business\b|\bAnnouncing our next round of funding\b"
    r"|\b(?:globex|initech|hooli|umbrella corp|voltshift|stratosync|cyphervault)\b",
    re.IGNORECASE,
)
COPYRIGHT_PATTERN = re.compile(r"(?:©|&copy;|&#169;|\(c\))\s*(?:(\d{4})\s*[–-]\s*)?(\d{4})\b")

DEAD_LINK_PATTERN = re.compile(
    r"href=[\"']#[\"']|href=[\"']javascript:void\(0\)[\"']"
    r"|href=[\"']https?://(?:www\.)?(?:twitter|x|facebook|linkedin|instagram|github|youtube|tiktok)\.com/?[\"']",
    re.IGNORECASE,
)

TESTIMONIAL_PATTERN = re.compile(
    r"\b(?:dr\.? )?(?:sarah chen|marcus chen|elena vasquez|amara okafor|elara voss|aris thorne|lena petrova|kai (?:nakamura|tanaka)"
    r"|sarah johnson|michael chen|emily davis|emma (?:rodriguez|williams)|david kim|alex thompson|james wilson|priya patel|jessica martinez|john smith|michael brown|alex miller)\b"
    r"|\b(?:changed my life|absolutely (?:revolutionary|amazing|love it)|game[- ]changer for (?:our|my)|can'?t imagine (?:working|living) without"
    r"|10/10 would|highly recommend(?:ed)? (?:it )?to anyone|best (?:decision|investment) (?:we|i)'?ve? (?:ever )?made|exceeded (?:our|my|all) expectations)\b"
    r"|\b(?:ceo|cto|coo|cfo|founder|co-founder|marketing director|product manager),?\s*(?:at|@)?\s*(?:techcorp|startup inc|startupxyz|techstart inc|acme|company|tech company|innovate ?inc)\b",
    re.IGNORECASE,
)
INITIAL_PATTERN = re.compile(r"\b[A-Z][a-z]+ [A-Z]\.(?=\s*(?:<|\"|'|,|—|–|$))")

STAT_PATTERN = re.compile(
    r"\b\d{1,3}(?:,\d{3})*\+\s*(?:happy\s+)?(?:customers|users|companies|teams|businesses|downloads|developers|clients|reviews|projects|members)\b"
    r"|\b\d+(?:\.\d+)?[KkMmBb]\+\s*(?:happy\s+)?(?:customers|users|companies|teams|businesses|downloads|developers|clients|reviews|projects|members)\b"
    r"|\b99\.9+%\s*(?:</\w+>\s*)?uptime\b|\b4\.[5-9]\s*/\s*5\b|\b24\s*/\s*7\b|\b\d+x\s+(?:faster|more|better|growth)\b",
    re.IGNORECASE,
)
COUNT_UP_PATTERN = re.compile(r"\bCountUp\b|\buseCountUp\b|react-countup|\bNumberTicker\b|\banimate-count\b")

CTA_LABELS = (
    r"get started(?: free| today| now)?|learn more|explore(?: now| more)?|discover more|start your journey|join (?:now|us)"
    r"|sign up(?: free| now)?|start (?:your )?free trial|try (?:it )?(?:for )?free|book a demo|request a demo|contact us(?: today)?|let'?s go!?|click here"
)
CTA_PATTERN = re.compile(
    r">\s*(?:" + CTA_LABELS + r")\s*(?:→|&rarr;|&#8594;)?\s*<|[\"'](?:" + CTA_LABELS + r")[\"']|\[(?:" + CTA_LABELS + r")\]\(",
    re.IGNORECASE,
)
WELDED_ARROW_PATTERN = re.compile(r"(?:→|&rarr;|&#8594;|&#x2192;|➜|➔|⟶)\s*</(?:a|button|Button|Link)>")

STOCK_PATTERN = re.compile(
    r">\s*(?:everything you need(?: to \w+)?|powerful features|why (?:choose )?us\??|what our (?:customers|clients|users) (?:say|are saying)"
    r"|loved by (?:teams|thousands|\d[\d,]*\+?)[^<]{0,30}|simple,? transparent pricing|frequently asked questions|ready to get started\??|how it works"
    r"|trusted by [^<]{0,40}|as (?:seen|featured) (?:in|on)|most popular|our (?:mission|vision|values)|meet (?:the|our) team)\s*<"
    r"|\b(?:is there a free trial|can i cancel (?:anytime|at any time)|do you offer (?:refunds|a free trial)|is my data (?:safe|secure)|what integrations do you support|can i change my plan)\b",
    re.IGNORECASE,
)

COPY_PATTERN = re.compile(
    r"\b(?:elevate your|unlock the (?:power|potential)|harness the power|supercharge your|revolutioni[sz]e your"
    r"|all-in-one (?:platform|solution|workspace)|built for the (?:future|modern)|in today'?s (?:fast[- ]paced|digital|modern|ever[- ]evolving|rapidly (?:evolving|changing)|competitive|hyper-?connected)"
    r"|in a world where|now more than ever|in this day and age|welcome to the world of"
    r"|empower(?:ing)? your|transform your|unleash (?:the|your)|take (?:it|your \w+) to the next level|look no further|one[- ]stop[- ]shop|we'?ve got you covered|at your fingertips"
    r"|say goodbye to|possibilities are endless|journey (?:starts|begins) here|join thousands of|whether you'?re an?|for (?:teams|businesses|companies) of (?:all|every|any) sizes?|no matter your"
    r"|it'?s (?:important|worth|essential|crucial) to (?:note|mention|remember|understand)|it should be noted|at its core|in the realm of|at the end of the day"
    r"|picture this|ever wondered|let'?s (?:dive in|dive into|explore|unpack)|here'?s the (?:thing|deal|kicker)|imagine a world where|what if (?:i told you|there were a better way)|buckle up|let that sink in"
    r"|stands? as a testament|plays? an? (?:pivotal|vital|crucial|key) role|pivotal moment|the future of (?:work|business|\w+ing)|scale without limits|rich tapestry|ever[- ](?:evolving|changing) landscape|navigating the complexities"
    r"|passionate about|committed to excellence|your success is our|dedicated to your success|we pride ourselves|customer[- ]centric|(?:tailored|innovative|bespoke) solutions?|trusted partner"
    r"|certainly!|absolutely!|great question|i hope this helps|let me know if you|as an ai(?: language model)?|here'?s (?:a|your) (?:draft|landing page|copy)"
    r"|studies (?:have )?shown?|research (?:suggests|shows)|experts agree|in conclusion|to summari[sz]e|in summary,"
    r"|no credit card(?: required)?.{0,6}(?:·|•|\||✓|✔|,|-).{0,40}(?:cancel anytime|free trial|no setup|no commitment)"
    r")\b"
    r"|citeturn\d|\boaicite\b|contentReference|\[cite: ?\d|utm_source=chatgpt",
    re.IGNORECASE,
)
NEGATION_PIVOT_PATTERN = re.compile(
    r"\b(?:it'?s|this is|we'?re|that'?s|you'?re|they'?re|i'?m) not (?:just |only |simply |merely |about )?(?:a|an|the|your)?\s*[^.,;—–:<>-]{1,40}[,;—–:-]\s*(?:it'?s|this is|we'?re|that'?s|you'?re|they'?re|but|it is)\b"
    r"|\b(?:it'?s|this is|we'?re|that'?s) not (?:just|only|merely|simply)\b|\bmore than just\b",
    re.IGNORECASE,
)

# Marketing words that mean nothing on their own but, four or more to a file,
# are the register a generator writes in. Words that are also code, such as
# transform and navigate, are left out.
BUZZWORDS = [
    "seamless", "seamlessly", "elevate", "elevates", "elevated", "unlock", "unleash", "leverage", "leverages", "leveraging",
    "harness", "empower", "empowers", "empowering", "cutting-edge", "robust", "innovative", "transformative",
    "game-changer", "game-changing", "groundbreaking", "unprecedented", "best-in-class", "world-class",
    "industry-leading", "state-of-the-art", "next-level", "effortless", "effortlessly", "intuitive", "bespoke",
    "unparalleled", "revolutionary", "revolutionize", "revolutionise", "supercharge", "turbocharge", "streamline",
    "streamlined", "actionable", "data-driven", "ai-powered", "holistic", "synergy", "delve", "tapestry", "testament",
    "meticulous", "meticulously", "realm", "embark", "myriad", "plethora", "multifaceted", "paradigm", "pivotal",
    "unwavering", "skyrocket", "unveil", "deep dive", "ecosystem", "beacon", "cornerstone", "frictionless",
    "scalable", "enterprise-grade", "future-proof", "reimagined", "reimagine",
]
BUZZWORD_PATTERN = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(BUZZWORDS, key=len, reverse=True)) + r")\b", re.IGNORECASE)
BUZZWORD_CLUSTER = 4

EM_DASH_PATTERN = re.compile(r"—|&mdash;|&#8212;")
EM_DASH_DENSITY = 5
EM_DASH_LABEL_PATTERN = re.compile(r"<(?:button|h[1-3]|a|Button)\b[^>]*>[^<]*(?:—|&mdash;|&#8212;)")

# A radius at or above this reads as the soft pill-and-card look rather than
# a considered corner. 12px is where Tailwind's rounded-xl begins.
LARGE_RADIUS_PX = 12
# A shadow blur at or above this is the diffuse floating-card shadow.
LARGE_BLUR_PX = 20
# A blur filter at or above this is a backdrop blob, not an effect on content.
BLOB_BLUR_PX = 24


# ---------------------------------------------------------------------------
# Line checkers


def regex_tell(category, pattern, group=0):
    """A checker for a tell that one regular expression finds outright.

    Most tells are this simple. The ones below that measure something, such
    as a colour's warmth or a corner's size, are written out by hand.
    """
    def check(line):
        for match in pattern.finditer(line):
            yield category, match.group(group)
    return check


def all_of(category, label, patterns):
    """A checker for a tell that is several things on one line together,
    such as a pulsing dot: animate-pulse, rounded-full and a tiny size.

    The finding is the label, so a keep covers every instance in a file.
    """
    def check(line):
        if all(pattern.search(line) for pattern in patterns):
            yield category, label
    return check


def shadow_blurs(value):
    """The blur of each shadow in a box-shadow list, in px.

    Colours are taken out first so their numbers are not read as lengths; the
    blur is then the third length, and a bare 0 counts as one.
    """
    without_colours = HEX_PATTERN.sub(" ", re.sub(r"[a-z-]+\([^)]*\)", " ", value, flags=re.I))
    for shadow in without_colours.split(","):
        lengths = SHADOW_LENGTH_PATTERN.findall(shadow)
        if len(lengths) >= 3:
            number, unit = lengths[2]
            yield to_px(number, unit)


def beige_colours(line):
    for snippet, rgb in colours_in(line):
        if is_beige(*rgb):
            yield "beige", snippet


def purple_colours(line):
    # Purple inside a gradient is the gradient's tell, reported there.
    outside = GRADIENT_CALL_PATTERN.sub(" ", line)
    for snippet, rgb in colours_in(outside):
        if is_purple(*rgb):
            yield "purple", snippet
    for snippet in purple_oklch(outside):
        yield "purple", snippet
    for match in TOKEN_HSL_PATTERN.finditer(line):
        hue, saturation = float(match.group(1)), float(match.group(2))
        if 237 <= hue <= 300 and saturation >= 35:
            yield "purple", match.group(0)


def large_radii(line):
    for match in RADIUS_PATTERN.finditer(line):
        value = match.group(1).strip()
        lengths = [to_px(v, u) for v, u in LENGTH_PATTERN.findall(value)]
        if any(px >= LARGE_RADIUS_PX for px in lengths):
            yield "radius", match.group(0).strip()[:60]


def purple_gradients(line):
    for match in GRADIENT_PATTERN.finditer(line):
        if any(is_purple(*rgb) for _, rgb in colours_in(match.group(1))):
            yield "gradient", match.group(0)[:60]


def soft_shadows(line):
    for match in SHADOW_PATTERN.finditer(line):
        value = match.group(1).strip()
        if is_glow(value):
            continue
        if any(blur >= LARGE_BLUR_PX for blur in shadow_blurs(value)):
            yield "shadow", "box-shadow: " + value[:50]


def is_glow(value):
    """A shadow with no offset and a colour: a halo, not a drop shadow."""
    return bool(re.match(r"0\s+0\s+\d", value)) and any(is_chromatic(*rgb) for _, rgb in colours_in(value))


def coloured_glows(line):
    for match in GLOW_CSS_PATTERN.finditer(line):
        if any(is_chromatic(*rgb) for _, rgb in colours_in(match.group(1))):
            yield "glow", match.group(0)[:60]


def blur_blobs(line):
    if BLUR_CLASS_PATTERN.search(line) and BLUR_COMPANY_PATTERN.search(line):
        yield "backdrop", "blur blob"
    for match in BLUR_CSS_PATTERN.finditer(line):
        if int(match.group(1)) >= BLOB_BLUR_PX:
            yield "backdrop", match.group(0)


def worn_icon_imports(line):
    for match in ICON_IMPORT_PATTERN.finditer(line):
        names = set(re.findall(r"\b(" + WORN_ICONS + r")\b", match.group(1)))
        if names & {"Sparkles", "Sparkle", "Zap", "Rocket", "Wand2", "WandSparkles", "BrainCircuit"} or len(names) >= 3:
            yield "icon", "worn icon set: " + ", ".join(sorted(names))


def icon_emoji(line):
    for match in EMOJI_PATTERN.finditer(COMMENT_PATTERN.sub(" ", line)):
        yield "emoji", match.group(0)


def stale_copyright(line):
    for match in COPYRIGHT_PATTERN.finditer(line):
        if int(match.group(2)) < CURRENT_YEAR:
            yield "placeholder", match.group(0)


def calls_to_action(line):
    found = [("cta", match.group(0)) for match in CTA_PATTERN.finditer(line)]
    if not found and WELDED_ARROW_PATTERN.search(line):
        found.append(("cta", "arrow welded to link"))
    yield from found


def name_initials(line):
    for match in INITIAL_PATTERN.finditer(line):
        yield "testimonial", match.group(0)


# Every checker, in the order their findings are reported within a line. A
# new tell is a regex_tell or an all_of here, or a function above if it has
# to measure.
CHECKS = [
    regex_tell("font", FONT_PATTERN, 1),
    regex_tell("font", FONT_IMPORT_PATTERN, 1),
    regex_tell("font", FONTSOURCE_PATTERN, 1),
    regex_tell("font", TAILWIND_FONT_PATTERN, 1),
    regex_tell("font", FIRST_FAMILY_PATTERN, 1),
    regex_tell("font", SEGOE_STACK_PATTERN, 1),
    beige_colours,
    regex_tell("beige", BEIGE_NAME_PATTERN, 1),
    regex_tell("beige", TAILWIND_BEIGE_PATTERN),
    regex_tell("tasteful", CLAY_PATTERN),
    purple_colours,
    regex_tell("purple", TAILWIND_PURPLE_PATTERN),
    regex_tell("purple", VIOLET_BASE_PATTERN),
    large_radii,
    regex_tell("radius", TAILWIND_RADIUS_PATTERN),
    all_of("radius", "pill button", (PILL_BUTTON_PATTERN,)),
    purple_gradients,
    regex_tell("gradient", TAILWIND_GRADIENT_PATTERN),
    all_of("gradient", "gradient text", (re.compile(r"\bbg-clip-text\b"), re.compile(r"\btext-transparent\b"))),
    regex_tell("gradient", GRADIENT_TEXT_CSS_PATTERN),
    regex_tell("gradient", CHATGPT_GRADIENT_PATTERN),
    all_of("gradient", "gradient button", (GRADIENT_BUTTON_PATTERN,)),
    soft_shadows,
    regex_tell("shadow", TAILWIND_SHADOW_PATTERN),
    coloured_glows,
    regex_tell("glow", GLOW_CLASS_PATTERN),
    regex_tell("glow", GLOW_TOKEN_PATTERN),
    regex_tell("glass", GLASS_PATTERN),
    all_of("glass", "glass fill", GLASS_FILL_PATTERNS),
    blur_blobs,
    regex_tell("backdrop", TAILWIND_UI_BLOB_PATTERN),
    regex_tell("backdrop", PATTERN_BACKDROP_PATTERN),
    all_of("chrome", "eyebrow label", EYEBROW_PATTERNS),
    regex_tell("chrome", EYEBROW_CSS_PATTERN),
    regex_tell("chrome", EYEBROW_WORDS_PATTERN, 1),
    all_of("chrome", "pill badge", (PILL_BADGE_PATTERN,)),
    all_of("chrome", "pulsing dot", PULSING_DOT_PATTERNS),
    regex_tell("chrome", NUMBERED_MARKER_PATTERN, 1),
    regex_tell("chrome", WINDOW_DOTS_PATTERN),
    all_of("card", "icon chip", ICON_CHIP_PATTERNS),
    all_of("card", "side stripe", (SIDE_STRIPE_PATTERN,)),
    regex_tell("card", SIDE_STRIPE_CSS_PATTERN),
    regex_tell("card", SHADCN_CARD_PATTERN),
    worn_icon_imports,
    regex_tell("icon", REFLEX_ICON_PATTERN, 1),
    regex_tell("icon", ICON_GLYPH_PATTERN),
    regex_tell("icon", FONT_AWESOME_PATTERN),
    icon_emoji,
    all_of("type", "crushed display tracking", DISPLAY_TRACKING_PATTERNS),
    all_of("type", "serif-italic accent word", SERIF_ACCENT_PATTERNS),
    regex_tell("type", MONO_BODY_PATTERN),
    regex_tell("layout", THREE_COLUMN_PATTERN),
    all_of("layout", "bento tile", BENTO_PATTERNS),
    regex_tell("motion", MOTION_PATTERN),
    regex_tell("dark", DARK_HTML_PATTERN),
    regex_tell("dark", DARK_ROOT_CLASS_PATTERN),
    all_of("dark", "dark card", DARK_CARD_PATTERNS),
    all_of("imagery", "scrim over image", SCRIM_PATTERNS),
    regex_tell("imagery", SCRIM_CSS_PATTERN),
    regex_tell("imagery", STOCK_PHOTO_PATTERN),
    regex_tell("alt", ALT_PATTERN),
    regex_tell("shadcn", SHADCN_PATTERN),
    regex_tell("scaffold", SCAFFOLD_PATTERN),
    regex_tell("badge", BADGE_PATTERN),
    regex_tell("placeholder", PLACEHOLDER_PATTERN),
    stale_copyright,
    regex_tell("link", DEAD_LINK_PATTERN),
    regex_tell("testimonial", TESTIMONIAL_PATTERN),
    name_initials,
    regex_tell("stat", STAT_PATTERN),
    regex_tell("stat", COUNT_UP_PATTERN),
    calls_to_action,
    regex_tell("stock", STOCK_PATTERN),
    regex_tell("copy", COPY_PATTERN),
    regex_tell("copy", NEGATION_PIVOT_PATTERN),
    regex_tell("dash", EM_DASH_LABEL_PATTERN),
]


def scan_line(line):
    """Return (category, snippet) for every tell on one line."""
    found = []
    for check in CHECKS:
        found.extend(check(line))
    return found


# ---------------------------------------------------------------------------
# File checkers: tells that are only a tell in bulk, or that span lines.
# Each takes the file's lines and yields (line_number, category, match, detail).


def buzzword_cluster(lines):
    seen = {}
    for number, line in enumerate(lines, 1):
        for match in BUZZWORD_PATTERN.finditer(line):
            seen.setdefault(match.group(1).lower(), number)
    if len(seen) >= BUZZWORD_CLUSTER:
        words = sorted(seen, key=seen.get)
        yield min(seen.values()), "buzzword", "buzzword cluster", f"{len(seen)} words: " + ", ".join(words)


def em_dash_density(lines):
    count, first = 0, None
    for number, line in enumerate(lines, 1):
        hits = len(EM_DASH_PATTERN.findall(line))
        if hits and first is None:
            first = number
        count += hits
    if count >= EM_DASH_DENSITY:
        yield first, "dash", "em dash density", f"{count} em dashes"


def cream_and_terracotta(lines):
    beige = terracotta = None
    for number, line in enumerate(lines, 1):
        for _, rgb in colours_in(line):
            if beige is None and is_beige(*rgb):
                beige = number
            if terracotta is None and is_terracotta(*rgb):
                terracotta = number
    if beige is not None and terracotta is not None:
        yield min(beige, terracotta), "tasteful", "cream and terracotta", f"cream at line {beige}, terracotta at line {terracotta}"


def stock_section_order(lines):
    """The canonical landing page, read as the order its sections appear in.

    Every occurrence of every marker counts, because a nav that says
    "Features" before the hero must not hide the features section that
    follows it. Five of the nine markers in order is the threshold, because
    a real page can have a hero, features and a footer without being the
    template.
    """
    text = "\n".join(lines)
    occurrences = []
    for index, (name, pattern) in enumerate(SECTION_MARKERS):
        occurrences.extend((match.start(), index) for match in pattern.finditer(text))
    occurrences.sort()
    # The longest chain of occurrences whose markers rise through the canon.
    chains = []
    for position, index in occurrences:
        best = []
        for chain in chains:
            if chain[-1][1] < index and len(chain) > len(best):
                best = chain
        chains.append(best + [(position, index)])
    longest = max(chains, key=len, default=[])
    if len(longest) >= 5:
        first = text[:longest[0][0]].count("\n") + 1
        names = [SECTION_MARKERS[index][0] for _, index in longest]
        yield first, "layout", "stock section order", " → ".join(names)


def uniform_section_padding(lines):
    hits = [number for number, line in enumerate(lines, 1) if SECTION_PADDING_PATTERN.search(line)]
    if len(hits) >= 3:
        yield hits[0], "layout", "uniform section padding", f"{len(hits)} sections with py-20, py-24 or py-32"


def black_page_background(lines):
    text = "\n".join(lines)
    for match in DARK_ROOT_CSS_PATTERN.finditer(text):
        yield text[:match.start()].count("\n") + 1, "dark", "black page background", match.group(1)


def hover_lifts(lines):
    text = "\n".join(lines)
    for match in HOVER_LIFT_CSS_PATTERN.finditer(text):
        yield text[:match.start()].count("\n") + 1, "motion", "hover lift", " ".join(match.group(0).split())[-40:]


def monospace_body(lines):
    text = "\n".join(lines)
    for match in MONO_BODY_CSS_PATTERN.finditer(text):
        yield text[:match.start()].count("\n") + 1, "type", "monospace body", match.group(0)[:60]


FILE_CHECKS = [
    cream_and_terracotta,
    monospace_body,
    hover_lifts,
    stock_section_order,
    uniform_section_padding,
    black_page_background,
    buzzword_cluster,
    em_dash_density,
]


# ---------------------------------------------------------------------------
# The decisions file, walking the site, and reporting


class ConfigError(Exception):
    pass


CONFIG_NAME = ".ooer-design.json"

# A generated file says so in its first few lines. Tells found in one are
# fixed in whatever it is generated from, so the report points that out.
GENERATED_PATTERN = re.compile(
    r"@generated|\bauto-?generated\b|\bgenerated (?:from|by)\b|\bdo not edit\b", re.IGNORECASE
)
GENERATED_HEADER_LINES = 5


def load_config(path):
    """Read the decisions file, or return an empty one if there is none.

    A keep with no reason is refused, because a finding hidden without a
    reason is one nobody can later tell was decided rather than forgotten.
    """
    if not os.path.isfile(path):
        return {"exclude": [], "keep": []}
    try:
        with open(path, encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError) as error:
        raise ConfigError(f"{path}: {error}")
    if not isinstance(config, dict):
        raise ConfigError(f"{path}: expected an object at the top level")
    exclude = config.get("exclude", [])
    keep = config.get("keep", [])
    if not isinstance(exclude, list) or not all(isinstance(e, str) for e in exclude):
        raise ConfigError(f"{path}: 'exclude' must be a list of file patterns")
    if not isinstance(keep, list):
        raise ConfigError(f"{path}: 'keep' must be a list")
    for number, entry in enumerate(keep, 1):
        if not isinstance(entry, dict) or not isinstance(entry.get("match"), str):
            raise ConfigError(f"{path}: keep entry {number} needs a 'match'")
        if not str(entry.get("reason", "")).strip():
            raise ConfigError(f"{path}: keep entry {number} ({entry['match']}) needs a 'reason'")
    return {"exclude": exclude, "keep": keep}


def is_excluded(relative, patterns):
    relative = relative.replace(os.sep, "/")
    return any(fnmatch.fnmatch(relative, pattern) for pattern in patterns)


def keep_for(finding, keeps):
    for entry in keeps:
        if entry["match"].lower() != finding["match"].lower():
            continue
        if entry.get("category") and entry["category"] != finding["category"]:
            continue
        if entry.get("file") and not is_excluded(finding["file"], [entry["file"]]):
            continue
        return entry
    return None


def is_source(name):
    stem, extension = os.path.splitext(name)
    if name in SOURCE_NAMES:
        return True
    if ".min." in name or stem.lower() in SKIPPED_STEMS:
        return False
    return extension.lower() in SOURCE_EXTENSIONS


def source_files(root, exclude=()):
    if os.path.isfile(root):
        yield root
        return
    for directory, subdirectories, files in os.walk(root):
        subdirectories[:] = sorted(d for d in subdirectories if not is_skipped_directory(d))
        for name in sorted(files):
            path = os.path.join(directory, name)
            if exclude and is_excluded(os.path.relpath(path, root), exclude):
                continue
            if is_source(name):
                yield path


def decide(finding, keeps):
    entry = keep_for(finding, keeps)
    finding["kept"] = entry is not None
    if entry:
        finding["reason"] = entry["reason"]
    return finding


def scan(root, config=None):
    """Every tell under root, each marked as kept or not and generated or not."""
    config = config or {"exclude": [], "keep": []}
    findings = []
    animated, guarded = [], False
    for path in source_files(root, config["exclude"]):
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as error:
            print(f"skipped {path}: {error}", file=sys.stderr)
            continue
        relative = os.path.relpath(path, root) if os.path.isdir(root) else path
        lines = text.split("\n")
        generated = any(GENERATED_PATTERN.search(line) for line in lines[:GENERATED_HEADER_LINES])
        raw = []
        for number, line in enumerate(lines, 1):
            # Very long lines are built or inlined output, not source.
            if len(line) > 2000:
                continue
            for category, snippet in scan_line(line):
                raw.append((number, category, snippet, None))
        for check in FILE_CHECKS:
            raw.extend(check(lines))
        if ANIMATES_PATTERN.search(text):
            animated.append(relative)
        if REDUCED_MOTION_PATTERN.search(text):
            guarded = True
        for number, category, snippet, detail in sorted(raw, key=lambda r: r[0]):
            finding = {
                "category": category,
                "file": relative,
                "line": number,
                "match": snippet,
                "generated": generated,
            }
            if detail:
                finding["detail"] = detail
            findings.append(decide(finding, config["keep"]))
    if animated and not guarded:
        findings.append(decide({
            "category": "motion", "file": animated[0], "line": 1,
            "match": "no reduced-motion guard",
            "detail": f"{len(animated)} files animate and none honours prefers-reduced-motion",
            "generated": False,
        }, config["keep"]))
    return findings


def stale_keeps(findings, keeps):
    """Keep entries that matched nothing, so that old decisions do not pile up."""
    return [entry for entry in keeps if not any(keep_for(f, [entry]) for f in findings)]


def describe(finding):
    suffix = "  (generated)" if finding["generated"] else ""
    detail = f": {finding['detail']}" if finding.get("detail") else ""
    return f"  {finding['file']}:{finding['line']}  {finding['match']}{detail}{suffix}"


def report(findings, stale=()):
    open_findings = [f for f in findings if not f["kept"]]
    kept = [f for f in findings if f["kept"]]
    lines = []
    for category, title in CATEGORIES.items():
        mine = [f for f in open_findings if f["category"] == category]
        if not mine:
            continue
        lines.append(f"{title} ({len(mine)})")
        lines.extend(describe(f) for f in mine)
        lines.append("")
    if kept:
        lines.append(f"Kept ({len(kept)})")
        lines.extend(f"{describe(f)}  kept: {f['reason']}" for f in kept)
        lines.append("")
    if stale:
        lines.append(f"Kept in {CONFIG_NAME} but no longer matches anything ({len(stale)})")
        lines.extend(f"  {entry['match']}  {entry.get('file', '')}".rstrip() for entry in stale)
        lines.append("")
    if open_findings:
        lines.append(f"{len(open_findings)} tells in {len({f['file'] for f in open_findings})} files.")
    else:
        lines.append("No AI design tells found.")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", nargs="?", default=".", help="directory or file to scan")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    parser.add_argument("--strict", action="store_true", help="exit 1 if anything not kept is found")
    parser.add_argument("--config", help=f"decisions file (default: {CONFIG_NAME} in the scanned directory)")
    args = parser.parse_args(argv)

    config_path = args.config or (os.path.join(args.path, CONFIG_NAME) if os.path.isdir(args.path) else "")
    try:
        config = load_config(config_path)
    except ConfigError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    findings = scan(args.path, config)
    stale = stale_keeps(findings, config["keep"])
    if args.json:
        print(json.dumps({"findings": findings, "stale_keeps": stale}, indent=2))
    else:
        print(report(findings, stale))
    return 1 if args.strict and any(not f["kept"] for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
