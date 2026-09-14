"""Real per-train photography for RailSync.

Every train gets ITS OWN picture, resolved live (and cached) from:
  1. the train's Wikipedia article infobox image (en.wikipedia pageimages),
  2. a Wikimedia Commons bitmap search for "<train name> train" with a
     safety filter that drops collision/crash/map/logo imagery,
  3. nothing -> the frontend falls back to its class artwork.
No keys required; Wikimedia asks only for a polite User-Agent.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parent / "data" / "train_photos.json"
UA = {"User-Agent": "RailSync-demo/1.0 (TechZephyx hackathon; "
                    "harishankarsahu874-jpg@users.noreply.github.com)"}
TTL_S = 30 * 86400
CLASS_TOKENS = ("rajdhani", "shatabdi", "vande", "duronto", "tejas", "express",
                "mail", "passenger", "memu", "emu", "garib rath", "superfast")
TRAINISH = re.compile(
    r"express|rajdhani|shatabdi|duronto|tejas|vande|train|rail|loco|coach|"
    r"wagon|emu|memu|mail|passenger|garib|sampark|gati|decker|hyderabad|"
    r"expresses|rake",
    re.I)
BAD_TITLE = re.compile(
    r"collision|crash|accident|derail|death|victim|rescue|wreck|fire|burnt|"
    r"route map|map\.png|diagram|logo|sign|plaque|board|ticket|coach chart",
    re.I)
_LOCK = threading.Lock()
_CACHE: dict[str, dict] = {}


def _load() -> dict:
    global _CACHE
    if not _CACHE:
        try:
            _CACHE = json.loads(CACHE_PATH.read_text())
        except Exception:
            _CACHE = {}
    return _CACHE


def _save() -> None:
    try:
        cache = _load()
        if len(cache) > 4000:  # keep the cache file bounded
            keep = sorted(cache.items(), key=lambda kv: kv[1].get("ts", 0))[-3000:]
            cache = dict(keep)
            _CACHE.clear()
            _CACHE.update(cache)
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(cache))
    except Exception:
        pass


def _get_json(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def _url_taken(url: str, key: str) -> bool:
    """One photograph = one train: never show the same picture twice."""
    for k, row in _load().items():
        if k != key and row.get("url") == url:
            return True
    return False


def _wiki_pageimage(name: str):
    url = ("https://en.wikipedia.org/w/api.php?action=query&format=json"
           "&prop=pageimages&pithumbsize=900&titles=" + urllib.parse.quote(name))
    data = _get_json(url)
    for page in (data.get("query") or {}).get("pages", {}).values():
        thumb = (page.get("thumbnail") or {}).get("source")
        if not thumb:
            continue
        fname = urllib.parse.unquote(thumb.split("/")[-1]).lower()
        cls_tok = next((k for k in CLASS_TOKENS if k in name.lower()), None)
        ok = TRAINISH.search(fname) or re.search(r"\d{5}", fname)
        if not ok or (cls_tok and cls_tok not in fname and not re.search(r"\d{5}", fname)):
            continue  # article lead image isn't this train's picture
        return thumb, "wikipedia", page.get("title", "")
    return None, None, None


def _commons(name: str, number: str | None = None):
    q = urllib.parse.quote(f'filetype:bitmap "{name}" train')
    url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json"
           f"&generator=search&gsrsearch={q}&gsrnamespace=6&gsrlimit=8"
           "&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=900")
    data = _get_json(url)
    pages = sorted((data.get("query") or {}).get("pages", {}).values(),
                   key=lambda p: p.get("index", 99))
    words = [w for w in re.split(r"\W+", name.lower()) if len(w) > 2]
    for page in pages:
        title = page.get("title", "")
        info = (page.get("imageinfo") or [{}])[0]
        thumb = info.get("thumburl")
        width = info.get("width") or 0
        if not thumb or width < 700 or BAD_TITLE.search(title):
            continue
        low = title.lower()
        numbered = bool(number) and number in re.sub(r"\D", "", low)
        if not numbered and not TRAINISH.search(title):
            continue  # tea gardens, forecourts, event photos: not a train picture
        cls_tok = next((k for k in CLASS_TOKENS if k in name.lower()), None)
        if not numbered and cls_tok and cls_tok not in low:
            continue  # a freight train at the same city is NOT this train
        if not numbered and cls_tok is None and len(words) < 3:
            continue  # bare-city candidates are too generic to trust
        hit = sum(1 for w in words if w in low)
        if not numbered and words and hit < max(1, len(words) // 2):
            continue
        return thumb, "wikimedia commons", title
    return None, None, None


def _candidates(name: str) -> list[str]:
    """Search-phrase candidates: full name first, then the useful fragments
    ('Mumbai Central - New Delhi Tejas Rajdhani Express' -> 'Mumbai Rajdhani')."""
    cand = [name]
    head = tail = ''
    if ' - ' in name:
        head, tail = name.split(' - ', 1)
        cand += [tail, head]
    up = name.upper()
    cls = None
    for key in ('VANDE BHARAT', 'RAJDHANI', 'SHATABDI', 'DURONTO', 'TEJAS', 'EXPRESS'):
        if key in up:
            cls = key.title()
            break
    first = name.split()[0] if name.split() else ''
    if cls and first:
        cand.append(f"{first} {cls}")
        if head:
            cand.append(f"{head.split()[0]} {cls}")
    seen: dict[str, None] = {}
    for c in cand:
        if c and c not in seen:
            seen[c] = None
    return list(seen)


def photo_for(number: str, name: str) -> dict:
    """{url, source, ts} for a train; url=None means "no real photo found"."""
    key = str(number)
    with _LOCK:
        row = _load().get(key)
        if row and time.time() - row.get("ts", 0) < TTL_S:
            return row
    url = source = title = None
    for cand in _candidates(name):
        try:
            url, source, title = _wiki_pageimage(cand)
        except Exception:
            url = source = title = None
        if url and _url_taken(url, key):
            url = source = title = None
        if url:
            break
    if not url:
        for cand in _candidates(name):
            try:
                url, source, title = _commons(cand, key)
            except Exception:
                url = source = title = None
            if url and _url_taken(url, key):
                url = source = title = None
            if url:
                break
    if not url:
        try:
            url, source, title = _commons_by_number(key)
        except Exception:
            url = source = title = None
        if url and _url_taken(url, key):
            url = source = title = None
    row = {"url": url, "source": source, "title": title, "ts": time.time()}
    with _LOCK:
        _load()[key] = row
        _save()
    return row


def _commons_by_number(number: str):
    """Last-resort real photo: railfan uploads titled with the train number."""
    q = urllib.parse.quote(f'filetype:bitmap "{number}" railway train india')
    url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json"
           f"&generator=search&gsrsearch={q}&gsrnamespace=6&gsrlimit=6"
           "&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=900")
    data = _get_json(url)
    for page in sorted((data.get("query") or {}).get("pages", {}).values(),
                       key=lambda p: p.get("index", 99)):
        title = page.get("title", "")
        info = (page.get("imageinfo") or [{}])[0]
        thumb = info.get("thumburl")
        if not thumb or (info.get("width") or 0) < 700 or BAD_TITLE.search(title):
            continue
        if number in re.sub(r"\D", "", title.lower()):
            return thumb, "wikimedia commons", title
    return None, None, None


def start_prewarm(delay: float = 0.7) -> None:
    """Background crawl: resolve a real photo (or confirmed-none) for EVERY
    catalogued service, gentle on Wikimedia (~1 req/s). On-demand lookups
    always win for trains the passenger actually opens."""
    from . import catalog

    def run() -> None:
        for num, name in catalog.all_services():
            with _LOCK:
                row = _load().get(num)
                if row and time.time() - row.get("ts", 0) < TTL_S:
                    continue
            try:
                photo_for(num, name)
            except Exception:
                pass
            time.sleep(delay)

    t = threading.Thread(target=run, name="train-photo-prewarm", daemon=True)
    t.start()


def stats() -> dict:
    cache = _load()
    return {"cached": len(cache),
            "with_photo": sum(1 for v in cache.values() if v.get("url"))}
