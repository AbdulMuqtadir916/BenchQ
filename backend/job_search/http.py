"""The job search's outbound call (decided 2026-11-10): a 20 s limit on the whole call, one retry after 2 s on a
timeout, a dropped connection, 5xx or 429, a 5 MB cap on the body, no redirects. Every failure is a `ProviderError`
with a fixed code; the URL, the parameters and the body never reach an error or a log line (another source's key may
travel in them)."""
import asyncio
import json
import logging
import time

import httpx

from backend.job_search.providers.base import ProviderError

logger = logging.getLogger("benchq.job_search")

TIMEOUT_SECONDS = 20.0
RETRY_DELAY_SECONDS = 2.0
MAX_BYTES = 5 * 1024 * 1024

# Tests swap in an httpx.MockTransport here; production uses httpx's own.
transport: httpx.AsyncBaseTransport | None = None


class _Retry(Exception):
    def __init__(self, code: str):
        self.code = code


async def _once(url: str, params: dict, headers: dict, timeout: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport) as client:
        async with client.stream("GET", url, params=params, headers=headers) as resp:
            status = resp.status_code
            if status == 429 or status >= 500:
                raise _Retry("provider_unavailable")
            if status >= 300:            # 3xx too: a redirect is not followed
                raise ProviderError("provider_rejected")
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > MAX_BYTES:
                raise ProviderError("too_large")
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise ProviderError("too_large")
    try:
        payload = json.loads(bytes(body))
    except (ValueError, UnicodeDecodeError):
        raise ProviderError("bad_response") from None
    if not isinstance(payload, dict):
        raise ProviderError("bad_response")
    return payload


async def _attempt(url: str, params: dict, headers: dict, timeout: float) -> dict:
    try:
        return await asyncio.wait_for(_once(url, params, headers, timeout), timeout=timeout)
    except (asyncio.TimeoutError, httpx.TimeoutException):
        raise _Retry("timeout") from None
    except httpx.TransportError:
        raise _Retry("provider_unavailable") from None


async def get_json(url: str, params: dict, *, headers: dict | None = None, source: str = "",
                   timeout: float | None = None, attempts: int = 2) -> dict:
    """The source's JSON object, or `ProviderError`. Logs the outcome by code and timing only. `timeout` (default
    `TIMEOUT_SECONDS`) is the whole call, the retry and its wait included: a retry gets what is left, and none when too
    little is (CodeRabbit and CodeAnt on #135). A page waiting on the call (a job's full posting, job search PR 3)
    passes a shorter `timeout` and one attempt."""
    started = time.monotonic()
    headers = headers or {}
    timeout = TIMEOUT_SECONDS if timeout is None else timeout       # read now: tests and settings may change it
    deadline = started + timeout
    for attempt in range(1, attempts + 1):
        try:
            payload = await _attempt(url, params, headers, max(deadline - time.monotonic(), 0.001))
            logger.info("job search source=%s attempt=%d ok ms=%d", source, attempt,
                        (time.monotonic() - started) * 1000)
            return payload
        except _Retry as retry:
            logger.warning("job search source=%s attempt=%d code=%s ms=%d", source, attempt, retry.code,
                           (time.monotonic() - started) * 1000)
            if attempt == attempts or deadline - time.monotonic() <= RETRY_DELAY_SECONDS:
                raise ProviderError(retry.code) from None
            await asyncio.sleep(RETRY_DELAY_SECONDS)
        except ProviderError as error:
            logger.warning("job search source=%s attempt=%d code=%s ms=%d", source, attempt, error.code,
                           (time.monotonic() - started) * 1000)
            raise
    raise ProviderError("internal")      # unreachable: the loop returns or raises
