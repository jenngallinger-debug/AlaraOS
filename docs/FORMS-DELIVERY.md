# Turning on form email delivery (the 10-minute checklist)

The website's three tools — **case review**, **refer a patient**, and **have a
nurse call me** — are already wired end-to-end. Today they run in fallback
mode: the case review and referral open a pre-filled email from the visitor's
own email app, and every submission is also written to `data/submissions.log`
on the server as a backup record.

The moment you add one API key in Render, delivery upgrades itself:
submissions are **emailed straight to the nurse inbox** and the visitor gets
an in-page confirmation instead of an email app popping open. No code change,
no redeploy of anything but the environment variable.

## What you do (once, ~10 minutes)

1. **Create a Resend account** — <https://resend.com> (free tier: 3,000
   emails/month, far more than we need). Sign up with the business email.
2. **Verify the sending domain.** In Resend: *Domains → Add domain* →
   `alarahomecare.com`. Resend shows 3 DNS records (DKIM/SPF). Add them
   wherever the domain's DNS lives (Squarespace today). Wait for the green
   "Verified" check — usually minutes.
3. **Create an API key.** In Resend: *API Keys → Create*. Scope "Sending
   access" is enough. Copy the key (starts with `re_`).
4. **Add it in Render.** Render dashboard → this service → *Environment* →
   add variable:
   - `RESEND_API_KEY` = the key you copied
   Optional overrides (defaults shown; only set them to change something):
   - `EMAIL_TO` = `referrals@alarahomecare.com` (where submissions arrive)
   - `EMAIL_FROM` = `website@alarahomecare.com` (must be on the verified domain)
5. **Save.** Render restarts the service automatically.

## How to check it worked

- Open `https://alarahc.com/api/config` — it should say
  `{"emailDelivery":true}`.
- Submit a test referral at `/refer` with your own name and number. You
  should see the in-page "Referral received." confirmation (no email app),
  and the email should land in the `EMAIL_TO` inbox within a minute.

## What happens on each submission (for reference)

| | Without key (today) | With key |
|---|---|---|
| Case review / referral | Opens a pre-filled email from the visitor's email app | Delivered to the inbox, in-page confirmation |
| "Have a nurse call me" (begin) | Logged on the server only | Emailed to the inbox + logged |
| Server log `data/submissions.log` | Always written | Always written |

**Note on the log:** Render's disk is ephemeral — the log is a same-day
safety net, not an archive. The email inbox is the system of record once the
key is live. Until the key is set, the begin page's call-back requests are
only in that log, so turning the key on is what makes that page fully real.

## If email ever fails

The server logs the submission first, then tries to send. A Resend outage or
a bad key never loses a submission and never shows the visitor an error — the
case-review and referral pages fall back to the pre-filled email flow.
