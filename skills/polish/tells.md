# The tells of AI-generated design

Each entry says what the tell looks like, why it reads as generated, and what
to do instead. Entries marked *scanned* are found by `scan.py`, under the
category named in brackets. The rest have to be seen in the markup or on the
page. The sources at the end are what this catalogue rests on; where a tell
has one source and others disagree, it says so.

Three things the sources agree on shape how to read a scan:

- **No single tell is proof.** Density and clustering are the signal. A
  purple button on its own is a colour; a purple gradient button under a
  pill badge over three icon cards is a template.
- **The tells move.** The 2024 look was purple gradients on white or near
  black, Inter, and rounded cards. As generators were told to avoid that, the
  2026 look became cream, a display serif and a terracotta or sage accent.
  Anthropic's own frontend guidance now bans both, so a third cluster will
  follow. Read the current list as a snapshot.
- **Structure gives it away before colour.** The centred hero, three cards and
  the stock section order are recognised before any hex value.

## Colour

**Indigo, violet or purple accent** *(scanned: purple)*. Tailwind's `indigo-`,
`violet-`, `purple-` and `fuchsia-` classes; hex values such as `#6366f1`,
`#4f46e5`, `#8b5cf6`, `#7c3aed` and `#a855f7`; a `--primary` in HSL or OKLCH
whose hue sits between 237° and 300°. This is the single most-agreed visual
tell, named by about two dozen sources. Adam Wathan made every Tailwind UI
button `bg-indigo-500` in 2019, tutorials copied it, and generators learned
that web buttons are indigo. *Instead:* pick one flat accent from outside that
hue range and set it as a token. If purple genuinely is the brand, pair it
with a neutral that is not slate or zinc, and say so in a keep.

**Beige, cream and oat backgrounds** *(scanned: beige)*. `#faf7f2`, `#f5f0e8`,
`#f4f1ea`, `bg-stone-50`, `bg-amber-50`. Warm off-white became the "tasteful"
background once purple was banned, so it now signals that nobody chose one.
*Instead:* pure white, a true neutral, or a committed colour. If warmth is
wanted, carry it in the accent or the photography.

**The cream, serif and terracotta default** *(scanned: tasteful)*. A cream
ground with a display serif such as Instrument Serif or Fraunces and a clay or
terracotta accent near `#D97757`, sometimes sage. The scanner flags the clay
hexes from Anthropic's own examples outright, and any file that holds both a
cream and a terracotta. Eight sources name it, and it is the only cluster
they describe as rising rather than fading. *Instead:* anchor the palette to
the actual brand, and if it happens to be cream and terracotta, choose each
value with the same care as every other and keep it with a reason.

**Purple-to-blue and purple-to-pink gradients** *(scanned: gradient)*.
`from-indigo-500 to-purple-600`, `from-purple-500 to-pink-500`,
`linear-gradient(135deg, #667eea 0%, #764ba2 100%)`, which is the ChatGPT
gradient in vanilla CSS. Nineteen sources. *Instead:* solid fills; at most one
restrained gradient within a single hue, and only with a reason.

**Gradient text** *(scanned: gradient)*. `bg-clip-text text-transparent` on a
headline, `-webkit-background-clip: text` in CSS. It compromises contrast for
decoration. *Instead:* solid ink, with size and weight for emphasis.

**Untouched shadcn theme** *(scanned: shadcn)*. `--primary: 222.2 47.4% 11.2%`
or `oklch(0.205 0 0)`, `--radius: 0.5rem`, `"baseColor": "slate"` in
`components.json`, the slate-200 hairline on every card. shadcn is the default
kit of v0, Lovable and Bolt, and about a quarter of scanned sites ship its
theme unchanged. *Instead:* edit the tokens once: a real primary, a radius
chosen on purpose, a neutral ramp tuned to the brand.

**Muted grey text below contrast.** `text-gray-400` on white, `text-zinc-500`
on `zinc-950`. *Instead:* ink at 4.5:1 or better, and a contrast gate.

**Pure black with pure white text** *(scanned: dark)*. `bg-black`, `#000`,
`#0a0a0a` on the body, `class="dark"` hard-coded on `<html>`. Dark mode itself
is not the tell; the flat black, the medium-grey body text and the glow are.
*Instead:* a three-layer surface system with a near-black base and off-white
text, or light mode.

## Type

**Inter, and the usual substitutes** *(scanned: font)*. Inter first, then Plus
Jakarta Sans, DM Sans, Poppins, Manrope, Outfit, Geist and Figtree, and now the
"tasteful" set: Space Grotesk, Instrument Serif and Sans, Fraunces, General
Sans, Playfair Display, DM Serif, Syne, Sora. Roboto or Arial as the chosen
face, and the `'Segoe UI', Tahoma, Geneva, Verdana` stack, which is the VS
Code snippet default that ChatGPT-era output reproduces. About twenty-two
sources name Inter; the substitutes are the model's next choice when Inter is
banned. *Instead:* a display face and a body face chosen for the subject, with
a stated reason and a checked licence. Sources of distinctive free faces
include Google Fonts beyond its first page, Fontshare, Velvetyne, the League
of Moveable Type and Collletttivo.

**Crushed tracking on a giant centred headline** *(scanned: type)*.
`text-6xl tracking-tight` filling the first screen. *Instead:* a shorter
headline at a smaller size; loosen the tracking, especially on phones.

**The serif-italic accent word** *(scanned: type)*. One word of a sans
headline set in italic serif. Anthropic's guidance lists it as a default to
reject, and one detector calls it a recognisable Claude signature. *Instead:*
hierarchy without isolating single words.

**Monospace body copy** *(scanned: type)*. `font-mono` on the body, so the
whole page reads like a terminal. *Instead:* mono for code and labels only.

**All-caps tracked eyebrow labels** *(scanned: chrome)*. `text-xs uppercase
tracking-widest` above every heading, often with a dot before and a rule
after. Six sources; one calls it "the 'here's the thing' of landing pages".
*Instead:* fold the useful words into the heading, in sentence case.

**Fonts declared but never loaded.** A `font-family` with no `@font-face`,
`@import` or link, so the browser silently falls back. *Instead:* load it, or
remove the declaration.

## Shape

**One large radius on everything** *(scanned: radius)*. `rounded-2xl` on
cards, buttons, inputs and images alike; `border-radius` of 12px or more;
`--radius: 1rem`. Nineteen sources. Uniform softness reads as no hierarchy
because it was generated without one. *Instead:* a small radius scale tied to
hierarchy, with 0 to 4px as the system and larger radii only where a shape
means something, such as avatars and toggles.

**Pill buttons and pill badges** *(scanned: radius, chrome)*. `rounded-full`
on every control; the small pill above the headline saying "✨ Now in beta".
*Instead:* remove the badge; vary button shape with the radius scale.

**Blur blobs, orbs and aurora** *(scanned: backdrop)*. Empty absolute divs with
`rounded-full blur-3xl bg-purple-500/30`; `filter: blur(80px)` on a
pseudo-element; the Tailwind UI hero blob with its `aspect-[1155/678]`
wrapper. One comment study rates blobs as low signal, so weight them below
the palette tells. *Instead:* remove them; if the page then feels empty, the
fix is content or an image.

**Decorative grid, dot and spotlight backgrounds** *(scanned: backdrop)*.
`bg-grid-white/[0.02]`, `bg-[radial-gradient(#e4e4e7_1px,transparent_1px)]`,
`[mask-image:radial-gradient(...)]`, the Aceternity Spotlight and Aurora
components. *Instead:* reserve grids for canvases and maps.

## Depth

**Soft diffuse shadow on every card** *(scanned: shadow)*. `shadow-xl`,
`0 10px 40px rgba(0,0,0,.08)`, often with a hairline border defining the same
edge twice. Fourteen sources. *Instead:* edge or shadow, not both; shadows
only for things that float, such as menus and dialogs.

**Coloured glow and neon** *(scanned: glow)*. `shadow-[0_0_40px_rgba(139,92,246,0.5)]`,
`box-shadow: 0 0 20px` in a colour, `text-shadow` in cyan, `--shadow-glow`.
"Dark mode itself is fine; glow is the tell." *Instead:* emphasis by spacing,
contrast or a heading; one accent per viewport.

**Frosted glass** *(scanned: glass)*. `backdrop-blur` on nav bars and cards;
`bg-white/10 border border-white/20`. Twelve sources. *Instead:* solid
surfaces; blur only for overlays that genuinely layer, and at 5px.

**Gradient and glowing borders.** `border-image: linear-gradient`, the 1px
gradient wrapper trick, BorderBeam. *Instead:* spacing and type.

**The card kit** *(scanned: card)*. An icon in a tinted rounded square above
the card heading; a 4px coloured stripe down the left edge, which two sources
call the single most reliable tell; the stock shadcn card class string;
cards nested in cards. *Instead:* the icon beside the heading or gone; no
stripe unless it marks a real status; one card primitive, used once.

## Icons and imagery

**Emoji as the icon system** *(scanned: emoji)*. 🚀 ✨ ⚡ 🔒 💡 ✅ 🎯 in card
headings, bullets, nav and badges. Seven sources; v0's own prompt now bans it.
*Instead:* one SVG set with one style, or no icons.

**The worn Lucide set and the sparkle** *(scanned: icon)*. `Sparkles`, `Zap`,
`Rocket`, `Wand2` imported from lucide-react, a `✦` for anything called AI,
Font Awesome by CDN. v0, Lovable and Bolt all mandate lucide-react, so the
presence of Lucide is not the tell; the reflex set is. *Instead:* fewer icons,
or a set with character; never a sparkle unless the product literally
generates.

**Stock photo under a dark scrim** *(scanned: imagery)*. `absolute inset-0
bg-black/50` over an Unsplash or Pexels hero. The scrim is the tell more than
the photo: it is the reflex for guaranteeing contrast over an image the model
did not choose. *Instead:* imagery with its own contrast, or none.

**Hyperreal AI people, plastic 3D blobs, undraw-style scenes** *(scanned:
imagery, by asset name only)*. *Instead:* real product screenshots, real
people, commissioned illustration.

**Generic alt text** *(scanned: alt)*. `alt="hero image"`, `alt="image"`,
`alt="icon"`. *Instead:* describe the content, or `alt=""` for decoration.

## Layout and composition

**The centred hero stack.** A pill badge, a giant centred headline, one grey
line, two buttons with one outlined, and a screenshot in a rounded frame.
Sixteen sources. The scanner sees its parts; the whole is seen on the page.
*Instead:* left-align, set up an asymmetric grid, lead with the product, one
call to action.

**Three identical feature cards** *(scanned: layout)*. `md:grid-cols-3`, each
card an icon, a two-word Title Case heading and two generic sentences, the
same grid reused for "Benefits" and "Why us". Twenty-one sources; it is the
grid Tailwind tutorials used to demonstrate a grid. *Instead:* unequal
emphasis, a list with real detail, or fewer features said properly.

**Bento by reflex** *(scanned: layout)*. `col-span-2 row-span-2` tiles holding
six blurbs of the same weight. Six sources, with one dissent that rates it
low. The deletion test: if any tile can go and the section reads the same,
the sizes carried nothing. *Instead:* bento only when the tiles are genuinely
different kinds of thing.

**The stock section order** *(scanned: layout, when five or more markers run
in order)*. Hero, logo strip, features, how it works, stats, testimonials,
pricing, FAQ, closing call to action, four-column footer. Nine sources; one
notes it is the weakest single signal because human marketers use it too.
*Instead:* sections that follow the product's actual argument, and none that
have no real content.

**Uniform generous padding and everything centred** *(scanned: layout)*.
`py-24` on every section, `text-center` throughout. *Instead:* a density
target, and a strong left edge.

**Numbered 01 / 02 / 03 markers** *(scanned: chrome)*. Beside headings or in a
three-step row when nothing is sequential. *Instead:* number only real steps.

**The pulsing status dot** *(scanned: chrome)*. `animate-pulse rounded-full
h-2 w-2` next to "All systems operational". *Instead:* a still dot.

**The fake macOS window chrome** *(scanned: chrome)*. Three dots in
`#ff5f57`, `#febc2e`, `#28c840` above a screenshot. *Instead:* the screenshot.

## Motion

**Fade-up on scroll on every section** *(scanned: motion)*. `data-aos="fade-up"`,
Framer `initial={{ opacity: 0, y: 20 }} whileInView`, `animate-fade-in-up`,
`@keyframes fadeInUp`. Ten sources; Anthropic's guidance names it as the
generic default. Its failure mode is content stuck at opacity 0 for crawlers
and screenshots. *Instead:* content visible by default; motion only where it
explains something.

**Hover lift on every card** *(scanned: motion)*. `hover:-translate-y-1
hover:shadow-xl`, `:hover { transform: translateY(-5px) }`, `hover:scale-105`.
*Instead:* hover only where it explains function.

**`transition: all 0.3s ease`** *(scanned: motion)*. The default transition of
vanilla generated CSS. *Instead:* one property, one duration, chosen.

**Marquees, typewriters, count-ups, animated gradients, bounce easing**
*(scanned: motion, stat)*. `animate-marquee`, `TypewriterEffect`,
`react-countup`, `animate-gradient`, `cubic-bezier(0.68, -0.55, 0.265, 1.55)`,
and the Aceternity and Magic UI effects dropped in unchanged. *Instead:* one
orchestrated page load if any; static numbers; a quick settle.

**No reduced-motion guard** *(scanned: motion, once per site)*. Animations
with no `prefers-reduced-motion` query, `motion-safe:` or `useReducedMotion`
anywhere. *Instead:* honour it.

## Scaffolding and fingerprints

**Section comments and TODOs** *(scanned: scaffold)*. `<!-- Hero Section -->`,
`{/* Features Section */}`, `TODO: replace with real testimonials`. *Instead:*
strip them.

**Starter leftovers** *(scanned: scaffold)*. `cdn.tailwindcss.com` in a shipped
page, Vite's `#646cff`, create-next-app's `#0a0a0a` and `#ededed`, "Get
started by editing", Bolt's "Start prompting (or editing)", Astro's
`#3245ff → #bc52ee`. *Instead:* delete the starter.

**Builder badges and fingerprints** *(scanned: badge)*. "Made with Lovable",
"Built with v0", `gptengineer.js`, `lovable-tagger`, `my-v0-project`,
`replit-dev-banner`, a `*.lovable.app` or `*.vercel.app` domain, Lovable's
`--shadow-elegant` and `--transition-smooth` tokens. Near-certain when
present. *Instead:* a custom domain and no badge.

## Copy

**Placeholders left in** *(scanned: placeholder)*. Lorem ipsum, "Your
Company", "John Doe", `you@example.com`, `+1 (555) 123-4567`, "123 Main
Street", `[Insert testimonial here]`, placehold.co and pravatar images,
`<title>My App</title>`, "Coming soon", a copyright year that is not this
year, the fake logo names Globex, Initech and Hooli. The strongest greppable
class. *Instead:* delete the section rather than leave a placeholder.

**Dead links** *(scanned: link)*. `href="#"`, `javascript:void(0)`, a social
icon pointing at `https://twitter.com`. *Instead:* remove the link or the
section.

**Fake testimonials** *(scanned: testimonial)*. First name and initial
("Sarah M."), the names generators reach for (Sarah Chen, Marcus Chen, Elena
Vasquez, Elara Voss, Aris Thorne, Sarah Johnson, Michael Chen), "CEO,
TechCorp", "This changed my life", five gold stars on every card, avatar
services. Eight sources. *Instead:* full name, role, company, a real photo
and a specific outcome, embedded from a review platform where possible; or
no testimonials.

**Fabricated statistics** *(scanned: stat)*. "10,000+ happy customers",
"99.9% uptime", "4.9/5", "24/7 support", "10x faster", counting up on scroll.
*Instead:* only sourced numbers, with the source; otherwise no row.

**The "Trusted by" logo strip** *(scanned: stock, placeholder)*. Grey logos
under the hero, invented or unlicensed, often in a marquee. *Instead:* named
customers with permission, or nothing. "Empty is better than fake."

**Generic calls to action** *(scanned: cta)*. "Get Started", "Learn More",
"Start Your Journey", "Click Here", with an arrow welded on. *Instead:* an
outcome and an object: "Start my 14-day trial", "See pricing for 5 seats".

**Stock section headings** *(scanned: stock)*. "Everything you need",
"Powerful features", "Why choose us?", "What our customers say", "Simple,
transparent pricing", "Frequently asked questions" with "Is there a free
trial?" and "Can I cancel anytime?", "Ready to get started?", "Most Popular".
*Instead:* headings that say something specific.

**Generated-sounding phrases** *(scanned: copy)*. The time-based opener ("In
today's fast-paced world"), the negation pivot ("It's not just X, it's Y",
which two sources rank the single strongest writing tell), verb cosplay
("Elevate your workflow", "Unlock the power of", "Empower your team"),
throat-clearing ("It's important to note", "At its core"), hooks ("Picture
this", "Let's dive in"), significance inflation ("stands as a testament"),
the why-us claims ("passionate about", "committed to excellence"), the
risk-reducer triplet ("No credit card · Cancel anytime · 14-day trial"), and
chatbot register or markup leaking through ("Certainly!", "Great question",
`citeturn0search0`, `utm_source=chatgpt.com`). *Instead:* say the specific
thing, to the one audience, with a number where there is one. Rewriting copy
is the user's call: report it and offer rewrites.

**Buzzword clusters** *(scanned: buzzword, once per file at four or more
distinct words)*. Seamless, robust, cutting-edge, leverage, empower,
effortless, intuitive, scalable, delve, tapestry, testament, and the rest.
One is a word; four in a file is the register. *Instead:* the plain verb and
the object it acts on.

**Em dash density** *(scanned: dash, once per file at five or more, and any
em dash in a button or heading)*. Contested as a tell on its own; agreed as a
tell in bulk and in labels. *Instead:* commas, full stops and colons; one per
paragraph at most.

**The rule of three, uniform sentence length, Title Case Everywhere,
questions as headings, emoji bullets.** Seen rather than scanned, beyond the
emoji. *Instead:* two or four; vary the rhythm; sentence case; headings that
contain the answer.

## Sources

The three research passes behind this catalogue read about a hundred pages
in September 2026. The ones the entries above lean on most:

- Wikipedia, "Signs of AI writing": https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- Slop Detector's word list, with the corpus studies behind it: https://slopdetector.org/blog/ai-words-list
- Matthew Vollmer, "I asked the machine to tell on itself": https://matthewvollmer.substack.com/p/i-asked-the-machine-to-tell-on-itself
- CopyAdsContent, 32 signs of AI writing: https://copyadscontent.com/signs-of-ai-writing/
- avoid-ai-writing, a tiered list with the markup artefacts: https://github.com/conorbronsdon/avoid-ai-writing
- avoid-ai-design, a 67-rule scanner whose regexes several checks here follow: https://github.com/funboy322/avoid-ai-design
- Adrian Krebs, design slop measured over 1,590 Show HN pages: https://www.adriankrebs.ch/blog/design-slop/
- Developers Digest, sixteen visual tells: https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it
- Impeccable, a 63-item slop vocabulary: https://impeccable.style/slop/
- Unslop UI, the richest single catalogue, with the "cleared by data" list: https://www.claudecodehq.com/playbooks/unslop-ui
- Anthropic's frontend-design skill, which bans both palette clusters: https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md
- Alan West on Tailwind's indigo-500: https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- Jack Pearce on the shift from purple to cream: https://www.jackpearce.co.uk/notes/purple-gradient-ai-aesthetics/
- 925 Studios, the tells and the guide: https://www.925studios.co/blog/ai-slop-design-tells and https://www.925studios.co/blog/ai-slop-web-design-guide
- uxskill, nine signs and the bento essay: https://uxskill.laithjunaidy.com/how-to-tell-if-a-website-was-ai-generated.html
- TeneX, eight signs from an audit: https://tenex.studio/en/blog/ai-slop-ui-8-signes/
- Solo Design, the tells and a 50-rule detector: https://solodesign.cc/blog/ai-design-slop-the-tells/
- checkvibe and hustletoai on vibe-coded fingerprints: https://checkvibe.dev/blog/how-to-tell-if-a-website-is-vibe-coded and https://www.hustletoai.com/blog/programming-7/how-to-tell-if-a-website-is-vibe-coded-120
- Was It Vibed, 46 named signals: https://wasitvibed.com/
- fakelogo.com, on the "Trusted by" row: https://fakelogo.com/
- The Augmented Educator on the names generators reuse: https://www.theaugmentededucator.com/p/the-problem-with-dr-sarah-chen
- Ben Guttmann on the sparkle: https://www.benguttmann.com/blog/sparkles-mean-ai-now-emoji-gpt-symbol
- Raxxo Studios on dark mode: https://dev.to/raxxostudios/dark-mode-design-that-doesnt-look-ai-2cn3
- shadcn's theming defaults: https://ui.shadcn.com/docs/theming
- The leaked v0, Lovable and Bolt prompts, for what the generators are told to do: https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools
