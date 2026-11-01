"""Validated Perplexity Decider V1.2 adapter through OpenRouter."""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from backend.config import OPENROUTER_API_KEY
from backend.inbox.decider_categories import CATEGORIES, MODEL_ID, QUESTION_KEY, CATEGORY_VERSION, INSTRUCTIONS
from backend.inbox.safe_text import redact_sensitive_text

ENDPOINT = "https://openrouter.ai/api/alpha/decisions"


class DeciderError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class Classification:
    category: str
    probabilities: dict[str, float]
    confidence: float
    model: str
    provider: str | None
    request_id: str | None


def build_request(subject: str, body: str) -> dict[str, Any]:
    state = f"Subject: {redact_sensitive_text(subject).strip() or '(no subject)'}\n\nMessage body:\n{redact_sensitive_text(body).strip()}"
    return {
        "model": MODEL_ID,
        "state": [state],
        "questions": {QUESTION_KEY: {"type": "choice", "instructions": INSTRUCTIONS,
                                     "criteria": dict(CATEGORIES)}},
    }


def parse_response(payload: dict[str, Any]) -> Classification:
    answers = payload.get("answers")
    answer = answers.get(QUESTION_KEY) if isinstance(answers, dict) else None
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        raise DeciderError("Decider returned an invalid classification response.")
    category, probabilities = answer.get("choice"), answer.get("probabilities")
    if category not in CATEGORIES or not isinstance(probabilities, dict):
        raise DeciderError("Decider returned an unsupported category or missing probabilities.")
    values: dict[str, float] = {}
    for name in CATEGORIES:
        value = probabilities.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise DeciderError("Decider returned invalid category probabilities.")
        values[name] = float(value)
    confidence = answer.get("confidence")
    if (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
            or not math.isfinite(confidence) or not 0 <= confidence <= 1):
        confidence = values[category]
    return Classification(category, values, float(confidence), str(payload.get("model") or MODEL_ID),
                          str(payload["provider"]) if payload.get("provider") else None,
                          str(payload["id"]) if payload.get("id") else None)


def classify(subject: str, body: str, *, api_key: str | None = None, post: Callable | None = None,
             sleep: Callable[[float], None] = time.sleep) -> Classification:
    key = api_key or OPENROUTER_API_KEY
    if not key:
        raise DeciderError("Email classification is not configured: set OPENROUTER_API_KEY.")
    request = build_request(subject, body)
    send = post or httpx.post
    for attempt in range(3):
        try:
            response = send(ENDPOINT, headers={"Authorization": f"Bearer {key}",
                                                "Content-Type": "application/json"},
                            json=request, timeout=45.0)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            if attempt < 2:
                sleep(0.25 * 2 ** attempt)
                continue
            raise DeciderError("Decider could not be reached after three attempts.", retryable=True) from exc
        if response.status_code == 429 or response.status_code >= 500:
            if attempt < 2:
                sleep(0.25 * 2 ** attempt)
                continue
            raise DeciderError("Decider is temporarily unavailable after three attempts.", retryable=True)
        if response.status_code >= 400:
            raise DeciderError("Decider rejected the classification request.")
        try:
            payload = response.json()
        except (ValueError, TypeError) as exc:
            raise DeciderError("Decider returned unreadable JSON.") from exc
        if not isinstance(payload, dict):
            raise DeciderError("Decider returned an invalid response.")
        return parse_response(payload)
    raise DeciderError("Decider could not complete the request.", retryable=True)
