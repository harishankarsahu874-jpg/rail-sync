"""ETA engine — the heart of RailSync.

Per-station ETA for a train =
    now
  + remaining scheduled minutes from the CURRENT position
      (this automatically carries any existing delay forward)
  + deterministic slowdown time from live conditions
      (weather, congestion, active signal hold — computed with the exact
       same physics law the simulator uses, so no double counting)
  + learned residual from the RandomForest, scaled by remaining leg
      fraction (fallback: historical route x hour average when the live
    feed is stale)

The output is a PREDICTED ETA plus a CONFIDENCE RANGE derived from the
model's measured holdout error, widened for longer horizons and stale data.
That honest "14:32 ± 6 min" is a deliberate product decision.
"""
import json
import math
import time

import joblib

from .. import config
from . import features as F


class EtaEngine:
    def __init__(self):
        F.init_ids()   # ensure route/leg id encodings are available at runtime
        p = config.MODELS_DIR
        if not (p / "predictor.joblib").exists():
            raise SystemExit("[eta] models missing — run: python -m app.seed && python -m app.train")
        self.rf = joblib.load(p / "predictor.joblib")
        self.ridge = joblib.load(p / "explainer.joblib")
        with open(p / "metrics.json") as fh:
            self.metrics = json.load(fh)
        with open(p / "hist_fallback.json") as fh:
            self.fallback = json.load(fh)
        self.mae = self.metrics["mae_minutes"]

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _is_stale(last_update_ts, now=None):
        now = now or time.time()
        return (now - last_update_ts) > config.STALE_AFTER_SECONDS

    def _residual(self, t, leg, frac, carry, clock, stale):
        if stale:
            key = f"{F.ROUTE_ID[t['number']]}|{int(clock) // 60 % 24}"
            return self.fallback.get(key, 0.0) * (1.0 - frac)
        vec = F.vector(carry, t["dwell_base"] + 1.0, t["priority"],
                       clock, F.ROUTE_ID[t["number"]],
                       F.LEG_ID[(t["number"], leg)])
        return max(-2.0, float(self.rf.predict([vec])[0])) * (1.0 - frac)

    @staticmethod
    def _speed_factor(w, c):
        return (1.0 - 0.45 * w) * (1.0 - 0.35 * c)

    # ------------------------------------------------------------------- main
    def station_etas(self, t, segments, clock, last_update_ts):
        """Full route ETA table for train t (dict of live state fields)."""
        stale = self._is_stale(last_update_ts)
        stops, km, sched_arr, travel = t["stops"], t["km"], t["sched_arr"], t["travel"]
        i = t["leg"]                       # leg currently on, or station index if halted
        carry = max(0.0, t["delay"])
        out, range_next = [], None

        # --- first upcoming stop (leg i -> i+1), partial
        a, b = km[i], km[i + 1]
        frac = 0.0 if (b - a) <= 0 else min(1.0, max(0.0, (t["pos"] - a) / (b - a)))
        seg = segments[(stops[i], stops[i + 1])]
        f = self._speed_factor(seg.w, seg.congestion)
        remaining_sched = (sched_arr[i + 1] + t["epoch"]) - self._sched_time(t)
        # scheduled time already assumes SCHEDULE_FACTOR conditions, so only
        # slowdown RELATIVE to that baseline adds extra minutes
        cond = remaining_sched * (1.0 / f - 1.0 / config.SCHEDULE_FACTOR) \
            + (seg.hold if seg.hold > 0 else 0.0)
        resid = self._residual(t, i, frac, carry, clock, stale)
        eta = clock + remaining_sched + cond + resid
        range_next = self._range(1, stale)
        out.append(self._row(t, i + 1, sched_arr[i + 1] + t["epoch"], eta,
                             range_next, "next"))
        cur = eta

        # --- remaining stops
        for j in range(i + 1, len(stops) - 1):
            segj = segments[(stops[j], stops[j + 1])]
            fj = self._speed_factor(segj.w, segj.congestion)
            condj = travel[j] * (1.0 / fj - 1.0 / config.SCHEDULE_FACTOR) \
                + (segj.hold if segj.hold > 0 else 0.0)
            resj = self._residual(t, j, 0.0, carry, clock, stale)
            cur = cur + t["dwell_base"] + travel[j] + condj + resj
            out.append(self._row(t, j + 1, sched_arr[j + 1] + t["epoch"], cur,
                                 None, "upcoming"))
        return out, range_next, stale

    @staticmethod
    def _sched_time(t):
        """Scheduled clock-time corresponding to the train's current
        position (piecewise linear over the leg)."""
        if t["at_station"]:
            return t["sched_arr"][t["leg"]] + t["epoch"]
        a, b = t["km"][t["leg"]], t["km"][t["leg"] + 1]
        frac = 0.0 if (b - a) <= 0 else (t["pos"] - a) / (b - a)
        return t["sched_dep"][t["leg"]] + frac * t["travel"][t["leg"]] + t["epoch"]

    def _range(self, n_legs, stale):
        r = self.mae * math.sqrt(1.0 + 0.25 * n_legs)
        return max(1.0, round(r * (1.6 if stale else 1.0), 1))

    @staticmethod
    def _row(t, idx, sched_min, eta_min, rng, tag):
        return {
            "seq": idx,
            "code": t["stops"][idx],
            "name": t["stop_names"][idx],
            "scheduled_min": round(sched_min),
            "eta_min": round(eta_min),
            "delay_min": round(eta_min - sched_min, 1),
            "range_min": rng,
            "tag": tag,
        }

    # ------------------------------------------------------------- explainability
    def cause_breakdown(self, t, seg, carry, clock, leg_sched):
        """Split the expected extra delay of the current leg into causes.

        The Ridge explainer predicts delay as a FRACTION of scheduled leg
        time (coefficients are leg-length independent); we multiply the
        current leg's scheduled minutes back in to get minutes, then
        normalise to percentages for the stacked-bar UI.
        """
        x = F.cause_vector(seg.w, max(0.0, seg.hold), seg.congestion,
                           t["dwell_base"] + 1.0, carry, t["priority"],
                           int(clock) // 60 % 24)
        total_frac = float(self.ridge.predict([x])[0])
        contrib = {}
        for name, coef, xi in zip(F.CAUSE_NAMES, self.ridge.coef_, x):
            contrib[name] = max(0.0, float(coef) * xi)
        contrib["other"] = max(0.0, total_frac - sum(contrib.values())
                               + max(0.0, float(self.ridge.intercept_)))
        total_min = total_frac * leg_sched
        if total_min < 2.0:
            return [], 0.0
        s = sum(contrib.values()) or 1e-6
        return [{"cause": k, "minutes": round(v * leg_sched, 1), "pct": round(100.0 * v / s)}
                for k, v in sorted(contrib.items(), key=lambda kv: -kv[1]) if v * leg_sched > 0.05], \
            round(total_min, 1)
