"""Tiny, dependency-free HTTP helper used by external data providers.

Provider secrets never appear in exceptions or logs: URLs containing query-string
API keys are deliberately omitted from error messages.
"""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ProviderRequestError(RuntimeError):
    """A safe provider error that does not expose request URLs or credentials."""

    def __init__(self, provider: str, message: str, status: int | None = None):
        self.provider = provider
        self.status = status
        super().__init__(f"{provider}: {message}")


def get_json(
    provider: str,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 8.0,
) -> dict:
    query = urlencode({k: v for k, v in (params or {}).items() if v is not None})
    full_url = f"{url}?{query}" if query else url
    req_headers = {
        "Accept": "application/json",
        "User-Agent": "RailSync-SIH/1.1 (+https://github.com/railsync)",
        **(headers or {}),
    }
    request = Request(full_url, headers=req_headers, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(5_000_000)
    except HTTPError as exc:
        detail = _http_detail(exc)
        raise ProviderRequestError(provider, detail, exc.code) from None
    except URLError as exc:
        reason = getattr(exc, "reason", None)
        name = reason.__class__.__name__ if reason else "network error"
        raise ProviderRequestError(provider, f"network failure ({name})") from None
    except TimeoutError:
        raise ProviderRequestError(provider, "request timed out") from None

    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderRequestError(provider, "returned a non-JSON response") from None
    if not isinstance(value, dict):
        raise ProviderRequestError(provider, "returned an unexpected JSON shape")
    return value


def post_form_json(
    provider: str,
    url: str,
    *,
    form: dict,
    headers: dict | None = None,
    timeout: float = 10.0,
) -> dict:
    body = urlencode(form).encode("utf-8")
    req_headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "RailSync-SIH/1.1 (+https://github.com/railsync)",
        **(headers or {}),
    }
    request = Request(url, data=body, headers=req_headers, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(5_000_000)
    except HTTPError as exc:
        raise ProviderRequestError(provider, _http_detail(exc), exc.code) from None
    except URLError as exc:
        reason = getattr(exc, "reason", None)
        name = reason.__class__.__name__ if reason else "network error"
        raise ProviderRequestError(provider, f"network failure ({name})") from None
    except TimeoutError:
        raise ProviderRequestError(provider, "request timed out") from None

    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderRequestError(provider, "returned an invalid JSON response") from None
    if not isinstance(value, dict):
        raise ProviderRequestError(provider, "returned an unexpected JSON shape")
    return value


def _http_detail(exc: HTTPError) -> str:
    """Extract a useful provider message without ever echoing the request URL."""
    labels = {
        400: "rejected the request",
        401: "API key missing or invalid",
        403: "access forbidden for this key",
        404: "resource not found",
        429: "rate limit reached",
        500: "server error",
        502: "upstream unavailable",
        503: "service unavailable",
    }
    message = labels.get(exc.code, f"HTTP {exc.code}")
    try:
        body = exc.read(32_000).decode("utf-8", "replace")
        payload = json.loads(body)
        provider_msg = (
            payload.get("message")
            or payload.get("detail")
            or (payload.get("error") or {}).get("message")
        )
        if provider_msg and isinstance(provider_msg, str):
            # Keep provider text useful but bounded and single-line.
            message = provider_msg.replace("\n", " ")[:240]
    except Exception:
        pass
    return message
