"""Estimation engine (spec section 6) - the heart of QueueSense.

Pipeline, per queue key (a service type for counters/rooms; a party-size bucket for tables):
  1. Every finished service becomes a duration sample, unless it is implausible (rejected, reason logged).
  2. Learn an exponentially weighted mean/variance, blended with the template prior (cold start).
  3. Correct for time of day using 30-minute buckets once a bucket has enough samples.
  4. Predict a ticket's wait by Monte Carlo: replay the queue 400 times with random service times drawn from
     a lognormal fitted to (mu, sigma), and report the 20th/50th/80th percentiles.
  5. Self-calibrate: compare predicted ranges with actual waits and widen/narrow sigma accordingly.
All state here is derived and can be rebuilt by replaying the append-only event log.
"""
import math
from dataclasses import dataclass

import numpy as np

import config as C


# ---------------------------------------------------------------------------------- queue keys
def party_bucket(party_size: int) -> str:
    for lo, hi, label in C.PARTY_BUCKETS:
        if lo <= party_size <= hi:
            return label
    return C.PARTY_BUCKETS[-1][2]


def queue_key(service_type: dict, party_size: int = 1) -> str:
    # Why: table dwell depends on group size (a family of 6 stays longer than a pair), counters don't.
    if service_type["resource_kind"] == "table":
        return f"{service_type['_id']}:{party_bucket(party_size)}"
    return service_type["_id"]


def bucket_of(local_dt) -> str:
    m = (local_dt.hour * 60 + local_dt.minute) // C.BUCKET_MINUTES * C.BUCKET_MINUTES
    return f"{m // 60:02d}:{m % 60:02d}"


# ---------------------------------------------------------------------------------- learning
def new_state(venue_id: str, key: str, prior_mu: float, prior_cv: float, label: str) -> dict:
    return {"venue_id": venue_id, "queue_key": key, "label": label, "n": 0,
            "ew_mean": float(prior_mu), "ew_var": float((prior_cv * prior_mu) ** 2),
            "prior_mu": float(prior_mu), "prior_cv": float(prior_cv),
            "recent": [], "buckets": {}, "rejected": 0}


def p90(values) -> float | None:
    return float(np.percentile(values, 90)) if values else None


def check_sample(state: dict, d: float) -> str | None:
    """Return a rejection reason, or None if the sample is usable."""
    if d <= 0:
        return "non_positive_duration"        # clock problem; never learn from it
    if d < C.REJECT_MIN_SECONDS:
        return "too_short"                     # almost certainly a double tap
    if state["n"] < C.REJECT_SWITCH_N:
        if d > C.REJECT_PRIOR_MULT * state["prior_mu"]:
            return "outlier_vs_prior"          # few samples yet: compare with the template prior
    else:
        q = p90(state["recent"])
        if q and d > C.REJECT_P90_MULT * q:
            return "outlier_vs_p90"            # enough samples: compare with what we've actually seen
    return None


def apply_sample(state: dict, d: float, weight: float, bucket: str):
    """Exponentially weighted mean/variance. Recent behaviour matters more than this morning's."""
    a = C.EW_ALPHA * weight                    # implicit (inferred) samples move the estimate half as much
    diff = d - state["ew_mean"]
    state["ew_mean"] += a * diff
    state["ew_var"] = (1 - a) * (state["ew_var"] + a * diff * diff)
    state["n"] += 1
    state["recent"] = (state["recent"] + [d])[-C.RECENT_KEEP:]
    b = state["buckets"].get(bucket, [])
    state["buckets"][bucket] = (b + [d])[-C.BUCKET_KEEP:]


def params(state: dict, bucket: str | None, sigma_scale: float = 1.0):
    """(mu_final, sigma) in seconds."""
    n_eff = min(state["n"], C.N_EFF_CAP)
    # Bayesian blend: on day one the template prior dominates; after ~30 services the data does.
    mu_hat = (C.PRIOR_K * state["prior_mu"] + n_eff * state["ew_mean"]) / (C.PRIOR_K + n_eff)
    mu = mu_hat
    b = state["buckets"].get(bucket) if bucket else None
    if b and len(b) >= C.BUCKET_MIN_N:
        # Time-of-day correction: the lunch rush is served faster/slower than the daily average.
        mu = C.BUCKET_WEIGHT * float(np.median(b)) + (1 - C.BUCKET_WEIGHT) * mu_hat
    if state["n"] < C.COLD_START_N:
        sigma = state["prior_cv"] * state["prior_mu"]
    else:
        sigma = max(math.sqrt(max(state["ew_var"], 0.0)), C.SIGMA_FLOOR * mu_hat)  # never overconfident
    sigma *= min(max(sigma_scale, C.SIGMA_SCALE_MIN), C.SIGMA_SCALE_MAX)
    return max(mu, 1.0), max(sigma, 1.0)


def lognormal_params(mu: float, sigma: float):
    s2 = math.log(1 + (sigma / mu) ** 2)
    return math.log(mu) - s2 / 2, math.sqrt(s2)


def confidence(state: dict, name: str):
    n = state["n"]
    cv = math.sqrt(max(state["ew_var"], 0)) / state["ew_mean"] if n and state["ew_mean"] > 0 else 1.0
    shown = min(n, C.N_EFF_CAP)
    if n >= C.CONF_HIGH_N and cv <= C.CONF_HIGH_CV:
        return "High", f"Based on the last {shown} customers for {name}"
    if n >= C.CONF_MEDIUM_N:
        return "Medium", f"Based on {shown} customers so far for {name}; service times vary"
    return "Low", f"Not enough data yet for {name} - using typical times for this kind of venue"


# ---------------------------------------------------------------------------------- Monte Carlo
@dataclass
class SimResource:
    mask_index: int
    state: str                 # "idle" | "busy" | "held"
    elapsed: float = 0.0       # busy: seconds already spent on the current service
    dist: tuple = (0.0, 0.0)   # busy: lognormal (m, s) of the current service
    mu: float = 0.0
    held_offset: float = 0.0   # held: seconds until it is released


@dataclass
class SimTicket:
    mask: np.ndarray           # bool per resource: which resources can serve this ticket
    dist: tuple                # lognormal (m, s)
    mu: float
    slot_offset: float = 0.0   # bookings: seconds from now until slot_start
    show_rate: float = 1.0
    overhead: float = 0.0      # learned call-to-arrival gap: the resource is occupied while they walk over


def simulate_wait(resources: list, queue: list, target: int, bookings: list | None = None,
                  runs: int = C.MC_RUNS, seed: int = 7):
    """Wait (seconds) for queue[target] in each run, or None if nothing can ever serve it.

    Why simulation: service times are skewed, busy points are part-way through a service, several points work
    in parallel and serve different services, and pre-bookings may or may not show up. A formula can't hold all
    of that; replaying the queue a few hundred times can. A fixed seed keeps the number steady between
    refreshes when nothing has changed."""
    if not queue[target].mask.any():
        return None
    rng = np.random.default_rng(seed)
    R = len(resources)
    free = np.zeros((runs, R))
    rows = np.arange(runs)
    for j, r in enumerate(resources):
        if r.state == "busy":
            m, s = r.dist
            x = rng.lognormal(m, s, (runs, C.MC_COND_TRIES))
            ok = x > r.elapsed                    # remaining time given it has already lasted `elapsed`
            first = x[rows, ok.argmax(axis=1)]
            free[:, j] = np.where(ok.any(axis=1), first - r.elapsed, 0.25 * r.mu)
        elif r.state == "held":
            free[:, j] = r.held_offset             # held for a pre-booking until its grace ends
    inf = np.inf
    # Expected pre-bookings take priority at their slot time, each showing up with probability show_rate.
    for b in sorted(bookings or [], key=lambda x: x.slot_offset):
        if not b.mask.any():
            continue
        shown = rng.random(runs) < b.show_rate
        cand = np.where(b.mask[None, :], free, inf)
        idx = cand.argmin(axis=1)
        start = np.maximum(free[rows, idx], b.slot_offset)
        dur = rng.lognormal(b.dist[0], b.dist[1], runs) + b.overhead
        free[rows, idx] = np.where(shown, start + dur, free[rows, idx])
    # Walk the queue in the assignment engine's order; each ticket takes the earliest-free compatible point.
    simulate_upto = target
    extra = 0
    if target > C.MC_MAX_AHEAD:                  # very long queue: simulate the first 60, extrapolate the rest
        extra = target - C.MC_MAX_AHEAD
        simulate_upto = C.MC_MAX_AHEAD
        ahead_list = queue[:C.MC_MAX_AHEAD] + [queue[target]]
    else:
        ahead_list = queue[:target + 1]
    for i, t in enumerate(ahead_list):
        cand = np.where(t.mask[None, :], free, inf)
        idx = cand.argmin(axis=1)
        start = free[rows, idx]
        if i == len(ahead_list) - 1:
            if extra:
                active = max(1, int(t.mask.sum()))
                start = start + extra * t.mu / active
            return start
        free[rows, idx] = start + rng.lognormal(t.dist[0], t.dist[1], runs) + t.overhead
    return None


def update_call_gap(cal: dict, gap: float):
    """Learn how long people take to reach the counter after being called (EW mean, outliers capped)."""
    if 0 < gap < 900:
        cal["call_gap"] = gap if cal.get("call_gap") is None else (1 - C.EW_ALPHA) * cal["call_gap"] + C.EW_ALPHA * gap


def fallback_wait(ahead: int, active: int, mu: float):
    """Analytic fallback if simulation fails: (ahead / servers) x mean + half a service."""
    w = (ahead / max(1, active)) * mu + 0.5 * mu
    return w * (1 - C.FALLBACK_RANGE), w, w * (1 + C.FALLBACK_RANGE)


def percentiles(samples):
    p20, p50, p80 = np.percentile(samples, [20, 50, 80])
    return float(p20), float(p50), float(p80)


def format_eta(p20: float, p50: float, p80: float, called: bool = False, joined: bool = True) -> str:
    """Honest wording (spec 6.6): a range, never fake precision, never '0 min' unless actually called.
    `joined=False` is the preview shown before someone joins, so it never says 'your turn'."""
    if called:
        return "It's your turn"
    if not joined and p80 < C.ALMOST_TURN_SECONDS:
        return "No wait"
    if p50 < C.ALMOST_TURN_SECONDS:
        return "Almost your turn" if joined else "Under 1 min"
    if p80 - p20 < C.TIGHT_RANGE_SECONDS:
        return f"~{max(1, round(p50 / 60))} min"
    lo = max(1, math.floor(p20 / 60))
    hi = max(lo + 1, math.ceil(p80 / 60))
    return f"{lo}–{hi} min"


# ---------------------------------------------------------------------------------- calibration
def new_calibration(venue_id: str) -> dict:
    return {"venue_id": venue_id, "queue_key": "_calibration", "pairs": [], "since_adapt": 0, "sigma_scale": 1.0}


def add_calibration(cal: dict, p20: float, p50: float, p80: float, actual: float):
    cal["pairs"] = (cal["pairs"] + [[p20, p50, p80, actual]])[-C.CALIB_KEEP:]
    cal["since_adapt"] += 1
    if cal["since_adapt"] >= C.CALIBRATE_EVERY:
        # Ranges should contain about 60% of actual waits. Too few inside -> widen; too many -> narrow.
        cov = calibration_metrics(cal, last=C.CALIBRATE_EVERY)["coverage"]
        if cov is not None and cov < C.COVERAGE_LOW:
            cal["sigma_scale"] *= C.SCALE_UP
        elif cov is not None and cov > C.COVERAGE_HIGH:
            cal["sigma_scale"] *= C.SCALE_DOWN
        cal["sigma_scale"] = min(max(cal["sigma_scale"], C.SIGMA_SCALE_MIN), C.SIGMA_SCALE_MAX)
        cal["since_adapt"] = 0


def calibration_metrics(cal: dict, last: int | None = None) -> dict:
    pairs = cal["pairs"][-last:] if last else cal["pairs"]
    if not pairs:
        return {"mae_s": None, "mape": None, "coverage": None, "within3": None, "n": 0}
    arr = np.array(pairs, dtype=float)
    err = np.abs(arr[:, 1] - arr[:, 3])
    big = arr[:, 3] >= C.MAPE_MIN_SECONDS
    mape = float(np.mean(err[big] / arr[big, 3])) if big.any() else None
    tol = C.COVERAGE_TOLERANCE_SECONDS
    cov = float(np.mean((arr[:, 3] >= arr[:, 0] - tol) & (arr[:, 3] <= arr[:, 2] + tol)))
    return {"mae_s": float(err.mean()), "mape": mape, "coverage": cov,
            "within3": float(np.mean(err <= C.ACCURATE_WITHIN_SECONDS)), "n": len(pairs)}
