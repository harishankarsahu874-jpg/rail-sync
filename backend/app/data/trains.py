"""Coach-train fleet definition (long-distance services).

Routes use the user-supplied station catalogue plus traceable aliases for
renamed codes.  The ordered stop lists follow the real operating corridors.
Per-leg km are computed from geography and scaled by `calib` to each
published route distance; movement speed is set so route time plus the simple
class dwell model matches the published end-to-end duration.

Departure times are deliberately shifted into the demo morning window so all
six services are moving together when judges open RailSync. Distances, stop
order and end-to-end durations remain calibrated to the referenced services.
"""

TRAIN_DEFS = [
    # number  name                           class        from   to    movement km/h  prio coaches demo dep calib
    ("12301", "Howrah Rajdhani",             "Rajdhani",  "HWH",  "NDLS", 87.377, 0.95, 11, "06:00", 0.921045),
    ("12951", "Mumbai Tejas Rajdhani",        "Rajdhani",  "MMCT", "NDLS", 92.575, 0.95, 11, "06:15", 0.943020),
    ("12621", "Tamil Nadu Express",           "Superfast", "MAS",  "NDLS", 70.354, 0.80, 13, "05:45", 0.986865),
    ("12841", "Coromandel Express",           "Superfast", "HWH",  "MAS",  68.969, 0.80, 12, "06:20", 0.947494),
    ("12953", "August Kranti Tejas Rajdhani", "Rajdhani",  "MMCT", "NZM",  88.553, 0.95, 11, "05:30", 0.922086),
    ("12303", "Poorva Express",               "Mail",      "HWH",  "NDLS", 81.653, 0.55, 18, "06:35", 0.900445),
]

# Representative passenger halts in real order. The source catalogue uses a
# few historical codes; stations.py exposes current DDU/MMCT/PRYJ/VGLJ aliases
# while retaining the source MGS/BCT/ALD/JHS records for search and audit.
ROUTES = {
    "12301": ["HWH", "ASN", "DHN", "PNME", "GAYA", "DDU", "PRYJ", "CNB", "NDLS"],
    "12951": ["MMCT", "BVI", "ST", "BRC", "RTM", "NAD", "KOTA", "NDLS"],
    "12621": ["MAS", "BZA", "KMT", "WL", "BPQ", "NGP", "ET", "BPL", "VGLJ", "GWL", "AGC", "NZM", "NDLS"],
    "12841": ["HWH", "SRC", "KGP", "BLS", "BHC", "JJKR", "CTC", "BBS", "KUR", "BAM", "VSKP", "RJY", "TDD", "EE", "BZA", "MAS"],
    "12953": ["MMCT", "BVI", "VAPI", "BL", "ST", "BH", "BRC", "DHD", "RTM", "KOTA", "SWM", "MTJ", "NZM"],
    "12303": ["HWH", "BWN", "DGR", "ASN", "CRJ", "JMT", "MDP", "JSME", "JAJ", "JMU", "KIUL", "PNBE", "ARA", "BXR", "DDU", "PRYJ", "CNB", "ETW", "TDL", "ALJN", "NDLS"],
}

# Scheduled platform dwell per train class (minutes, intermediate halts).
DWELL = {"Rajdhani": 5, "Superfast": 7, "Mail": 10}

# Map colours per train (used by the frontend + state payloads).
TRAIN_COLORS = {
    "12301": "#7c9bff",
    "12951": "#f59e0b",
    "12621": "#34d399",
    "12841": "#f472b6",
    "12953": "#a78bfa",
    "12303": "#fb7185",
}

BY_NUMBER = {
    train[0]: dict(
        number=train[0], name=train[1], ttype=train[2], from_code=train[3],
        to_code=train[4], avg_speed=train[5], priority=train[6],
        coaches=train[7], dep_hhmm=train[8], calib=train[9],
    )
    for train in TRAIN_DEFS
}
