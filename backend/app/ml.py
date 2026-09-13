"""Dynamic ETA: RandomForest delay-drift model.

Motto:  final ETA = published schedule + live RailRadar delay
                        + RF-predicted drift over the remaining legs.

The prototype trains on a deterministic 60-day synthetic history (same spirit
as the original RailSync ML engine): drift is a smooth function of carried
delay, leg length, weather severity and rush hour, plus seeded noise. The
model card is published in every journey response so judges can see exactly
what was trained, on how much, and with what holdout error. Swap the
synthetic generator for NTES historical feeds to go production-grade.
"""
from __future__ import annotations

import threading

_LOCK = threading.Lock()
_MODEL = None

FEATURES = [
    "carried_delay_min",   # live delay right now (RailRadar)
    "leg_km",              # distance to the next halt
    "remaining_km",        # distance from next halt to destination
    "weather_severity",    # 0..1 published OpenWeather score at the halt
    "rush_hour",           # 1 if scheduled arrival inside 07-11 or 17-21
    "night_hour",          # 1 if scheduled arrival inside 00-05
    "scheduled_min",       # minutes-of-day of the scheduled arrival
]


def _synthetic_history(rows: int = 4200, seed: int = 20260914):
    """Deterministic 60-day-style history: features → realised drift."""
    import numpy as np
    rng = np.random.default_rng(seed)
    carried = rng.gamma(2.0, 18.0, rows).clip(0, 240)
    leg = rng.uniform(15, 320, rows)
    remaining = rng.uniform(0, 1500, rows)
    weather = rng.beta(1.6, 5.0, rows)
    rush = rng.integers(0, 2, rows).astype(float)
    night = rng.integers(0, 2, rows).astype(float)
    sched = rng.integers(0, 1440, rows).astype(float)
    noise = rng.normal(0, 2.2, rows)
    drift = (
        0.16 * carried
        + 2.6 * weather * (leg / 120.0)
        + 2.4 * rush
        - 1.6 * night
        + 0.004 * remaining
        + noise
    ).clip(-6, 120)
    X = np.column_stack([carried, leg, remaining, weather, rush, night, sched])
    return X, drift


def _train():
    global _MODEL
    with _LOCK:
        if _MODEL is not None:
            return _MODEL
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.model_selection import train_test_split
        X, y = _synthetic_history()
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=7)
        model = RandomForestRegressor(
            n_estimators=140, min_samples_leaf=4, max_features=0.7,
            random_state=7, n_jobs=1,
        )
        model.fit(X_tr, y_tr)
        preds = model.predict(X_te)
        mae = float((abs(preds - y_te)).mean())
        _MODEL = {
            "model": model,
            "card": {
                "name": "RandomForestRegressor",
                "purpose": "predicts delay DRIFT over remaining legs; final ETA = schedule + live delay + drift",
                "n_estimators": 140,
                "trained_rows": int(X_tr.shape[0]),
                "holdout_mae_min": round(mae, 2),
                "features": FEATURES,
                "training_data": "deterministic 60-day synthetic history (prototype); replace with NTES feeds for production",
            },
        }
        return _MODEL


def model_card() -> dict:
    return _train()["card"]


def predict_drift(*, carried_delay_min: float, leg_km: float, remaining_km: float,
                  weather_severity: float, scheduled_min: float | None) -> float:
    sched = (scheduled_min or 0) % 1440
    rush = 1.0 if (7 * 60 <= sched < 11 * 60) or (17 * 60 <= sched < 21 * 60) else 0.0
    night = 1.0 if sched < 5 * 60 else 0.0
    row = [[carried_delay_min, leg_km, remaining_km, weather_severity, rush, night, sched]]
    value = float(_train()["model"].predict(row)[0])
    return round(max(-5.0, min(120.0, value)), 1)
