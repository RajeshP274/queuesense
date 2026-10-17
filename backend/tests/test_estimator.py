from conftest import ALL_DAY
"""T1-T6: estimation engine (spec 19)."""
import numpy as np

import estimator as E


def _queue(state, n_tickets, n_counters):
    mu, sigma = E.params(state, None)
    m, s = E.lognormal_params(mu, sigma)
    res = [E.SimResource(j, "idle") for j in range(n_counters)]
    q = [E.SimTicket(np.ones(n_counters, dtype=bool), (m, s), mu) for _ in range(n_tickets)]
    return res, q


def _p50(state, ahead, counters):
    res, q = _queue(state, ahead + 1, counters)
    return E.percentiles(E.simulate_wait(res, q, ahead))[1]


def _trained(n=20, mean=180.0):
    s = E.new_state("v", "k", 240, 0.5, "Fees")
    rng = np.random.default_rng(1)
    for d in rng.normal(mean, 15, n):
        assert E.check_sample(s, float(d)) is None
        E.apply_sample(s, float(d), 1.0, "12:00")
    return s


def test_t1_cold_start():
    s = E.new_state("v", "k", 240, 0.5, "Fees")
    p50 = _p50(s, 5, 1)
    assert 18 * 60 <= p50 <= 26 * 60
    assert E.confidence(s, "Fees")[0] == "Low"


def test_t2_after_20_samples():
    s = _trained()
    p50 = _p50(s, 5, 1)
    assert 13 * 60 <= p50 <= 18 * 60
    assert E.confidence(s, "Fees")[0] == "High"


def test_t3_two_counters_roughly_halve():
    s = _trained()
    one, two = _p50(s, 5, 1), _p50(s, 5, 2)
    assert 0.4 <= two / one <= 0.6


def test_t4_outlier_rejected():
    s = _trained()
    before = s["ew_mean"]
    assert E.check_sample(s, 45 * 60) is not None
    assert abs(s["ew_mean"] - before) / before <= 0.02


def test_t5_rebuild_reproduces_state():
    import service as S
    import venues as V
    from clock import CLOCK
    v, _, _ = V.create_venue("admin_office", "Test Office", "test-office", open_hours=ALL_DAY)
    st = next(iter(S.service_types(v["_id"]).values()))
    res = [r for r in S.resources(v["_id"]) if st["_id"] in r["service_type_ids"]][0]
    act = S.actor("staff", "u1")
    for _ in range(12):
        S.join(v, st["_id"], act=S.actor("customer"))
        S.staff_next(v, S.resource_by_id(res["_id"]), act)
        CLOCK.advance(200)
    S.staff_next(v, S.resource_by_id(res["_id"]), act)
    key = E.queue_key(st)
    before = dict(S._EST[(v["_id"], key)])
    S.rebuild_estimator(v["_id"])
    after = S._EST[(v["_id"], key)]
    assert before["n"] == after["n"] > 0
    assert abs(before["ew_mean"] - after["ew_mean"]) / before["ew_mean"] < 0.01


def test_t6_calibration_adapts_sigma():
    low = E.new_calibration("v")
    for i in range(20):  # 35% coverage
        actual = 100 if i < 7 else 1000
        E.add_calibration(low, 50, 100, 150, actual)
    assert low["sigma_scale"] > 1.0
    high = E.new_calibration("v")
    for i in range(20):  # 85% coverage
        actual = 100 if i < 17 else 1000
        E.add_calibration(high, 50, 100, 150, actual)
    assert high["sigma_scale"] < 1.0
