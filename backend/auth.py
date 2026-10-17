"""Authentication (spec 3, 15): staff/admin PIN (bcrypt) -> JWT; customer phone + mocked OTP -> JWT.
Phone numbers are stored only as an HMAC-SHA256 hash plus the last 4 digits."""
import hashlib
import hmac
import logging
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta

import bcrypt
import jwt

import config as C
from clock import now

log = logging.getLogger("queuesense.auth")


class AuthError(Exception):
    def __init__(self, code, message, status=401, hint=None):
        self.code, self.message, self.status, self.hint = code, message, status, hint


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=10)).decode()


def check_pin(pin: str, pin_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), pin_hash.encode())
    except ValueError:
        return False


def make_token(claims: dict) -> str:
    # Real wall time for expiry: tokens must not expire faster when the demo clock runs at 300x.
    body = dict(claims, exp=int(time.time() + C.JWT_HOURS * 3600), iat=int(time.time()))
    return jwt.encode(body, C.JWT_SECRET, algorithm="HS256")


def read_token(token: str) -> dict:
    try:
        return jwt.decode(token, C.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AuthError("INVALID_TOKEN", "Please log in again")


def normalize_phone(phone: str) -> str:
    """E.164, default +91."""
    digits = re.sub(r"[^\d+]", "", phone or "")
    if digits.startswith("+"):
        num = "+" + re.sub(r"\D", "", digits)
    else:
        d = re.sub(r"\D", "", digits)
        if len(d) == 12 and d.startswith("91"):
            d = d[2:]
        if len(d) == 11 and d.startswith("0"):
            d = d[1:]
        num = C.DEFAULT_COUNTRY_CODE + d
    if not re.fullmatch(r"\+\d{10,15}", num):
        raise AuthError("INVALID_PHONE", "Enter a valid mobile number", 400, "10 digits, e.g. 98765 43210")
    return num


def phone_hash(e164: str) -> str:
    return hmac.new(C.PHONE_PEPPER.encode(), e164.encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------------- rate limits
_hits = defaultdict(deque)


def rate_limit(key: str, limit: int, window_s: int, code="RATE_LIMITED", message="Too many attempts"):
    q = _hits[key]
    t = time.time()
    while q and t - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise AuthError(code, message, 429, f"Try again in {int(window_s - (t - q[0])) + 1} s")
    q.append(t)


# ---------------------------------------------------------------------------------- OTP (mocked)
_otps = {}


def request_otp(phone: str) -> tuple[str, str]:
    e164 = normalize_phone(phone)
    rate_limit(f"otp:{e164}", C.OTP_MAX_PER_WINDOW, C.OTP_WINDOW_SECONDS, message="Too many OTP requests")
    code = f"{secrets.randbelow(10000):04d}"
    _otps[e164] = (hashlib.sha256(code.encode()).hexdigest(), time.time() + C.OTP_TTL_SECONDS)
    log.info("[MOCK OTP] code %s for ******%s", code, e164[-4:])
    return e164, code


def verify_otp(phone: str, code: str) -> dict:
    e164 = normalize_phone(phone)
    rec = _otps.get(e164)
    if not rec or rec[1] < time.time() or rec[0] != hashlib.sha256((code or "").strip().encode()).hexdigest():
        raise AuthError("OTP_INVALID", "That code is wrong or expired", 400, "Request a new code")
    del _otps[e164]
    h = phone_hash(e164)
    return {"token": make_token({"scope": "customer", "phone_hash": h, "last4": e164[-4:]}), "phone_last4": e164[-4:]}
