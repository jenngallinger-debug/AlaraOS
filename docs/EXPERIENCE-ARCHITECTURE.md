# Experience architecture — the logic of the site

Status: draft for owner review (2026-06-30). This is the map we build against.
Nothing new ships until the journeys below are signed off.

---

## 0. The one job

> Take someone who has (or whose family member has) a federal benefit and a
> complex health need — and is confused — to **"I understand exactly what I am
> entitled to and what to do next, and Alara is obviously the expert who should
> deliver it"** — without requiring a phone call.

Two truths sit underneath every page:

1. The visitor is **capable**, not helpless. We inform; we do not rescue.
2. We earn the relationship by **giving value before asking for anything**.

---

## 1. The two lanes (this is the fix for "is this the benefit page or the Alara page?")

Every page on the site lives mostly in **one of two lanes**, and hands off to
the other at defined moments. Mixing them inside a single section is what made
the White Card page feel confusing.

| | **Education lane** | **Service lane** |
|---|---|---|
| Question it answers | "What is this benefit and what am I entitled to?" | "What does Alara do, and how do I start?" |
| Voice | Neutral, authoritative, the best explanation anywhere | Warm, specific, accountable |
| Job | Build trust + get found (search / AI engines) | Convert that trust into a patient |
| Pages | White Card pillar, OWCP pillar, VA pillar, Library, Navigator | Services, About, Begin |

**So: the White Card page is the EEOICPA *education pillar*, authored by Alara as
the named expert.** It is not an Alara sales page. Alara appears in exactly three
delineated places — the one-line "where Alara fits," the "what we do / do not do"
box, and the closing hand-off — and **never blended into the teaching.** The
reader should be able to read the whole thing as the clearest explanation of the
White Card that exists, and only at the end think "…and the people who wrote this
are obviously who I want."

The same template produces the OWCP pillar and the VA pillar.

---

## 2. The emotional arc (the universal spine of a pillar)

Every education pillar moves the reader through five moments. The White Card
page is now built on this; the others will be too.

| # | Moment | What they feel coming in | The question we answer | What we must NOT do |
|---|---|---|---|---|
| 1 | **Recognition** | Wary, tired of being confused | "Is this for me, and do these people actually understand my situation?" | Frame them as a victim |
| 2 | **Revelation** | "Wait — I didn't know that" | "What am I leaving on the table?" | Ask for anything yet |
| 3 | **Orientation** | Steadier, curious | "OK, what's the full picture?" | Bury it in an essay |
| 4 | **Action** | Capable, ready | "What is my exact next step?" | Make 'call us' the only answer |
| 5 | **Decision** | Trust | "Who should deliver this?" | Hard-sell |

Arc in one line: **wary → surprised(valued) → oriented → capable → trusting.**

The White Card page maps to this: hook (Revelation first, deliberately) → covers
→ what it is (Orientation) → consequential → file → medicare → boundary → FAQ →
"where to go next" (Action/Decision).

---

## 3. The audiences and their entry states

| Audience | Where they enter | Feeling | Top thing they want |
|---|---|---|---|
| **White Card holder / family** (the star) | Google, AI answer, referral, home | Wary, underserved | "What does my card actually cover — and what am I missing?" |
| **Maybe-eligible worker / survivor** (no card) | Google ("was I exposed / am I owed") | Uncertain, sometimes resigned after a past denial | "Do I qualify, and how do I start — without paying a percentage?" |
| **Federal / postal worker** (OWCP) | Google, referral | Frustrated by paperwork | "Will workers' comp cover home care, and how is it authorized?" |
| **Veteran** (VA) | Google, referral | Tired of waiting | "Can I get home care without the VA wait, and without Medicare?" |
| **Physician / referral partner** | Direct, word of mouth | Time-poor, protective of patients | "Are these people competent and fast? How do I refer?" |
| **Case manager / discharge planner** | Direct, referral | Needs reliability | "Can I hand this off and trust it gets done?" |

---

## 4. The star journey, mapped point by point

White Card holder / family. This is the one we make perfect first.

| Point | Page / section | They feel | They want to know | The exact question we answer | Where they go next |
|---|---|---|---|---|---|
| Entry | Home or pillar hero | "Are these the right people?" | Is this for me? | "Worked at the Test Site / DOE and have a White Card? This is the complete, plain guide." | Into the pillar |
| Hook | Pillar · *benefits most miss* | Surprised, valued | What am I missing? | "Here are the specific benefits families miss, each with the exact step to claim it yourself." | Act now, or read on |
| Coverage | Pillar · *what it covers* | Steadier | What's actually covered at home? | "Skilled nursing, therapy, aide, equipment, travel — at no cost to you." | Down to specifics |
| Orientation | Pillar · *what the card is* | Confident | What is this thing, at the ground floor? | "EEOICPA, the White Card, and where Alara fits — three facts." | Their specific question |
| Their question | Consequential / Medicare / file | Capable | "My specific situation?" | The one that matches them, plainly. | Navigator to personalize |
| Personalize | Navigator (qualify) | In control | "What applies to *me*?" | A plain answer + source + next step. | Begin, or print |
| Decision | Pillar close / Begin | Trust | "Who delivers this?" | "Alara starts care, handles authorization, screens for consequential conditions day one." | Begin care |

The same table will exist for OWCP, VA, the no-card filer, and the physician —
each is a one-page map before its pillar gets built.

---

## 5. What each page is for (and the nav logic)

```
HOME ............ the threshold. Recognition + "AlaraOS is the expert system"
│                 + route the visitor to their situation.
│
├─ BENEFITS ..... the index/hub. Each program in one card → its pillar.
│   │             Short. It routes; it does not teach deeply.
│   ├─ White Card pillar ...... EEOICPA education (built)
│   ├─ OWCP pillar ............ to build (same template)
│   └─ VA pillar .............. to build (same template)
│
├─ LIBRARY ...... definitions that support the pillars. Cites them; never
│                 re-explains them.
│
├─ NAVIGATOR .... the bridge. Personalizes education → a cited answer + next step.
│   (qualify)     Every pillar hands off to it.
│
├─ SERVICES ..... what Alara clinically does. (Service lane)
├─ ABOUT ........ who Alara is / why to trust them. (Service lane)
└─ BEGIN ........ start care / be contacted. (Service lane conversion)
```

**Navigation logic.** Two lanes, one bridge. The top nav already separates them:
*Benefits / Library* (education) vs *Services / About* (service), with *See if
you qualify* (the Navigator) as the always-present bridge. A reader can stay in
the education lane as long as they want; the bridge is always one click away;
the service lane is there when they're ready — never pushed mid-lesson.

---

## 6. The hand-off rules (so lanes never tangle again)

1. An education page may hand to the service lane **only at its end** (the "where
   to go next" block), never inside a teaching section.
2. Every education page ends with the **same two doors**: *personalize*
   (Navigator) and *act* (Begin) — plus *keep it* (print).
3. The service lane always offers a way **back** into education (so a visitor who
   isn't ready to start doesn't dead-end).
4. Alara is named in education as **the expert who authored it**, in delineated
   spots only.

---

## 7. Where we are vs "perfect"

**Mapped and built:** the star journey + the White Card pillar.

**Mapped here, not yet built:**
- OWCP pillar, VA pillar (same template, same arc).
- The **no-card filer** on-ramp ("I worked there — am I owed anything?") — today
  it's a section inside the White Card pillar; it likely deserves its own light
  entry because the emotional state is different (uncertain, not underserved).
- The **physician / referral** journey — a different lane entirely (competence +
  speed, not benefits education).
- Home and the Navigator re-checked against this arc end to end.

**Open decisions for the owner (Section 8) before we build the rest.**

---

## 8. Decisions to confirm

1. **White Card page identity** — confirm it is the *EEOICPA education pillar
   authored by Alara*, not an Alara service page. (This drives every other pillar.)
2. **Whose journey is second** after the star — OWCP, VA, or the no-card filer?
3. **The no-card filer** — its own entry page, or keep as a section in the pillar?
4. **Physicians** — in scope now, or later? It's a separate lane and a separate build.
