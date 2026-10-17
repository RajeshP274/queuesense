"""Admin analytics, estimator-quality panel, rule-based insights and the what-if tool (spec 13)."""
from collections import defaultdict
from datetime import timedelta

import numpy as np

import config as C
import estimator as E
import service as S
from clock import aware, iso, local, now, seconds_between
from db import DB

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def analytics(venue, t_from=None, t_to=None):
    t_to = t_to or now()
    t_from = t_from or (t_to - timedelta(days=7))
    vid, tz = venue["_id"], venue.get("timezone", C.DEFAULT_TIMEZONE)
    sts = S.service_types(vid)
    q = {"venue_id": vid, "created_at": {"$gte": t_from, "$lte": t_to}}
    tks = list(DB.tickets.find(q))
    n = len(tks)
    waits = [t["actual_wait_seconds"] for t in tks if t.get("actual_wait_seconds") is not None]
    done = [t for t in tks if t["status"] == "DONE" and t.get("service_end_at") and t.get("service_start_at")]
    svc = [seconds_between(t["service_start_at"], t["service_end_at"]) for t in done]
    hours = max(1 / 60, seconds_between(t_from, t_to) / 3600)
    first = min((aware(t["created_at"]) for t in tks), default=t_to)
    active_hours = max(1 / 60, seconds_between(first, t_to) / 3600)
    res = S.resources(vid)
    busy = defaultdict(float)
    for t in done:
        busy[t.get("resource_id")] += seconds_between(t["service_start_at"], t["service_end_at"])
    util = [{"label": r["label"], "v": round(min(1.0, busy[r["_id"]] / (active_hours * 3600)), 3)} for r in res]
    samples = list(DB.queue_samples.find({"venue_id": vid, "t": {"$gte": t_from, "$lte": t_to}}).sort("t", 1))
    no_show = sum(1 for t in tks if t["status"] == "NO_SHOW")
    abandoned = sum(1 for t in tks if t["status"] == "CANCELLED" and not t.get("called_at"))
    kpis = {"tickets": n,
            "avg_wait_s": round(float(np.mean(waits))) if waits else None,
            "p90_wait_s": round(float(np.percentile(waits, 90))) if waits else None,
            "avg_service_s": round(float(np.mean(svc))) if svc else None,
            "throughput_per_hour": round(len(done) / active_hours, 1),
            "utilisation": round(float(np.mean([u["v"] for u in util])), 3) if util else None,
            "no_show_rate": round(no_show / n, 3) if n else None,
            "abandonment_rate": round(abandoned / n, 3) if n else None,
            "avg_queue_length": round(float(np.mean([s["v"] for s in samples])), 1) if samples else None,
            "prebook_share": round(sum(1 for t in tks if t["source"] == "prebook") / n, 3) if n else None}

    # charts
    step = max(1, len(samples) // 120)
    queue_line = [{"t": iso(s["t"]), "v": s["v"]} for s in samples[::step]]
    hm_hours = list(range(7, 22))
    acc = defaultdict(list)
    for t in tks:
        if t.get("actual_wait_seconds") is not None:
            lt = local(t["created_at"], tz)
            acc[(lt.weekday(), lt.hour)].append(t["actual_wait_seconds"])
    heat = [[round(float(np.mean(acc[(d, h)]))) if acc.get((d, h)) else None for h in hm_hours] for d in range(7)]
    bins = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 30), (30, 45), (45, 60), (60, 999)]
    hist = [{"bin": f"{a}-{b}" if b < 999 else f"{a}+", "count": sum(1 for w in waits if a * 60 <= w < b * 60)} for a, b in bins]
    pva = [{"p": t["predicted_at_join"]["p50"], "a": t["actual_wait_seconds"]} for t in tks
           if t.get("predicted_at_join") and t.get("actual_wait_seconds") is not None][-300:]
    trend = []
    for st in sts.values():
        pts = defaultdict(list)
        for t in done:
            if t["service_type_id"] == st["_id"]:
                lt = aware(t["service_end_at"])
                key = lt.replace(minute=(lt.minute // 30) * 30, second=0, microsecond=0)
                pts[key].append(seconds_between(t["service_start_at"], t["service_end_at"]))
        trend.append({"service": S.st_name(st), "points": [{"t": iso(k), "v": round(float(np.median(v)))} for k, v in sorted(pts.items())]})

    # estimator quality
    cal = S.calibration(vid)
    m = E.calibration_metrics(cal)
    sample_counts = {}
    for d in DB.estimator_state.find({"venue_id": vid, "queue_key": {"$ne": "_calibration"}}):
        sample_counts[d.get("label", d["queue_key"])] = d["n"]
    sentence = (f"Estimates are within 3 minutes {round(m['within3'] * 100)}% of the time "
                f"(last {m['n']} customers)" if m["n"] else "Not enough completed visits yet to measure accuracy")
    quality = {"mae_s": round(m["mae_s"]) if m["mae_s"] is not None else None,
               "mape": round(m["mape"], 3) if m["mape"] is not None else None,
               "coverage": round(m["coverage"], 3) if m["coverage"] is not None else None,
               "sigma_scale": round(cal["sigma_scale"], 3), "samples": sample_counts, "sentence": sentence}
    return {"kpis": kpis, "charts": {"queue_length": queue_line,
                                     "heatmap": {"days": DAYS, "hours": hm_hours, "values": heat},
                                     "wait_hist": hist, "pred_vs_actual": pva, "service_trend": trend,
                                     "utilisation": util},
            "quality": quality, "insights": insights(venue, tks, done, samples, util)}


def insights(venue, tks, done, samples, util):
    """At most three rule-based, plain-language insights."""
    out = []
    tz = venue.get("timezone", C.DEFAULT_TIMEZONE)
    if samples:
        by = defaultdict(list)
        for s in samples:
            lt = local(s["t"], tz)
            by[(lt.hour, lt.minute // 30)].append(s["v"])
        (h, half), vals = max(by.items(), key=lambda kv: np.mean(kv[1]))
        if np.mean(vals) >= 2:
            out.append(f"Peak is around {h:02d}:{half * 30:02d}–{h + (half == 1):02d}:{(1 - half) * 30:02d} "
                       f"with about {np.mean(vals):.0f} waiting. Add staff just before it.")
    per_res = defaultdict(list)
    for t in done:
        per_res[t.get("resource_id")].append(seconds_between(t["service_start_at"], t["service_end_at"]))
    labels = {r["_id"]: r["label"] for r in S.resources(venue["_id"])}
    counters = {k: np.mean(v) for k, v in per_res.items() if len(v) >= 5 and k in labels}
    if len(counters) >= 2:
        avg = np.mean(list(counters.values()))
        slow = max(counters, key=counters.get)
        if counters[slow] > 1.3 * avg:
            out.append(f"{labels[slow]} is {counters[slow] / avg:.1f}x slower than average. Check if it needs help.")
    ns = sorted((aware(t["created_at"]), t["status"] == "NO_SHOW") for t in tks)
    if len(ns) >= 20:
        half = len(ns) // 2
        a = np.mean([x[1] for x in ns[:half]])
        b = np.mean([x[1] for x in ns[half:]])
        if b > a + 0.05:
            out.append(f"No-shows are rising ({a:.0%} → {b:.0%}). Consider shorter call timeouts or reminders.")
    if not out:
        out.append("Queues look steady. No action needed right now.")
    return out[:3]


def whatif(venue, add_resources=0, pause_resources=(), horizon=60):
    """Re-run the Monte Carlo on the CURRENT queue with modified resources (spec 13)."""
    with S.LOCK:
        ranked = S.ranked_queue(venue)

        def run(extra, paused):
            ctx = S._sim_context(venue, extra_counters=extra, paused_ids=tuple(paused))
            if not ctx["res"]:
                return {"p50_seconds": None, "clear_seconds": None}
            sts = list(S.service_types(venue["_id"]).values())
            joins = []
            for st in sts:
                ghost = {"_id": "new", "service_type_id": st["_id"], "party_size": 2 if st["resource_kind"] == "table" else 1,
                         "created_at": ctx["t"]}
                if not S._mask(ctx, ghost).any():
                    continue
                s, _, _ = S._wait_samples(venue, ctx, ranked, ghost, len(ranked), seed=5)
                if s is not None:
                    joins.append(float(np.median(s)))
            clear = None
            if ranked:
                last = ranked[-1].ticket
                s, target, _ = S._wait_samples(venue, ctx, ranked, last, len(ranked) - 1, seed=5)
                if s is not None:
                    clear = float(np.median(s)) + target.mu
            return {"p50_seconds": round(float(np.mean(joins))) if joins else None,
                    "clear_seconds": round(clear) if clear is not None else 0}

        before = run(0, ())
        after = run(int(add_resources), pause_resources)
    note = []
    if add_resources:
        note.append(f"add {add_resources} counter(s)")
    if pause_resources:
        note.append(f"pause {len(pause_resources)} resource(s)")
    return {"before": before, "after": after, "horizon": horizon,
            "note": f"Simulated the current queue of {len(ranked)} with: {', '.join(note) or 'no change'}"}


def export_csv(venue, kind="tickets"):
    import csv
    import io
    buf = io.StringIO()
    if kind == "events":
        cols = ["ts", "type", "actor_kind", "ticket_id", "resource_id", "payload"]
        w = csv.writer(buf)
        w.writerow(cols)
        for e in DB.events.find({"venue_id": venue["_id"]}).sort("ts", 1):
            w.writerow([iso(e["ts"]), e["type"], (e.get("actor") or {}).get("kind"), e.get("ticket_id"),
                        e.get("resource_id"), e.get("payload")])
    else:
        cols = ["code", "service_type_id", "source", "party_size", "priority_class", "status", "created_at", "called_at",
                "service_start_at", "service_end_at", "actual_wait_seconds", "pred_p50", "phone_last4"]
        w = csv.writer(buf)
        w.writerow(cols)
        for t in DB.tickets.find({"venue_id": venue["_id"]}).sort("created_at", 1):
            w.writerow([t["code"], t["service_type_id"], t["source"], t["party_size"], t["priority_class"], t["status"],
                        iso(t.get("created_at")), iso(t.get("called_at")), iso(t.get("service_start_at")),
                        iso(t.get("service_end_at")), t.get("actual_wait_seconds"),
                        (t.get("predicted_at_join") or {}).get("p50"), t.get("phone_last4")])
    return buf.getvalue()
