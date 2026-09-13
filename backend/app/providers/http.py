"""Minimal stdlib HTTP helpers for provider calls (no requests/httpx dep)."""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ProviderRequestError(RuntimeError):
    def __init__(self, provider: str, message: str):
        super().__init__(f"{provider}: {message}")
        self.provider = provider
        self.message = message


def get_json(provider: str, url: str, *, params: dict | None = None,
             headers: dict | None = None, timeout: float = 10) -> dict:
    target = f"{url}?{urlencode(params)}" if params else url
    request = Request(target, headers={"User-Agent": "RailSync-Live/1.0 (hackathon demo)",
                                       "Accept": "application/json", **(headers or {})})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:200]
        raise ProviderRequestError(provider, f"HTTP {exc.code} {body}") from None
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ProviderRequestError(provider, f"network/parse failure: {exc}") from None


def post_form_json(provider: str, url: str, *, form: dict, timeout: float = 12) -> dict:
    request = Request(url, data=urlencode(form).encode("utf-8"),
                      headers={"User-Agent": "RailSync-Live/1.0 (hackathon demo)",
                               "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise ProviderRequestError(provider, f"HTTP {exc.code}") from None
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ProviderRequestError(provider, f"network/parse failure: {exc}") from None
