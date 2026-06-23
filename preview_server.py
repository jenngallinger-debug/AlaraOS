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

NAVBAR = [("/", "Home"), ("/navigator", "Benefit Navigator"),
          ("/glossary", "Federal Benefits Library"), ("/trust", "Trust & Sources")]

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
        "<nav class=\"mainnav\" aria-label=\"Primary\">" + nav + "</nav></header>"
        + main_open + crumbs_html(crumbs) + body + "</main>"
        "<footer class=\"site\"><p><strong>Alara Home Care</strong> &middot; Nurse-led home health &middot; Las Vegas / Clark County / Southern Nevada &middot; (702) 814-9630</p>"
        "<p class=\"muted\">Educational information, not a benefits determination. We help you work with your Resource Center, physician, and the VA &mdash; we do not replace them.</p></footer>"
        "</body></html>")

# ---- homepage ----------------------------------------------------------------
ENTRY_POINTS = [
    ("EEOICPA / White Card", "Former Nevada Test Site &amp; DOE workers. Covered home health at no cost to you.", "/navigator?node=eeoicpa-need"),
    ("Federal Workers / OWCP", "Federal and postal employees with an accepted work injury or illness.", "/navigator?node=owcp-need"),
    ("Veterans / VA Community Care", "Skilled home health through the VA Community Care Network, Region 4.", "/navigator?node=va-need"),
    ("Physicians &amp; Referral Partners", "Refer a patient. A nurse assesses within 48 hours. One-hour response.", "/navigator?node=by-who"),
]
TRUST_POINTS = [
    ("Resource Centers", "We know the EEOICPA authorization process and the consequential-condition pathway, and we work alongside the DOL Las Vegas Resource Center."),
    ("Physicians", "A Director of Nursing reviews every case. Documentation is accurate, coding is clean, and you reach our clinical team within one hour."),
    ("Families", "Most patients pay nothing out of pocket. We handle the paperwork and explain every step in plain language."),
    ("Patients", "Nurse-led, locally owned care across Clark County, built around your goals, not just your diagnosis."),
]

def view_home(site):
    entry = "".join(
        '<a class="ep-card" href="' + href + '"><span class="ep-card__arch" aria-hidden="true"></span>'
        '<span class="ep-card__body"><span class="ep-card__title">' + label + '</span>'
        '<span class="ep-card__desc">' + desc + '</span>'
        '<span class="ep-card__go">Explore <i aria-hidden="true">&rarr;</i></span></span></a>'
        for (label, desc, href) in ENTRY_POINTS)
    trust = "".join(
        '<div class="trust-card"><h3>' + t + '</h3><p>' + d + '</p></div>' for (t, d) in TRUST_POINTS)
    body = (
      '<section class="hero">'
        '<div class="hero__photo" role="img" aria-label="A grand travertine archway framing a brass door at the top of a wide staircase, drawing the eye upward toward the entrance"></div>'
        '<div class="hero__scrim"></div>'
        '<div class="hero__inner"><div class="hero__copy">'
          '<p class="hero__eyebrow">The federal-benefits home-care authority</p>'
          '<h1 class="hero__title">Understanding federal benefits.<br>Delivering care at home.</h1>'
          '<p class="hero__lead">Nurse-led skilled care at home for White Card, federal-worker, and veteran families across Southern Nevada.</p>'
          '<div class="hero__cta">'
            '<a class="btn btn--paper" href="/navigator">Find out if you qualify</a>'
            '<a class="btn btn--on-image" href="/navigator?node=by-who">Refer a patient</a>'
          '</div>'
          '<p class="hero__note">Free, about ten minutes, no obligation</p>'
        '</div></div>'
      '</section>'

      '<section class="band">'
        '<p class="eyebrow center">Start where you are</p>'
        '<h2 class="center">Four ways in</h2>'
        '<div class="ep-grid">' + entry + '</div>'
      '</section>'

      '<section class="band band--tint feature">'
        '<div class="feature__row">'
          '<div class="feature__text"><p class="eyebrow">Benefit Navigator</p>'
            '<h2>Not sure where you fit?</h2>'
            '<p class="sub">Answer a few plain questions and reach a clear, sourced answer about your coverage and your next step. It does not replace your Resource Center or physician. It helps you work with them.</p>'
            '<a class="btn btn--ink" href="/navigator">Open the Benefit Navigator</a></div>'
          '<div class="feature__mark"><span class="big-arch" aria-hidden="true"></span></div>'
        '</div>'
      '</section>'

      '<section class="band feature">'
        '<div class="feature__row reverse">'
          '<div class="feature__text"><p class="eyebrow">Federal Benefits Library</p>'
            '<h2>The benefits, in plain language.</h2>'
            '<p class="sub">Clinician-reviewed, source-cited explanations of the White Card, EEOICPA, OWCP, VA Community Care, and the care they cover. Written to be understood, and built to be cited.</p>'
            '<a class="btn btn--ink" href="/glossary">Open the Library</a></div>'
          '<div class="feature__mark"><span class="big-arch" aria-hidden="true"></span></div>'
        '</div>'
      '</section>'

      '<section class="band">'
        '<p class="eyebrow center">Quiet authority</p>'
        '<h2 class="center">Why Resource Centers, physicians, families, and patients use Alara</h2>'
        '<div class="trust-grid">' + trust + '</div>'
      '</section>'

      '<section class="convert-band">'
        '<div class="convert-band__inner">'
          '<div><h2>Talk to a nurse.</h2><p>Free, about ten minutes, no obligation. We will tell you honestly whether Alara is the right fit.</p></div>'
          '<div class="convert-band__cta">'
            '<a class="btn btn--paper" href="tel:+17028149630">(702) 814-9630</a>'
            '<a class="btn btn--on-image" href="/navigator">Find out if you qualify</a>'
          '</div>'
        '</div>'
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
