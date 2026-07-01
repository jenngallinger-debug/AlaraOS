# Site navigation — information architecture (owner-locked)

**Principle:** Reality is the spine. People arrive asking "can these people help me?", not
"tell me about the corporation." Navigation answers their questions in their order:
*how does this work → will it work for me → what should I know → why you → refer.*
Programs are **not** the top-level skeleton; they are how we answer a qualification question.
The White Card is strategically first under Programs, one click from every page, but it is not
the organizing principle of the site.

## Primary navigation

`Get Care · Programs · Learn · Why Alara · Refer a Patient` + CTA **See if You Qualify**
(Home = the logo. **About is removed from the main nav** — supporting content, not a buying
question. "Services" is retired as a label — every agency has "services"; it says nothing.)

## The four menus, with destination mapping

Legend: **✓ live** = an existing page/section · **NEW** = content to build.

### Get Care — "How does this work?"
| Item | Destination |
|---|---|
| Home Health | services.html ✓ (becomes the Get Care landing) |
| What to Expect | NEW (the visit-by-visit / first-week walkthrough) |
| How We Help | NEW (or a Get-Care section) |
| Family Caregivers | NEW (paid-caregiver explainer; content seeds exist on white-card) |
| Choosing Home Health | NEW (buyer's guide article) |

### Programs — "Will this work for me?"  (fully buildable now)
| Item | Destination |
|---|---|
| White Card (EEOICPA) | white-card.html ✓ |
| &nbsp;&nbsp;└ Nevada Test Site | nevada-test-site.html ✓ |
| VA Community Care | programs.html#community-care ✓ (own page later) |
| OWCP / FECA | owcp.html ✓ |
| Medicare | NEW (short program page) |
| Other Coverage | programs.html ✓ |
| Not sure? Find Your Program | qualify.html ✓ (the Navigator) |

### Learn — "What should I know?"  ("Learn," never "Library")
| Item | Destination |
|---|---|
| Articles | NEW (article index) |
| Guides | NEW (guide index; White Card Guide is the first entry) |
| FAQs | NEW (or aggregate existing page FAQs) |
| Understanding Home Care | NEW |
| White Card Guide | white-card.html ✓ |
| Family Resources | NEW |

### Why Alara — "Why are you different?"  (this is where AlaraOS lives, not "About")
| Item | Destination |
|---|---|
| Our Approach | NEW (or from about.html) |
| AlaraOS | inside-alaraos.html ✓ |
| Our Team | about.html ✓ (team/founder section) |
| Stories | NEW (patient stories) |

### Refer a Patient
Stays visible as a primary item. → begin.html?who=referrer ✓

## Build phasing

- **Phase 1 (now):** New top-level labels + the **Programs dropdown** (fully buildable, highest
  strategic value) live across all pages, desktop + mobile. Get Care / Learn / Why Alara ride
  their existing landing pages (services / learn, and Why Alara → the AlaraOS + team content)
  until their subpages exist, so no menu points to an empty room.
- **Phase 2:** Build the NEW subpages (What to Expect, Family Caregivers, the Learn index,
  Medicare, Stories, Our Approach), then light up their dropdowns.

Shared assets: dropdown styling in `site.css`, dropdown behavior in `site-nav.js` (both already
shared across pages); only the header markup is duplicated per page and must be updated in each.
