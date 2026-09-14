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


def _wiki_pageimage(name: str):
    url = ("https://en.wikipedia.org/w/api.php?action=query&format=json"
           "&prop=pageimages&pithumbsize=900&titles=" + urllib.parse.quote(name))
    data = _get_json(url)
    for page in (data.get("query") or {}).get("pages", {}).values():
        thumb = (page.get("thumbnail") or {}).get("source")
        if thumb:
            return thumb, "wikipedia"
    return None, None


def _commons(name: str):
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
        hit = sum(1 for w in words if w in low)
        if words and hit < max(1, len(words) // 2):
            continue
        return thumb, "wikimedia commons"
    return None, None


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
    url = source = None
    for cand in _candidates(name):
        for finder in (_wiki_pageimage, _commons):
            try:
                url, source = finder(cand)
            except Exception:
                url = source = None
            if url:
                break
        if url:
            break
    row = {"url": url, "source": source, "ts": time.time()}
    with _LOCK:
        _load()[key] = row
        _save()
    return row
