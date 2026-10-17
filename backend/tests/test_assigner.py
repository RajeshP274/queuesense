from conftest import ALL_DAY
"""T7-T15: queue ordering and assignment (spec 19)."""
from datetime import timedelta

import assigner as A
import config as C
import service as S
import venues as V
from clock import CLOCK, now
from db import DB

SETT = dict(C.DEFAULT_SETTINGS)
TZ = "Asia/Kolkata"


def tk(i, prio="NORMAL", source="walkin", mins_ago=5, party=1, st="s1", **kw):
    t = now() - timedelta(minutes=mins_ago)
    return {"_id": f"t{i}", "code": f"A-{i:03d}", "priority_class": prio, "source": source, "created_at": t,
            "party_size": party, "service_type_id": st, "skip_count": 0, "status": "WAITING", **kw}


def codes(ranked):
    return [r.ticket["_id"] for r in ranked]


def test_t7_emergency_prebook_senior_walkin():
    walk = tk(1, mins_ago=30)
    senior = tk(2, "SENIOR", mins_ago=10)
    pre = tk(3, source="prebook", mins_ago=2, slot_start=now() + timedelta(minutes=2), checkin_at=now() - timedelta(minutes=1))
    emerg = tk(4, "EMERGENCY", mins_ago=1)
    order = codes(A.order_queue([walk, senior, pre, emerg], SETT, now(), 0, TZ))
    assert order == ["t4", "t3", "t2", "t1"]


def test_t8_fairness_after_three_priority_calls():
    seniors = [tk(i, "SENIOR", mins_ago=10 - i) for i in range(1, 4)]
    normal = tk(9, mins_ago=5)
    order = codes(A.order_queue(seniors + [normal], SETT, now(), 3, TZ))
    assert order[0] == "t9"


def test_t9_starvation_beats_senior():
    old = tk(1, mins_ago=SETT["starvation_limit_minutes"] + 5)
    senior = tk(2, "SENIOR", mins_ago=3)
    assert codes(A.order_queue([senior, old], SETT, now(), 0, TZ))[0] == "t1"


def _table(i, cap):
    return {"_id": f"r{i}", "kind": "table", "capacity": cap, "service_type_ids": ["s1"], "status": "OPEN", "label": f"T{i}"}


def test_t10_smallest_table_then_relax_after_10_min():
    sett = {**SETT, "max_table_oversize": 2}
    party3 = tk(1, party=3, mins_ago=2)
    assert A.fits(_table(1, 4), party3, sett, now())
    assert not A.fits(_table(2, 6), party3, sett, now())       # 6 > 3 + 2: too wasteful for now
    ranked = A.order_queue([party3], sett, now(), 0, TZ)
    pick, _ = A.pick_for_resource(_table(2, 6), ranked, sett, now())
    assert pick is None
    later = tk(1, party=3, mins_ago=11)
    assert A.fits(_table(2, 6), later, SETT, now())


def test_t11_head_skipped_at_most_twice_then_table_held():
    head = tk(1, party=6, mins_ago=9)
    others = [tk(i, party=4, mins_ago=9 - i) for i in range(2, 7)]
    queue = [head] + others
    for _ in range(4):
        ranked = A.order_queue([t for t in queue if t["status"] == "WAITING"], SETT, now(), 0, TZ)
        pick, skipped = A.pick_for_resource(_table(1, 4), ranked, SETT, now())
        for s in skipped:
            s["skip_count"] += 1
        if pick:
            pick.ticket["status"] = "CALLED"
    assert head["skip_count"] <= C.MAX_SKIPS
    ranked = A.order_queue([t for t in queue if t["status"] == "WAITING"], SETT, now(), 0, TZ)
    pick, _ = A.pick_for_resource(_table(9, 6), ranked, SETT, now())
    assert pick.ticket["_id"] == "t1"


def test_t12_walkin_not_seated_if_it_would_overrun_booking():
    booking = tk(1, source="prebook", status="BOOKED", slot_start=now() + timedelta(minutes=10))
    walk = tk(2, party=2, mins_ago=5)
    r = _table(1, 2)
    protected = {"r1": (booking, booking["slot_start"])}
    ranked = A.order_queue([walk], SETT, now(), 0, TZ)
    pick, _ = A.pick_for_resource(r, ranked, SETT, now(), protected, lambda t: 30 * 60)
    assert pick is None
    pick, _ = A.pick_for_resource(r, ranked, SETT, now(), protected, lambda t: 5 * 60)
    assert pick is not None


def _canteen():
    v, _, _ = V.create_venue("canteen", "Test Canteen", "test-canteen", open_hours=ALL_DAY)
    return v


def test_t13_no_show_booking_releases_resource():
    v = _canteen()
    st = next(s for s in S.service_types(v["_id"]).values() if s["resource_kind"] == "table")
    date = S.local(now(), v["timezone"]).strftime("%Y-%m-%d")
    slot = next(s for s in S.slots(v, st["_id"], 2, date) if s["status"] != "full")
    from datetime import datetime
    b = S.book(v, st["_id"], 2, datetime.fromisoformat(slot["start"].replace("Z", "+00:00")), "h", "1234", S.actor("customer"))
    CLOCK.advance((datetime.fromisoformat(slot["start"].replace("Z", "+00:00")) - now()).total_seconds() + 5)
    S.assign(v)
    assert DB.resources.find_one({"held_for_ticket_id": b["_id"]}) is not None
    CLOCK.advance((S.settings(v)["grace_minutes_prebook"] + 1) * 60)
    S.tick(v)
    assert DB.tickets.find_one({"_id": b["_id"]})["status"] == "NO_SHOW"
    assert DB.resources.find_one({"held_for_ticket_id": b["_id"]}) is None


def test_t14_assign_is_idempotent():
    v = _canteen()
    st = next(s for s in S.service_types(v["_id"]).values() if s["resource_kind"] == "table")
    for _ in range(3):
        S.join(v, st["_id"], 2, act=S.actor("customer"))
    S.assign(v)
    called = DB.tickets.count_documents({"status": "CALLED"})
    assert S.assign(v) == 0
    assert DB.tickets.count_documents({"status": "CALLED"}) == called


def test_t15_idempotency_key_single_event():
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        V.create_venue("admin_office", "Test Office", "test-office", open_hours=ALL_DAY)
        tok = c.post("/api/auth/login", json={"slug": "test-office", "pin": "1234"}).json()["token"]
        v = S.venue_by_slug("test-office")
        st = next(iter(S.service_types(v["_id"]).values()))
        h = {"Authorization": f"Bearer {tok}", "Idempotency-Key": "abc-123"}
        a = c.post("/api/staff/venues/test-office/walkins", json={"service_type_id": st["_id"], "party_size": 1}, headers=h).json()
        b = c.post("/api/staff/venues/test-office/walkins", json={"service_type_id": st["_id"], "party_size": 1}, headers=h).json()
        assert a["code"] == b["code"]
        assert DB.events.count_documents({"type": "TICKET_JOINED", "venue_id": v["_id"]}) == 1


def test_anonymous_customer_join_and_no_otp_leak():
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        V.create_venue("admin_office", "Test Office", "test-office", open_hours=ALL_DAY)
        st = next(iter(S.service_types(S.venue_by_slug("test-office")["_id"]).values()))
        t = c.post("/api/venues/test-office/tickets", json={"service_type_id": st["_id"], "display_name": "Asha"}).json()
        assert t["status"] in ("WAITING", "CALLED") and t["code"].startswith("A-")
        assert "demo_code" not in c.post("/api/otp/request", json={"phone": "9876543210"}).json()
        assert c.get("/api/sim/status").status_code == 404
