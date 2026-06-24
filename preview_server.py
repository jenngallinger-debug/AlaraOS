#!/usr/bin/env python3
"""AlaraOS web server.

Runs the Alara Home Care / AlaraOS site. Used both as the local dev-preview AND as the
Render STAGING server (alarahc.com). Renders pages from the data files in data/ and the
shared knowledge graph. Node server.js is kept in parity as the longer-term canonical.

Staging safety (see SITE_MODE below): unless SITE_MODE=production AND the request host is the
real production domain, every page is noindex,nofollow, robots.txt disallows all, and the
sitemap is disabled. This keeps the staging build (alarahc.com, *.onrender.com) out of search.
"""
import json, os, html as H, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
PORT = int(os.environ.get("PORT", "3000"))
ASSET_VER = str(int(datetime.datetime.now().timestamp()))  # cache-bust static assets per server start

# ---- SITE MODE / indexing ----------------------------------------------------
SITE_MODE = os.environ.get("SITE_MODE", "production" if os.environ.get("PUBLIC_SITE") == "true" else "staging")
PROD_HOSTS = {"alarahomecare.com", "www.alarahomecare.com"}
PROD_CANONICAL = "https://www.alarahomecare.com"
STAGING_CANONICAL = "https://alarahc.com"

def site_context(host):
    host = (host or "").split(":")[0].strip().lower()
    is_prod_host = host in PROD_HOSTS
    # Index ONLY when explicitly in production mode AND served from the production domain.
    # Everything else (alarahc.com, *.onrender.com, localhost) is treated as staging.
    indexable = (SITE_MODE == "production") and is_prod_host
    return {
        "host": host, "mode": SITE_MODE, "indexable": indexable, "is_prod_host": is_prod_host,
        "canonical_base": PROD_CANONICAL if indexable else STAGING_CANONICAL,
    }

# ---- data --------------------------------------------------------------------
def load(p):
    with open(p) as f: return json.load(f)

GLOSSARY = load(os.path.join(HERE, "data", "glossary.json"))
NAV = load(os.path.join(HERE, "data", "navigator.json"))
GRAPH = load(os.path.join(HERE, "content", "data", "knowledge-graph.json"))
GBY = {t["slug"]: t for t in GLOSSARY}
NBYID = {n["id"]: n for n in GRAPH["nodes"]}
SITE = "https://www.alarahomecare.com"

def esc(s): return H.escape("" if s is None else str(s))

NAVBAR = [("/#serve", "Programs"), ("/glossary", "Resources"),
          ("/#physicians", "Physicians"), ("/trust", "About")]

# Public URLs included in the production sitemap.
def public_paths():
    paths = ["/", "/navigator", "/glossary", "/trust"]
    paths += ["/programs/" + s for s in PILLARS]
    paths += ["/glossary/" + t["slug"] for t in GLOSSARY]
    return paths

# ---- JSON-LD -----------------------------------------------------------------
def org_node():
    return {"@type": ["MedicalOrganization", "HomeHealthCare", "LocalBusiness"], "@id": SITE + "/#organization",
            "name": "Alara Home Care", "url": SITE + "/", "telephone": "+1-702-814-9630",
            "areaServed": ["Las Vegas NV", "Clark County NV", "Southern Nevada"],
            "knowsAbout": ["EEOICPA", "White Card benefits", "OWCP", "FECA", "VA Community Care Network", "home health"]}

def breadcrumb(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": it[0], "item": SITE + it[1]} for i, it in enumerate(items)]}

def basic_graph(name, path, crumbs):
    return {"@context": "https://schema.org", "@graph": [
        {"@type": "MedicalWebPage", "@id": SITE + path + "#webpage", "url": SITE + path, "name": name,
         "publisher": {"@id": SITE + "/#organization"}}, breadcrumb(crumbs), org_node()]}

def glossary_graph(t, crumbs):
    tid = SITE + "/glossary/" + t["slug"] + "/#term"
    return {"@context": "https://schema.org", "@graph": [
        {"@type": "DefinedTerm", "@id": tid, "name": t["term"], "description": t["shortDefinition"],
         "inDefinedTermSet": {"@type": "DefinedTermSet", "@id": SITE + "/glossary/#set",
                              "name": "Alara Federal Benefits Library"}},
        {"@type": "MedicalWebPage", "@id": SITE + "/glossary/" + t["slug"] + "/#webpage",
         "url": SITE + "/glossary/" + t["slug"] + "/", "name": "What is " + t["term"] + "?",
         "lastReviewed": t["lastReviewed"], "about": {"@id": tid}, "publisher": {"@id": SITE + "/#organization"},
         "reviewedBy": {"@type": "Person", "name": t["reviewer"]["name"], "jobTitle": t["reviewer"]["role"]} if t.get("reviewer") else None,
         "citation": [s["url"] for s in t.get("sources", [])]},
        breadcrumb(crumbs), org_node()]}

# ---- chrome ------------------------------------------------------------------
def crumbs_html(items):
    if not items or len(items) < 2: return ""
    parts = []
    for i, it in enumerate(items):
        if i < len(items) - 1:
            parts.append('<a href="' + esc(it[1]) + '">' + esc(it[0]) + '</a><span aria-hidden="true"> &rsaquo; </span>')
        else:
            parts.append('<span aria-current="page">' + esc(it[0]) + '</span>')
    return '<nav class="crumbs" aria-label="Breadcrumb">' + "".join(parts) + "</nav>"

def page(title, desc, body, active, jsonld=None, crumbs=None, site=None, path="/", wide=False):
    links = []
    for p_, l in NAVBAR:
        active_attr = ' class="active" aria-current="page"' if p_ == active else ''
        links.append('<a href="' + p_ + '"' + active_attr + '>' + esc(l) + '</a>')
    nav = "".join(links)
    ld = '<script type="application/ld+json">' + json.dumps(jsonld) + '</script>' if jsonld else ""
    site = site or site_context("")
    robots_meta = "" if site["indexable"] else '<meta name="robots" content="noindex,nofollow">'
    canonical = '<link rel="canonical" href="' + site["canonical_base"] + path + '">'
    staging_ribbon = "" if site["indexable"] else '<div class="staging-ribbon">Staging preview &middot; not indexed &middot; not the live site</div>'
    main_open = '<main id="main">' if not wide else '<main id="main" class="wide">'
    return ("<!doctype html><html lang=\"en\"><head>"
        "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>" + esc(title) + " &mdash; Alara Home Care</title>"
        "<meta name=\"description\" content=\"" + esc(desc) + "\">"
        + robots_meta + canonical +
        "<link rel=\"stylesheet\" href=\"/public/app.css?v=" + ASSET_VER + "\">" + ld + "</head><body>"
        "<a class=\"skip\" href=\"#main\">Skip to content</a>"
        + staging_ribbon +
        "<header class=\"site\"><a class=\"brand\" href=\"/\">"
        "<svg viewBox=\"0 0 100 92\" width=\"26\" height=\"24\" aria-hidden=\"true\"><path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M22,88 V34 L50,8 L78,34 V88 Z M37,88 V66 A13,13 0 0 1 63,66 V88 Z M52.4,27 A2.4,2.4 0 1 0 47.6,27 A2.4,2.4 0 1 0 52.4,27 Z\"/></svg>"
        "<span style=\"display:flex;flex-direction:column;gap:3px;line-height:1\"><strong>ALARA</strong><span class=\"brand__tag\">Clarity when things get complicated</span></span></a>"
        "<nav class=\"mainnav\" aria-label=\"Primary\">" + nav + "</nav>"
        "<div class=\"headcta\"><a class=\"head-phone\" href=\"tel:+17028149630\">(702)&nbsp;814-9630</a>"
        "<a class=\"btn btn--ink btn--sm\" href=\"/navigator\">See if we can help</a></div></header>"
        + main_open + crumbs_html(crumbs) + body + "</main>"
        "<footer class=\"site\"><p><strong>Alara Home Care</strong> &middot; Nurse-led home health &middot; Las Vegas / Clark County / Southern Nevada &middot; (702) 814-9630</p>"
        "<p class=\"footer-cred\">Nevada Licensed Home Health Agency &middot; License&nbsp;#&nbsp;[pending] &middot; Medicare CCN&nbsp;#&nbsp;[pending] &middot; NPI&nbsp;[pending] &middot; VA Community Care &mdash; TriWest Region 4</p>"
        "<p class=\"muted\">Educational information, not a benefits determination. We help you work with your Resource Center, physician, and the VA &mdash; we do not replace them.</p></footer>"
        "</body></html>")

# ---- homepage ----------------------------------------------------------------
AUDIENCE_DOORS = [
    ("White Card / EEOICPA", "Former Nevada Test Site &amp; DOE workers. Covered skilled care at home, at no cost to you.", "/programs/eeoicpa", "$0 out-of-pocket", False),
    ("Federal Workers Compensation", "Federal and postal employees with an OWCP/FECA-accepted work injury or illness.", "/programs/owcp", "", False),
    ("Veterans / VA Community Care", "Eligible veterans through TriWest, Region 4. You do not need Medicare.", "/programs/veterans", "", False),
    ("Physicians &amp; Referral Partners", "Refer a patient. In-home assessment within 48 hours. One-hour response.", "#physicians", "Referral partners", True),
]
QUESTION_GROUPS = [
    ("White Card / EEOICPA", [
        ("Does the White Card cover home health?", "/glossary/white-card"),
        ("Can I get paid to care for my family member?", "/navigator?node=ans-paid-caregiver"),
        ("Can I have the White Card and Medicare?", "/navigator?node=ans-white-card-medicare"),
    ]),
    ("OWCP / Federal workers", [
        ("Does OWCP pay for home health?", "/navigator?node=ans-owcp-hh"),
        ("How do federal workers qualify?", "/navigator?node=owcp-need"),
    ]),
    ("Veterans / VA", [
        ("Am I eligible for VA home care without Medicare?", "/navigator?node=ans-va-hh"),
        ("Does the VA cover home wound care?", "/navigator?node=ans-va-wound"),
    ]),
    ("Consequential conditions", [
        ("What is a consequential condition, and is it covered?", "/glossary/consequential-condition"),
        ("How fast can home health start?", "/navigator?node=ans-eeoicpa-hh"),
    ]),
]
PROGRAMS = [
    ("01 &mdash; EEOICPA", "The White Card covers more than most families are told.",
     "If you worked at the Nevada Test Site or a Department of Energy site and later got sick, the White Card pays for skilled care at home &mdash; nursing, wound care, therapy, even a paid family caregiver &mdash; at no cost to you.",
     ["Part B &mdash; $150,000 + lifetime medical", "Part E &mdash; up to $250,000, wage loss &amp; impairment", "Forms EE-1 (worker) &middot; EE-2 (survivor)", "Consequential conditions &mdash; covered after DOL acceptance"],
     "U.S. Department of Labor, DEEOIC", "/programs/eeoicpa"),
    ("02 &mdash; Federal Workers Compensation (OWCP / FECA)", "Injured on the job as a federal or postal worker? Your care can come home.",
     "When OWCP accepts your claim and your physician orders it, federal workers&rsquo; compensation can cover skilled nursing, therapy, and home health aide care &mdash; and we handle the authorization so you do not have to.",
     ["Covers federal &amp; postal employees", "FECA, administered by OWCP", "Physician order + OWCP authorization", "No out-of-pocket cost when authorized"],
     "U.S. Department of Labor, OWCP", "/programs/owcp"),
    ("03 &mdash; Veterans / VA Community Care", "Veterans can get home health through the VA &mdash; without the wait, and without Medicare.",
     "When the VA cannot deliver care directly, eligible veterans receive skilled home health through the Community Care Network. Alara is a TriWest provider for Region 4.",
     ["VA Community Care Network", "TriWest, Region 4", "Referral + authorization from the VA", "You do not need Medicare"],
     "U.S. Department of Veterans Affairs", "/programs/veterans"),
]
WHY_PILLARS = [
    ("A Director of Nursing reviews every case", "Every start-of-care assessment is reviewed before it is submitted. That is not standard in this industry. It is standard here."),
    ("We know the White Card program", "The authorization path, the consequential-condition pathway, and how to get claims paid in 15 to 28 days."),
    ("One hour, every referral", "When you call, you reach our clinical team within one hour, and authorization gaps are blocked before they happen."),
    ("Whole-person, hospital-avoidance care", "We screen for what determines whether treatment actually works, and act before a small problem becomes a hospitalization."),
]
STEPS = [
    ("Call", "Tell us your situation. A nurse listens &mdash; no script, no pressure."),
    ("We verify &amp; authorize", "We confirm your benefit and handle the paperwork with the DOL, OWCP, or VA."),
    ("Care begins", "Skilled care at home, usually within days."),
]

def view_home(site):
    pathways = [
        ("White Card", "You have the card. We&rsquo;ll show you what it actually covers.", "/programs/eeoicpa"),
        ("Federal worker", "Injured on the job. The OWCP paperwork is ours, not yours.", "/programs/owcp"),
        ("Veteran", "Home care through the VA. We&rsquo;ll confirm what you qualify for.", "/programs/veterans"),
    ]
    paths_html = "".join('<a class="pathway" href="' + h + '"><span class="pathway__t">' + t + '</span>'
                         '<span class="pathway__d">' + d + '</span><span class="pathway__go">This way <i aria-hidden="true">&rarr;</i></span></a>'
                         for (t, d, h) in pathways)
    told = ["Home health isn&rsquo;t covered.", "Family caregivers can&rsquo;t be paid.",
            "Those benefits are already used up.", "You need a referral before you can even call."]
    told_html = "".join('<p class="told">&ldquo;' + x + '&rdquo;</p>' for x in told)
    steps = [
        ("You call.", "Tell us what&rsquo;s happening."),
        ("The hard part is ours.", "The DOL, the denials, the authorizations &mdash; you never see them."),
        ("Care begins.", "Skilled care at your door, usually within days."),
    ]
    steps_html = "".join('<div class="step"><p class="step__t">' + t + '</p><p class="step__d">' + d + '</p></div>' for (t, d) in steps)
    body = (
      '<section class="hero">'
        '<div class="hero__head">'
          '<h1 class="hero__title">Skilled care at home, through the federal benefits you&rsquo;ve already earned.</h1>'
          '<p class="hero__lead">White Card, OWCP / FECA, and VA Community Care throughout Southern Nevada.</p>'
          '<div class="hero__cta">'
            '<a class="btn btn--ink" href="/navigator">See if we can help</a>'
            '<a class="btn btn--line" href="tel:+17028149630">Talk to a nurse</a>'
          '</div>'
          '<p class="hero__note">Most patients pay nothing out of pocket.</p>'
        '</div>'
        '<div class="hero__media"><img class="hero__img" src="/public/hero-arches.webp" alt="A travertine archway framing a brass door at the top of a wide staircase" loading="eager"></div>'
      '</section>'

      '<section class="band" id="serve">'
        '<div class="pathways">' + paths_html + '</div>'
      '</section>'

      '<section class="band band--tint" id="confusion">'
        '<div class="confusion">'
          '<h2 class="confusion__h">What you&rsquo;ve probably been told.</h2>'
          '<div class="confusion__list">' + told_html + '</div>'
          '<p class="confusion__turn">Sometimes that&rsquo;s true. Sometimes it isn&rsquo;t. The difference is in the details.</p>'
        '</div>'
      '</section>'

      '<section class="bridge"><p class="bridge__line">For many families, the hardest part isn&rsquo;t the care. It&rsquo;s knowing what comes next.</p></section>'

      '<section class="band" id="process">'
        '<h2 class="sec-h">We take it from there.</h2>'
        '<div class="steps">' + steps_html + '</div>'
      '</section>'

      '<section class="band band--ink" id="care">'
        '<div class="care">'
          '<h2 class="sec-h sec-h--light">The kind of care most people don&rsquo;t realize can come home.</h2>'
          '<p class="care__body">Skilled nursing, wound care, infusion, and therapy &mdash; every plan of care reviewed by our Director of Nursing before the first visit.</p>'
          '<p class="care__note">One thing most families are never told: the person already caring for them at home can often be paid to do it.</p>'
        '</div>'
      '</section>'

      '<section class="physband" id="physicians">'
        '<p class="physband__txt"><b>Physicians &amp; case managers</b> &mdash; refer in two minutes. We respond within the hour.</p>'
        '<a class="physband__cta" href="tel:+17028149630">Refer a patient</a>'
      '</section>'

      '<section class="band final" id="talk">'
        '<h2 class="final__h">Start with one call.</h2>'
        '<div class="final__cta"><a class="btn btn--ink" href="/navigator">See if we can help</a><a class="btn btn--line" href="tel:+17028149630">(702) 814-9630</a></div>'
      '</section>'
    )
    return page("Skilled Home Care Through Your Federal Benefits",
                "Skilled home health for White Card holders, federal workers, and veterans throughout Southern Nevada. We confirm your coverage, take on the paperwork, and bring skilled care to your door.",
                body, "/", basic_graph("Alara Home Care", "/", [("Home", "/")]), site=site, path="/", wide=True)

# ---- other views -------------------------------------------------------------
def view_navigator(site):
    body = ('<h1>Benefit Navigator</h1><p class="sub">Answer a few questions and reach a plain-language answer with a cited source and your next step. Nothing here is a benefits determination.</p>'
            '<div id="navigator" aria-live="polite"><noscript><p>The Benefit Navigator needs JavaScript. You can still <a href="/glossary">browse the library</a>.</p></noscript></div>'
            '<script src="/public/navigator.js" defer></script>')
    return page("Benefit Navigator", "Reach a cited answer from your program, condition, question, or location.",
                body, "/navigator", basic_graph("Benefit Navigator", "/navigator", [("Home", "/"), ("Benefit Navigator", "/navigator")]),
                crumbs=[("Home", "/"), ("Benefit Navigator", "/navigator")], site=site, path="/navigator")

def view_glossary_index(site):
    items = "".join('<div><a class="term-list" href="/glossary/' + t["slug"] + '">' + esc(t["term"]) + '</a>'
                    '<div class="muted" style="font-size:.85rem;margin-bottom:10px">' + esc(t["shortDefinition"][:120]) + '&hellip;</div></div>'
                    for t in sorted(GLOSSARY, key=lambda x: x["term"]))
    body = ('<h1>Federal Benefits Library</h1><p class="sub">Plain-language, clinician-reviewed, source-cited definitions of the entities in federal benefits and home health. Written to be understood, built to be cited.</p>'
            '<div class="glossary-list">' + items + '</div>')
    return page("Federal Benefits Library", "Clinician-reviewed, source-cited federal-benefits definitions.", body, "/glossary",
                basic_graph("Federal Benefits Library", "/glossary", [("Home", "/"), ("Federal Benefits Library", "/glossary")]),
                crumbs=[("Home", "/"), ("Federal Benefits Library", "/glossary")], site=site, path="/glossary")

def view_glossary_term(site, slug):
    t = GBY.get(slug)
    if not t: return None
    crumbs = [("Home", "/"), ("Library", "/glossary"), (t["term"], "/glossary/" + slug)]
    related = " &middot; ".join('<a href="/glossary/' + r + '">' + esc(GBY[r]["term"]) + '</a>' if r in GBY else '<span class="muted">' + esc(r) + '</span>' for r in t.get("related", []))
    who = "".join("<li>" + esc(w) + "</li>" for w in t.get("whoItAffects", []))
    sources = "".join('<li><a href="' + esc(s["url"]) + '" rel="nofollow noopener" target="_blank">' + esc(s["label"]) + '</a></li>' for s in t.get("sources", []))
    rv = t.get("reviewer") or {}
    body = ('<h1>What is ' + esc(t["term"]) + '?</h1><p class="lead">' + esc(t["shortDefinition"]) + '</p>'
            '<h2>In plain terms</h2><p>' + esc(t["plain"]) + '</p>'
            + (("<h2>Who it affects</h2><ul>" + who + "</ul>") if who else "")
            + (("<h2>Related terms</h2><p>" + related + "</p>") if related else "")
            + '<div class="card" style="margin-top:22px"><h3>Trust &amp; review</h3>'
            '<p class="muted" style="font-size:.9rem">Reviewed by ' + esc(rv.get("name", "pending"))
            + ((" (" + esc(rv.get("role")) + ")") if rv else "") + ' &middot; Last reviewed ' + esc(t["lastReviewed"]) + ' &middot; '
            'Version ' + esc(t["version"]) + ' &middot; Status <span class="tag ' + ("live" if t["status"] == "published" else "draft") + '">' + esc(t["status"]) + '</span></p>'
            + (("<strong>Sources</strong><ul>" + sources + "</ul>") if sources else "") + '</div>'
            '<div class="cta"><a class="btn primary" href="/navigator">Use the Benefit Navigator</a><a class="btn ghost" href="/glossary">Back to the Library</a></div>')
    return page("What is " + t["term"] + "?", t["shortDefinition"], body, "/glossary", glossary_graph(t, crumbs),
                crumbs=crumbs, site=site, path="/glossary/" + slug)

def view_trust(site):
    rows = "".join('<tr><td><a href="/glossary/' + t["slug"] + '">' + esc(t["term"]) + '</a></td>'
                   '<td><span class="tag ' + ("live" if t["status"] == "published" else "draft") + '">' + esc(t["status"]) + '</span></td>'
                   '<td>' + esc((t.get("reviewer") or {}).get("name", "—")) + '</td><td>' + esc(t["lastReviewed"]) + '</td><td>' + esc(t["version"]) + '</td></tr>'
                   for t in GLOSSARY)
    body = ('<h1>Trust &amp; Sources</h1><p class="sub">Federal benefits and healthcare are YMYL content. Trust is engineered, not assumed.</p>'
            '<div class="grid cols-2">'
            '<div class="card"><h3>Clinician review</h3><p class="sub">Every page moves <code>Draft &rarr; SME review &rarr; Approved &rarr; Published</code>. A named, credentialed reviewer signs each page.</p></div>'
            '<div class="card"><h3>Source citations</h3><p class="sub">Every benefits claim cites a primary authority &mdash; DOL/DEEOIC, OWCP/FECA, or VA. Coverage is framed as &ldquo;generally covered when authorized.&rdquo;</p></div>'
            '<div class="card"><h3>Version history</h3><p class="sub">Each definition carries a version and a last-reviewed date. A quarterly re-review keeps content current.</p></div>'
            '<div class="card"><h3>Update tracking</h3><p class="sub">Changes are versioned at the content-model level so corrections are auditable.</p></div></div>'
            '<h2>Live content register</h2><table><thead><tr><th>Term</th><th>Status</th><th>Reviewer</th><th>Last reviewed</th><th>Version</th></tr></thead>'
            '<tbody>' + rows + '</tbody></table>')
    return page("Trust & Sources", "How Alara engineers trust: clinician review, citations, versioning.", body, "/trust",
                basic_graph("Trust & Sources", "/trust", [("Home", "/"), ("Trust & Sources", "/trust")]),
                crumbs=[("Home", "/"), ("Trust & Sources", "/trust")], site=site, path="/trust")

# ---- the three pillars (definitive program reference pages) ------------------
PILLARS = {
  "eeoicpa": {
    "num": "01", "nav": "EEOICPA / White Card", "title": "EEOICPA & the White Card",
    "h1": "EEOICPA and the White Card, explained.",
    "meta": "What the EEOICPA White Card covers at home, who qualifies, and how to use it — a plain-language, source-cited reference for DOE and Nevada Test Site workers and their families.",
    "lede": "The Energy Employees Occupational Illness Compensation Program Act &mdash; EEOICPA &mdash; provides compensation and lifetime medical benefits to Department of Energy and Nevada Test Site workers who became ill from their work. When a condition is accepted, the worker receives a White Card and covered care, including skilled care at home, at no out-of-pocket cost.",
    "glance": [("Administered by", "U.S. DOL &mdash; DEEOIC"), ("Part B", "$150,000 + lifetime medical"), ("Part E", "Up to $250,000"), ("The White Card", "Medical-benefits ID for accepted conditions"), ("Out-of-pocket cost", "None, for covered care")],
    "overview": [
      "<p>EEOICPA was enacted in 2000 to compensate the men and women who built and maintained the nation&rsquo;s nuclear-weapons complex and later developed serious illnesses. It is administered by the U.S. Department of Labor through the Division of Energy Employees Occupational Illness Compensation (DEEOIC).</p>",
      "<p>The program has two parts. <strong>Part B</strong> covers radiation-induced cancers, chronic beryllium disease, and silicosis, paying a lump sum of $150,000 plus lifetime medical benefits. <strong>Part E</strong> covers a broader range of illnesses caused by toxic exposure at DOE facilities, and can pay up to $250,000 for wage loss and impairment in addition to medical coverage.</p>",
      "<p>When a condition is accepted, the worker &mdash; or an eligible survivor &mdash; receives a <strong>White Card</strong>, a medical-benefits identification card used like an insurance card to obtain covered care for the accepted condition. There are no premiums, copays, or deductibles for that care.</p>"],
    "eligibility_intro": "EEOICPA covers workers across the DOE nuclear-weapons complex, including:",
    "eligibility": ["Department of Energy employees and their contractors and subcontractors", "Atomic Weapons Employer (AWE) workers", "Nevada Test Site and Tonopah Test Range workers", "Members of the Special Exposure Cohort (SEC), who qualify with fewer requirements", "Eligible survivors, who may file using Form EE-2"],
    "covered_intro": "Once a condition is accepted, the White Card covers physician-ordered care at home, including:",
    "covered": ["Skilled nursing &mdash; wound care, IV / infusion therapy, medication management", "Physical and occupational therapy", "Home health aide services", "Medical social work and benefits navigation", "Caregiver training, and in many cases a paid family caregiver", "Durable medical equipment and home-safety modifications", "Travel reimbursement for covered care"],
    "misunderstandings": [
      ("&ldquo;I have Medicare, so I can&rsquo;t use the White Card.&rdquo;", "You can have both. The White Card and Medicare operate independently &mdash; neither cancels the other, and the White Card pays for your accepted condition."),
      ("&ldquo;It only covers my original diagnosis.&rdquo;", "A <em>consequential condition</em> &mdash; a new problem caused by your accepted condition or its treatment &mdash; can also be covered once the Department of Labor accepts it."),
      ("&ldquo;Home health isn&rsquo;t covered, only doctor visits.&rdquo;", "Skilled home health is covered. Many White Card holders are never told the full scope of what they are entitled to."),
      ("&ldquo;There will be bills.&rdquo;", "For covered care tied to an accepted condition, there is no out-of-pocket cost.")],
    "faqs": [
      ("Does the White Card cover home health care?", "Yes. Physician-ordered home health &mdash; skilled nursing, wound care, therapy, and home health aide services &mdash; is covered at no out-of-pocket cost for approved beneficiaries."),
      ("Can I get paid to care for my family member?", "Under EEOICPA in-home care benefits, a family member who already provides daily care may be able to be employed and paid to provide it, with RN supervision, when authorized."),
      ("Can I use the White Card and Medicare at the same time?", "Yes. They operate independently and do not cancel each other."),
      ("What is a consequential condition?", "A new illness or injury that results from an already-accepted condition or its treatment, which may also become covered after Department of Labor approval."),
      ("How do I get a White Card?", "File an EEOICPA claim &mdash; Form EE-1 as a worker, or EE-2 as a survivor &mdash; with the Department of Labor. The DOL Las Vegas Resource Center can help. When a condition is accepted, the White Card is issued.")],
    "glossary": ["white-card", "eeoicpa", "eeoicpa-part-b", "eeoicpa-part-e", "consequential-condition", "impairment-evaluation"],
    "questions": [("Does the White Card cover home health?", "/navigator?node=ans-eeoicpa-hh"), ("Can I get paid to care for my family member?", "/navigator?node=ans-paid-caregiver"), ("Can I have the White Card and Medicare?", "/navigator?node=ans-white-card-medicare")],
    "sources": [("U.S. Department of Labor &mdash; EEOICP", "https://www.dol.gov/agencies/owcp/energy")],
  },
  "owcp": {
    "num": "02", "nav": "Federal Workers Compensation", "title": "Federal Workers Compensation (OWCP / FECA)",
    "h1": "Federal Workers Compensation, explained.",
    "meta": "How Federal Workers Compensation (OWCP / FECA) covers home health for federal and postal employees — eligibility, covered services, and how to access it. A source-cited reference.",
    "lede": "The Federal Employees&rsquo; Compensation Act (FECA), administered by the Department of Labor&rsquo;s Office of Workers&rsquo; Compensation Programs (OWCP), provides medical care and wage replacement to federal and postal employees with work-related injuries or illnesses. When a claim is accepted and a physician orders it, OWCP can authorize skilled care at home at no out-of-pocket cost.",
    "glance": [("Administered by", "U.S. DOL &mdash; OWCP (DFEC)"), ("The law", "Federal Employees&rsquo; Compensation Act"), ("Who", "Federal &amp; postal employees"), ("To access", "Physician order + OWCP authorization"), ("Out-of-pocket cost", "None, when authorized")],
    "overview": [
      "<p>OWCP &mdash; the Office of Workers&rsquo; Compensation Programs &mdash; administers federal workers&rsquo; compensation. For federal and postal employees, the governing law is the Federal Employees&rsquo; Compensation Act (FECA), handled by OWCP&rsquo;s Division of Federal Employees&rsquo;, Longshore and Harbor Workers&rsquo; Compensation (DFEC).</p>",
      "<p>When a federal or postal worker is injured or made ill on the job and the claim is accepted, FECA covers the medical care required to treat the accepted condition. With a physician&rsquo;s order and OWCP authorization, that care can include skilled home health &mdash; at no out-of-pocket cost.</p>",
      "<p>Alara handles the authorization process with OWCP, so patients and families do not have to navigate it alone.</p>"],
    "eligibility_intro": "FECA covers civilian federal and postal employees, including:",
    "eligibility": ["United States Postal Service (USPS) employees", "Department of Veterans Affairs and other agency civilian staff", "Federal law enforcement and TSA personnel", "Department of Defense civilian employees", "Other federal employees with an accepted, work-related condition"],
    "covered_intro": "When OWCP authorizes care, FECA can cover physician-ordered home health, including:",
    "covered": ["Skilled nursing &mdash; wound care, medication management, post-surgical care", "Physical and occupational therapy", "Home health aide services", "Care coordination across providers"],
    "misunderstandings": [
      ("&ldquo;OWCP doesn&rsquo;t cover care at home.&rdquo;", "It can. When a physician orders home health for an accepted condition and OWCP authorizes it, the care is covered."),
      ("&ldquo;I&rsquo;ll have to fight for the authorization myself.&rdquo;", "We handle the authorization with OWCP, and our scheduling blocks visits without a valid authorization number."),
      ("&ldquo;Postal workers aren&rsquo;t federal employees for this.&rdquo;", "USPS employees are covered by FECA the same way as other federal employees.")],
    "faqs": [
      ("Does OWCP cover home health care?", "Yes. When a claim is accepted, a physician orders it, and OWCP authorizes it, home health is covered at no out-of-pocket cost."),
      ("How do federal workers qualify?", "Your work-related injury or illness must be accepted by OWCP, and a physician must order the home health care."),
      ("Who pays for the care?", "OWCP pays for authorized care tied to your accepted condition; there is no out-of-pocket cost to you."),
      ("Are postal workers covered?", "Yes. USPS employees are covered under FECA like other federal employees.")],
    "glossary": ["owcp", "feca", "home-health", "wound-care"],
    "questions": [("Does OWCP pay for home health?", "/navigator?node=ans-owcp-hh"), ("How do federal workers qualify?", "/navigator?node=owcp-need")],
    "sources": [("U.S. Department of Labor &mdash; OWCP / FECA", "https://www.dol.gov/agencies/owcp/FECA")],
  },
  "veterans": {
    "num": "03", "nav": "Veterans / VA Community Care", "title": "Veterans & VA Community Care",
    "h1": "VA Community Care for veterans, explained.",
    "meta": "How eligible veterans get home health through VA Community Care (TriWest, Region 4) — eligibility, covered services, and the referral process. No Medicare required.",
    "lede": "When the VA cannot readily provide care directly, eligible veterans can receive skilled home health from approved community providers through the VA Community Care Network (CCN). Alara is a CCN provider for Region 4 through TriWest Healthcare Alliance &mdash; no Medicare required.",
    "glance": [("Administered by", "U.S. Department of Veterans Affairs"), ("Network", "VA Community Care Network"), ("Region 4", "TriWest Healthcare Alliance"), ("To access", "VA referral + authorization"), ("Medicare", "Not required")],
    "overview": [
      "<p>VA Community Care lets the VA authorize care from approved community providers when it cannot deliver that care directly &mdash; for example, when demand exceeds capacity or specialized home care is needed.</p>",
      "<p>In the western United States, including Nevada (Region 4), the network is administered by TriWest Healthcare Alliance. Alara is a CCN provider, so a veteran referred through Community Care can receive skilled home health from our nurses.</p>",
      "<p>Veterans do not need Medicare to use VA Community Care, and the PACT Act has expanded coverage for veterans exposed to burn pits, contaminated water, and other hazards.</p>"],
    "eligibility_intro": "Eligibility for VA Community Care home health generally requires:",
    "eligibility": ["Enrollment in VA health care", "A VA referral and authorization for community care", "A provider order for skilled home health", "PACT Act toxic-exposure conditions may expand what the VA covers"],
    "covered_intro": "Through Community Care, eligible veterans can receive physician-ordered home health, including:",
    "covered": ["Skilled nursing &mdash; wound care, medication management, chronic-disease management", "Physical and occupational therapy", "Home health aide services", "Post-hospitalization and hospital-avoidance care"],
    "misunderstandings": [
      ("&ldquo;I need Medicare to get VA home health.&rdquo;", "You do not. VA Community Care does not require Medicare."),
      ("&ldquo;Community Care means the VA wait still applies.&rdquo;", "Community Care exists precisely to provide access when the VA cannot deliver care directly &mdash; often faster."),
      ("&ldquo;Only the VA hospital can provide my home care.&rdquo;", "Approved community providers in the network, like Alara, deliver authorized home health.")],
    "faqs": [
      ("Am I eligible for VA home care without Medicare?", "Yes. VA Community Care does not require Medicare. Eligibility is based on VA enrollment and a referral and authorization."),
      ("How does VA Community Care work?", "When the VA cannot deliver care directly, it authorizes a community provider in its network (TriWest, Region 4) to provide it."),
      ("Does the VA cover home wound care?", "Yes. Eligible veterans can receive skilled home wound care through Community Care when referred and authorized.")],
    "glossary": ["community-care", "triwest", "home-health", "wound-care"],
    "questions": [("Am I eligible for VA home care without Medicare?", "/navigator?node=ans-va-hh"), ("Does the VA cover home wound care?", "/navigator?node=ans-va-wound")],
    "sources": [("U.S. Department of Veterans Affairs &mdash; Community Care", "https://www.va.gov/communitycare/")],
  },
}

def view_pillar(site, slug):
    p = PILLARS.get(slug)
    if not p: return None
    glance = "".join('<div class="glance__row"><span class="glance__k">' + k + '</span><span class="glance__v">' + v + '</span></div>' for (k, v) in p["glance"])
    elig = "".join('<li>' + i + '</li>' for i in p["eligibility"])
    cov = "".join('<li>' + i + '</li>' for i in p["covered"])
    myth = "".join('<div class="myth"><p class="myth__m">' + m + '</p><p class="myth__r">' + r + '</p></div>' for (m, r) in p["misunderstandings"])
    faqs_html = "".join('<div class="faq__item"><div class="faq__q">' + q + '</div><div class="faq__a">' + a + '</div></div>' for (q, a) in p["faqs"])
    gloss = "".join(('<a class="chip" href="/glossary/' + g + '">' + esc(GBY[g]["term"]) + '</a>') if g in GBY else ('<span class="chip">' + esc(g) + '</span>') for g in p["glossary"])
    qs = "".join('<li><a href="' + h + '">' + q + '</a></li>' for (q, h) in p["questions"])
    srcs = "".join('<li><a href="' + u + '" rel="nofollow noopener" target="_blank">' + l + '</a></li>' for (l, u) in p["sources"])
    crumbs = [("Home", "/"), ("Programs", "/#programs"), (p["nav"], "/programs/" + slug)]
    g = basic_graph(p["title"], "/programs/" + slug, crumbs)
    g["@graph"].append({"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for (q, a) in p["faqs"]]})
    body = (
      '<article class="pillar">'
        '<p class="eyebrow">Federal program reference &middot; ' + p["num"] + '</p>'
        '<h1 class="pillar__h1">' + p["h1"] + '</h1>'
        '<p class="pillar__lede">' + p["lede"] + '</p>'
        '<div class="pillar__body"><div class="pillar__main">'
          '<section class="pillar__sec"><h2>Program overview</h2>' + "".join(p["overview"]) + '</section>'
          '<section class="pillar__sec"><h2>Who qualifies</h2><p>' + p["eligibility_intro"] + '</p><ul class="ticks">' + elig + '</ul></section>'
          '<section class="pillar__sec"><h2>What&rsquo;s covered at home</h2><p>' + p["covered_intro"] + '</p><ul class="ticks">' + cov + '</ul></section>'
          '<section class="pillar__sec"><h2>Common misunderstandings</h2>' + myth + '</section>'
          '<section class="pillar__sec"><h2>Frequently asked questions</h2><div class="faq">' + faqs_html + '</div></section>'
          '<section class="pillar__sec"><h2>Keep reading</h2>'
            '<p class="related__lab">Related glossary terms</p><div class="chips">' + gloss + '</div>'
            '<p class="related__lab">Related questions</p><ul class="qlinks">' + qs + '</ul></section>'
          '<section class="pillar__sec sources"><p class="sources__lab">Sources</p><ul>' + srcs + '</ul>'
            '<p class="reviewer">Reviewed by [Director of Nursing, RN] &middot; last reviewed [pending] &middot; updated as the rules change.</p></section>'
        '</div><aside class="pillar__rail">'
          '<div class="glance"><p class="glance__lab">At a glance</p>' + glance + '</div>'
          '<div class="pillar__cta"><p class="pillar__cta-h">Questions about your benefits?</p>'
            '<p class="pillar__cta-p">A nurse who knows this program will walk you through it.</p>'
            '<a class="btn btn--ink" href="tel:+17028149630">Talk to a nurse</a>'
            '<a class="btn btn--line" href="/navigator">See if you qualify</a></div>'
        '</aside></div>'
      '</article>')
    return page(p["title"], p["meta"], body, "/#programs", g, crumbs=crumbs, site=site, path="/programs/" + slug)

# ---- robots / sitemap --------------------------------------------------------
def robots_txt(site):
    if not site["indexable"]:
        return "User-agent: *\nDisallow: /\n"
    lines = ["User-agent: *", "Allow: /", "Disallow: /api/", ""]
    for bot in ["ClaudeBot", "anthropic-ai", "GPTBot", "OAI-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"]:
        lines += ["User-agent: " + bot, "Allow: /", ""]
    lines += ["Sitemap: " + PROD_CANONICAL + "/sitemap.xml", ""]
    return "\n".join(lines)

def sitemap_xml(site):
    if not site["indexable"]:
        return None  # disabled on staging
    today = datetime.date.today().isoformat()
    urls = "".join("<url><loc>" + PROD_CANONICAL + p + "</loc><lastmod>" + today + "</lastmod></url>" for p in public_paths())
    return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + '</urlset>'

# ---- server ------------------------------------------------------------------
MIME = {".css": "text/css", ".js": "application/javascript", ".json": "application/json",
        ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon"}

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, ctype, body, extra=None):
        if isinstance(body, str): body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra:
            for k, v in extra.items(): self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, *a): pass

    def site(self):
        return site_context(self.headers.get("Host", ""))

    def do_POST(self):
        if urlparse(self.path).path == "/api/event":
            ln = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(ln) if ln else b"{}"
            try: ev = json.loads(raw or b"{}")
            except Exception: ev = {}
            rec = {"ts": datetime.datetime.utcnow().isoformat(), "type": str(ev.get("type"))[:40],
                   "nodeId": str(ev.get("nodeId"))[:60], "label": str(ev.get("label"))[:120]}
            with open(os.path.join(HERE, "data", "analytics.log"), "a") as f: f.write(json.dumps(rec) + "\n")
            self.send_response(204); self.end_headers(); return
        self.send_response(404); self.end_headers()

    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        site = self.site()
        u = urlparse(self.path); p = u.path
        try:
            if p == "/healthz": return self._send(200, "text/plain", "ok")
            # Indexing control (mode + host aware)
            if p == "/robots.txt":
                return self._send(200, "text/plain; charset=utf-8", robots_txt(site))
            if p == "/sitemap.xml":
                sm = sitemap_xml(site)
                if sm is None:
                    return self._send(404, "text/plain", "sitemap disabled on staging")
                return self._send(200, "application/xml; charset=utf-8", sm)
            if p.startswith("/public/"):
                fn = os.path.normpath(os.path.join(HERE, "public", p[len("/public/"):]))
                if not fn.startswith(os.path.join(HERE, "public")): return self._send(403, "text/plain", "Forbidden")
                if not os.path.exists(fn): return self._send(404, "text/plain", "Not found")
                with open(fn, "rb") as f: data = f.read()
                ext = os.path.splitext(fn)[1]
                cache = {"Cache-Control": "no-store"} if ext in (".css", ".js") else {"Cache-Control": "public, max-age=3600"}
                return self._send(200, MIME.get(ext, "application/octet-stream"), data, cache)
            if p == "/api/navigator": return self._send(200, "application/json", json.dumps(NAV))
            if p == "/api/graph": return self._send(200, "application/json", json.dumps(GRAPH))
            if p == "/": return self._send(200, "text/html; charset=utf-8", view_home(site))
            if p == "/navigator": return self._send(200, "text/html; charset=utf-8", view_navigator(site))
            if p == "/glossary": return self._send(200, "text/html; charset=utf-8", view_glossary_index(site))
            if p.startswith("/glossary/"):
                parts = p.split("/")
                out = view_glossary_term(site, parts[2] if len(parts) > 2 else "")
                return self._send(200 if out else 404, "text/html; charset=utf-8",
                                  out or page("Not found", "", "<h1>Term not found</h1><p><a href='/glossary'>Back</a></p>", "/glossary", site=site, path=p))
            if p.startswith("/programs/"):
                parts = p.split("/")
                out = view_pillar(site, parts[2] if len(parts) > 2 else "")
                return self._send(200 if out else 404, "text/html; charset=utf-8",
                                  out or page("Not found", "", "<h1>Program not found</h1><p><a href='/#programs'>Back to programs</a></p>", "/", site=site, path=p))
            if p == "/graph":
                # internal-only view; always noindex (covered by staging, and excluded from sitemap)
                byt = {}
                for n in GRAPH["nodes"]: byt.setdefault(n["type"], []).append(n)
                cards = "".join('<div class="card"><h3>' + esc(ty) + ' <span class="muted">(' + str(len(ns)) + ')</span></h3><p class="sub" style="font-size:.88rem">' + esc(" &middot; ".join(n["label"] for n in ns)) + '</p></div>' for ty, ns in sorted(byt.items()))
                body = '<h1>Knowledge Graph</h1><p class="sub">' + str(len(NBYID)) + ' entities, ' + str(len(GRAPH["edges"])) + ' relationships.</p><div class="grid cols-2">' + cards + '</div>'
                return self._send(200, "text/html; charset=utf-8", page("Knowledge Graph", "Internal graph view.", body, "/", site=site, path="/graph"))
            if p == "/trust": return self._send(200, "text/html; charset=utf-8", view_trust(site))
            return self._send(404, "text/html; charset=utf-8", page("Not found", "", "<h1>404 &mdash; Not found</h1><p><a href='/'>Home</a></p>", "/", site=site, path=p))
        except Exception:
            import traceback; traceback.print_exc()
            return self._send(500, "text/html; charset=utf-8", page("Error", "", "<h1>Something went wrong</h1>", "/", site=site, path=p))

if __name__ == "__main__":
    print("AlaraOS on http://localhost:%d  (SITE_MODE=%s)" % (PORT, SITE_MODE))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
