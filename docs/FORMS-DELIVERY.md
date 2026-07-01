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

The server accepts **either provider** — set whichever key you have:
`SENDGRID_API_KEY` (Twilio SendGrid) or `RESEND_API_KEY` (Resend). If both
are set, SendGrid is used.

## Option A — you already have Twilio SendGrid (fastest)

1. **Make sure a verified sender exists.** SendGrid dashboard → *Settings →
   Sender Authentication*. Either the `alarahomecare.com` domain is
   authenticated, or a Single Sender (an email address) is verified. Note the
   verified address — SendGrid rejects sends "from" anything unverified.
2. **Create an API key.** *Settings → API Keys → Create API Key* →
   "Restricted Access" with only **Mail Send** enabled. Copy it (starts
   with `SG.`).
3. **Add it in Render.** Render dashboard → this service → *Environment* →
   add:
   - `SENDGRID_API_KEY` = the key
   - `EMAIL_FROM` = the verified sender from step 1 (only needed if it is
     not `website@alarahomecare.com`)
   - `EMAIL_TO` = where submissions arrive (default
     `referrals@alarahomecare.com`)
4. **Save.** Render restarts automatically.

## Option B — Resend (if starting from nothing)

1. **Create a Resend account** — <https://resend.com> (free tier: 3,000
   emails/month, far more than we need). Sign up with the business email.
2. **Verify the sending domain.** In Resend: *Domains → Add domain* →
   `alarahomecare.com`. Resend shows 3 DNS records (DKIM/SPF). Add them
   wherever the domain's DNS lives (Squarespace today). Wait for the green
   "Verified" check — usually minutes.
3. **Create an API key.** In Resend: *API Keys → Create*. Scope "Sending
   access" is enough. Copy the key (starts with `re_`).
4. **Add it in Render** as `RESEND_API_KEY` (same `EMAIL_TO`/`EMAIL_FROM`
   notes as above). Save; Render restarts automatically.

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
