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

NAVBAR = [("/#programs", "Programs"), ("/glossary", "Resources"),
          ("/#physicians", "For Physicians"), ("/trust", "About")]

# Public URLs included in the production sitemap.
def public_paths():
    paths = ["/", "/navigator", "/glossary", "/trust"]
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
        "<span style=\"display:flex;flex-direction:column;gap:3px;line-height:1\"><strong>ALARA</strong><span>HOME CARE</span></span></a>"
        "<nav class=\"mainnav\" aria-label=\"Primary\">" + nav + "</nav>"
        "<div class=\"headcta\"><a class=\"head-phone\" href=\"tel:+17028149630\">(702)&nbsp;814-9630</a>"
        "<a class=\"btn btn--ink btn--sm\" href=\"/navigator\">Find out if you qualify</a></div></header>"
        + main_open + crumbs_html(crumbs) + body + "</main>"
        "<footer class=\"site\"><p><strong>Alara Home Care</strong> &middot; Nurse-led home health &middot; Las Vegas / Clark County / Southern Nevada &middot; (702) 814-9630</p>"
        "<p class=\"footer-cred\">Nevada Licensed Home Health Agency &middot; License&nbsp;#&nbsp;[pending] &middot; Medicare CCN&nbsp;#&nbsp;[pending] &middot; NPI&nbsp;[pending] &middot; VA Community Care &mdash; TriWest Region 4</p>"
        "<p class=\"muted\">Educational information, not a benefits determination. We help you work with your Resource Center, physician, and the VA &mdash; we do not replace them.</p></footer>"
        "</body></html>")

# ---- homepage ----------------------------------------------------------------
AUDIENCE_DOORS = [
    ("White Card / EEOICPA", "Former Nevada Test Site &amp; DOE workers. Covered skilled care at home, at no cost to you.", "/navigator?node=eeoicpa-need", "$0 out-of-pocket", False),
    ("Federal Workers / OWCP", "Federal and postal employees with an accepted work injury or illness.", "/navigator?node=owcp-need", "", False),
    ("Veterans / VA Community Care", "Eligible veterans through TriWest, Region 4. You do not need Medicare.", "/navigator?node=va-need", "", False),
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
     "U.S. Department of Labor, DEEOIC", "/glossary/eeoicpa"),
    ("02 &mdash; OWCP / FECA", "Injured on the job as a federal or postal worker? Your care can come home.",
     "When OWCP accepts your claim and your physician orders it, federal workers&rsquo; compensation can cover skilled nursing, therapy, and home health aide care &mdash; and we handle the authorization so you do not have to.",
     ["Covers federal &amp; postal employees", "FECA, administered by OWCP", "Physician order + OWCP authorization", "No out-of-pocket cost when authorized"],
     "U.S. Department of Labor, OWCP", "/glossary/owcp"),
    ("03 &mdash; VA Community Care", "Veterans can get home health through the VA &mdash; without the wait, and without Medicare.",
     "When the VA cannot deliver care directly, eligible veterans receive skilled home health through the Community Care Network. Alara is a TriWest provider for Region 4.",
     ["VA Community Care Network", "TriWest, Region 4", "Referral + authorization from the VA", "You do not need Medicare"],
     "U.S. Department of Veterans Affairs", "/glossary/community-care"),
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
    doors = "".join(
        '<a class="door' + (' door--invert' if inv else '') + '" href="' + href + '"><span class="door__arch" aria-hidden="true"></span>'
        '<span class="door__body"><span class="door__title">' + label + '</span>'
        '<span class="door__desc">' + desc + '</span>'
        '<span class="door__foot"><span class="door__go">Explore <i aria-hidden="true">&rarr;</i></span>'
        + (('<span class="door__tag">' + tag + '</span>') if tag else '') + '</span></span></a>'
        for (label, desc, href, tag, inv) in AUDIENCE_DOORS)
    qcols = ""
    for (grp, qs) in QUESTION_GROUPS:
        rows = "".join('<a class="q-row" href="' + h + '"><span class="q-txt">' + q + '</span><span class="q-arrow" aria-hidden="true">&rarr;</span></a>' for (q, h) in qs)
        qcols += '<div class="q-group"><p class="q-grp">' + grp + '</p>' + rows + '</div>'
    progs = ""
    for (eyb, head, lede, facts, src, href) in PROGRAMS:
        fl = "".join('<li>' + f + '</li>' for f in facts)
        progs += ('<article class="program"><div class="program__main">'
                  '<p class="program__eyb">Federal program &middot; ' + eyb + '</p>'
                  '<h3 class="program__title">' + head + '</h3><p class="program__lede">' + lede + '</p>'
                  '<p class="program__foot"><a class="program__cta" href="' + href + '">Read the brief &rarr;</a>'
                  '<span class="program__src">Source &mdash; ' + src + '</span></p></div>'
                  '<aside class="program__facts"><p class="facts__label">At a glance</p><ul>' + fl + '</ul></aside></article>')
    whys = "".join('<div class="why"><h3>' + t + '</h3><p>' + d + '</p></div>' for (t, d) in WHY_PILLARS)
    steps = "".join('<div class="step"><span class="step__n">' + str(i + 1).zfill(2) + '</span><h3>' + t + '</h3><p>' + d + '</p></div>' for i, (t, d) in enumerate(STEPS))
    body = (
      '<section class="hero">'
        '<div class="hero__text"><div class="hero__copy">'
          '<p class="hero__eyebrow">The federal-benefits home-care authority</p>'
          '<h1 class="hero__title">Understanding federal benefits.<br>Delivering care at home.</h1>'
          '<p class="hero__lead">Nurse-led skilled care at home for White Card, federal-worker, and veteran families across Southern Nevada.</p>'
          '<div class="hero__cta">'
            '<a class="btn btn--ink" href="/navigator">Find out if you qualify</a>'
            '<a class="btn btn--line" href="/navigator?node=by-who">Refer a patient</a>'
          '</div>'
        '</div></div>'
        '<div class="hero__media"><img class="hero__img" src="/public/hero-arches.webp" alt="A grand travertine archway framing a brass door at the top of a wide staircase" loading="eager"></div>'
      '</section>'

      '<section class="band" id="serve">'
        '<p class="eyebrow center">Who we serve</p>'
        '<h2 class="center">Care built for who you are</h2>'
        '<div class="door-grid">' + doors + '</div>'
      '</section>'

      '<section class="band band--tint" id="understand">'
        '<p class="eyebrow center">Start with answers</p>'
        '<h2 class="center editorial">Understand the benefits you have already earned.</h2>'
        '<p class="sub center mx">Most families are never told the full scope of what their White Card, OWCP, or VA benefits cover. We make it clear &mdash; in plain language, with sources.</p>'
        '<div class="engine-grid">'
          '<a class="engine-tile" href="/navigator"><span class="engine-out">Find out what&rsquo;s covered</span>'
          '<span class="engine-sub">Answer a few questions and reach a clear, sourced answer about your coverage and your next step.</span>'
          '<span class="engine-tool">Through the Benefit Navigator &rarr;</span></a>'
          '<a class="engine-tile" href="/glossary"><span class="engine-out">Read it in plain language</span>'
          '<span class="engine-sub">Clinician-reviewed, source-cited explanations of every program and the care it covers.</span>'
          '<span class="engine-tool">In the Federal Benefits Library &rarr;</span></a>'
        '</div>'
      '</section>'

      '<section class="band" id="questions">'
        '<p class="eyebrow center">Questions we answer every day</p>'
        '<h2 class="center editorial">The questions everyone asks &mdash; answered, with sources.</h2>'
        '<div class="q-index">' + qcols + '</div>'
        '<p class="q-foot center">Every answer is clinician-reviewed and cites the DOL, VA, or CMS. <a href="/glossary">Browse the library &rarr;</a></p>'
      '</section>'

      '<section class="band band--tint" id="programs">'
        '<p class="eyebrow center">Federal programs we serve</p>'
        '<h2 class="center editorial">What each program covers, and how to reach it.</h2>'
        '<div class="programs">' + progs + '</div>'
      '</section>'

      '<div class="authority-strip"><span>Nevada Licensed Home Health</span><span class="bar" aria-hidden="true"></span><span>VA Community Care Network</span><span class="bar" aria-hidden="true"></span><span>EEOICPA White Card Expertise</span><span class="bar" aria-hidden="true"></span><span>Federal Workers &amp; Veterans</span></div>'

      '<section class="band" id="why">'
        '<p class="eyebrow center">Why Alara</p>'
        '<h2 class="center">What makes the care different</h2>'
        '<div class="why-grid">' + whys + '</div>'
      '</section>'

      '<section class="band band--tint" id="about">'
        '<div class="founder">'
          '<div class="founder__photo"><span class="founder__ph">Real portrait<br>Jenn Gallinger, DON</span></div>'
          '<div class="founder__copy">'
            '<p class="eyebrow">The nurse who runs Alara</p>'
            '<div class="founder__name">Jenn Gallinger</div>'
            '<div class="founder__title">Director of Nursing &amp; Founder</div>'
            '<blockquote class="founder__quote">&ldquo;When we walk through someone&rsquo;s door, they are letting us in at the hardest moment of their lives. That is a responsibility I do not take lightly &mdash; and neither does anyone on this team.&rdquo;</blockquote>'
            '<p class="founder__cred">RN, DON &middot; 20+ years in healthcare &middot; reviews every start of care herself</p>'
          '</div>'
        '</div>'
      '</section>'

      '<section class="band" id="how">'
        '<p class="eyebrow center">How it works</p>'
        '<h2 class="center">Three steps, and we handle the rest</h2>'
        '<div class="steps">' + steps + '</div>'
      '</section>'

      '<section class="referral" id="physicians">'
        '<div class="referral__inner">'
          '<div class="referral__lead"><p class="eyebrow eyebrow--light">For physicians &amp; partners</p>'
            '<div class="referral__h">Your patients. Our paperwork.</div>'
            '<div class="referral__props"><span>In-home assessment within 48 hours</span><span>Documentation, ready to review</span><span>Every referral answered in one hour</span></div></div>'
          '<div class="referral__cta"><a class="btn btn--paper" href="tel:+17028149630">Refer a patient</a>'
            '<a class="btn btn--on-image" href="tel:+17252108285">Fax &middot; (725) 210-8285</a></div>'
        '</div>'
      '</section>'

      '<section class="band">'
        '<p class="proof center">Alara works alongside the DOL Las Vegas Resource Center and the VA Southern Nevada Healthcare System.</p>'
        '<div class="final"><h2 class="center">Talk to a nurse.</h2>'
        '<p class="sub center mx">A confidential conversation with a nurse who knows these programs. We will tell you honestly whether Alara is the right fit.</p>'
        '<div class="final__cta"><a class="btn btn--ink" href="tel:+17028149630">(702) 814-9630</a><a class="btn btn--line" href="/navigator">Find out if you qualify</a></div></div>'
      '</section>'
    )
    return page("Federal Benefits, Understood. Care at Home.",
                "Nurse-led home health in Las Vegas for EEOICPA White Card holders, federal and postal workers, and veterans, with a clear, source-cited federal benefits library.",
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
