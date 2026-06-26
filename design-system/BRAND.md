# Alara Design Truth

**The design source of truth is this document + `tokens.css` — the palette and the look we
decided together.** Notion is NOT the design record. (Notion's older "Black and Gold" brief is
superseded; Notion is used only for *copy* — see "What Notion is for" below.)

## Palette — the only colors (owner-confirmed)
| Token | Hex | Role |
|---|---|---|
| espresso | `#342E2E` | primary text, dark sections, links |
| taupe | `#817A7A` | secondary text (large), keylines, dividers |
| greige | `#D9D8D3` | surfaces, arch fills, the "Mediterranean" tone |
| mist | `#E8E8E8` | alternate section tint |
| paper | `#FBFBFB` | page background |

No gold in the interface. **No blue. No clinical brightness.** Warmth comes from the
**photography** (travertine arches, the brass door), never from UI color.

## The look we decided together
- **Warm-neutral and minimal.** The five palette colors carry the whole system.
- **Typography-forward, generous white space.** Calm, exact, premium. `--section-y`
  `clamp(72px,9vw,144px)`, gutter `clamp(24px,6vw,80px)`.
- **Arch as a system.** The logo's doorway is an arch → carry it through: hero photograph,
  arched card tops, section transitions, the favicon mark. Logo → architecture → UI.
- **Typography:** thin, wide-tracked geometric caps for the wordmark + labels (web match
  **Jost Light**); **Inter** for headings and body (legible, senior-friendly). No serif.
- **High-end private clinic, not a hospital.** Restraint over decoration: hairlines, not
  shadows. The photography is the richness; the UI gets out of its way.
- **Logo:** house mark whose doorway is an arch; thin wide-tracked "ALARA / HOME CARE."
  Rebuilt as scalable vector at `public/logo.svg`.

## Accessibility (non-negotiable)
WCAG 2.2 AA contrast on the neutral pairs, 17px base body, 48px tap targets, underlined
links, focus-visible rings. Sections must read cleanly at **375px**.

## What Notion IS for (copy only, not design)
- **Approved homepage copy** (Homepage Copy FINAL): hero headline "Las Vegas Home Health Built
  for White Card Patients, Veterans, and Seniors Who Need More Than a Visit." · subhead
  "DON-led. Locally owned. We handle all the paperwork. Most patients pay nothing." · CTAs
  "Find Out If You Qualify — Free 10 Minute Call" / "Refer a Patient" · audiences (Nevada Test
  Site & DOE Workers · Veterans · Medicare/Seniors) · founder bar (female-founded, "our
  founder") · phone-only contact ("Tell us your number. We'll call you." / "Call Me") · NAP
  "Serving all of Clark County, Nevada" · one-hour response.
- **Voice:** no em dashes, no AI-sounding structure; calm, warm, exact; no hype.

## Reconciliation log (so we don't loop)
gold/cream guess → neutral palette (owner swatches) → Notion "Black and Gold" pulled gold
back in → **reverted.** Final: **neutral five-color palette + the co-decided look; warmth from
photography; no gold in the UI.**
