"""Queue ordering and assignment engine (spec section 7). Pure functions: no database access here.

Ordering rules, applied in this exact order (first match wins):
  1. EMERGENCY tickets, oldest first                 - life safety beats everything.
  2. Checked-in pre-bookings due within 5 minutes    - they reserved a time; honour it.
  3. STARVATION: waiting longer than the limit        - nobody waits forever behind priorities.
  4. SENIOR tickets, but after N priority calls in a row one NORMAL ticket goes first - fairness cap.
  5. Everyone else by virtual arrival time            - walk-ins by arrival, late bookings by slot time.
Every decision carries a human-readable reason that is shown to staff, customers and judges.
"""
from dataclasses import dataclass

import config as C
from clock import aware, local, seconds_between

ACTIVE_WAITING = ("WAITING",)

# Allowed ticket state transitions (spec 7.1). Anything else is rejected with a clear error.
TRANSITIONS = {
    "BOOKED": {"WAITING", "NO_SHOW", "CANCELLED", "EXPIRED"},
    "WAITING": {"CALLED", "CANCELLED", "EXPIRED"},
    "CALLED": {"IN_SERVICE", "WAITING", "NO_SHOW", "CANCELLED", "DONE"},
    "IN_SERVICE": {"DONE"},
    "NO_SHOW": {"WAITING"},          # staff may reinstate once
    "DONE": set(), "CANCELLED": set(), "EXPIRED": set(),
}


@dataclass
class Ranked:
    ticket: dict
    rule: int
    reason: str


def waited_seconds(t: dict, now) -> float:
    return max(0.0, seconds_between(t.get("checkin_at") or t["created_at"], now))


def virtual_arrival(t: dict):
    """Walk-ins rank by arrival; late bookings by their slot (ahead of walk-ins who came later);
    snoozes and missed calls move this value back."""
    return aware(t.get("virtual_arrival") or t.get("slot_start") or t["created_at"])


def _hhmm(dt, tz):
    return local(dt, tz).strftime("%H:%M")


def order_queue(waiting: list, settings: dict, now, consecutive_priority: int, tz: str) -> list:
    """Return waiting tickets as [Ranked] in the order the engine would call them."""
    early = C.PREBOOK_EARLY_MINUTES * 60
    limit = settings["starvation_limit_minutes"] * 60
    prio_on = settings["priority_enabled"]
    r1, r2, r3, r4, r5 = [], [], [], [], []
    for t in waiting:
        w = waited_seconds(t, now)
        mins = round(w / 60)
        if t["priority_class"] == "EMERGENCY":
            r1.append(Ranked(t, 1, "Emergency priority"))
        elif t["source"] == "prebook" and t.get("checkin_at") and seconds_between(now, t["slot_start"]) <= early:
            r2.append(Ranked(t, 2, f"Pre-booked {_hhmm(t['slot_start'], tz)}, checked in {_hhmm(t['checkin_at'], tz)}"))
        elif w > limit:
            r3.append(Ranked(t, 3, f"Waiting {mins} min - over the {settings['starvation_limit_minutes']} min fairness limit"))
        elif prio_on and t["priority_class"] == "SENIOR":
            r4.append(Ranked(t, 4, f"Senior priority, waiting {mins} min"))
        else:
            late = t["source"] == "prebook" and t.get("slot_start")
            reason = (f"Late booking for {_hhmm(t['slot_start'], tz)}, ranked by booking time" if late
                      else f"Next in line, waiting {mins} min")
            r5.append(Ranked(t, 5, reason))
    r1.sort(key=lambda r: aware(r.ticket["created_at"]))
    r2.sort(key=lambda r: aware(r.ticket["slot_start"]))
    r3.sort(key=lambda r: virtual_arrival(r.ticket))
    r4.sort(key=lambda r: virtual_arrival(r.ticket))
    r5.sort(key=lambda r: virtual_arrival(r.ticket))
    if r4 and r5 and consecutive_priority >= settings["max_consecutive_priority"]:
        # Fairness cap: after N priority calls in a row, the next normal ticket goes before seniors.
        first = r5.pop(0)
        first.reason = f"Next in line after {consecutive_priority} priority calls, waiting {round(waited_seconds(first.ticket, now) / 60)} min"
        r4.insert(0, first)
    return r1 + r2 + r3 + r4 + r5


def fits(resource: dict, t: dict, settings: dict, now) -> bool:
    """Compatibility + best fit. Tables: big enough, and not wastefully big (unless waited long or skipped)."""
    if t["service_type_id"] not in resource["service_type_ids"]:
        return False
    if resource["kind"] != "table":
        return True
    cap, p = resource["capacity"], t["party_size"]
    if cap < p:
        return False
    relaxed = (waited_seconds(t, now) >= C.TABLE_RELAX_MINUTES * 60) or t.get("skip_count", 0) >= C.MAX_SKIPS
    return relaxed or cap <= p + settings["max_table_oversize"]


def can_ever_fit(resources: list, t: dict) -> bool:
    return any(t["service_type_id"] in r["service_type_ids"] and r["capacity"] >= t["party_size"] for r in resources)


def pick_for_resource(resource: dict, ranked: list, settings: dict, now, protected=None, p80_service=None,
                      taken=frozenset()):
    """Choose who gets `resource`. Returns (Ranked, skipped_heads) or (None, []).

    protected: {resource_id: (booking_ticket, slot_start)} from slot protection (spec 7.5).
    p80_service(ticket) -> seconds: used to keep walk-ins off a resource reserved for a booking soon."""
    cands = [r for r in ranked if r.ticket["service_type_id"] in resource["service_type_ids"]
             and r.ticket["_id"] not in taken]
    if not cands:
        return None, []
    prot = (protected or {}).get(resource["_id"])

    def blocked(r):
        if not prot:
            return False
        booking, slot = prot
        if r.ticket["_id"] == booking["_id"]:
            return False
        late = seconds_between(slot, now) > settings["grace_minutes_prebook"] * 60
        if late:
            return False
        # Don't start a walk-in that would likely still be running when the booking's slot starts.
        need = p80_service(r.ticket) if p80_service else 0
        return seconds_between(now, slot) < need

    if resource["kind"] != "table":
        for r in cands:
            if not blocked(r):
                return r, []
        return None, []

    head = cands[0]
    if fits(resource, head.ticket, settings, now) and not blocked(head):
        return head, []
    if head.ticket.get("skip_count", 0) >= C.MAX_SKIPS and resource["capacity"] >= head.ticket["party_size"]:
        # Head was already skipped twice: this table could fit them, so it is theirs, not given away.
        return (head, []) if not blocked(head) else (None, [])
    # Skip-ahead: the head doesn't fit this table; let one of the next few groups that does fit sit down.
    for r in cands[1:1 + C.SKIP_LOOKAHEAD]:
        if fits(resource, r.ticket, settings, now) and not blocked(r):
            r.reason += f" (seated ahead of a party of {head.ticket['party_size']} waiting for a bigger table)"
            skipped = [head.ticket] if head.ticket.get("skip_count", 0) < C.MAX_SKIPS else []
            return r, skipped
    return None, []


def designate_bookings(bookings: list, resources: list, settings: dict, now, horizon_s: float = 3600):
    """Slot protection: give each upcoming booking a target resource (smallest that fits, free/held first)."""
    out, used = {}, set()
    for b in sorted(bookings, key=lambda x: aware(x["slot_start"])):
        if seconds_between(now, b["slot_start"]) > horizon_s:
            continue
        options = [r for r in resources if r["_id"] not in used and r["status"] not in ("PAUSED", "CLOSED")
                   and b["service_type_id"] in r["service_type_ids"] and r["capacity"] >= b["party_size"]]
        if not options:
            continue
        options.sort(key=lambda r: (r.get("held_for_ticket_id") != b["_id"], r["status"] != "OPEN",
                                    r["capacity"], r.get("order", 0)))
        r = options[0]
        used.add(r["_id"])
        out[r["_id"]] = (b, aware(b["slot_start"]))
    return out
