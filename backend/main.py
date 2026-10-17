"""QueueSense API. Run:  python main.py   (serves the API and the built React app on port 8000)"""
import asyncio
import io
import json
import logging
import os
import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import segno
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import analytics as AN
import auth as AU
import config as C
import service as S
import venues as V
from clock import iso, now
from db import BACKEND, DB, Conflict, ensure_indexes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s %(name)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("queuesense")
PORT = int(os.environ.get("PORT", "8000"))


# ============================================================================ lifecycle
def _ticker():
    while True:
        time.sleep(1)
        for v in list(DB.venues.find({})):
            try:
                S.tick(v)
            except Exception:
                log.exception("tick failed for %s", v.get("slug"))


@asynccontextmanager
async def lifespan(app):
    ensure_indexes()
    for v in DB.venues.find({}):
        if not DB.estimator_state.find_one({"venue_id": v["_id"]}) and DB.events.find_one({"venue_id": v["_id"]}):
            S.rebuild_estimator(v["_id"])   # spec 6.7: rebuild on startup if state is missing
    threading.Thread(target=_ticker, daemon=True, name="ticker").start()
    ip = _lan_ip()
    log.info("=" * 64)
    log.info("QueueSense ready  (storage: %s, %d workplaces)", BACKEND, DB.venues.count_documents({}))
    log.info("  Open:  http://localhost:%d/     Phones on the same Wi-Fi:  http://%s:%d/", PORT, ip, PORT)
    log.info("=" * 64)
    yield


app = FastAPI(title="QueueSense", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=C.CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


def _lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


@app.middleware("http")
async def headers_and_base(request: Request, call_next):
    host = request.url.hostname or "localhost"
    if host in ("localhost", "127.0.0.1"):
        S.PUBLIC_BASE["url"] = f"http://{_lan_ip()}:{request.url.port or PORT}"   # phones can't reach "localhost"
    else:
        S.PUBLIC_BASE["url"] = f"{request.url.scheme}://{request.url.netloc}"
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return resp


# ============================================================================ errors (one shape)
def err(status, code, message, hint=None):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "hint": hint}})


@app.exception_handler(S.ServiceError)
async def _svc(_, e: S.ServiceError):
    return err(e.status, e.code, e.message, e.hint)


@app.exception_handler(AU.AuthError)
async def _auth(_, e: AU.AuthError):
    return err(e.status, e.code, e.message, e.hint)


@app.exception_handler(Conflict)
async def _conflict(_, e: Conflict):
    return err(409, "CONFLICT", "Someone else changed this just now. Refreshed.", None)


@app.exception_handler(RequestValidationError)
async def _validation(_, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    return err(422, "INVALID_INPUT", f"{'.'.join(str(x) for x in first.get('loc', []))}: {first.get('msg', 'invalid')}")


@app.exception_handler(StarletteHTTPException)
async def _http(_, e: StarletteHTTPException):
    return err(e.status_code, "NOT_FOUND" if e.status_code == 404 else "HTTP_ERROR", str(e.detail))


# ============================================================================ auth helpers
def _bearer(request: Request):
    h = request.headers.get("authorization", "")
    return h[7:] if h.lower().startswith("bearer ") else None


def staff_user(request: Request) -> dict:
    tok = _bearer(request)
    if not tok:
        raise AU.AuthError("LOGIN_REQUIRED", "Staff login required")
    c = AU.read_token(tok)
    if c.get("scope") != "staff":
        raise AU.AuthError("FORBIDDEN", "Staff login required", 403)
    return c


def customer(request: Request) -> dict:
    tok = _bearer(request)
    if not tok:
        raise AU.AuthError("OTP_REQUIRED", "Verify your mobile number first", 401)
    c = AU.read_token(tok)
    if c.get("scope") != "customer":
        raise AU.AuthError("FORBIDDEN", "Customer login required", 403)
    return c


def own_venue(user, venue, admin=False):
    if user["venue_id"] != venue["_id"]:
        raise AU.AuthError("WRONG_VENUE", "You can only act on your own venue", 403)
    if admin and user["role"] != "ADMIN":
        raise AU.AuthError("ADMIN_ONLY", "Admin PIN required", 403)


def staff_actor(u):
    return S.actor("staff", u["sub"])


def idempotent(request: Request, scope: str, fn):
    """Same Idempotency-Key -> same response, and the action runs once (double taps, offline replays)."""
    key = request.headers.get("idempotency-key")
    if not key:
        return fn()
    full = f"{scope}:{key}"
    hit = DB.idempotency.find_one({"key": full})
    if hit:
        return hit["response"]
    with S.LOCK:
        hit = DB.idempotency.find_one({"key": full})
        if hit:
            return hit["response"]
        res = fn()
        DB.idempotency.insert_one({"key": full, "response": res, "ts": now()})
        return res


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ============================================================================ public / customer
@app.get("/api/health")
def health():
    return {"ok": True, "storage": BACKEND, "time": iso(now()), "venues": DB.venues.count_documents({})}


@app.get("/api/venues")
def list_venues():
    out = []
    for v in DB.venues.find({}).sort("created_at", 1):
        sm = S.summary(v)
        etas = [s["eta"] for s in sm["services"] if s["eta"]]
        theme = V.resolve_theme(v)
        out.append({"slug": v["slug"], "name": v["name"], "template": v["template"], "open_now": sm["open_now"],
                    "queue_length": sm["queue_length"], "typical_eta": max(etas, key=lambda e: e["p50"]) if etas else None,
                    "theme": theme, "emoji": theme["emoji"],
                    "service_point_count": DB.resources.count_documents({"venue_id": v["_id"]})})
    return out


@app.get("/api/base")
def public_base():
    """The address phones should use (the LAN IP when the operator opened the site as localhost)."""
    return {"base_url": S.PUBLIC_BASE["url"]}


@app.get("/api/themes")
def themes():
    return {"presets": [{"id": k, **t} for k, t in C.THEMES.items()],
            "fonts": [{"id": k, **f} for k, f in C.FONTS.items()]}


@app.get("/api/venues/{slug}")
def get_venue(slug: str):
    return S.venue_view(S.venue_by_slug(slug))


@app.get("/api/venues/{slug}/summary")
def get_summary(slug: str):
    return S.summary(S.venue_by_slug(slug))


@app.get("/api/venues/{slug}/board")
def get_board(slug: str):
    return S.board(S.venue_by_slug(slug))


@app.get("/api/venues/{slug}/qr.svg")
def qr(slug: str):
    S.venue_by_slug(slug)
    buf = io.BytesIO()
    segno.make(f"{S.PUBLIC_BASE['url']}/v/{slug}", error="m").save(buf, kind="svg", scale=8, border=2)
    return Response(buf.getvalue(), media_type="image/svg+xml")


class PhoneIn(Strict):
    phone: str


class OtpIn(Strict):
    phone: str
    code: str


@app.post("/api/otp/request")
def otp_request(body: PhoneIn):
    AU.request_otp(body.phone)   # delivered by the SMS provider interface (mock logs it); never returned to the client
    return {"sent": True}


@app.post("/api/otp/verify")
def otp_verify(body: OtpIn):
    return AU.verify_otp(body.phone, body.code)


class JoinIn(Strict):
    service_type_id: str
    party_size: int = Field(1, ge=1, le=20)
    priority_class: str = Field("NORMAL", pattern="^(NORMAL|SENIOR)$")
    display_name: str | None = Field(None, max_length=40)
    lang: str = Field("en", pattern="^(en|hi|gu)$")


def optional_customer(request: Request) -> dict:
    """Customers join anonymously; a verified phone (if an SMS provider is configured) is optional."""
    tok = _bearer(request)
    if tok:
        try:
            c = AU.read_token(tok)
            if c.get("scope") == "customer":
                return c
        except AU.AuthError:
            pass
    return {"phone_hash": None, "last4": None}


def _cust_actor(cust, request):
    return S.actor("customer", (cust["phone_hash"] or "")[:12] or (request.client.host if request.client else None))


@app.post("/api/venues/{slug}/tickets")
def join(slug: str, body: JoinIn, request: Request, cust=Depends(optional_customer)):
    ip = request.client.host if request.client else "?"
    AU.rate_limit(f"join:{ip}", C.JOIN_MAX_PER_MINUTE, 60, message="Too many joins from this device")
    v = S.venue_by_slug(slug)

    def run():
        t = S.join(v, body.service_type_id, body.party_size, body.priority_class, cust["phone_hash"], cust["last4"],
                   body.display_name, "walkin", _cust_actor(cust, request), body.lang)
        return S.ticket_view(t, v)
    return idempotent(request, f"join:{cust['phone_hash'] or ip}", run)


@app.get("/api/tickets/{code}")
def get_ticket(code: str):
    return S.ticket_view(S.ticket_by_code(code))


@app.get("/api/tickets/{code}/ics")
def ticket_ics(code: str):
    t = S.ticket_by_code(code)
    if not t.get("slot_start"):
        raise S.ServiceError("NOT_A_BOOKING", "Only bookings have a calendar entry", 400)
    return PlainTextResponse(S.ics(t, S.venue_by_id(t["venue_id"])), media_type="text/calendar",
                             headers={"Content-Disposition": f'attachment; filename="{code}.ics"'})


class FeedbackIn(Strict):
    rating: int | None = Field(None, ge=1, le=5)
    accurate: bool | None = None


@app.post("/api/tickets/{code}/{action}")
def ticket_action(code: str, action: str, request: Request, body: dict | None = None):
    t = S.ticket_by_code(code)
    v = S.venue_by_id(t["venue_id"])
    act = S.actor("customer", (t.get("phone_hash") or "")[:12] or None)
    if action == "feedback":
        fb = FeedbackIn(**(body or {}))
        DB.tickets.update_one({"_id": t["_id"]}, {"$set": {k: x for k, x in fb.model_dump().items() if x is not None}})
        return S.ticket_view(S.ticket_by_code(code), v)
    if action == "delete-data":
        DB.tickets.update_one({"_id": t["_id"]}, {"$set": {"phone_hash": None, "phone_last4": None, "display_name": None}})
        return {"ok": True}
    fns = {"cancel": S.cancel, "snooze": S.snooze, "checkin": S.checkin, "leaving": S.leaving}
    if action not in fns:
        raise S.ServiceError("NOT_FOUND", "Unknown action", 404)

    def run():
        with S.LOCK:
            fns[action](v, S.ticket_by_code(code), act)
            return S.ticket_view(S.ticket_by_code(code), v)
    return idempotent(request, f"t:{code}:{action}", run)


@app.get("/api/phone/tickets")
def my_tickets(cust=Depends(customer)):
    return [S.ticket_view(t) for t in DB.tickets.find({"phone_hash": cust["phone_hash"], "status": {"$in": list(S.ACTIVE)}})]


@app.get("/api/venues/{slug}/slots")
def get_slots(slug: str, service: str, party: int = 1, date: str | None = None):
    v = S.venue_by_slug(slug)
    date = date or S.local(now(), v["timezone"]).strftime("%Y-%m-%d")
    return S.slots(v, service, party, date)


class BookIn(Strict):
    service_type_id: str
    party_size: int = Field(1, ge=1, le=20)
    slot_start: str
    lang: str = Field("en", pattern="^(en|hi|gu)$")


@app.post("/api/venues/{slug}/bookings")
def create_booking(slug: str, body: BookIn, request: Request, cust=Depends(optional_customer)):
    ip = request.client.host if request.client else "?"
    AU.rate_limit(f"book:{ip}", C.JOIN_MAX_PER_MINUTE, 60, message="Too many bookings from this device")
    v = S.venue_by_slug(slug)
    slot = datetime.fromisoformat(body.slot_start.replace("Z", "+00:00"))

    def run():
        t = S.book(v, body.service_type_id, body.party_size, slot, cust["phone_hash"], cust["last4"],
                   _cust_actor(cust, request), body.lang)
        return S.ticket_view(t, v)
    return idempotent(request, f"book:{cust['phone_hash'] or ip}", run)


# ============================================================================ staff
class LoginIn(Strict):
    slug: str
    pin: str = Field(min_length=4, max_length=6)


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "?"
    AU.rate_limit(f"login:{body.slug}:{ip}", C.LOGIN_MAX_ATTEMPTS, C.LOGIN_WINDOW_SECONDS,
                  code="LOCKED_OUT", message="Too many wrong PINs - locked for a few minutes")
    v = S.venue_by_slug(body.slug)
    for u in DB.staff_users.find({"venue_id": v["_id"]}).sort("role", 1):   # ADMIN sorts before STAFF
        if AU.check_pin(body.pin, u["pin_hash"]):
            tok = AU.make_token({"scope": "staff", "sub": u["_id"], "venue_id": v["_id"], "slug": v["slug"],
                                 "role": u["role"], "name": u["name"]})
            log.info("LOGIN %s %s at %s", u["role"], u["name"], v["slug"])
            return {"token": tok, "role": u["role"], "name": u["name"], "slug": v["slug"]}
    raise AU.AuthError("WRONG_PIN", "Wrong PIN")


@app.get("/api/staff/venues/{slug}/console")
def get_console(slug: str, user=Depends(staff_user)):
    v = S.venue_by_slug(slug)
    own_venue(user, v)
    return S.console(v, user)


def _staff_do(request, user, venue_id, label, fn):
    v = S.venue_by_id(venue_id)
    own_venue(user, v)

    def run():
        with S.LOCK:
            with S.staff_action(user, v, label):
                return fn(v)
    return idempotent(request, f"staff:{user['sub']}", run)


def _clamp_client_ts(request):
    """Offline replays send X-Client-Ts; it's only trusted within +/- 2 minutes of server time (logged)."""
    raw = request.headers.get("x-client-ts")
    if raw:
        try:
            ct = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if abs((ct - now()).total_seconds()) > C.CLIENT_TS_CLAMP_SECONDS:
                log.info("Client timestamp %s clamped (offline replay)", raw)
        except ValueError:
            pass


@app.post("/api/staff/resources/{rid}/{action}")
def resource_action(rid: str, action: str, request: Request, body: dict | None = None, user=Depends(staff_user)):
    _clamp_client_ts(request)
    r = S.resource_by_id(rid)

    def fn(v):
        r2 = S.resource_by_id(rid)
        a = staff_actor(user)
        if action == "next":
            t = S.staff_next(v, r2, a)
            return {"ok": True, "message": f"Called {t['code']}" if t else "Nobody waiting for this", "called": t["code"] if t else None}
        if action == "left":
            t = S.staff_left(v, r2, a)
            return {"ok": True, "message": f"{r2['label']} is free" + (f" - called {t['code']}" if t else ""), "called": t["code"] if t else None}
        if action == "pause":
            S.pause(v, r2, a, (body or {}).get("reason"))
            return {"ok": True, "message": f"{r2['label']} paused"}
        if action == "resume":
            S.resume(v, r2, a)
            return {"ok": True, "message": f"{r2['label']} resumed"}
        raise S.ServiceError("NOT_FOUND", "Unknown action", 404)
    return _staff_do(request, user, r["venue_id"], f"{action} on {r['label']}", fn)


@app.post("/api/staff/tickets/{tid}/{action}")
def ticket_staff_action(tid: str, action: str, request: Request, user=Depends(staff_user)):
    _clamp_client_ts(request)
    t = S.ticket_by_id(tid)

    def fn(v):
        t2 = S.ticket_by_id(tid)
        a = staff_actor(user)
        if action == "arrived":
            S.staff_arrived(v, t2, a)
            return {"ok": True, "message": f"{t2['code']} in service"}
        if action == "served":
            S.staff_served(v, t2, a)
            return {"ok": True, "message": f"{t2['code']} served"}
        if action == "no-show":
            c = S.staff_no_show(v, t2, a)
            return {"ok": True, "message": f"{t2['code']} no-show", "called": c["code"] if c else None}
        if action == "skip":
            c = S.staff_skip(v, t2, a)
            return {"ok": True, "message": f"{t2['code']} skipped", "called": c["code"] if c else None}
        if action == "reinstate":
            S.reinstate(v, t2, a)
            return {"ok": True, "message": f"{t2['code']} back in the queue"}
        raise S.ServiceError("NOT_FOUND", "Unknown action", 404)
    return _staff_do(request, user, t["venue_id"], f"{action} {t['code']}", fn)


class WalkinIn(Strict):
    service_type_id: str
    party_size: int = Field(1, ge=1, le=20)
    display_name: str | None = Field(None, max_length=40)


@app.post("/api/staff/venues/{slug}/walkins")
def walkin(slug: str, body: WalkinIn, request: Request, user=Depends(staff_user)):
    v = S.venue_by_slug(slug)

    def fn(v):
        t = S.join(v, body.service_type_id, body.party_size, "NORMAL", None, None, body.display_name, "staff_added", staff_actor(user))
        return {"ok": True, "code": t["code"], "ticket": S.ticket_view(t, v)}
    return _staff_do(request, user, v["_id"], "add walk-in", fn)


class EmergencyIn(Strict):
    service_type_id: str
    display_name: str | None = Field(None, max_length=40)


@app.post("/api/staff/venues/{slug}/emergency")
def emergency(slug: str, body: EmergencyIn, request: Request, user=Depends(staff_user)):
    v = S.venue_by_slug(slug)

    def fn(v):
        t = S.join(v, body.service_type_id, 1, "EMERGENCY", None, None, body.display_name, "staff_added", staff_actor(user))
        return {"ok": True, "code": t["code"]}
    return _staff_do(request, user, v["_id"], "add emergency", fn)


@app.post("/api/staff/undo")
def staff_undo(user=Depends(staff_user)):
    label = S.undo(user)
    return {"ok": True, "message": f"Undone: {label}"}


class OverrideIn(Strict):
    resource_id: str
    reason: str = Field(pattern="^(Emergency|Regular customer error|Other)$")


@app.post("/api/staff/assignments/{tid}/override")
def override(tid: str, body: OverrideIn, request: Request, user=Depends(staff_user)):
    t = S.ticket_by_id(tid)

    def fn(v):
        S.override(v, S.ticket_by_id(tid), S.resource_by_id(body.resource_id), body.reason, staff_actor(user))
        return {"ok": True, "message": f"{t['code']} assigned ({body.reason})"}
    return _staff_do(request, user, t["venue_id"], f"override {t['code']}", fn)


# ============================================================================ admin
def admin_for(slug, user):
    v = S.venue_by_slug(slug)
    own_venue(user, v, admin=True)
    return v


TEMPLATE_ORDER = ["restaurant", "canteen", "hospital", "admin_office", "custom"]


@app.get("/api/admin/templates")
def list_templates():
    tpls = V.templates()
    out = []
    for tid in TEMPLATE_ORDER + [k for k in tpls if k not in TEMPLATE_ORDER]:
        if tid in tpls:
            t = tpls[tid]
            preset = C.TEMPLATE_THEME.get(tid, "custom")
            out.append({"id": tid, "name": t["name"], "description": t["description"],
                        "emoji": t.get("emoji") or C.THEMES[preset]["emoji"], "default_theme": preset})
    return out


class ThemeIn(Strict):
    preset: str | None = None
    primary: str | None = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    accent: str | None = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    bg: str | None = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    font: str | None = None
    emoji: str | None = Field(None, max_length=4)


class CreateVenueIn(Strict):
    template: str
    name: str = Field(min_length=2, max_length=60)
    slug: str | None = Field(None, pattern="^[a-z0-9-]{3,40}$")
    theme: ThemeIn | None = None
    staff_pin: str | None = Field(None, pattern=r"^\d{4,6}$")
    admin_pin: str | None = Field(None, pattern=r"^\d{4,6}$")


def _links(slug):
    base = S.PUBLIC_BASE["url"]
    return {"customer": f"{base}/v/{slug}", "operator": f"{base}/op/{slug}", "staff": f"{base}/staff/{slug}",
            "board": f"{base}/board/{slug}", "booking": f"{base}/b/{slug}", "guide": f"{base}/guide/{slug}"}


def _admin_session(v):
    admin = DB.staff_users.find_one({"venue_id": v["_id"], "role": "ADMIN"})
    tok = AU.make_token({"scope": "staff", "sub": admin["_id"], "venue_id": v["_id"], "slug": v["slug"],
                         "role": "ADMIN", "name": admin["name"]})
    return {"token": tok, "role": "ADMIN", "name": admin["name"], "slug": v["slug"]}


# ============================================================================ operator accounts
def operator_user(request: Request) -> dict:
    tok = _bearer(request)
    if not tok:
        raise AU.AuthError("SIGNIN_REQUIRED", "Please sign in as an operator", 401)
    c = AU.read_token(tok)
    if c.get("scope") != "operator":
        raise AU.AuthError("SIGNIN_REQUIRED", "Please sign in as an operator", 401)
    op = DB.operators.find_one({"_id": c["sub"]})
    if not op:
        raise AU.AuthError("SIGNIN_REQUIRED", "Account not found - please sign in again", 401)
    return op


def _op_public(op):
    return {"id": op["_id"], "name": op["name"], "email": op["email"]}


def _op_session(op):
    return {"token": AU.make_token({"scope": "operator", "sub": op["_id"], "name": op["name"]}), "operator": _op_public(op)}


class SignupIn(Strict):
    name: str = Field(min_length=2, max_length=60)
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)   # bcrypt limit


class SigninIn(Strict):
    email: str = Field(max_length=120)
    password: str = Field(max_length=72)


@app.post("/api/operators/signup")
def operator_signup(body: SignupIn, request: Request):
    AU.rate_limit(f"signup:{request.client.host if request.client else '?'}", 10, 3600, message="Too many sign-ups")
    email = body.email.strip().lower()
    if DB.operators.find_one({"email": email}):
        raise S.ServiceError("EMAIL_TAKEN", "An account with this email already exists", 409, "Sign in instead")
    from db import new_id
    op = {"_id": new_id("op"), "name": body.name.strip(), "email": email, "password_hash": AU.hash_pin(body.password),
          "created_at": now()}
    DB.operators.insert_one(op)
    log.info("OPERATOR signed up: %s", email)
    return _op_session(op)


@app.post("/api/operators/signin")
def operator_signin(body: SigninIn, request: Request):
    email = body.email.strip().lower()
    AU.rate_limit(f"signin:{email}", C.LOGIN_MAX_ATTEMPTS, C.LOGIN_WINDOW_SECONDS, code="LOCKED_OUT",
                  message="Too many attempts - try again in a few minutes")
    op = DB.operators.find_one({"email": email})
    if not op or not AU.check_pin(body.password, op["password_hash"]):
        raise AU.AuthError("WRONG_LOGIN", "Email or password is wrong")
    return _op_session(op)


@app.get("/api/operators/me")
def operator_me(op=Depends(operator_user)):
    out = []
    for v in DB.venues.find({"owner_id": op["_id"]}).sort("created_at", -1):
        sm = S.summary(v)
        etas = [s["eta"] for s in sm["services"] if s["eta"]]
        theme = V.resolve_theme(v)
        out.append({"slug": v["slug"], "name": v["name"], "template": v["template"], "theme": theme, "emoji": theme["emoji"],
                    "open_now": sm["open_now"], "queue_length": sm["queue_length"],
                    "typical_eta": max(etas, key=lambda e: e["p50"]) if etas else None,
                    "links": _links(v["slug"]), "created_at": iso(v.get("created_at"))})
    return {"operator": _op_public(op), "workplaces": out}


@app.post("/api/operators/workplaces/{slug}/session")
def operator_workplace_session(slug: str, op=Depends(operator_user)):
    v = S.venue_by_slug(slug)
    if v.get("owner_id") != op["_id"]:
        raise AU.AuthError("NOT_YOUR_WORKPLACE", "This workplace belongs to another account", 403)
    return _admin_session(v)


@app.post("/api/admin/venues")
def create_venue(body: CreateVenueIn, request: Request, op=Depends(operator_user)):
    """A signed-in operator creates a workplace: returns both website links and an admin session."""
    AU.rate_limit(f"create:{op['_id']}", 20, 3600, message="Too many workplaces created")
    try:
        v, sp, ap = V.create_venue(body.template, body.name.strip(), body.slug,
                                   theme=body.theme.model_dump(exclude_none=True) if body.theme else None,
                                   staff_pin=body.staff_pin, admin_pin=body.admin_pin, owner_id=op["_id"])
    except ValueError as e:
        raise S.ServiceError("CANNOT_CREATE", str(e), 409)
    log.info("WORKPLACE created by %s: %s (%s) /v/%s", op["email"], v["name"], v["template"], v["slug"])
    return {"venue": S.venue_view(v), "staff_pin": sp, "admin_pin": ap, "admin_session": _admin_session(v),
            "links": _links(v["slug"]), "base_url": S.PUBLIC_BASE["url"]}


@app.get("/api/admin/venues/{slug}")
def admin_venue(slug: str, user=Depends(staff_user)):
    v = admin_for(slug, user)
    t = now()
    act = {x["_id"]: x for x in S.tickets(v["_id"], ("CALLED", "IN_SERVICE"))}
    return {"venue": S.venue_view(v), "resources": [S.resource_view(r, act, S.settings(v), t) for r in S.resources(v["_id"])],
            "staff_users": [{"id": u["_id"], "name": u["name"], "role": u["role"]} for u in DB.staff_users.find({"venue_id": v["_id"]})]}


class VenuePatch(Strict):
    name: str | None = Field(None, min_length=2, max_length=60)
    open_hours: list[dict] | None = None
    theme: ThemeIn | None = None


@app.patch("/api/admin/venues/{slug}")
def patch_venue(slug: str, body: VenuePatch, user=Depends(staff_user)):
    v = admin_for(slug, user)
    ch = {k: x for k, x in body.model_dump(exclude={"theme"}).items() if x is not None}
    if body.theme is not None:
        ch["theme"] = V.clean_theme(body.theme.model_dump(exclude_none=True), v["template"])
    if "open_hours" in ch:
        for h in ch["open_hours"]:
            if not (0 <= int(h["weekday"]) <= 6 and h["open"] < h["close"]):
                raise S.ServiceError("INVALID_HOURS", "Each day needs weekday 0-6 and open < close", 400)
    DB.venues.update_one({"_id": v["_id"]}, {"$set": ch})
    S.bump(v["_id"])
    return S.venue_view(S.venue_by_id(v["_id"]))


@app.patch("/api/admin/venues/{slug}/settings")
def patch_settings(slug: str, body: dict, user=Depends(staff_user)):
    v = admin_for(slug, user)
    unknown = set(body) - set(C.DEFAULT_SETTINGS)
    if unknown:
        raise S.ServiceError("UNKNOWN_SETTING", f"Unknown settings: {', '.join(sorted(unknown))}", 400)
    new = {**S.settings(v), **body}
    if new["call_mode"] not in ("staff_tap", "auto_suggest"):
        raise S.ServiceError("INVALID_SETTING", "call_mode must be staff_tap or auto_suggest", 400)
    DB.venues.update_one({"_id": v["_id"]}, {"$set": {"settings": new}})
    S.bump(v["_id"])
    S.assign(S.venue_by_id(v["_id"]))     # settings changed -> matcher runs (spec 7.2)
    return S.venue_view(S.venue_by_id(v["_id"]))


class ServiceTypeIn(Strict):
    name: dict
    prior_mean_seconds: float = Field(gt=5, lt=36000)
    prior_cv: float = Field(gt=0.05, lt=3)
    color: str = "#1F6FEB"
    allows_priority: bool = False
    resource_kind: str = Field(pattern="^(counter|table|room)$")


@app.post("/api/admin/venues/{slug}/service-types")
def add_service_type(slug: str, body: ServiceTypeIn, user=Depends(staff_user)):
    from db import new_id
    v = admin_for(slug, user)
    doc = {"_id": new_id("st"), "venue_id": v["_id"], "key": new_id("k"), **body.model_dump()}
    DB.service_types.insert_one(doc)
    S.bump(v["_id"])
    return S.st_public(doc)


@app.patch("/api/admin/service-types/{sid}")
def patch_service_type(sid: str, body: dict, user=Depends(staff_user)):
    st = DB.service_types.find_one({"_id": sid}) or {}
    v = S.venue_by_id(st.get("venue_id"))
    if not v:
        raise S.ServiceError("NOT_FOUND", "Service type not found", 404)
    admin_for(v["slug"], user)
    allowed = {"name", "prior_mean_seconds", "prior_cv", "color", "allows_priority"}
    ch = {k: x for k, x in body.items() if k in allowed}
    DB.service_types.update_one({"_id": sid}, {"$set": ch})
    if {"prior_mean_seconds", "prior_cv"} & set(ch):
        S.rebuild_estimator(v["_id"])    # priors changed: re-derive from events with the new prior
    S.bump(v["_id"])
    return S.st_public(DB.service_types.find_one({"_id": sid}))


@app.delete("/api/admin/service-types/{sid}")
def delete_service_type(sid: str, user=Depends(staff_user)):
    st = DB.service_types.find_one({"_id": sid}) or {}
    v = S.venue_by_id(st.get("venue_id"))
    if not v:
        raise S.ServiceError("NOT_FOUND", "Service type not found", 404)
    admin_for(v["slug"], user)
    if DB.tickets.count_documents({"service_type_id": sid, "status": {"$in": list(S.ACTIVE)}}):
        raise S.ServiceError("IN_USE", "People are still queued for this service", 409)
    DB.service_types.delete_one({"_id": sid})
    DB.resources.update_many({"venue_id": v["_id"]}, {"$pull": {"service_type_ids": sid}})
    S.bump(v["_id"])
    return {"ok": True}


class ResourceIn(Strict):
    kind: str = Field(pattern="^(counter|table|room)$")
    label: str = Field(min_length=1, max_length=40)
    capacity: int = Field(1, ge=1, le=30)
    service_type_ids: list[str]


@app.post("/api/admin/venues/{slug}/resources")
def add_resource(slug: str, body: ResourceIn, user=Depends(staff_user)):
    from db import new_id
    v = admin_for(slug, user)
    n = DB.resources.count_documents({"venue_id": v["_id"]})
    doc = {"_id": new_id("r"), "venue_id": v["_id"], **body.model_dump(), "status": "OPEN", "current_ticket_id": None,
           "held_for_ticket_id": None, "held_until": None, "status_changed_at": now(), "version": 0, "order": n,
           "paused": False, "pending_release": False}
    DB.resources.insert_one(doc)
    S.bump(v["_id"])
    S.assign(v)
    return S.resource_view(doc, {}, S.settings(v), now())


@app.patch("/api/admin/resources/{rid}")
def patch_resource(rid: str, body: dict, user=Depends(staff_user)):
    r = S.resource_by_id(rid)
    v = S.venue_by_id(r["venue_id"])
    admin_for(v["slug"], user)
    ch = {k: x for k, x in body.items() if k in ("label", "capacity", "service_type_ids", "kind")}
    DB.resources.update_one({"_id": rid}, {"$set": ch, "$inc": {"version": 1}})
    S.bump(v["_id"])
    return S.resource_view(S.resource_by_id(rid), {}, S.settings(v), now())


@app.delete("/api/admin/resources/{rid}")
def delete_resource(rid: str, user=Depends(staff_user)):
    r = S.resource_by_id(rid)
    v = S.venue_by_id(r["venue_id"])
    admin_for(v["slug"], user)
    if r.get("current_ticket_id"):
        raise S.ServiceError("IN_USE", f"{r['label']} is serving someone right now", 409)
    DB.resources.delete_one({"_id": rid})
    S.bump(v["_id"])
    return {"ok": True}


class StaffUserIn(Strict):
    name: str = Field(min_length=1, max_length=40)
    role: str = Field(pattern="^(STAFF|ADMIN)$")
    pin: str = Field(pattern=r"^\d{4,6}$")


@app.post("/api/admin/venues/{slug}/staff-users")
def add_staff(slug: str, body: StaffUserIn, user=Depends(staff_user)):
    from db import new_id
    v = admin_for(slug, user)
    doc = {"_id": new_id("u"), "venue_id": v["_id"], "name": body.name, "role": body.role, "pin_hash": AU.hash_pin(body.pin)}
    DB.staff_users.insert_one(doc)
    return {"id": doc["_id"], "name": doc["name"], "role": doc["role"]}


@app.delete("/api/admin/staff-users/{uid}")
def delete_staff(uid: str, user=Depends(staff_user)):
    u = DB.staff_users.find_one({"_id": uid})
    if not u:
        raise S.ServiceError("NOT_FOUND", "User not found", 404)
    admin_for(S.venue_by_id(u["venue_id"])["slug"], user)
    if u["_id"] == user["sub"]:
        raise S.ServiceError("CANNOT_DELETE_SELF", "You can't delete yourself", 409)
    DB.staff_users.delete_one({"_id": uid})
    return {"ok": True}


def _parse_dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


@app.get("/api/admin/venues/{slug}/analytics")
def get_analytics(slug: str, frm: str | None = Query(None, alias="from"), to: str | None = None,
                  user=Depends(staff_user)):
    return AN.analytics(admin_for(slug, user), _parse_dt(frm), _parse_dt(to))


class WhatIfIn(Strict):
    add_resources: int = Field(0, ge=0, le=3)
    pause_resources: list[str] = []
    horizon: int = Field(60, ge=10, le=240)


@app.post("/api/admin/venues/{slug}/whatif")
def whatif(slug: str, body: WhatIfIn, user=Depends(staff_user)):
    return AN.whatif(admin_for(slug, user), body.add_resources, body.pause_resources, body.horizon)


@app.get("/api/admin/venues/{slug}/export.csv")
def export_csv(slug: str, kind: str = "tickets", user=Depends(staff_user)):
    v = admin_for(slug, user)
    return PlainTextResponse(AN.export_csv(v, kind), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{slug}-{kind}.csv"'})


@app.post("/api/admin/rebuild-estimator")
def rebuild(body: dict | None = None, user=Depends(staff_user)):
    v = S.venue_by_id(user["venue_id"])
    own_venue(user, v, admin=True)
    return {"ok": True, "keys": S.rebuild_estimator(v["_id"])}


# ============================================================================ realtime (SSE)
@app.get("/api/venues/{slug}/stream")
async def stream(slug: str, request: Request, ticket: str | None = None, token: str | None = None):
    v = S.venue_by_slug(slug)
    user = None
    if token:
        try:
            c = AU.read_token(token)
            if c.get("scope") == "staff" and c.get("venue_id") == v["_id"]:
                user = c
        except AU.AuthError:
            pass
    if ticket:
        tk = S.ticket_by_code(ticket)
        if tk["venue_id"] != v["_id"]:
            raise S.ServiceError("TICKET_NOT_FOUND", "Ticket not at this venue", 404)

    def frames():
        out = [("queue_update", S.summary(v)), ("board_update", S.board(v))]
        if ticket:
            out.append(("ticket_update", S.ticket_view(S.ticket_by_code(ticket), v)))   # only this ticket's data
        if user:
            out.append(("resource_update", S.console(v, user)))
        return out

    async def gen():
        seen, eid, last_send, last_beat = -1, 0, 0.0, time.time()
        yield "retry: 1000\n\n"
        while not await request.is_disconnected():
            ver = S.VERSION[v["_id"]]
            t = time.time()
            if ver != seen or t - last_send >= C.ETA_REFRESH_SECONDS:     # push on change; refresh ETAs every 30 s
                seen, last_send = ver, t
                for name, data in await asyncio.to_thread(frames):
                    eid += 1
                    yield f"id: {eid}\nevent: {name}\ndata: {json.dumps(data, default=str)}\n\n"
            elif t - last_beat >= C.SSE_HEARTBEAT_SECONDS:
                last_beat = t
                yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ============================================================================ React app (SPA)
if (C.FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=C.FRONTEND_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise S.ServiceError("NOT_FOUND", "Unknown API endpoint", 404)
    f = C.FRONTEND_DIST / path
    if path and f.is_file():
        return FileResponse(f)
    index = C.FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return PlainTextResponse("Frontend not built. Run: cd frontend && npm install && npm run build", 503)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
