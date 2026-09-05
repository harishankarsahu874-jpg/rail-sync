"""Contract for swapping the synthetic history for REAL delay data.

RailSync's ML layer only depends on 14 columns (see data/historical_legs.csv).
Any source — NTES historical extracts, IRS 3.0 open data, or the public Kaggle
"Indian Railways Delay Prediction" dataset — can be reshaped to this schema:

    train_number, leg, date, hour, weather, signal, congestion, dwell,
    carry, priority, leg_sched, extra, cond, residual

  * leg_sched : scheduled travel minutes for that leg
  * extra     : observed extra delay (minutes) at the leg's end
  * cond      : part of `extra` already explained by live conditions
                (weather/congestion/signal) — 0 if you can't compute it
  * residual  : extra - cond (what the model must learn)

Usage:
    python scripts/import_real.py /path/to/real_data.csv

then retrain and restart:
    backend/.venv/bin/python -m app.ml.train
"""
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app import db, config  # noqa: E402

COLS = ["train_number", "leg", "date", "hour", "weather", "signal", "congestion",
        "dwell", "carry", "priority", "leg_sched", "extra", "cond", "residual"]


def main(src: str):
    path = Path(src)
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in COLS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"input missing columns: {missing} (needs {COLS})")
        rows = [
            (r["train_number"], int(r["leg"]), r["date"], int(float(r["hour"])),
             *[float(r[c]) for c in COLS[4:]])
            for r in reader
        ]
    db.init()
    db.execute("DELETE FROM hist_leg")
    for r in rows:
        db.execute(
            "INSERT INTO hist_leg(train_number, leg, date, hour, weather, signal, congestion, "
            "dwell, carry, priority, leg_sched, extra, cond, residual) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", r)
    out = config.DATA_DIR / "historical_legs.csv"
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(COLS)
        w.writerows([tuple(str(x) for x in r) for r in rows])
    print(f"[import] {len(rows)} real-leg records loaded (CSV: {out})")
    print("[import] retrain with: python -m app.ml.train  (then restart the server)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
