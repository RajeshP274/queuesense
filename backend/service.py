"""Core operations used by customers, staff and admins.

Every state change: validates the transition, writes the append-only event, updates the ticket/resource with an
optimistic version check, re-runs the matcher where relevant, notifies, and bumps the venue's live version so SSE
clients refresh. One process-wide lock serialises mutations, so the matcher can't double-assign a resource."""
import hashlib
import logging
import math
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import timedelta

import numpy as np

import assigner as A
import config as C
import estimator as E
from clock import aware, iso, local, now, seconds_between
from db import DB, Conflict, new_id, update_versioned
from notifications import notify

log = logging.getLogger("queuesense.service")

LOCK = threading.RLock()
VERSION = defaultdict(int)          # venue_id -> live version (SSE + ETA cache key)
NARRATION = deque(maxlen=300)       # plain-language "what the engine is doing" feed for /demo
CONTEXT = defaultdict(dict)         # venue_id -> recent context used to explain estimate rises
LAST_P50 = {}                       # ticket_id -> last p50 (for rise reasons)
RISE = {}                           # ticket_id -> (reason, expires_real_ts)
ETA_CACHE = {}                      # ticket_id -> (version, real_ts, eta)
UNDO = defaultdict(deque)           # staff user id -> recent undoable actions
_EST, _CAL = {}, {}                 # in-memory estimator state (mirrored to estimator_state)
_ACTION = threading.local()
PUBLIC_BASE = {"url": ""}

ACTIVE = ("BOOKED", "WAITING", "CALLED", "IN_SERVICE")
CLOSED_STATES = ("DONE", "NO_SHOW", "CANCELLED", "EXPIRED")


class ServiceError(Exception):
    def __init__(self, code, message, status=400, hint=None):
        self.code, self.message, self.status, self.hint = code, message, status, hint


# =========================================================================== basics
def bump(venue_id):
    VERSION[venue_id] += 1


def narrate(venue, text):
    NARRATION.appendleft({"ts": iso(now()), "venue": venue["name"], "slug": venue["slug"], "text": text})


def actor(kind="system", id_=None):
    return {"kind": kind, "id": id_}


def venue_by_slug(slug):
    v = DB.venues.find_one({"slug": slug})
    if not v:
        raise ServiceError("VENUE_NOT_FOUND", f"No venue called '{slug}'", 404)
    return v


def venue_by_id(vid):
    return DB.venues.find_one({"_id": vid})


def settings(venue):
    return {**C.DEFAULT_SETTINGS, **(venue.get("settings") or {})}


def service_types(venue_id):
    return {s["_id"]: s for s in DB.service_types.find({"venue_id": venue_id})}


def resources(venue_id):
    return sorted(DB.resources.find({"venue_id": venue_id}), key=lambda r: (r.get("order", 0), r["label"]))


def tickets(venue_id, statuses=ACTIVE):
    return list(DB.tickets.find({"venue_id": venue_id, "status": {"$in": list(statuses)}}))


def ticket_by_code(code):
    t = DB.tickets.find_one({"code": code.upper()})
    if not t:
        raise ServiceError("TICKET_NOT_FOUND", f"No ticket {code}", 404, "Check the code on your screen")
    return t


def ticket_by_id(tid):
    t = DB.tickets.find_one({"_id": tid})
    if not t:
        raise ServiceError("TICKET_NOT_FOUND", "Ticket not found", 404)
    return t


def resource_by_id(rid):
    r = DB.resources.find_one({"_id": rid})
    if not r:
        raise ServiceError("RESOURCE_NOT_FOUND", "Resource not found", 404)
    return r


def is_open(venue, at=None):
    lt = local(at or now(), venue.get("timezone", C.DEFAULT_TIMEZONE))
    hm = lt.strftime("%H:%M")
    return any(h["weekday"] == lt.weekday() and h["open"] <= hm < h["close"] for h in venue.get("open_hours", []))


def st_name(st, lang="en"):
    return (st.get("name") or {}).get(lang) or (st.get("name") or {}).get("en") or "service"


def record_event(venue_id, etype, act, ticket_id=None, resource_id=None, payload=None, idem=None):
    ev = {"_id": new_id("e"), "venue_id": venue_id, "ts": now(), "type": etype, "actor": act,
          "ticket_id": ticket_id, "resource_id": resource_id, "payload": payload or {}, "idempotency_key": idem}
    if idem is None:
        ev.pop("idempotency_key")
    DB.events.insert_one(ev)
    if getattr(_ACTION, "events", None) is not None:
        _ACTION.events.append(ev)
    return ev


def transition(ticket, new_status, **changes):
    if new_status not in A.TRANSITIONS.get(ticket["status"], set()):
        log.warning("Rejected transition %s %s -> %s", ticket["code"], ticket["status"], new_status)
        raise ServiceError("INVALID_TRANSITION", f"{ticket['code']} is {ticket['status'].replace('_', ' ').lower()}, "
                                                 f"it can't become {new_status.replace('_', ' ').lower()}", 409)
    update_versioned("tickets", ticket, {"status": new_status, "status_changed_at": now(), **changes})


def set_resource(resource, **changes):
    if "status" in changes:
        changes["status_changed_at"] = now()
    update_versioned("resources", resource, changes)


def release_resource(resource):
    """Resource becomes free (or stays paused)."""
    set_resource(resource, current_ticket_id=None, held_until=None, pending_release=False,
                 status="PAUSED" if resource.get("paused") else "OPEN")


# =========================================================================== estimator state
def _state(venue_id, st, party):
    key = E.queue_key(st, party)
    s = _EST.get((venue_id, key))
    if s is None:
        doc = DB.estimator_state.find_one({"venue_id": venue_id, "queue_key": key})
        if doc:
            doc.pop("_id", None)
            s = doc
        else:
            label = st_name(st) if st["resource_kind"] != "table" else f"{st_name(st)} (party {E.party_bucket(party)})"
            s = E.new_state(venue_id, key, st["prior_mean_seconds"], st["prior_cv"], label)
        _EST[(venue_id, key)] = s
    return s


def _save_state(s):
    DB.estimator_state.replace_one({"venue_id": s["venue_id"], "queue_key": s["queue_key"]}, dict(s), upsert=True)


def calibration(venue_id):
    c = _CAL.get(venue_id)
    if c is None:
        doc = DB.estimator_state.find_one({"venue_id": venue_id, "queue_key": "_calibration"})
        if doc:
            doc.pop("_id", None)
        c = doc or E.new_calibration(venue_id)
        _CAL[venue_id] = c
    return c


def _save_cal(c):
    DB.estimator_state.replace_one({"venue_id": c["venue_id"], "queue_key": "_calibration"}, dict(c), upsert=True)


def rebuild_estimator(venue_id):
    """Derived state = replay of the event log (spec 6.7). Undone events are skipped."""
    with LOCK:
        for k in [k for k in _EST if k[0] == venue_id]:
            del _EST[k]
        _CAL.pop(venue_id, None)
        DB.estimator_state.delete_many({"venue_id": venue_id})
        sts = service_types(venue_id)
        undone = set()
        for u in DB.events.find({"venue_id": venue_id, "type": "UNDO"}):
            undone.update(u["payload"].get("undone_event_ids", []))
        cal = E.new_calibration(venue_id)
        touched = {}
        for ev in DB.events.find({"venue_id": venue_id, "type": {"$in": ["SERVICE_ENDED", "CALLED", "SERVICE_STARTED"]}}).sort("ts", 1):
            if ev["_id"] in undone:
                continue
            p = ev["payload"]
            if ev["type"] == "SERVICE_ENDED" and not p.get("rejected_reason") and p.get("service_type_id") in sts:
                s = _state(venue_id, sts[p["service_type_id"]], p.get("party_size", 1))
                E.apply_sample(s, p["duration_s"], p.get("weight", 1.0), p.get("bucket", "00:00"))
                touched[s["queue_key"]] = s
            elif ev["type"] == "CALLED" and p.get("calib"):
                c = p["calib"]
                E.add_calibration(cal, c["p20"], c["p50"], c["p80"], c["actual"])
            elif ev["type"] == "SERVICE_STARTED" and p.get("gap_s") is not None:
                E.update_call_gap(cal, p["gap_s"])
        for s in touched.values():
            _save_state(s)
        _CAL[venue_id] = cal
        _save_cal(cal)
        bump(venue_id)
        return list(touched)


# =========================================================================== ranking & ETA
def ranked_queue(venue, waiting=None, t=None):
    t = t or now()
    waiting = waiting if waiting is not None else tickets(venue["_id"], ("WAITING",))
    return A.order_queue(waiting, settings(venue), t, venue.get("consecutive_priority", 0),
                         venue.get("timezone", C.DEFAULT_TIMEZONE))


def _dist(venue, st, party, t):
    s = _state(venue["_id"], st, party)
    bucket = E.bucket_of(local(t, venue.get("timezone", C.DEFAULT_TIMEZONE)))
    mu, sigma = E.params(s, bucket, calibration(venue["_id"])["sigma_scale"])
    m, sd = E.lognormal_params(mu, sigma)
    return (m, sd), mu, sigma, s


def p80_service(venue, sts, t):
    def f(ticket):
        (m, sd), mu, sigma, _ = _dist(venue, sts[ticket["service_type_id"]], ticket["party_size"], t)
        return math.exp(m + 0.8416 * sd)
    return f


def _sim_context(venue, extra_counters=0, paused_ids=(), t=None):
    """Everything the Monte Carlo needs, built once per call."""
    t = t or now()
    sts = service_types(venue["_id"])
    sett = settings(venue)
    res = [r for r in resources(venue["_id"]) if r["status"] not in ("PAUSED", "CLOSED") and r["_id"] not in paused_ids]
    if extra_counters:
        base = max((r for r in res if r["kind"] != "table"), key=lambda r: len(r["service_type_ids"]), default=None)
        base = base or (res[0] if res else None)
        for i in range(extra_counters):
            if base:
                res.append({**base, "_id": f"whatif_{i}", "status": "OPEN", "current_ticket_id": None,
                            "held_until": None, "held_for_ticket_id": None, "label": f"Extra {base['kind']} {i + 1}"})
    active = {x["_id"]: x for x in tickets(venue["_id"], ("CALLED", "IN_SERVICE"))}
    sim_res = []
    for j, r in enumerate(res):
        cur = active.get(r.get("current_ticket_id"))
        if cur:
            (m, sd), mu, _, _ = _dist(venue, sts[cur["service_type_id"]], cur["party_size"], t)
            start = cur.get("service_start_at") or cur.get("called_at")
            sim_res.append(E.SimResource(j, "busy", max(0.0, seconds_between(start, t)), (m, sd), mu))
        elif r.get("held_for_ticket_id") and r.get("held_until"):
            sim_res.append(E.SimResource(j, "held", held_offset=max(0.0, seconds_between(t, r["held_until"]))))
        else:
            sim_res.append(E.SimResource(j, "idle"))
    return {"t": t, "sts": sts, "sett": sett, "res": res, "sim_res": sim_res}


def _mask(ctx, ticket):
    t, sett = ctx["t"], ctx["sett"]
    m = np.zeros(len(ctx["res"]), dtype=bool)
    for j, r in enumerate(ctx["res"]):
        if ticket["service_type_id"] not in r["service_type_ids"]:
            continue
        if r["kind"] == "table":
            if r["capacity"] < ticket["party_size"]:
                continue
            relaxed = A.waited_seconds(ticket, t) >= C.TABLE_RELAX_MINUTES * 60 if ticket.get("created_at") else False
            if not relaxed and r["capacity"] > ticket["party_size"] + sett["max_table_oversize"]:
                continue
        m[j] = True
    if not m.any():  # oversize rule is relaxed in time; for the estimate allow any table that fits
        for j, r in enumerate(ctx["res"]):
            if ticket["service_type_id"] in r["service_type_ids"] and r["capacity"] >= ticket["party_size"]:
                m[j] = True
    return m


def _sim_ticket(ctx, venue, ticket):
    (m, sd), mu, _, _ = _dist(venue, ctx["sts"][ticket["service_type_id"]], ticket["party_size"], ctx["t"])
    gap = calibration(venue["_id"]).get("call_gap") or 0.0
    return E.SimTicket(_mask(ctx, ticket), (m, sd), mu, overhead=gap)


def _bookings_for(ctx, venue, horizon_s):
    out = []
    show = calibration(venue["_id"]).get("show_rate") or ctx["sett"]["show_rate_default"]
    for b in DB.tickets.find({"venue_id": venue["_id"], "status": "BOOKED"}):
        off = seconds_between(ctx["t"], b["slot_start"])
        if -ctx["sett"]["grace_minutes_prebook"] * 60 <= off <= horizon_s:
            st = _sim_ticket(ctx, venue, b)
            st.slot_offset, st.show_rate = max(0.0, off), show
            out.append(st)
    return out


def _wait_samples(venue, ctx, ranked, target_ticket, index, seed):
    queue = [_sim_ticket(ctx, venue, r.ticket) for r in ranked]
    if index >= len(queue):
        queue.append(_sim_ticket(ctx, venue, target_ticket))
        index = len(queue) - 1
    target = queue[index]
    active = max(1, int(target.mask.sum()))
    rough = (index / active + 1) * target.mu * 1.5           # only bookings before our likely start matter
    bookings = _bookings_for(ctx, venue, rough)
    return E.simulate_wait(ctx["sim_res"], queue, index, bookings, seed=seed), target, index


def _eta_dict(venue, st, party, samples, target, index, ticket_id=None):
    s = _state(venue["_id"], st, party)
    conf, reason = E.confidence(s, st_name(st) if st["resource_kind"] != "table"
                                else f"tables for {E.party_bucket(party)} people")
    if samples is None:
        p20, p50, p80 = E.fallback_wait(index, int(target.mask.sum()), target.mu)
        conf, reason = "Low", "Simplified estimate (simulation unavailable)"
    else:
        p20, p50, p80 = E.percentiles(samples)
    rise = None
    if ticket_id:
        last = LAST_P50.get(ticket_id)
        if last is not None and p50 - last >= C.RISE_REASON_SECONDS:
            ctxv = CONTEXT[venue["_id"]]
            recent = lambda k: k in ctxv and seconds_between(ctxv[k], now()) < 900
            rise = ("A counter was paused" if recent("paused_at") else
                    "A priority patient was seen" if recent("priority_at") else
                    "Service is slower than usual" if s["ew_mean"] > 1.15 * s["prior_mu"] else
                    "More people ahead than expected")
            RISE[ticket_id] = (rise, time.time() + 120)
        elif ticket_id in RISE and RISE[ticket_id][1] > time.time():
            rise = RISE[ticket_id][0]
        LAST_P50[ticket_id] = p50
    return {"p20": round(p20), "p50": round(p50), "p80": round(p80),
            "text": E.format_eta(p20, p50, p80, joined=ticket_id is not None),
            "confidence": conf, "reason": reason, "rise_reason": rise}


def eta_for_ticket(venue, ticket, ranked=None, ctx=None):
    """Monte Carlo ETA for a WAITING ticket (cached 5 s per ticket and venue state)."""
    key = ticket["_id"]
    cached = ETA_CACHE.get(key)
    if cached and cached[0] == VERSION[venue["_id"]] and time.time() - cached[1] < C.ETA_CACHE_SECONDS:
        return cached[2]
    with LOCK:
        ranked = ranked if ranked is not None else ranked_queue(venue)
        ids = [r.ticket["_id"] for r in ranked]
        if ticket["_id"] not in ids:
            return None
        ctx = ctx or _sim_context(venue)
        st = ctx["sts"][ticket["service_type_id"]]
        if not A.can_ever_fit(ctx["res"] or resources(venue["_id"]), ticket):
            return None
        idx = ids.index(ticket["_id"])
        seed = int(hashlib.md5(ticket["_id"].encode()).hexdigest()[:8], 16)
        try:
            samples, target, idx = _wait_samples(venue, ctx, ranked, ticket, idx, seed)
        except Exception:
            log.exception("Monte Carlo failed; analytic fallback")
            samples, target = None, _sim_ticket(ctx, venue, ticket)
        eta = _eta_dict(venue, st, ticket["party_size"], samples, target, idx, ticket["_id"])
    ETA_CACHE[key] = (VERSION[venue["_id"]], time.time(), eta)
    return eta


_NEW_CACHE = {}


def eta_for_new(venue, st, party=None):
    """Estimate for someone who would join now (shown BEFORE joining)."""
    party = party or (2 if st["resource_kind"] == "table" else 1)
    k = (venue["_id"], st["_id"], party)
    c = _NEW_CACHE.get(k)
    if c and c[0] == VERSION[venue["_id"]] and time.time() - c[1] < C.ETA_CACHE_SECONDS:
        return c[2]
    with LOCK:
        ctx = _sim_context(venue)
        if not ctx["res"]:
            return None
        ghost = {"_id": "new", "service_type_id": st["_id"], "party_size": party, "created_at": ctx["t"]}
        if not _mask(ctx, ghost).any():
            return None
        ranked = ranked_queue(venue)
        try:
            samples, target, idx = _wait_samples(venue, ctx, ranked, ghost, len(ranked), seed=11)
        except Exception:
            log.exception("Monte Carlo failed; analytic fallback")
            samples, target, idx = None, _sim_ticket(ctx, venue, ghost), len(ranked)
        eta = _eta_dict(venue, st, party, samples, target, idx)
    _NEW_CACHE[k] = (VERSION[venue["_id"]], time.time(), eta)
    return eta


# =========================================================================== views
def venue_view(venue):
    sts = list(service_types(venue["_id"]).values())
    res = resources(venue["_id"])
    from venues import resolve_theme
    return {"slug": venue["slug"], "name": venue["name"], "template": venue["template"], "theme": resolve_theme(venue),
            "timezone": venue.get("timezone", C.DEFAULT_TIMEZONE),
            "open_now": is_open(venue), "open_hours": venue.get("open_hours", []), "settings": settings(venue),
            "service_types": [st_public(s) for s in sts],
            "party_max": max([r["capacity"] for r in res if r["kind"] == "table"] or [1]),
            "has_tables": any(r["kind"] == "table" for r in res)}


def st_public(s):
    return {"id": s["_id"], "name": s["name"], "color": s.get("color", "#1F6FEB"), "allows_priority": s.get("allows_priority", False),
            "resource_kind": s["resource_kind"], "prior_mean_seconds": s["prior_mean_seconds"], "prior_cv": s["prior_cv"]}


def summary(venue):
    waiting = tickets(venue["_id"], ("WAITING",))
    res = resources(venue["_id"])
    out = []
    for st in service_types(venue["_id"]).values():
        open_r = [r for r in res if st["_id"] in r["service_type_ids"] and r["status"] not in ("PAUSED", "CLOSED")]
        out.append({"service_type_id": st["_id"], "name": st["name"],
                    "waiting": sum(1 for t in waiting if t["service_type_id"] == st["_id"]),
                    "open_resources": len(open_r), "eta": eta_for_new(venue, st) if open_r else None})
    return {"slug": venue["slug"], "name": venue["name"], "open_now": is_open(venue), "queue_length": len(waiting),
            "services": out, "updated_at": iso(now())}


def ticket_view(ticket, venue=None):
    venue = venue or venue_by_id(ticket["venue_id"])
    sts = service_types(venue["_id"])
    st = sts.get(ticket["service_type_id"]) or {"name": {"en": "?"}, "resource_kind": "counter"}
    res = DB.resources.find_one({"_id": ticket.get("resource_id")}) if ticket.get("resource_id") else None
    position = ahead = eta = None
    can_snooze = False
    if ticket["status"] == "WAITING":
        ranked = ranked_queue(venue)
        same = [r for r in ranked if r.ticket["service_type_id"] == ticket["service_type_id"]]
        ids = [r.ticket["_id"] for r in same]
        if ticket["_id"] in ids:
            ahead = ids.index(ticket["_id"])
            position = ahead + 1
            can_snooze = ticket.get("snooze_count", 0) < C.MAX_SNOOZES and ahead < len(ids) - 1
        eta = eta_for_ticket(venue, ticket, ranked)
    sett = settings(venue)
    call_exp = None
    if ticket["status"] == "CALLED" and res and res.get("held_until") and res.get("current_ticket_id") == ticket["_id"]:
        call_exp = iso(res["held_until"])
    checkin_open = False
    if ticket["status"] == "BOOKED" and ticket.get("slot_start"):
        to_slot = seconds_between(now(), ticket["slot_start"])
        checkin_open = to_slot <= sett["checkin_window_minutes"] * 60
    base = PUBLIC_BASE["url"]
    return {"code": ticket["code"], "venue_slug": venue["slug"], "venue_name": venue["name"],
            "service_type_id": ticket["service_type_id"], "service_name": st["name"], "party_size": ticket["party_size"],
            "priority_class": ticket["priority_class"], "source": ticket["source"], "status": ticket["status"],
            "position": position, "ahead": ahead, "eta": eta,
            "resource_label": res["label"] if res and ticket["status"] in ("CALLED", "IN_SERVICE") else None,
            "resource_kind": res["kind"] if res else None,
            "called_at": iso(ticket.get("called_at")), "call_expires_at": call_exp,
            "slot_start": iso(ticket.get("slot_start")), "checkin_open": checkin_open,
            "reason": ticket.get("reason"), "snooze_count": ticket.get("snooze_count", 0), "can_snooze": can_snooze,
            "is_table": st["resource_kind"] == "table", "rating": ticket.get("rating"), "accurate": ticket.get("accurate"),
            "created_at": iso(ticket["created_at"]), "notices": ticket.get("notices", [])[:5],
            "join_url": f"{base}/v/{venue['slug']}",
            "share_text": f"My QueueSense ticket {ticket['code']} at {venue['name']}: {base}/t/{ticket['code']}"}


def board(venue):
    res = {r["_id"]: r for r in resources(venue["_id"])}
    serving = [{"code": t["code"], "resource_label": res[t["resource_id"]]["label"]}
               for t in tickets(venue["_id"], ("CALLED", "IN_SERVICE")) if t.get("resource_id") in res]
    serving.sort(key=lambda x: x["resource_label"])
    nxt = [r.ticket["code"] for r in ranked_queue(venue)[:6]]
    services = []
    for s in summary(venue)["services"]:
        nm = s["name"]
        services.append({"name": nm.get("en") if isinstance(nm, dict) else nm, "names": nm,
                         "eta_text": s["eta"]["text"] if s["eta"] else "Closed"})
    return {"venue_name": venue["name"], "now_serving": serving, "next_up": nxt, "services": services,
            "join_url": f"{PUBLIC_BASE['url']}/v/{venue['slug']}", "updated_at": iso(now())}


def resource_view(r, tmap, sett, t):
    cur = tmap.get(r.get("current_ticket_id"))
    held = DB.tickets.find_one({"_id": r["held_for_ticket_id"]}) if r.get("held_for_ticket_id") else None
    dwell = None
    if cur and r["kind"] == "table" and cur["status"] == "IN_SERVICE":
        dwell = int(seconds_between(cur.get("service_start_at") or cur["called_at"], t))
    return {"id": r["_id"], "kind": r["kind"], "label": r["label"], "capacity": r["capacity"],
            "service_type_ids": r["service_type_ids"], "status": r["status"],
            "ticket": {"id": cur["_id"], "code": cur["code"], "status": cur["status"], "party_size": cur["party_size"],
                       "priority_class": cur["priority_class"], "display_name": cur.get("display_name"),
                       "called_at": iso(cur.get("called_at")),
                       "service_start_at": iso(cur.get("service_start_at")) if not cur.get("implicit_start") else None}
            if cur else None,
            "held_for_code": held["code"] if held else None, "held_until": iso(r.get("held_until")),
            "status_changed_at": iso(r.get("status_changed_at")), "dwell_seconds": dwell,
            "dwell_alert": bool(dwell and dwell > sett["max_dwell_minutes"] * 60),
            "pending_release": bool(r.get("pending_release"))}


def console(venue, user):
    t = now()
    sett = settings(venue)
    act = {x["_id"]: x for x in tickets(venue["_id"], ("CALLED", "IN_SERVICE"))}
    res = resources(venue["_id"])
    ranked = ranked_queue(venue, t=t)
    flags = []
    for r in ranked:
        if not A.can_ever_fit(res, r.ticket):
            flags.append({"code": r.ticket["code"], "message": f"{r.ticket['code']}: party of {r.ticket['party_size']} "
                                                              f"is larger than any open table - seat manually"})
    undo = None
    if user and UNDO[user["sub"]]:
        last = UNDO[user["sub"]][-1]
        if time.time() - last["ts"] < C.UNDO_WINDOW_SECONDS:
            undo = {"label": last["label"], "expires_at": iso(now() + timedelta(seconds=C.UNDO_WINDOW_SECONDS - (time.time() - last["ts"])))}
    return {"venue": venue_view(venue), "resources": [resource_view(r, act, sett, t) for r in res],
            "up_next": [{"ticket_id": r.ticket["_id"], "code": r.ticket["code"], "party_size": r.ticket["party_size"],
                         "service_type_id": r.ticket["service_type_id"], "priority_class": r.ticket["priority_class"],
                         "display_name": r.ticket.get("display_name"), "source": r.ticket["source"],
                         "waited_seconds": int(A.waited_seconds(r.ticket, t)), "reason": r.reason} for r in ranked[:5]],
            "queue_length": len(ranked), "flags": flags, "undo": undo, "staff_name": (user or {}).get("name")}


# =========================================================================== core transitions
def _next_code(venue):
    v = DB.venues.find_one_and_update({"_id": venue["_id"]}, {"$inc": {"ticket_counter": 1}}, return_document=True)
    return f"{venue['code_prefix']}-{v['ticket_counter']:03d}"


def _new_ticket(venue, st, party, priority, source, act, phone_hash=None, last4=None, display_name=None,
                status="WAITING", slot_start=None, lang="en"):
    t = now()
    doc = {"_id": new_id("t"), "code": _next_code(venue), "venue_id": venue["_id"], "service_type_id": st["_id"],
           "source": source, "phone_hash": phone_hash, "phone_last4": last4, "display_name": display_name,
           "party_size": party, "priority_class": priority, "status": status, "created_at": t, "status_changed_at": t,
           "slot_start": slot_start, "checkin_at": None, "called_at": None, "service_start_at": None,
           "service_end_at": None, "resource_id": None, "skip_count": 0, "snooze_count": 0, "missed_calls": 0,
           "predicted_at_join": None, "prediction_snapshots": [], "actual_wait_seconds": None, "version": 0,
           "lang": lang, "notices": []}
    DB.tickets.insert_one(doc)
    if getattr(_ACTION, "created", None) is not None:
        _ACTION.created.append(doc["_id"])
    return doc


def _validate_join(venue, st, party, priority, phone_hash, source):
    sett = settings(venue)
    if priority == "EMERGENCY" and source != "staff_added":
        raise ServiceError("EMERGENCY_STAFF_ONLY", "Emergency tickets can only be added by staff", 403)
    if priority == "SENIOR" and not (sett["priority_enabled"] and st.get("allows_priority")):
        raise ServiceError("PRIORITY_NOT_ALLOWED", "Priority isn't available for this service", 400)
    if not 1 <= party <= 20:
        raise ServiceError("INVALID_PARTY", "Party size must be 1-20", 400)
    if phone_hash:
        n = DB.tickets.count_documents({"venue_id": venue["_id"], "phone_hash": phone_hash, "status": {"$in": list(ACTIVE)}})
        if n >= sett["max_active_tickets_per_phone"]:
            existing = DB.tickets.find_one({"venue_id": venue["_id"], "phone_hash": phone_hash, "status": {"$in": list(ACTIVE)}})
            raise ServiceError("ALREADY_HAS_TICKET", "You already have an active ticket here", 409, existing["code"])


def join(venue, service_type_id, party_size=1, priority_class="NORMAL", phone_hash=None, last4=None,
         display_name=None, source="walkin", act=None, lang="en"):
    act = act or actor("customer")
    with LOCK:
        sts = service_types(venue["_id"])
        st = sts.get(service_type_id)
        if not st:
            raise ServiceError("SERVICE_NOT_FOUND", "Unknown service type", 400)
        if source == "walkin" and not is_open(venue):
            raise ServiceError("VENUE_CLOSED", "This venue is closed right now", 409, "Book a slot for later instead")
        party_size = party_size if st["resource_kind"] == "table" else 1
        _validate_join(venue, st, party_size, priority_class, phone_hash, source)
        if source == "walkin" and not A.can_ever_fit(resources(venue["_id"]), {"service_type_id": st["_id"], "party_size": party_size}):
            raise ServiceError("PARTY_TOO_LARGE", "No table here fits a group that large", 400, "Please ask the staff to seat you")
        t = _new_ticket(venue, st, party_size, priority_class, source, act, phone_hash, last4, display_name, lang=lang)
        record_event(venue["_id"], "TICKET_JOINED", act, t["_id"], payload={"source": source, "party_size": party_size,
                                                                              "priority_class": priority_class})
        if priority_class == "EMERGENCY":
            CONTEXT[venue["_id"]]["priority_at"] = now()
            narrate(venue, f"Emergency {t['code']} added - goes to the front of {st_name(st)}")
        bump(venue["_id"])
        eta = eta_for_ticket(venue, t)
        if eta:
            pred = {"p20": eta["p20"], "p50": eta["p50"], "p80": eta["p80"], "confidence": eta["confidence"]}
            DB.tickets.update_one({"_id": t["_id"]}, {"$set": {"predicted_at_join": pred}})
            t["predicted_at_join"] = pred
        notify(t, "JOINED", venue=venue["name"], eta=eta["text"] if eta else "a few minutes")
        assign(venue)
        return DB.tickets.find_one({"_id": t["_id"]})


def call(venue, ticket, resource, reason, act):
    """WAITING -> CALLED on `resource`. Single-tap flow: service is assumed to start now (implicit)."""
    sett = settings(venue)
    t = now()
    waited = A.waited_seconds(ticket, t)
    auto = sett["call_mode"] == "auto_suggest"
    transition(ticket, "CALLED", called_at=t, service_start_at=t, implicit_start=True, resource_id=resource["_id"],
               reason=reason, actual_wait_seconds=round(waited))
    set_resource(resource, current_ticket_id=ticket["_id"], held_for_ticket_id=None,
                 status="HELD" if auto else "BUSY",
                 held_until=t + timedelta(seconds=sett["call_timeout_seconds"]) if auto else None)
    calib = None
    pred = ticket.get("predicted_at_join")
    if pred:
        cal = calibration(venue["_id"])
        E.add_calibration(cal, pred["p20"], pred["p50"], pred["p80"], waited)
        _save_cal(cal)
        calib = {**pred, "actual": waited}
    record_event(venue["_id"], "ASSIGNED", act, ticket["_id"], resource["_id"], {"reason": reason})
    record_event(venue["_id"], "CALLED", act, ticket["_id"], resource["_id"], {"calib": calib, "wait_s": waited})
    prio = ticket["priority_class"] != "NORMAL"
    DB.venues.update_one({"_id": venue["_id"]}, {"$set": {"consecutive_priority": venue.get("consecutive_priority", 0) + 1 if prio else 0}})
    venue["consecutive_priority"] = venue.get("consecutive_priority", 0) + 1 if prio else 0
    if prio:
        CONTEXT[venue["_id"]]["priority_at"] = t
    notify(ticket, "CALLED", resource=resource["label"])
    narrate(venue, f"{ticket['code']} → {resource['label']}: {reason}")
    bump(venue["_id"])


def end_service(venue, ticket, act, implicit_end=False, end_time=None):
    """CALLED/IN_SERVICE -> DONE, records the duration sample (spec 6.2) and frees the resource."""
    t = end_time or now()
    start = ticket.get("service_start_at") or ticket.get("called_at")
    d = seconds_between(start, t)
    st = service_types(venue["_id"]).get(ticket["service_type_id"])
    implicit = implicit_end or ticket.get("implicit_start", False)
    weight = C.IMPLICIT_WEIGHT if implicit else 1.0
    payload = {"service_type_id": ticket["service_type_id"], "party_size": ticket["party_size"], "duration_s": d,
               "weight": weight, "implicit": implicit}
    if st:
        s = _state(venue["_id"], st, ticket["party_size"])
        bucket = E.bucket_of(local(start, venue.get("timezone", C.DEFAULT_TIMEZONE)))
        rej = E.check_sample(s, d)
        payload.update(queue_key=s["queue_key"], bucket=bucket, rejected_reason=rej)
        if rej:
            if rej == "non_positive_duration":
                log.warning("Rejected non-positive duration for %s", ticket["code"])
        else:
            E.apply_sample(s, d, weight, bucket)
            _save_state(s)
    transition(ticket, "DONE", service_end_at=t)
    record_event(venue["_id"], "SERVICE_ENDED", act, ticket["_id"], ticket.get("resource_id"), payload)
    if ticket.get("resource_id"):
        r = DB.resources.find_one({"_id": ticket["resource_id"]})
        if r and r.get("current_ticket_id") == ticket["_id"]:
            release_resource(r)
            record_event(venue["_id"], "RESOURCE_FREED", act, ticket["_id"], r["_id"])
    bump(venue["_id"])


def call_next_on(venue, resource, act):
    """Pick the right ticket for this resource (assignment engine) and call it."""
    if resource["status"] in ("PAUSED", "CLOSED"):
        raise ServiceError("RESOURCE_PAUSED", f"{resource['label']} is paused", 409, "Resume it first")
    t = now()
    sett = settings(venue)
    ranked = ranked_queue(venue, t=t)
    res = resources(venue["_id"])
    sts = service_types(venue["_id"])
    bookings = [x for x in tickets(venue["_id"], ("BOOKED", "WAITING")) if x["source"] == "prebook"]
    protected = A.designate_bookings(bookings, res, sett, t)
    if resource.get("held_for_ticket_id"):
        b = DB.tickets.find_one({"_id": resource["held_for_ticket_id"]})
        if b and b["status"] == "WAITING":
            call(venue, b, resource, f"Pre-booked {local(b['slot_start'], venue['timezone']).strftime('%H:%M')}, held table", act)
            return b
        if b and b["status"] == "BOOKED":
            raise ServiceError("RESOURCE_HELD", f"{resource['label']} is held for booking {b['code']}", 409,
                               "It is released automatically if they don't arrive in time")
    pick, skipped = A.pick_for_resource(resource, ranked, sett, t, protected, p80_service(venue, sts, t))
    for s in skipped:
        DB.tickets.update_one({"_id": s["_id"]}, {"$inc": {"skip_count": 1, "version": 1}})
    if not pick:
        return None
    call(venue, pick.ticket, resource, pick.reason, act)
    return pick.ticket


def assign(venue):
    """The matcher (spec 7.2). Idempotent: with no state change a second run assigns nothing."""
    with LOCK:
        venue = venue_by_id(venue["_id"])
        t = now()
        sett = settings(venue)
        res = resources(venue["_id"])
        bookings = [x for x in tickets(venue["_id"], ("BOOKED", "WAITING")) if x["source"] == "prebook"]
        protected = A.designate_bookings(bookings, res, sett, t)
        # Hold a resource for a booking whose slot has started (released at slot + grace if nobody comes).
        for rid, (b, slot) in protected.items():
            r = next(x for x in res if x["_id"] == rid)
            if b["status"] == "BOOKED" and seconds_between(slot, t) >= 0 and r["status"] == "OPEN" and not r.get("held_for_ticket_id"):
                set_resource(r, status="HELD", held_for_ticket_id=b["_id"],
                             held_until=slot + timedelta(minutes=sett["grace_minutes_prebook"]))
                record_event(venue["_id"], "RESOURCE_HELD", actor(), b["_id"], r["_id"], {"until": iso(r["held_until"])})
                narrate(venue, f"Holding {r['label']} for booking {b['code']} ({local(slot, venue['timezone']).strftime('%H:%M')})")
                bump(venue["_id"])
        if sett["call_mode"] != "auto_suggest":
            return 0
        n = 0
        free = [r for r in res if (r["status"] == "OPEN") or (r["status"] == "HELD" and r.get("held_for_ticket_id")
                                                             and not r.get("current_ticket_id"))]
        free.sort(key=lambda r: (r["capacity"], r.get("order", 0)))
        for r in free:
            r = DB.resources.find_one({"_id": r["_id"]})
            if r["status"] not in ("OPEN", "HELD") or r.get("current_ticket_id"):
                continue
            try:
                if call_next_on(venue, r, actor()):
                    n += 1
            except ServiceError:
                continue
        return n


# =========================================================================== staff actions
@contextmanager
def staff_action(user, venue, label):
    """Snapshot state so the action can be undone within 2 minutes (spec 11.5)."""
    with LOCK:
        snap_t = {x["_id"]: x for x in DB.tickets.find({"venue_id": venue["_id"], "status": {"$in": list(ACTIVE)}})}
        snap_r = {x["_id"]: x for x in DB.resources.find({"venue_id": venue["_id"]})}
        _ACTION.events, _ACTION.created = [], []
        try:
            yield
            if user:
                q = UNDO[user["sub"]]
                q.append({"label": label, "ts": time.time(), "venue_id": venue["_id"], "tickets": snap_t,
                          "resources": snap_r, "events": [e["_id"] for e in _ACTION.events],
                          "types": [e["type"] for e in _ACTION.events], "created": list(_ACTION.created)})
                while len(q) > C.UNDO_MAX:
                    q.popleft()
                CONTEXT[venue["_id"]].setdefault("human_taps", {})
                for e in _ACTION.events:
                    if e.get("resource_id"):
                        CONTEXT[venue["_id"]]["human_taps"][e["resource_id"]] = time.time()
        finally:
            _ACTION.events, _ACTION.created = None, None


def undo(user):
    with LOCK:
        q = UNDO[user["sub"]]
        while q and time.time() - q[-1]["ts"] > C.UNDO_WINDOW_SECONDS:
            q.pop()
        if not q:
            raise ServiceError("NOTHING_TO_UNDO", "Nothing to undo (actions can be undone for 2 minutes)", 409)
        a = q.pop()
        venue = venue_by_id(a["venue_id"])
        for tid, snap in a["tickets"].items():
            cur = DB.tickets.find_one({"_id": tid})
            DB.tickets.replace_one({"_id": tid}, {**snap, "version": (cur or snap).get("version", 0) + 1})
        for tid in a["created"]:
            DB.tickets.update_one({"_id": tid}, {"$set": {"status": "CANCELLED"}, "$inc": {"version": 1}})
        for rid, snap in a["resources"].items():
            cur = DB.resources.find_one({"_id": rid})
            if cur:
                DB.resources.replace_one({"_id": rid}, {**snap, "version": cur.get("version", 0) + 1})
        record_event(venue["_id"], "UNDO", actor("staff", user["sub"]), payload={"undone_event_ids": a["events"], "label": a["label"]})
        if "SERVICE_ENDED" in a["types"] or "CALLED" in a["types"]:
            rebuild_estimator(venue["_id"])   # the sample is re-opened: learn as if it never happened
        narrate(venue, f"Staff undid: {a['label']}")
        bump(venue["_id"])
        return a["label"]


def _current(resource):
    return DB.tickets.find_one({"_id": resource["current_ticket_id"]}) if resource.get("current_ticket_id") else None


def staff_next(venue, resource, act):
    """The one big button: close whoever is at this resource (implicitly) and call the next person."""
    cur = _current(resource)
    if cur:
        end_service(venue, cur, act, implicit_end=True)
        resource = resource_by_id(resource["_id"])
    called = call_next_on(venue, resource, act)
    assign(venue)
    return called


def staff_arrived(venue, ticket, act):
    gap = seconds_between(ticket["called_at"], now())
    transition(ticket, "IN_SERVICE", service_start_at=now(), implicit_start=False)
    r = resource_by_id(ticket["resource_id"])
    set_resource(r, status="PAUSED" if r.get("paused") else "BUSY", held_until=None)
    cal = calibration(venue["_id"])
    E.update_call_gap(cal, gap)
    _save_cal(cal)
    record_event(venue["_id"], "SERVICE_STARTED", act, ticket["_id"], r["_id"], {"gap_s": gap})
    bump(venue["_id"])


def staff_served(venue, ticket, act):
    end_service(venue, ticket, act, implicit_end=False)
    assign(venue)


def staff_no_show(venue, ticket, act):
    """Staff says the called person never came: NO_SHOW, then the resource calls the next person."""
    if ticket["status"] != "CALLED":
        raise ServiceError("INVALID_TRANSITION", "Only a called ticket can be a no-show", 409)
    r = resource_by_id(ticket["resource_id"])
    transition(ticket, "NO_SHOW")
    record_event(venue["_id"], "NO_SHOW", act, ticket["_id"], r["_id"])
    release_resource(r)
    narrate(venue, f"{ticket['code']} marked no-show at {r['label']}")
    bump(venue["_id"])
    called = call_next_on(venue, resource_by_id(r["_id"]), act) if settings(venue)["call_mode"] == "staff_tap" else None
    assign(venue)
    return called


def _push_back(venue, ticket, steps):
    """Move a waiting ticket behind the next `steps` compatible people (snooze, missed call)."""
    ranked = [r.ticket for r in ranked_queue(venue) if r.ticket["service_type_id"] == ticket["service_type_id"]
              and r.ticket["_id"] != ticket["_id"]]
    behind = [x for x in ranked if A.virtual_arrival(x) >= A.virtual_arrival(ticket)]
    if not behind:
        return False
    anchor = behind[min(steps, len(behind)) - 1]
    DB.tickets.update_one({"_id": ticket["_id"]}, {"$set": {"virtual_arrival": A.virtual_arrival(anchor) + timedelta(milliseconds=1)},
                                                   "$inc": {"version": 1}})
    return True


def missed_call(venue, ticket, act, reason="missed"):
    """CALLED -> WAITING (3 go ahead) on the first miss, NO_SHOW on the second."""
    r = resource_by_id(ticket["resource_id"])
    if ticket.get("missed_calls", 0) >= 1:
        transition(ticket, "NO_SHOW", missed_calls=ticket.get("missed_calls", 0) + 1)
        record_event(venue["_id"], "NO_SHOW", act, ticket["_id"], r["_id"], {"reason": "second missed call"})
        narrate(venue, f"{ticket['code']} missed a second call - no-show")
    else:
        transition(ticket, "WAITING", missed_calls=1, resource_id=None, called_at=None, service_start_at=None)
        _push_back(venue, ticket, C.MISSED_CALL_PUSHBACK)
        record_event(venue["_id"], "SKIPPED", act, ticket["_id"], r["_id"], {"reason": reason})
        notify(ticket, "NO_SHOW_WARNING")
        narrate(venue, f"{ticket['code']} didn't come to {r['label']} - moved back 3 places")
    release_resource(r)
    bump(venue["_id"])


def staff_skip(venue, ticket, act):
    if ticket["status"] != "CALLED":
        raise ServiceError("INVALID_TRANSITION", "Only a called ticket can be skipped", 409)
    rid = ticket["resource_id"]
    missed_call(venue, ticket, act, "staff skip")
    called = call_next_on(venue, resource_by_id(rid), act) if settings(venue)["call_mode"] == "staff_tap" else None
    assign(venue)
    return called


def staff_left(venue, resource, act):
    """Table/room is free. Uses the customer's own 'I'm leaving' time if they tapped first (spec 6.2)."""
    cur = _current(resource)
    if not cur:
        if resource["status"] == "HELD" and resource.get("held_for_ticket_id"):
            raise ServiceError("RESOURCE_HELD", "This table is held for a booking", 409)
        return None
    if cur["status"] == "CALLED":
        transition(cur, "IN_SERVICE", implicit_start=True)
    end_service(venue, cur, act, implicit_end=False, end_time=cur.get("release_requested_at"))
    called = None
    if settings(venue)["call_mode"] == "staff_tap":
        called = call_next_on(venue, resource_by_id(resource["_id"]), act)
    assign(venue)
    return called


def pause(venue, resource, act, reason=None):
    set_resource(resource, paused=True, status="PAUSED")
    CONTEXT[venue["_id"]]["paused_at"] = now()
    record_event(venue["_id"], "RESOURCE_PAUSED", act, resource_id=resource["_id"], payload={"reason": reason})
    narrate(venue, f"{resource['label']} paused{': ' + reason if reason else ''} - waits re-estimated")
    bump(venue["_id"])


def resume(venue, resource, act):
    set_resource(resource, paused=False, status="BUSY" if resource.get("current_ticket_id") else "OPEN")
    record_event(venue["_id"], "RESOURCE_RESUMED", act, resource_id=resource["_id"])
    narrate(venue, f"{resource['label']} resumed")
    bump(venue["_id"])
    assign(venue)


def override(venue, ticket, resource, reason, act):
    if ticket["status"] != "WAITING":
        raise ServiceError("INVALID_TRANSITION", "Only waiting tickets can be assigned", 409)
    cur = _current(resource)
    if cur:
        end_service(venue, cur, act, implicit_end=True)
        resource = resource_by_id(resource["_id"])
    if resource["status"] in ("PAUSED", "CLOSED"):
        raise ServiceError("RESOURCE_PAUSED", f"{resource['label']} is paused", 409)
    record_event(venue["_id"], "OVERRIDE", act, ticket["_id"], resource["_id"], {"reason": reason})
    call(venue, ticket, resource, f"Staff override: {reason}", act)


# =========================================================================== customer actions
def cancel(venue, ticket, act):
    late = False
    if ticket["status"] == "BOOKED" and ticket.get("slot_start"):
        late = seconds_between(now(), ticket["slot_start"]) < C.PREBOOK_FREE_CANCEL_MINUTES * 60
    rid = ticket.get("resource_id") if ticket["status"] == "CALLED" else None
    transition(ticket, "CANCELLED", late_cancel=late)
    record_event(venue["_id"], "CANCELLED", act, ticket["_id"], rid, {"late_cancel": late})
    if rid:
        release_resource(resource_by_id(rid))
    for r in DB.resources.find({"held_for_ticket_id": ticket["_id"]}):
        set_resource(r, held_for_ticket_id=None, held_until=None, status="PAUSED" if r.get("paused") else "OPEN")
    notify(ticket, "CANCELLED")
    bump(venue["_id"])
    assign(venue)


def snooze(venue, ticket, act):
    if ticket["status"] != "WAITING":
        raise ServiceError("INVALID_TRANSITION", "Only waiting tickets can let others go ahead", 409)
    if ticket.get("snooze_count", 0) >= C.MAX_SNOOZES:
        raise ServiceError("SNOOZE_LIMIT", "You can let people go ahead at most twice", 409)
    if not _push_back(venue, ticket, C.SNOOZE_STEP):
        raise ServiceError("NOBODY_BEHIND", "There's nobody behind you right now", 409)
    DB.tickets.update_one({"_id": ticket["_id"]}, {"$inc": {"snooze_count": 1, "version": 1}})
    record_event(venue["_id"], "SNOOZED", act, ticket["_id"])
    narrate(venue, f"{ticket['code']} let 2 people go ahead")
    bump(venue["_id"])


def checkin(venue, ticket, act):
    if ticket["status"] != "BOOKED":
        raise ServiceError("INVALID_TRANSITION", "Only booked tickets can check in", 409)
    sett = settings(venue)
    to_slot = seconds_between(now(), ticket["slot_start"])
    if to_slot > sett["checkin_window_minutes"] * 60:
        raise ServiceError("TOO_EARLY", f"Check-in opens {sett['checkin_window_minutes']} min before your slot", 409)
    transition(ticket, "WAITING", checkin_at=now())
    record_event(venue["_id"], "CHECKED_IN", act, ticket["_id"])
    narrate(venue, f"Booking {ticket['code']} checked in")
    bump(venue["_id"])
    assign(venue)


def leaving(venue, ticket, act):
    """Customer self-release for tables: a signal; confirmed by staff LEFT or automatically after 60 s."""
    if ticket["status"] != "IN_SERVICE" or not ticket.get("resource_id"):
        raise ServiceError("INVALID_TRANSITION", "You can only release a table you're seated at", 409)
    DB.tickets.update_one({"_id": ticket["_id"]}, {"$set": {"release_requested_at": now()}, "$inc": {"version": 1}})
    DB.resources.update_one({"_id": ticket["resource_id"]}, {"$set": {"pending_release": True}, "$inc": {"version": 1}})
    record_event(venue["_id"], "RESOURCE_FREED", act, ticket["_id"], ticket["resource_id"], {"self_release": True, "pending": True})
    bump(venue["_id"])


def reinstate(venue, ticket, act):
    if ticket["status"] != "NO_SHOW" or ticket.get("reinstated"):
        raise ServiceError("INVALID_TRANSITION", "Only a no-show can be reinstated, once", 409)
    transition(ticket, "WAITING", reinstated=True, resource_id=None)
    record_event(venue["_id"], "CHECKED_IN", act, ticket["_id"], payload={"reinstated": True})
    bump(venue["_id"])
    assign(venue)


# =========================================================================== bookings
def _arrival_rate(venue, st, at):
    arr = venue.get("arrivals") or {}
    base = (arr.get("base_per_hour") or {}).get(st.get("key", ""), 0)
    hm = local(at, venue.get("timezone", C.DEFAULT_TIMEZONE)).strftime("%H:%M")
    mult = 1.0
    for p in arr.get("peaks", []):
        if p["from"] <= hm < p["to"]:
            mult = p["mult"]
    return base * mult


def slots(venue, service_type_id, party, date_str):
    from datetime import datetime, timezone as tz
    sett = settings(venue)
    st = service_types(venue["_id"]).get(service_type_id)
    if not st:
        raise ServiceError("SERVICE_NOT_FOUND", "Unknown service type", 400)
    off = timedelta(minutes=C.TZ_OFFSET_MIN.get(venue.get("timezone", C.DEFAULT_TIMEZONE), 330))
    day = datetime.strptime(date_str, "%Y-%m-%d").date()
    t = now()
    if (day - local(t, venue["timezone"]).date()).days > sett["prebook_max_advance_days"]:
        return []
    hours = [h for h in venue.get("open_hours", []) if h["weekday"] == day.weekday()]
    res = [r for r in resources(venue["_id"]) if service_type_id in r["service_type_ids"] and r["capacity"] >= party]
    if not hours or not res:
        return []
    mu = _dist(venue, st, party, t)[1]
    cap_per_hour = len(res) * 3600 / mu
    out = []
    for h in hours:
        start = datetime.combine(day, datetime.strptime(h["open"], "%H:%M").time()) - off
        end = datetime.combine(day, datetime.strptime(h["close"], "%H:%M").time()) - off
        cur = start.replace(tzinfo=tz.utc)
        end = end.replace(tzinfo=tz.utc)
        while cur < end:
            if seconds_between(t, cur) >= 5 * 60:
                hour_from, hour_to = cur - timedelta(minutes=30), cur + timedelta(minutes=30)
                booked = DB.tickets.count_documents({"venue_id": venue["_id"], "source": "prebook", "service_type_id": service_type_id,
                                                     "status": {"$in": ["BOOKED", "WAITING"]},
                                                     "slot_start": {"$gte": hour_from, "$lt": hour_to}})
                cap = max(1, int(sett["prebook_capacity_cap"] * cap_per_hour))
                util = (_arrival_rate(venue, st, cur) * mu / 3600 + booked * mu / 3600) / max(1, len(res))
                if booked >= cap:
                    status, reason = "full", "Booking capacity reached"
                elif util < C.SLOT_GREEN_UTIL:
                    status, reason = "green", "Usually quiet"
                elif util < C.SLOT_AMBER_UTIL:
                    status, reason = "amber", "Moderately busy"
                else:
                    status, reason = "red", "Likely busy"
                out.append({"start": iso(cur), "label": local(cur, venue["timezone"]).strftime("%H:%M"),
                            "status": status, "reason": reason})
            cur += timedelta(minutes=sett["prebook_slot_minutes"])
    return out


def book(venue, service_type_id, party, slot_start, phone_hash, last4, act, lang="en"):
    with LOCK:
        st = service_types(venue["_id"]).get(service_type_id)
        if not st:
            raise ServiceError("SERVICE_NOT_FOUND", "Unknown service type", 400)
        party = party if st["resource_kind"] == "table" else 1
        _validate_join(venue, st, party, "NORMAL", phone_hash, "prebook")
        date_str = local(slot_start, venue["timezone"]).strftime("%Y-%m-%d")
        ok = {s["start"]: s for s in slots(venue, service_type_id, party, date_str)}
        s = ok.get(iso(slot_start))
        if not s:
            raise ServiceError("SLOT_UNAVAILABLE", "That time can't be booked", 409, "Pick another slot")
        if s["status"] == "full":
            raise ServiceError("SLOT_FULL", "That slot is fully booked", 409, "Pick another slot")
        t = _new_ticket(venue, st, party, "NORMAL", "prebook", act, phone_hash, last4, status="BOOKED",
                        slot_start=slot_start, lang=lang)
        record_event(venue["_id"], "TICKET_BOOKED", act, t["_id"], payload={"slot_start": iso(slot_start)})
        notify(t, "BOOKING_CONFIRMED", venue=venue["name"], slot=s["label"])
        narrate(venue, f"Booking {t['code']} for {s['label']}")
        bump(venue["_id"])
        return t


def ics(ticket, venue):
    start = aware(ticket["slot_start"])
    st = service_types(venue["_id"]).get(ticket["service_type_id"])
    mins = max(10, round(_dist(venue, st, ticket["party_size"], start)[1] / 60)) if st else 15
    f = lambda d: d.strftime("%Y%m%dT%H%M%SZ")
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QueueSense//EN", "BEGIN:VEVENT",
                        f"UID:{ticket['_id']}@queuesense", f"DTSTAMP:{f(now())}", f"DTSTART:{f(start)}",
                        f"DTEND:{f(start + timedelta(minutes=mins))}",
                        f"SUMMARY:{venue['name']} - booking {ticket['code']}",
                        f"DESCRIPTION:Check in on arrival: {PUBLIC_BASE['url']}/t/{ticket['code']}",
                        "END:VEVENT", "END:VCALENDAR", ""])


# =========================================================================== background tick
_last = defaultdict(float)


def tick(venue):
    """Timers (all on the server's virtual clock): booking no-shows and reminders, call timeouts, self-release
    auto-confirm, heartbeat matcher, ETA refresh with position/delay notices, queue-length sampling."""
    with LOCK:
        venue = venue_by_id(venue["_id"])
        t = now()
        sett = settings(venue)
        for b in DB.tickets.find({"venue_id": venue["_id"], "status": "BOOKED"}):
            to_slot = seconds_between(t, b["slot_start"])
            if to_slot < -sett["grace_minutes_prebook"] * 60:
                transition(b, "NO_SHOW")
                record_event(venue["_id"], "NO_SHOW", actor(), b["_id"], payload={"reason": "no check-in by slot + grace"})
                for r in DB.resources.find({"held_for_ticket_id": b["_id"]}):
                    set_resource(r, held_for_ticket_id=None, held_until=None, status="PAUSED" if r.get("paused") else "OPEN")
                narrate(venue, f"Booking {b['code']} didn't check in within {sett['grace_minutes_prebook']} min - released")
                bump(venue["_id"])
                continue
            for m in C.REMINDERS_MINUTES:
                flag = f"reminded_{m}"
                if to_slot <= m * 60 and not b.get(flag):
                    DB.tickets.update_one({"_id": b["_id"]}, {"$set": {flag: True}})
                    notify(b, f"REMINDER_{m}", venue=venue["name"], slot=local(b["slot_start"], venue["timezone"]).strftime("%H:%M"))
        for tk in DB.tickets.find({"venue_id": venue["_id"], "status": "CALLED"}):
            r = DB.resources.find_one({"_id": tk.get("resource_id")})
            if r and r.get("held_until") and r.get("current_ticket_id") == tk["_id"] and aware(r["held_until"]) < t:
                missed_call(venue, tk, actor(), "call timed out")
        if sett["self_release_enabled"]:
            for tk in DB.tickets.find({"venue_id": venue["_id"], "status": "IN_SERVICE", "release_requested_at": {"$ne": None}}):
                if tk.get("release_requested_at") and seconds_between(tk["release_requested_at"], t) >= C.SELF_RELEASE_CONFIRM_SECONDS:
                    r = DB.resources.find_one({"_id": tk["resource_id"]})
                    end_service(venue, tk, actor(), end_time=tk["release_requested_at"])
                    narrate(venue, f"{r['label'] if r else 'Table'} released by the customer ({tk['code']})")
                    assign(venue)
        real = time.time()
        if real - _last[("assign", venue["_id"])] >= C.ASSIGN_HEARTBEAT_SECONDS:
            _last[("assign", venue["_id"])] = real
            assign(venue)
        if real - _last[("eta", venue["_id"])] >= C.ETA_REFRESH_SECONDS:
            _last[("eta", venue["_id"])] = real
            refresh_waiting(venue)
        ts = t.timestamp()
        if ts - _last[("qs", venue["_id"])] >= C.QUEUE_SAMPLE_SECONDS:
            _last[("qs", venue["_id"])] = ts
            DB.queue_samples.insert_one({"venue_id": venue["_id"], "t": t,
                                         "v": DB.tickets.count_documents({"venue_id": venue["_id"], "status": "WAITING"})})


def refresh_waiting(venue):
    """Recompute ETAs for waiting tickets: notices for position 3 / next / delays; 50% prediction snapshots."""
    ranked = ranked_queue(venue)
    ctx = _sim_context(venue)
    by_type = defaultdict(list)
    for r in ranked:
        by_type[r.ticket["service_type_id"]].append(r.ticket)
    for r in ranked:
        tk = r.ticket
        pos = by_type[tk["service_type_id"]].index(tk) + 1
        if pos == 3 and not tk.get("notified_pos3"):
            DB.tickets.update_one({"_id": tk["_id"]}, {"$set": {"notified_pos3": True}})
            notify(tk, "POSITION_3")
        elif pos == 1 and not tk.get("notified_pos1"):
            DB.tickets.update_one({"_id": tk["_id"]}, {"$set": {"notified_pos1": True}})
            notify(tk, "POSITION_1")
        eta = eta_for_ticket(venue, tk, ranked, ctx)
        if not eta:
            continue
        last = tk.get("last_notified_p50") or (tk.get("predicted_at_join") or {}).get("p50")
        if last is not None and eta["p50"] - last >= C.DELAYED_MIN_SECONDS:
            DB.tickets.update_one({"_id": tk["_id"]}, {"$set": {"last_notified_p50": eta["p50"]}})
            notify(tk, "DELAYED", eta=eta["text"], reason=eta.get("rise_reason") or "")
        pred = tk.get("predicted_at_join")
        if pred and not tk.get("prediction_snapshots") and A.waited_seconds(tk, now()) >= 0.5 * pred["p50"]:
            snap = {"p20": eta["p20"], "p50": eta["p50"], "p80": eta["p80"], "ts": iso(now())}
            DB.tickets.update_one({"_id": tk["_id"]}, {"$push": {"prediction_snapshots": snap}})
