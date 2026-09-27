# The tells of AI-generated design

Each entry says what the tell looks like, why it reads as generated, and what
to do instead. The ones marked *scanned* are found by `scan.py`. The rest have
to be seen in the markup or on the page.

## Colour

**Beige, cream and oat backgrounds** *(scanned)*. Examples are `#faf7f2`,
`#f5f0e8`, `bg-stone-50` and `bg-amber-50`. Warm off-white became the default
"tasteful" background, so it now signals that nobody chose one.
*Instead:* use pure white or a true neutral grey, or commit to a real colour
that belongs to the brand. If warmth is wanted, carry it in the accent or the
photography, not in a tinted page.

**Purple-to-indigo or purple-to-pink gradients** *(scanned)*. They appear on
buttons, hero text and blobs, and they were the default accent of a generation
of templates. *Instead:* use a flat accent colour. If a gradient is needed,
make it a subtle one within a single hue.

**Gradient text on headlines.** *Instead:* use solid ink, and let the typeface
carry the emphasis.

**Muted grey-on-grey body text** at low contrast. *Instead:* use ink at 4.5:1
or better.

## Type

**Inter, and the usual substitutes** *(scanned)*: Inter Tight, Plus Jakarta
Sans, DM Sans, Poppins, Manrope, Outfit, Geist and Figtree. They are good
fonts, but they are chosen by default. *Instead:* pick faces with a point of
view that suit the subject. Consider a grotesque with character, a serif for
headings, or a mono for a technical product. Check the licence. Free sources
of distinctive faces include Google Fonts beyond its first page, Fontshare,
Velvetyne, the League of Moveable Type and the Collletttivo foundry.

**One weight everywhere, or headings only a little larger than body text.**
*Instead:* use a clear scale with real contrast in size and weight.

**Tight tracking on everything.** *Instead:* tighten only the large display
sizes.

## Shape

**Large rounded corners** *(scanned)*, meaning `rounded-xl` and up, and
`border-radius` of 12px or more on cards, buttons, inputs and images alike.
This soft blob look is the single most recognisable tell. *Instead:* use
square or nearly square corners (0 to 4px) as the system, with round shapes
kept for things that are round in meaning, such as avatars, toggles and
status dots.

**Pill badges**, often above the hero headline and holding text such as
"New: …" or "✨ Introducing". *Instead:* remove the pill, or set the text as a
plain small-caps label.

## Depth

**Soft, diffuse, floating shadows** *(scanned)*, such as `shadow-xl` or
`0 10px 40px rgba(0,0,0,.08)` on every card. *Instead:* use a 1px border, a
background shift or plain space. Keep shadows for things that actually float
above the page: menus, popovers and dialogs.

**Frosted glass** *(scanned)*, meaning `backdrop-blur` on nav bars and cards.
*Instead:* use a solid bar with a bottom rule.

**Glowing blurred colour blobs** behind the hero. *Instead:* remove them. If
the page feels empty, the fix is content or an image, not a blob.

## Layout and composition

**The centred hero stack**: a pill badge, a large centred headline, one line
of grey subcopy, two buttons with one outlined, and a screenshot in a rounded
frame below. *Instead:* left-align the hero, set up an asymmetric grid, lead
with the product or a real image, and use one call to action.

**The three-card feature grid**, where each card has an icon in a tinted
rounded square, a bold title and two lines of text. *Instead:* use a list with
real detail, alternating text and image rows, a table, or fewer features said
properly.

**Lucide or Heroicons icons in tinted circles everywhere.** *Instead:* use
fewer icons, or none, or an icon set with its own character.

**Emoji used as icons or bullets.** *Instead:* remove them.

**Everything centred, with the same spacing between every section.**
*Instead:* vary the rhythm, and align to a grid with a strong left edge.

**The "Trusted by" logo strip in grey** under the hero, with invented logos.
*Instead:* remove it unless the logos are real.

## Copy *(scanned; report it, do not rewrite it unasked)*

"Elevate your …", "seamless", "unlock the power of", "supercharge",
"revolutionise", "effortless", "game-changing", "next-level", "all-in-one
platform", "in today's fast-paced …". *Instead:* offer rewrites that say
specifically what the thing does, for whom, and with what result.
