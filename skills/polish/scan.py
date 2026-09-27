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
"""

import argparse
import colorsys
import fnmatch
import json
import os
import re
import sys

SOURCE_EXTENSIONS = {
    ".css", ".scss", ".sass", ".less", ".styl",
    ".html", ".htm", ".vue", ".svelte", ".astro",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mdx",
}

SKIPPED_DIRECTORIES = {
    "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
    ".svelte-kit", ".astro", ".vercel", ".turbo", "vendor", "coverage",
}

# Fonts that a generator reaches for when nobody chose one. Inter is the
# loudest tell; the rest are the usual substitutes when Inter is avoided.
DEFAULT_FONTS = [
    "Inter", "Inter Tight", "Plus Jakarta Sans", "DM Sans", "Poppins",
    "Manrope", "Outfit", "Geist", "Figtree",
]

# CSS named colours that are beige or cream by definition.
BEIGE_NAMES = [
    "beige", "linen", "oldlace", "ivory", "cornsilk", "antiquewhite",
    "floralwhite", "seashell", "bisque", "blanchedalmond", "papayawhip",
    "wheat", "navajowhite", "moccasin",
]

CATEGORIES = {
    "font": "Default font",
    "beige": "Beige or cream colour",
    "radius": "Large rounded corners",
    "gradient": "Purple or indigo gradient",
    "shadow": "Soft oversized shadow",
    "glass": "Frosted glass",
    "copy": "Generated-sounding copy",
}

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
TAILWIND_FONT_PATTERN = re.compile(r"\bfont-(inter|jakarta|dm-sans|poppins|manrope|geist)\b")

HEX_PATTERN = re.compile(r"(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
RGB_PATTERN = re.compile(r"\brgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})")
HSL_PATTERN = re.compile(r"\bhsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%")
BEIGE_NAME_PATTERN = re.compile(
    r"(?:[:\s,(]|^)(" + "|".join(BEIGE_NAMES) + r")\b(?![-\w])", re.IGNORECASE
)
TAILWIND_BEIGE_PATTERN = re.compile(
    r"\b(?:bg|from|via|to|border|ring|fill)-(?:stone-(?:50|100|200)|amber-(?:50|100)|orange-50|yellow-50|neutral-50)\b"
)

# Radii are also set as tokens: a custom property such as shadcn's --radius,
# or a borderRadius entry in a Tailwind config written on one line.
RADIUS_PATTERN = re.compile(
    r"(?:\bborder(?:-[a-z]+)*-radius|--[\w-]*radius[\w-]*|\bborderRadius)\s*:\s*([^;}\n]+)",
    re.IGNORECASE,
)
TAILWIND_RADIUS_PATTERN = re.compile(r"\brounded(?:-[trblse]{1,2})?-(xl|2xl|3xl|4xl)\b")
LENGTH_PATTERN = re.compile(r"(\d*\.?\d+)\s*(px|rem|em)\b")
SHADOW_LENGTH_PATTERN = re.compile(r"(?<![\w.])-?(\d*\.?\d+)(px|rem|em)?(?![\w.%])")

GRADIENT_PATTERN = re.compile(r"\b(?:linear|radial|conic)-gradient\(([^;]*)", re.IGNORECASE)
TAILWIND_GRADIENT_PATTERN = re.compile(
    r"\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b"
)

SHADOW_PATTERN = re.compile(r"\bbox-shadow\s*:\s*([^;}\n]+)", re.IGNORECASE)
TAILWIND_SHADOW_PATTERN = re.compile(r"\bshadow-(xl|2xl)\b")

GLASS_PATTERN = re.compile(r"\bbackdrop-filter\s*:\s*[^;]*blur|\bbackdrop-blur(?:-\w+)?\b", re.IGNORECASE)

COPY_PATTERN = re.compile(
    r"\b(elevate your|seamless(?:ly)?|unlock the (?:power|potential)|supercharge|"
    r"revolutioni[sz]e|effortless(?:ly)?|game[- ]chang(?:er|ing)|next[- ]level|"
    r"all-in-one platform|built for the future|in today's fast-paced)\b",
    re.IGNORECASE,
)

# A radius at or above this reads as the soft pill-and-card look rather than
# a considered corner. 12px is where Tailwind's rounded-xl begins.
LARGE_RADIUS_PX = 12
# A shadow blur at or above this is the diffuse floating-card shadow.
LARGE_BLUR_PX = 20


def hex_to_rgb(digits):
    if len(digits) in (3, 4):
        digits = "".join(c * 2 for c in digits[:3])
    return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4))


def is_beige(r, g, b):
    """Warm, light and only faintly tinted: the cream and oat backgrounds.

    Tint is measured as chroma, the gap between the strongest and weakest
    channel, because HSL saturation climbs to 100% for any pale colour and
    would call a strong yellow and a whisper of cream the same thing. Pure
    white and greys have no chroma and are left alone.
    """
    hue, lightness, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    chroma = max(r, g, b) - min(r, g, b)
    return 20 <= hue * 360 <= 65 and 6 <= chroma <= 70 and lightness >= 0.85


def is_purple(r, g, b):
    hue, lightness, saturation = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return 235 <= hue * 360 <= 300 and saturation >= 0.35 and 0.25 <= lightness <= 0.8


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


def to_px(value, unit):
    return abs(float(value)) * (16 if unit in ("rem", "em") else 1)


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


def regex_tell(category, pattern, group=0):
    """A checker for a tell that one regular expression finds outright.

    Most tells are this simple. The ones below that measure something, such
    as a colour's warmth or a corner's size, are written out by hand.
    """
    def check(line):
        for match in pattern.finditer(line):
            yield category, match.group(group)
    return check


def beige_colours(line):
    for snippet, rgb in colours_in(line):
        if is_beige(*rgb):
            yield "beige", snippet


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
        if any(blur >= LARGE_BLUR_PX for blur in shadow_blurs(value)):
            yield "shadow", "box-shadow: " + value[:50]


# Every checker, in the order their findings are reported within a line. A
# new tell is a regex_tell here, or a function above if it has to measure.
CHECKS = [
    regex_tell("font", FONT_PATTERN, 1),
    regex_tell("font", FONT_IMPORT_PATTERN, 1),
    regex_tell("font", TAILWIND_FONT_PATTERN, 1),
    beige_colours,
    regex_tell("beige", BEIGE_NAME_PATTERN, 1),
    regex_tell("beige", TAILWIND_BEIGE_PATTERN),
    large_radii,
    regex_tell("radius", TAILWIND_RADIUS_PATTERN),
    purple_gradients,
    regex_tell("gradient", TAILWIND_GRADIENT_PATTERN),
    soft_shadows,
    regex_tell("shadow", TAILWIND_SHADOW_PATTERN),
    regex_tell("glass", GLASS_PATTERN),
    regex_tell("copy", COPY_PATTERN),
]


def scan_line(line):
    """Return (category, snippet) for every tell on one line."""
    found = []
    for check in CHECKS:
        found.extend(check(line))
    return found


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


def source_files(root, exclude=()):
    if os.path.isfile(root):
        yield root
        return
    for directory, subdirectories, files in os.walk(root):
        subdirectories[:] = sorted(d for d in subdirectories if d not in SKIPPED_DIRECTORIES)
        for name in sorted(files):
            if ".min." in name:
                continue
            path = os.path.join(directory, name)
            if exclude and is_excluded(os.path.relpath(path, root), exclude):
                continue
            if os.path.splitext(name)[1].lower() in SOURCE_EXTENSIONS:
                yield path


def scan(root, config=None):
    """Every tell under root, each marked as kept or not and generated or not."""
    config = config or {"exclude": [], "keep": []}
    findings = []
    for path in source_files(root, config["exclude"]):
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                generated = False
                for number, line in enumerate(handle, 1):
                    if number <= GENERATED_HEADER_LINES and GENERATED_PATTERN.search(line):
                        generated = True
                    # Very long lines are built or inlined output, not source.
                    if len(line) > 2000:
                        continue
                    for category, snippet in scan_line(line):
                        finding = {
                            "category": category,
                            "file": os.path.relpath(path, root) if os.path.isdir(root) else path,
                            "line": number,
                            "match": snippet,
                            "generated": generated,
                        }
                        entry = keep_for(finding, config["keep"])
                        finding["kept"] = entry is not None
                        if entry:
                            finding["reason"] = entry["reason"]
                        findings.append(finding)
        except OSError as error:
            print(f"skipped {path}: {error}", file=sys.stderr)
    return findings


def stale_keeps(findings, keeps):
    """Keep entries that matched nothing, so that old decisions do not pile up."""
    return [entry for entry in keeps if not any(keep_for(f, [entry]) for f in findings)]


def describe(finding):
    suffix = "  (generated)" if finding["generated"] else ""
    return f"  {finding['file']}:{finding['line']}  {finding['match']}{suffix}"


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
