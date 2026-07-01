# The Benefit Navigator, rebuilt — design for sign-off

**Status:** proposal. Nothing is built yet. This is the plan to approve before code.
**Owner decision on file:** "It needs to be a strong machine — a decision-maker and a
learning tool." Also: the current opener reads like a form ("a human wouldn't say that").

**Governing constraint (owner-locked):** the Navigator is **purely educational**. It does
**not** determine anyone's eligibility, and it collects **no PHI**. It is *surgically*
educational — precise and genuinely useful about what these programs mean for a situation
like yours, without ever crossing into a personal verdict or a medical record. It reasons in
order to **teach**, not to decide. Every screen stays "general information, not a coverage
determination," and nothing a person enters is stored or transmitted as health data.

---

## 1. What is wrong with the Navigator today

`qualify.html` is a **fixed decision tree**. Every path is hand-authored in one big JSON
object (`start → by-program → owcp-need → ans-owcp-hh`). That has three costs:

1. **It cannot reason.** It can only walk branches someone wrote. It cannot say "based on
   the three things you told me, you *very likely* qualify for the White Card, you *might*
   also have a consequential condition, and the one thing missing is X." It hands back a
   pre-written card, not a conclusion about *you*.
2. **It only holds one program at a time.** Real people are cross-eligible — a White Card
   holder can also have Medicare; an injured worker can have OWCP now and a VA path later.
   A tree makes you pick one door and forget the rest.
3. **It reads and looks like a form.** Black-and-white, dense, and the opening line
   promises "in about a minute you will see what your benefits generally cover" — the voice
   of a government kiosk, not a person who is about to help you.

---

## 2. What it becomes

A **governed reasoning engine** with a human voice and a visible mind — pointed at
*teaching*, not deciding.

- **Surgical educator:** you tell it a few things in plain, non-medical terms; it reasons
  across *all* programs at once and returns an **educational picture** — what these benefits
  generally mean *for a situation like yours*, what's worth checking and the single fact that
  would clarify it, and the one next step. Framed as general information, never "you
  qualify." A precise lesson about your options, not a verdict about you.
- **Learning tool, two senses:**
  - *For the reader:* it teaches as it goes — every conclusion is explained in plain
    language and cited to the federal source, so you leave understanding your own benefits.
  - *For Alara:* it learns from real use — which questions confuse people, where they drop,
    what they actually needed — and surfaces that so the guidance keeps improving.

### The honest line on "learning" (please read)

For a **benefits-eligibility** tool, the machine must **not** invent or auto-learn
eligibility rules from traffic — that is how you end up telling a real family they qualify
for something they don't. So the design splits cleanly:

- **The eligibility logic is governed, not learned.** It lives in `data/`, is human-owned,
  cited to DOL/VA sources, and drift-guarded. Same single-source-of-truth rule as the rest
  of the site. The interface cannot lie.
- **The *guidance* is what learns.** From anonymous, no-PII usage: question order, drop-off
  points, "have a nurse call" moments, gaps people hit. That feeds a review surface the team
  acts on. Later, an LLM can *read* a person's free-text situation and map it to inputs —
  but the **determination is always made by the governed engine**, never the model.

This keeps the "strong machine" promise while never risking a false benefit claim.

---

## 3. How the engine works (reasoning, not a tree)

Three moving parts, all deterministic and auditable:

**a. Signals** — general, non-medical, optional, and **never saved**:
`role` (worker / survivor / caregiver / veteran), `employer` (Test Site, DOE, AWE, federal,
postal, none), `program held` (White Card / OWCP / VA / none / unsure), `kind of care needed`
(nursing / wound / therapy / aide — categories, not a diagnosis), `location`. No condition
name, no claim number, no PHI — the signals route *education*, not a determination.

**b. Program rules** — for each program (EEOICPA, OWCP, VA, +TRICARE/Medicare/Black Lung as
data grows), a small set of eligibility criteria expressed as data in `data/`:
```
eeoicpa: qualifiesIf(employer ∈ {TestSite, DOE, AWE} AND condition present)
         → likelihood: strong | possible | unlikely, with the reason and the gap
```
**c. The reasoner** — matches signals against every program's rules and returns, for each:
a **likelihood** (Likely / Possible / Not from what you've told me), the **because**
(the criteria met), and the **missing fact** that would move it up. It runs all programs in
parallel, so cross-eligibility falls out naturally.

**Adaptive intake:** instead of a fixed question order, the next question is the one that
would *most* change the picture (largest reduction in uncertainty across programs). Fewer
questions, faster to a real answer. Still one calm question per screen.

---

## 4. The flow (screen by screen)

1. **Open** — human, not a form. One warm line + the first question. No "in about a minute."
2. **Adaptive intake** — one question per screen, back/forward, nothing saved, no account.
   A quiet "thinking" beat between answers so the reasoning is *felt*, not hidden.
3. **The educational picture** — the payoff. A living summary, framed as *what these
   programs generally mean for a situation like yours* (never "you qualify"):
   - *Generally covered for someone like you* — each program with its plain-language because
     + covered services.
   - *Worth asking about* — programs that may apply and the one fact that would clarify each.
   - *Easy to miss* — the discovered/consequential benefits, framed (never "no one told you").
   - *Your one next step* — the single most useful action, program-aware.
   - Every claim cited to its federal source; "general information, not a determination."
4. **Two quiet doors** — read the full guide (White Card / OWCP), or have a nurse call.
   Informing, never pushing.

---

## 5. Voice (replacing the form line)

- **Kill:** "Start with a question. In about a minute, you will see what your benefits
  generally cover and the one next step to take. No form, no account."
- **Toward:** *"Tell me a little about your situation, and I'll show you what these benefits
  generally cover for someone like you, and the one thing to do next. No forms, and nothing
  you enter is saved."* (final words earn their place in use; the principle is: a person
  teaching you, not a kiosk deciding your case.)

---

## 6. Make it feel alive (the fix for "boring and lifeless," starting here)

This page is the right place to prove the site can have a pulse:

- **Reasoning made visible** — the "thinking" beat assembles the picture the way a mind
  would (signals lighting up, programs resolving from grey to warm as they qualify).
- **Colour with meaning** — Likely / Worth-checking / Not-yet as warm tiers on the espresso
  and greige system (no new palette), so the result page is not black-and-white.
- **One signature motion** — the benefit picture *builds* on reveal rather than just
  appearing. Reduced-motion safe.
- This becomes the template for a broader "site gets a pulse" pass (photography of real
  care, a signature interaction on the homepage, typographic contrast) — proposed separately
  once you've seen it work here.

---

## 7. Build shape (after you approve §1–6)

- Engine + rules as **data in `data/`** (single source of truth, drift-guarded), served the
  same standalone way `qualify.html` runs today — no backend dependency to ship.
- Anonymous event capture for the learning loop (counts and paths, **no PII**), plus a small
  internal review of "where people got stuck."
- Accessibility and reduced-motion parity with the rest of the site.

## 8. Decisions (locked by owner)

1. **Engine approach** — **governed deterministic reasoner.** Reasons from human-owned,
   cited rules in `data/`; never a model freelancing eligibility.
2. **What it does** — **purely educational, no PHI, no determination.** Surgically
   educational (see governing constraint). The only thing that "learns" is guidance quality,
   from anonymous, no-PII usage; the eligibility content is governed and cited.
3. **Programs at launch** — the **three we have data for** (EEOICPA, OWCP, VA) fully live;
   TRICARE / Medicare / Black Lung appear as "ask us" until their cited rules are added.

**Next:** build against this spec (owner chose design-first; the design is now settled).
