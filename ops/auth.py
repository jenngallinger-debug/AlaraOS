"""Minimal auth + RBAC for the internal ops console.

The marketing site has no auth; this introduces the smallest practical model:
a stateless HMAC-signed session cookie carrying user id + expiry. Login is gated
by a shared OPS_PASSWORD (env) and a seeded user identity. The whole console is
noindex and sits behind the staging guard, so this is appropriate for v0; it is
migration-ready (swap the cookie verifier for the full IDP/Auth0 later).
"""
import os
import hmac
import hashlib
import datetime

from . import db

SESSION_COOKIE = "alara_ops_session"
SESSION_TTL_HOURS = 12


def _secret():
    return (os.environ.get("OPS_SECRET") or "alara-dev-secret-change-me").encode("utf-8")


def _password():
    return os.environ.get("OPS_PASSWORD") or "alara-dev"


def _sign(value):
    return hmac.new(_secret(), value.encode("utf-8"), hashlib.sha256).hexdigest()


def make_session(user_id):
    exp = (datetime.datetime.now(datetime.timezone.utc)
           + datetime.timedelta(hours=SESSION_TTL_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = "%s|%s" % (user_id, exp)
    return "%s|%s" % (payload, _sign(payload))


def _parse_token(token):
    try:
        user_id, exp, sig = token.split("|")
    except (ValueError, AttributeError):
        return None
    payload = "%s|%s" % (user_id, exp)
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    if exp < datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"):
        return None
    return user_id


def cookie_from_header(cookie_header):
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == SESSION_COOKIE:
            return v
    return None


def current_user(headers):
    """Resolve the logged-in user (dict) from request headers, or None."""
    token = cookie_from_header(headers.get("Cookie", "") if headers else "")
    if not token:
        return None
    uid = _parse_token(token)
    if not uid:
        return None
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM app_user WHERE id=? AND active=1", (uid,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def verify_login(user_id, password):
    if not hmac.compare_digest(password or "", _password()):
        return None
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM app_user WHERE id=? AND active=1 AND role != 'system'",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def login_choices():
    """Active, non-system users offered on the login screen."""
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, role FROM app_user WHERE active=1 AND role != 'system' "
            "ORDER BY role"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def set_cookie_header(token):
    return ("%s=%s; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=%d"
            % (SESSION_COOKIE, token, SESSION_TTL_HOURS * 3600))


def clear_cookie_header():
    return "%s=; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=0" % SESSION_COOKIE


# --- RBAC ---------------------------------------------------------------------
class Forbidden(PermissionError):
    pass


def require(user, allowed_roles):
    if user is None:
        raise Forbidden("authentication required")
    if "*" in allowed_roles:
        return user
    if user["role"] not in allowed_roles and user["role"] != "admin":
        raise Forbidden("role '%s' not permitted (need one of %s)"
                        % (user["role"], ", ".join(allowed_roles)))
    return user
