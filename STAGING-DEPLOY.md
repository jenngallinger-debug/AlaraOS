# AlaraOS Staging Deploy — alarahc.com on Render

Goal: view/test the new AlaraOS build on **alarahc.com** while **alarahomecare.com stays on
Squarespace**, with **search engines blocked** until launch.

> What I can and can't do: I implemented and verified all the *code* (staging behavior + the
> homepage). The Render and GoDaddy steps are dashboard actions **you** perform — exact values
> below. Render runs the **Python** server (`preview_server.py`), which is the implementation I
> can fully verify; the Node `server.js` is kept as the parity target for later.

---

## A. Render — create the service + add the domain

**1. Create the web service** (Dashboard → New → Web Service → connect the repo):
- Runtime: **Python 3**
- Build command: `pip install -r requirements.txt` (no-op; zero dependencies)
- Start command: `python3 preview_server.py` (or `python3 preview_server.py` if the repo root is above the app — match your layout)
- Root directory: set to the folder containing `preview_server.py` **and** with `../content/data/` reachable (i.e. the repo must include both `alaraos/` and `content/`). The included `render.yaml` encodes this.
- Health check path: `/healthz`
- **Environment variable: `SITE_MODE = staging`**  ← this is the indexing guard.

**2. Add custom domains** (Service → Settings → Custom Domains → Add):
- Add `alarahc.com`
- Add `www.alarahc.com`
- Render then displays the **exact** DNS records to create. Use those exact values; the
  typical ones are below.
- TLS: Render auto-issues a Let's Encrypt certificate once DNS resolves. No manual cert.
- Set `alarahc.com` as the **primary** domain; Render will redirect `www` → apex automatically.

---

## B. GoDaddy DNS — for `alarahc.com` only (do NOT touch alarahomecare.com)

GoDaddy → your products → **alarahc.com** → DNS → Manage Zones.

**First, clear conflicts:** delete GoDaddy's default parked `A @` record and any `CNAME www`
pointing to parking; turn **off** Domain Forwarding if it's on.

**Then add (use the exact values Render shows — these are the standard Render values):**

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `216.24.57.1` (Render's anycast IP — confirm in the Render dashboard) | 600 |
| CNAME | `www` | `alaraos-staging.onrender.com` (your service's `.onrender.com` host) | 600 |

If Render shows an additional **verification** record (sometimes a TXT or a second CNAME), add
that too. GoDaddy does not support ALIAS/ANAME at the apex, so the apex uses Render's **A**
record (Render supports apex via that anycast IP).

> ⚠️ **alarahomecare.com is a different domain.** Do not open or change its DNS. It keeps
> pointing to Squarespace. No production records are touched. No production→staging redirects.

Propagation: usually minutes, up to a few hours.

---

## C. How the staging guard works (already built + verified)

Controlled by `SITE_MODE` **and** the request hostname (`lib`: `site_context()` in
`preview_server.py`). A page is indexable **only** when `SITE_MODE=production` **and** the host
is `alarahomecare.com` / `www.alarahomecare.com`. Everything else — `alarahc.com`,
`*.onrender.com`, `localhost` — is treated as staging:

| Behavior | Staging (alarahc.com / onrender / SITE_MODE=staging) | Production (alarahomecare.com + SITE_MODE=production) |
|---|---|---|
| `<meta name="robots">` | `noindex,nofollow` (+ visible "Staging preview" ribbon) | omitted (indexable) |
| `/robots.txt` | `User-agent: *` / `Disallow: /` | `Allow: /` + AI bots + `Sitemap:` line |
| `/sitemap.xml` | `404` (disabled) | full sitemap of public pages |
| `<link rel="canonical">` | `https://alarahc.com/...` (never points to production) | `https://www.alarahomecare.com/...` |

**Verified locally (browser + unit tests):** on `alarahc.com` → noindex present, canonical →
alarahc.com, robots.txt = Disallow all, sitemap = 404. With `SITE_MODE=production` + prod host →
indexable, prod canonical, robots+sitemap on, and **the staging domain still never indexes**.

---

## D. Verification commands (run after DNS propagates)

```bash
# DNS points to Render
dig +short alarahc.com A            # → Render's IP (e.g. 216.24.57.1)
dig +short www.alarahc.com          # → ...onrender.com

# Staging loads over HTTPS and is non-indexable
curl -sI https://alarahc.com | head -n1                 # → HTTP/2 200
curl -s  https://alarahc.com | grep -i 'name="robots"'  # → noindex,nofollow
curl -s  https://alarahc.com/robots.txt                 # → User-agent: * \n Disallow: /
curl -sI https://alarahc.com/sitemap.xml | head -n1     # → 404
curl -s  https://alarahc.com | grep -i 'rel="canonical"' # → https://alarahc.com/
curl -sI https://www.alarahc.com | head -n1             # → 200 or 301 → https://alarahc.com

# Production is untouched (still Squarespace)
curl -sI https://www.alarahomecare.com | head -n1       # → 200, served by Squarespace
dig +short alarahomecare.com                            # → unchanged Squarespace records
```

---

## E. Deployment checklist

- [ ] Render web service created from the repo (Python), **`SITE_MODE=staging`** set.
- [ ] `alarahc.com` + `www.alarahc.com` added as Render custom domains; `alarahc.com` primary.
- [ ] GoDaddy: `A @ → 216.24.57.1`, `CNAME www → <service>.onrender.com`, parking/forwarding removed, any Render verification record added.
- [ ] DNS resolves (`dig`); Render shows the domains as **Verified** + certificate **Issued**.
- [ ] `https://alarahc.com` loads the homepage with the real arches hero.
- [ ] `noindex,nofollow` present · `/robots.txt` = Disallow all · `/sitemap.xml` = 404 · canonical → alarahc.com.
- [ ] `https://www.alarahc.com` loads or 301s to apex; HTTPS valid on both.
- [ ] `alarahomecare.com` unchanged on Squarespace; its DNS never touched; no prod→staging redirects.

### Later — production cutover (NOT now)
- [ ] Set `SITE_MODE=production`, point `alarahomecare.com` at Render, verify indexable + production robots/sitemap, then retire Squarespace.

---

## F. Files changed/added this task
- `preview_server.py` — `site_context()` (SITE_MODE + host), `noindex`/canonical in `page()`,
  `/robots.txt` + `/sitemap.xml` routes, the **real homepage**, `.webp` MIME, HEAD support, health check.
- `public/app.css` — homepage styles (hero, four entry points, feature bands, trust grid,
  conversion band) + staging ribbon.
- `public/hero-arches.webp` — **new**, your real arches photograph (from the live site; Unsplash).
- `render.yaml`, `requirements.txt` — **new**, Render deploy config (Python).
- `STAGING-DEPLOY.md` — **new**, this document.
- Not changed yet: Node `server.js`/`render.js` (Render runs Python; Node parity is a fast-follow).
