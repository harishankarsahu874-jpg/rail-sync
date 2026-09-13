"""RailSync Live — REST API. Four endpoints, all partial-success."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import catalog, config, journey
from .providers.manager import ProviderManager

router = APIRouter(prefix="/api")
_manager: ProviderManager | None = None

# Discoverability helper: a small curated directory so the search box has
# suggestions. Any 5-digit number is accepted regardless of this list.
DIRECTORY = [
    ("12841", "Coromandel Express"), ("12842", "Coromandel Express (return)"),
    ("12951", "Mumbai Tejas Rajdhani"), ("12952", "Mumbai Tejas Rajdhani (return)"),
    ("12301", "Howrah Rajdhani"), ("12302", "Kolkata Rajdhani"),
    ("12621", "Tamil Nadu Express"), ("12622", "Tamil Nadu Express (return)"),
    ("12953", "August Kranti Tejas Rajdhani"), ("12954", "August Kranti Tejas Rajdhani (return)"),
    ("12839", "Chennai Mail"), ("12840", "Chennai Mail (return)"),
    ("12627", "Karnataka Express"), ("12628", "Karnataka Express (return)"),
    ("22691", "KSR Bengaluru Rajdhani"), ("12281", "Duronto Express"),
]


def set_manager(manager: ProviderManager):
    global _manager
    _manager = manager


@router.get("/health")
def health():
    return {"ok": True, "service": "railsync-live",
            "providers_configured": sum(1 for row in _manager.public_status()["items"].values()
                                         if row["configured"]),
            "catalogue": catalog.stats()}


@router.get("/trains")
def trains(q: str = Query("", min_length=1, max_length=60), limit: int = Query(8, ge=1, le=25)):
    """Search EVERY catalogued train in India (5,139 services, full routes)."""
    return {"query": q, "results": catalog.search(q, limit)}


@router.get("/running")
def running():
    """Trains RailSync users have observed RUNNING during this server boot.

    RailRadar exposes no fleet list and quota forbids polling all of India,
    so this strip is opportunistic and labelled as observed, not claimed.
    """
    return {"observed": _manager.observed()}


@router.get("/providers")
def providers():
    """Live health of every external API. Keys are never exposed."""
    return _manager.public_status()


@router.get("/search")
def search(q: str = Query("", min_length=1, max_length=60)):
    """Train-number passthrough + full-catalogue name/number suggestions."""
    needle = q.strip().lower()
    hits = catalog.search(needle, 8)
    if needle.isdigit():
        hits.insert(0, {"number": needle, "name": f"Train {needle} (live lookup)",
                        "type": "", "from": "", "to": "", "km": 0, "days": "", "stops": 0})
    return {"query": q, "results": hits[:8]}


@router.get("/journey/{number}")
def get_journey(number: str, force: bool = False):
    """The whole companion view in one request (server-cached 60 s)."""
    if not number.isdigit():
        raise HTTPException(422, "train number must be digits")
    try:
        return journey.build(_manager, number, force=force)
    except Exception as exc:
        text = str(exc)
        status = 503 if "not configured" in text else 502
        raise HTTPException(status, text) from None


@router.post("/journey/{number}/refresh")
def refresh_journey(number: str):
    """Bypass the 60 s cache and pull a fresh RailRadar fix (quota-aware)."""
    if not number.isdigit():
        raise HTTPException(422, "train number must be digits")
    try:
        return journey.build(_manager, number, force=True)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from None
