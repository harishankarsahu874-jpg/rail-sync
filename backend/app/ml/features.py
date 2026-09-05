"""Feature construction — shared by training and live inference so the
model can never see a differently-shaped input at runtime."""
import math

# --- residual-prediction model (RandomForest) inputs ------------------------
FEATURE_NAMES = ["carry", "dwell", "priority", "hour_sin", "hour_cos",
                 "route_id", "leg_id"]

ROUTE_ID, LEG_ID = {}, {}   # deterministic ids shared by train + inference


def init_ids(train_numbers=None):
    """Build route/leg ids deterministically from the static train roster so
    training and live inference always use the SAME encodings (independent
    of whether train.py has already run in this process)."""
    global ROUTE_ID, LEG_ID
    from ..data import trains as TR
    if train_numbers is None:
        train_numbers = list(TR.ROUTES.keys())
    nums = sorted(train_numbers)
    ROUTE_ID = {n: i for i, n in enumerate(nums)}
    LEG_ID = {}
    for n in nums:
        for leg in range(len(TR.ROUTES[n]) - 1):
            key = (n, leg)
            if key not in LEG_ID:
                LEG_ID[key] = len(LEG_ID)


def vector(carry, dwell, priority, hour, route_id, leg_id):
    h = 2 * math.pi * (hour % 24) / 24.0
    return [carry, dwell, priority, math.sin(h), math.cos(h), route_id, leg_id]


# --- explainability model (Ridge) inputs — the "why" -------------------------
# Coefficients on these features ARE the delay-cause breakdown, e.g.
# "each +0.1 congestion adds ~1.4 min on this leg".
CAUSE_NAMES = ["weather", "signal", "congestion", "dwell", "carry",
               "low_priority", "rush"]


def cause_vector(weather, signal, congestion, dwell, carry, priority, hour):
    rush = 1.0 if (7 <= hour < 10 or 16 <= hour < 21) else 0.0
    return [weather, signal, congestion, dwell, carry, 1.0 - priority, rush]
