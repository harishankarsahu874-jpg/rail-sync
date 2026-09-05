"""Tiny SQLite helper (thread-local connections, WAL mode).

Kept deliberately simple — raw SQL is easier to walk through in a
judging Q&A than an ORM.
"""
import sqlite3
import threading

from . import config

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS stations(
  code TEXT PRIMARY KEY, name TEXT, lat REAL, lng REAL, state TEXT, is_major INTEGER
);
CREATE TABLE IF NOT EXISTS trains(
  number TEXT PRIMARY KEY, name TEXT, ttype TEXT, from_code TEXT, to_code TEXT,
  avg_speed REAL, priority REAL, coaches INTEGER, dep_hhmm TEXT
);
CREATE TABLE IF NOT EXISTS route_stops(
  train_number TEXT, seq INTEGER, station_code TEXT, km REAL, sched_min REAL,
  PRIMARY KEY(train_number, seq)
);
CREATE TABLE IF NOT EXISTS catalog_trains(
  number TEXT PRIMARY KEY, name TEXT NOT NULL, train_type TEXT,
  source_code TEXT, source_name TEXT, destination_code TEXT, destination_name TEXT,
  running_days_mask INTEGER, overall_distance_km REAL,
  raw_route_count INTEGER, service_route_count INTEGER, scheduled_stop_count INTEGER,
  departure_time TEXT, arrival_time TEXT, duration_min REAL,
  route_quality TEXT, source_part TEXT, source_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS catalog_stops(
  train_number TEXT, raw_seq INTEGER, service_seq INTEGER,
  station_code TEXT, station_name TEXT,
  arrival_time TEXT, departure_time TEXT, journey_day INTEGER,
  arrival_min REAL, departure_min REAL,
  is_scheduled_stop INTEGER, in_service_route INTEGER,
  PRIMARY KEY(train_number, raw_seq)
);
CREATE INDEX IF NOT EXISTS idx_catalog_train_name ON catalog_trains(name);
CREATE INDEX IF NOT EXISTS idx_catalog_train_source ON catalog_trains(source_code);
CREATE INDEX IF NOT EXISTS idx_catalog_train_destination ON catalog_trains(destination_code);
CREATE INDEX IF NOT EXISTS idx_catalog_train_type ON catalog_trains(train_type);
CREATE INDEX IF NOT EXISTS idx_catalog_stop_station ON catalog_stops(station_code, in_service_route);
CREATE INDEX IF NOT EXISTS idx_catalog_stop_train_service ON catalog_stops(train_number, in_service_route, service_seq);
CREATE TABLE IF NOT EXISTS hist_leg(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  train_number TEXT, leg INTEGER, date TEXT, hour INTEGER,
  weather REAL, signal REAL, congestion REAL, dwell REAL, carry REAL,
  priority REAL, leg_sched REAL, extra REAL, cond REAL, residual REAL
);
CREATE TABLE IF NOT EXISTS accuracy_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT, train_number TEXT, station_code TEXT,
  predicted REAL, actual REAL, abs_error REAL
);
CREATE TABLE IF NOT EXISTS trips(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  train_number TEXT, started TEXT, ended TEXT, total_delay REAL
);
CREATE TABLE IF NOT EXISTS app_meta(
  key TEXT PRIMARY KEY, value TEXT
);
"""


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.c = c
    return c


def init():
    conn().executescript(SCHEMA)


def execute(sql, params=()):
    c = conn()
    c.execute(sql, params)
    c.commit()
    return c


def executemany(sql, rows):
    c = conn()
    c.executemany(sql, rows)
    c.commit()
    return c


def query(sql, params=()):
    rows = conn().execute(sql, params).fetchall()
    return [dict(r) for r in rows]
