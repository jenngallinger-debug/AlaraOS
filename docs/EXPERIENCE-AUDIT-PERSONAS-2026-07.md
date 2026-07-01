# Full Experience Audit — Personas, Journeys, Touchpoints, Fallout
**July 2026.** Eight personas across the three stakeholder groups walked the live site
page by page (four independent auditors + a mechanical link/CTA sweep of all 54 pages,
1,951 internal links). This document: the personas, what they experienced, where the
experience is excellent, where it leaks, and — per the owner's request — a **touchpoint
map** (where we can capture) and a **fallout map** (where people fall out, the recovery
move, and the analytics event that makes each leak measurable).

---

## 1. The personas

### Patients
| | Who | Situation | Entry | Finish line |
|---|---|---|---|---|
| **Earl, 78** | Test Site pipefitter, Henderson | HAS the White Card; nobody told him it covers home care; leg wound not healing | Google → what-does-the-white-card-cover-at-home article; flyer → homepage | Care started (begin/case review) or "doctor, send the referral to Alara" |
| **Vern, 81** | Card holder, Las Vegas | Has home health with a competitor: rotating traveling nurses, hours cut 6→4 at renewal | Google → switching article; → care-hours | Case review / call-back; belief hours can be restored |
| **Dorothy, 74** | Widow, Boulder City | Husband Gene machined at the Test Site, died of lung cancer 2019; no claim ever filed; scam-wary, paperwork-afraid | Google → survivor article; niece sends homepage link | Case review (survivor path) feeling safe; Resource Center understood |
| **Frank, 72** | Army veteran, COPD, N. Las Vegas | Wants help at home "through the VA" — but Alara can't bill the VA yet | Google → veterans.html | Call-back / crossover check, or a clear VA script + Alara remembered |

### Families
| | Who | Situation | Entry | Finish line |
|---|---|---|---|---|
| **Melissa, 52** | Daughter of a card holder, Henderson | 1:45 a.m., phone, dad just fell on 4 hrs/day of care; exhausted, guilty | Google → more-hours article / care-hours; homepage 2 a.m. section | Uses a tool tonight; knows the exact 8 a.m. move |
| **David, 48** | Son in Denver | Dad, 80, card holder in **Pahrump**; fraud-aware researcher, three agency tabs open | Google → choosing-an-agency flagship; about/inside-alaraos | Sends the referral himself from out of state |

### Professionals
| | Who | Situation | Entry | Finish line |
|---|---|---|---|---|
| **Gina, 58** | Internist's office manager, LV | Patient asked for home health; doctor has never filed an EE-17B, fears unpaid time + liability | Google → LMN article; family said "look up Alara" → refer | Referral sent with "Need help with the LMN / order" |
| **Norma, 45** | Hospital discharge planner | White Card patient discharges Thursday; gives any website 90 seconds | Nav → Refer a Patient | Referral sent, status "Hospital discharge referral," confident in the 1-hour response |

---

## 2. The verdict in one paragraph

The education layer is genuinely excellent — every persona found their exact question
answered in their own words, the hours/LMN story is best-in-class, the integrity
material persuades a skeptic without smearing, and the honesty (VA status, billing,
"Alara does not file claims") is disarming. The leaks are almost all **routing and
capture**, not content: the site's loudest funnel is *eligibility-shaped* while its
best customers are *already eligible*; the tools never ask two facts that decide
everything (do you already have the card? where does the patient live?); three
capture doors are missing entirely (veteran waitlist, survivor lane, professional CTA
on the LMN article); and until email delivery is live, the two biggest conversion
tools hand off to the visitor's email app — with refer.html showing **no on-page
confirmation at all** on that path. Nothing here requires new pages of prose; it
requires branches, fields, one orphan rescued, and receipts (license #, address,
name, fax).

---

## 3. Findings, deduplicated and ranked

### P0 — actively losing conversions today
1. **refer.html shows no confirmation on the mailto path.** `rfShowDone()` only fires
   when server email delivery is live. Until the API key is set, a clinic desktop with
   no mail client sees *nothing happen* after "Send the referral." Norma calls the next
   agency; Gina assumes it failed. The submission IS logged server-side (logOnly), so
   showing the confirmation is honest. *Fix: reveal the confirmation on the mailto
   branch too ("your email is opening — and we've logged your referral either way"),
   and set the Resend key (docs/FORMS-DELIVERY.md).*
2. **The eligibility funnel mis-serves already-qualified people — the bread and
   butter.** Four of eight personas (Earl, Vern, Melissa, Dorothy) were routed into a
   *new-claim* wizard that doesn't fit them:
   - Navigator (qualify.html) has **no** "I already have my White Card" branch, no
     survivor branch, no switching branch, and never asks about an existing agency.
   - The homepage "we want to switch" lane points to the generic Navigator, which has
     no switching content — the intent is dropped.
   - care-hours + more-hours articles promise "a nurse reads your current authorization"
     but send Melissa into a wizard asking "did you work at a DOE site?" — she bails.
   - Case-review's summary/confirmation says the card "can be **opened** for you" even
     when the visitor picked "Filed and was approved" (Earl: confusion) or "A survivor"
     (Dorothy: it promises her *home health* when her benefit is survivor compensation).
   *Fix: one "I already have my card" fast lane (homepage + Navigator first question),
   plus three copy branches in case-review (approved → "let's start your care";
   survivor → survivor compensation + Resource Center; hours → "what the documentation
   supports").*
3. **veterans.html captures no veterans.** The honesty ("we cannot bill the VA yet")
   is the right brand move, but the "be notified when enrollment is active" offer is
   addressed **only to providers, by phone**. Frank has no button to leave his number;
   the page never links begin.html. Alara asks him to remember them — Alara doesn't
   remember him. *Fix: veteran-facing "be the first call when we're VA-ready" capture
   → begin.html (kind: va-waitlist), + the veteran/spouse Test-Site-civilian crossover
   sentence, + link the Medicare basics article for the homebound (his COPD answer).*

### P1 — real friction on main paths
4. **Nobody ever asks where the patient lives.** Navigator, case review, and the
   referral form capture no city/ZIP. Meanwhile other-doe-workers.html actively
   recruits Nye County *worksites* (Tonopah, CNTA, Faultless) while las-vegas.html
   lists only Clark County *service* — "Pahrump" appears nowhere on the site. David
   cannot answer his one blocking question. *Fix: patient city/ZIP field on refer +
   an explicit Nye County/Pahrump service statement (yes / by arrangement / no).*
5. **Patient-voiced pages hand patients a physician-framed form.** Article CTAs
   ("Send the referral") drop Earl and Vern into refer.html ("Referring physician,
   office, or family member"). They read it as not-for-me. *Fix: patient-side CTAs
   route to begin.html or case-review; refer.html gets a top toggle "Are you the
   patient? Have a nurse call you instead →".*
6. **Start-of-care is buried for the ready buyer.** white-card.html's begin link sits
   below ~10 sections; homepage hero CTA is "See what you qualify for" — wrong verb
   for a card holder. *Fix: "Already have your card? Start care →" in the white-card
   hero aside + homepage hero secondary action.*
7. **The switching page never answers "why would Alara be different?"** It grants
   permission perfectly (no gap, card is yours, no explanations owed) but sells
   nothing — Vern's blocking objection (rotating strangers, cut hours) is answered on
   *other* pages. *Fix: short "why families switch TO Alara" block (local nurses you'll
   know; hours drafted from the care record) before the CTA.*
8. **Professionals: missing doors and missing receipts.**
   - The LMN article — Gina's literal landing page — has only patient CTAs. *Add a
     physician-office block → refer.html.*
   - refer.html's "one form your doctor signs" panel is addressed to patients; the
     physician's time/liability answer ("signs evidence, not recollection") lives on
     pages refer.html never links. *Add a "For the referring physician's office" panel.*
   - "We keep you updated on your patient" — the repeat-referral sentence — exists on
     begin.html's referrer variant but NOT on refer.html. *Port it.*
   - begin.html says "**Fax** or email" but no fax number exists anywhere on the site.
     *Add a fax line or cut the word.*
9. **Verifiable trust artifacts are absent sitewide.** The *language* of trust is
   strong; the *artifacts* a scam-wary widow or a fraud-wary office manager physically
   looks for are missing: street address, NV license #, Medicare certification/CCN,
   NPI, a named owner with a face, accreditation marks. *Fix: a credentials strip
   (footer or about.html) once the owner supplies the numbers.* **[needs owner input]**
10. **The 2 a.m. system under-delivers at 2 a.m.** The stack is ~5 scrolls below the
    hero; the note says "a nurse answers" with no business-hours qualifier (the only
    place on the site that over-promises); and nothing addresses the acute night
    moment itself ("if he's hurt, call 911; here's tonight vs. 8 a.m."). *Fix: hero
    quick-link to the stack, honest phone phrasing, a five-line night-triage block.*
11. **care-guide.html is orphaned.** A full page selling the named-Care-Guide model —
    zero inbound links. *Fix: link from about.html and services.html, or fold its
    content in and retire it.*
12. **Four broken section deep-links** land readers at the top of learn.html instead
    of their section: owcp.html→#owcp, programs.html→#community-care,
    services.html→#wound-care, white-card.html→#eeoicpa. *Fix: point at real anchors.*

### P2 — polish
13. Case-review trust line now says "Nothing is stored in your browser" (accurate),
    but the flagship integrity article's "How Alara answers them" skips 2 of its own
    7 questions — including "Are your nurses local?" (David's question). Answer Q5+Q7.
14. "No traveling nurses" is implied everywhere, asserted nowhere. One plain sentence
    on about.html / las-vegas.html.
15. refer.html: say the implicit things once in words — "Yes, we accept White Card
    patients" in the hero; "Refer before the order is finalized — that's ours to
    handle" near the form.
16. white-card-denied.html route table needs a sideways swipe at 390px (contained,
    acceptable); post-conversion confirmations don't seed later benefits (hours
    renewals, travel reimbursement, caregiver pay); "Already with Alara?" footer line
    exists only on home.html.
17. Navigator veteran result never mentions the VA-enrollment caveat that
    veterans.html is so careful about — a Navigator-first veteran misses the honesty.

---

## 4. Touchpoint map — where we can capture

Stages run: **Discover → Land → Learn → Tool → Convert → Confirm → Wait → Patient → Advocate.**
"Capture today" = what actually exists on the live site.

| # | Touchpoint | Personas | Capture today | Gap |
|---|---|---|---|---|
| T1 | Search result → article/guide (30 articles, 6 guides) | all | Education + end-of-article CTA band | CTA sometimes mis-routed (P1-5) or missing for professionals (P1-8) |
| T2 | Homepage hero | all | "See what you qualify for" + quiet phone | No card-holder/start-care action (P1-6); no 2 a.m. quick-link (P1-10) |
| T3 | Homepage lane chooser | all | 6 lanes → program pages | No survivor lane (P0-2); switch lane mis-routed (P0-2) |
| T4 | Benefits nav dropdown | all | 4 programs + qualify + case review | No Survivors entry |
| T5 | Navigator (qualify.html) | Dorothy, Frank, Melissa, Earl | Result + one next step | No already-have-card / survivor / switching branches; no location; no VA caveat |
| T6 | Case-review wizard (7 steps) | Earl, Vern, Dorothy, Melissa, David | Contact-last close; off-ramps never dead-end | Copy mis-addresses approved/survivor/hours cases (P0-2); steps unmeasured |
| T7 | refer.html form | Gina, Norma, David | 5-field form, SLA aside, PHI warning | No confirmation on mailto path (P0-1); no patient city; no fax; no "updated on your patient" |
| T8 | begin.html call-back | Earl, Frank, Vern | Name+phone, always-in-page confirm, POSTs to server | Least-promoted tool on the site; not linked from veterans.html |
| T9 | veterans.html status section | Frank | Provider-only phone notify | **No veteran capture at all** (P0-3) |
| T10 | 2 a.m. stack (home) | Melissa | 6 self-serve tools | Buried; over-promising phone note; no night triage |
| T11 | Phone (702) 814-9630 | all | On every page, honored | Correct as-is — do not touch |
| T12 | Post-convert confirmations | all converters | "What happens next" steps | Don't seed lifecycle benefits; survivor copy wrong |
| T13 | Patient life (hours renewals, travel $, caregiver pay, switching) | Vern, Melissa | care-hours + 3 articles | Entry points exist; wizard branch missing; "Already with Alara?" only on home |
| T14 | Analytics (/api/event) | — | page_view + .btn taps sitewide | Wizard steps, Navigator nodes, estimator, form outcomes emit nothing |

---

## 5. Fallout map — where they fall out, the recovery move, the measurement

Fallout = the person leaves without converting AND we have no way to reach them
(no capture) and no way to know it happened (no event). Both must be fixed.

| # | Fallout point | Who falls out | How it looks | Recovery move | Measure with |
|---|---|---|---|---|---|
| F1 | refer.html submit, mailto path | Norma, Gina, David | Click → nothing visible → back button → competitor | Show confirmation on mailto branch; set email key | `submit_attempt` / `submit_confirmed` events per kind |
| F2 | Case-review Step 1 ("did you work at a DOE site?") | Melissa (hours), Vern (switch) | "This isn't for me" → close tab at step 1 | "Already have a White Card?" branch at step 1 → hours/switch review | `cr_step` event per step → step-drop funnel |
| F3 | Navigator situation list | Dorothy (no survivor), Vern (no switch) | No option matches → picks wrong lane or quits | Add survivor + already-have-card + switching situations | `nav_node` events per node (navigator.js code exists, is loaded by no page — wire it) |
| F4 | veterans.html "can't bill VA yet" | Frank | Understands, nods, leaves forever | Veteran waitlist capture → begin.html (kind: va-waitlist) | page_view → begin-submit conversion rate for /veterans referrers |
| F5 | white-card.html long guide | Earl | Stalls mid-page before the bottom begin link | Start-care button in hero aside | scroll-depth or cta event on new hero button |
| F6 | Pahrump/Nye question | David + every rural family other-doe-workers recruits | Question unanswerable → won't refer from out of state | Service-area statement + patient city field on refer | count `submit` payloads containing non-Clark cities |
| F7 | 2 a.m. visit, crisis mode | Melissa | Never scrolls 5 sections to the stack; hero verb wrong; leaves | Hero quick-link to stack + night-triage block + honest phone note | night-hours (22:00–06:00) page_view → tool-open rate |
| F8 | LMN article, professional reader | Gina | Educated for free, no door to walk through | Physician-office CTA block on the article | cta events from /articles/what-is-a-letter-of-medical-necessity |
| F9 | Switching article | Vern | Permission granted, differentiation absent → switches to whoever answers first | "Why families switch TO Alara" block | article page_view → case-review start rate |
| F10 | Post-callback silence | any begin/case-review converter | Nurse calls once, misses, no retry visible to site | (operational, not website) — confirmation already sets the window; log callbacks against submissions.log | compare submissions.log volume to CRM callbacks (owner-side) |
| F11 | Trust check (address/license/owner) | Dorothy, Gina, David | Looks for receipts, finds assertions → "maybe a scam" → gone | Credentials strip (needs owner's license #/address/NPI) | n/a (qualitative) — but bounce rate on about.html is the proxy |
| F12 | Survivor completes wizard, gets home-health promise | Dorothy | "I don't need a nurse — Gene's gone" → distrust at the finish line | Survivor branch copy in summary + confirmation | `cr_done` event with `who` dimension |

**Instrumentation note.** Today only F-numbers with page-level signals are visible.
One small event pass makes the whole map measurable: `cr_step`/`cr_done` in the
wizard, `nav_node` in the Navigator (load the existing navigator.js beacon or fold
it into site-nav.js), `submit_attempt`/`submit_confirmed` in site-submit.js, and an
`estimator_used` event. All anonymous, consistent with privacy.html as written.

---

## 6. What is excellent — protect these
- **Hours/LMN story** (care-hours + more-hours article): "'That's all the hours you
  get'… is a documentation problem wearing a verdict's clothes." Best-in-class; the
  auditors independently called it the strongest asset for two different personas.
- **begin.html**: two fields, in-page confirmation, honest SLA, and a story
  placeholder ("my dad worked at the Test Site and his wound isn't healing") that
  made two auditors flag it as uncanny-good. It should be *more* promoted, not changed.
- **The integrity/ownership pieces**: DOJ dollar figures with disciplined
  "resolves allegations" language, investor-portfolio citations, and the
  billing-administrator phone number handed over for independent verification —
  "the ultimate we're-not-afraid-of-you-checking move."
- **Survivor education**: "The worker does not need to have filed" + "you never pay
  anyone a percentage of the award" + "Alara does not file claims" — the anti-scam
  trifecta.
- **VA honesty**: "we cannot bill the VA for your care yet" + the 4-question script
  for the VA care team (with TriWest named). Keep the honesty; add the capture.
- **refer.html structure for Norma**: form second section, education below it,
  role-recognition in the lead, tiered SLA. ~1 scroll, 5 fields, 1 click.
- **Wizard ergonomics**: one question per screen, big targets, Back button, contact
  last, off-ramps that never dead-end, reassurance under every question.
- **Phone honored everywhere**, disparaged nowhere. The one exception (the 2 a.m.
  "a nurse answers" over-promise) is an honesty fix, not a tone fix.

---

## 7. Build order (when approved)
1. **Confirmation + capture P0s** — refer.html mailto confirmation; veteran waitlist;
   case-review branches (approved / survivor / hours-switch); Navigator branches.
2. **Routing** — homepage card-holder action + switch-lane retarget; patient-vs-
   referrer toggle on refer; article CTA retargets; white-card hero start-care;
   LMN-article professional CTA; care-guide.html rescue; 4 anchor fixes.
3. **Fields + facts** — patient city/ZIP on refer; Pahrump/Nye statement; fax line or
   remove "Fax"; "updated on your patient"; explicit "we accept White Card" +
   "refer before the order is finished"; no-traveling-nurses sentence; Q5+Q7 answers.
4. **2 a.m. pass** — hero quick-link, night-triage block, honest phone note.
5. **Instrumentation pass** — wizard/Navigator/submit/estimator events (makes the
   fallout map live).
6. **Owner-dependent** — credentials strip (license #, address, NPI, cert, named
   owner + photo, fax number); Resend API key (turns on email delivery, retires the
   mailto risk permanently).
