"""Bounded Decisions API adapter. One HTTP attempt; the durable worker owns retries."""
from dataclasses import dataclass, field
import hashlib
import math

import httpx

from backend.inbox.decider_categories import CATEGORIES, INSTRUCTIONS, QUESTION_KEY, CATEGORY_VERSION, CONFIDENCE_THRESHOLD
from backend.inbox.safe_text import redact_sensitive_text

ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'


class DeciderError(RuntimeError):
    def __init__(self, code, *, retryable=False, usage=None):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.usage = usage or {"cost_quality": "UNKNOWN"}


@dataclass(frozen=True)
class Classification:
    category: str
    confidence: float
    probabilities: dict
    usage: dict = field(default_factory=dict)


def config_identity(cfg):
    return hashlib.sha256(repr((cfg.provider, cfg.model, cfg.prompts, cfg.preset_id, cfg.preset_version,
                                INSTRUCTIONS, CATEGORIES, CATEGORY_VERSION, CONFIDENCE_THRESHOLD,
                                "minimization-2026-11-04.1", "gmail-auth-2026-11-04.1")).encode()).hexdigest()


def build_request(subject, body, cfg):
    # Caller content is data, not instructions. No tools, URL fetches or attachments.
    instructions = cfg.prompts.get('instructions') or INSTRUCTIONS
    return {'model': cfg.model,
            'state': [{'subject': redact_sensitive_text(subject[:1000]),
                       'body': redact_sensitive_text(body[:24000])}],
            'questions': {QUESTION_KEY: {'type': 'choice', 'instructions': instructions,
                                        'criteria': dict(CATEGORIES)}}}


def parse_response(payload):
    if not isinstance(payload, dict):
        raise DeciderError('INVALID_RESPONSE')
    answers = payload.get('answers')
    answer = answers.get(QUESTION_KEY) if isinstance(answers, dict) else None
    if not isinstance(answer, dict) or answer.get('type') != 'choice':
        raise DeciderError('INVALID_RESPONSE')
    choice, probabilities = answer.get('choice'), answer.get('probabilities')
    if choice not in CATEGORIES or not isinstance(probabilities, dict) or set(probabilities) != set(CATEGORIES):
        raise DeciderError('INVALID_CATEGORIES')
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1
           for v in probabilities.values()):
        raise DeciderError('INVALID_PROBABILITIES')
    if probabilities[choice] != max(probabilities.values()) or abs(sum(probabilities.values()) - 1) > 0.02:
        raise DeciderError('INCONSISTENT_PROBABILITIES')
    confidence = answer.get('confidence', probabilities[choice])
    if (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
            or not math.isfinite(confidence) or not 0 <= confidence <= 1
            or abs(confidence - probabilities[choice]) > 1e-6):
        raise DeciderError('INVALID_CONFIDENCE')
    usage = payload.get('usage') if isinstance(payload.get('usage'), dict) else {}
    safe = {}
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'):
        value = usage.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
            safe[key] = value
    safe['cost_quality'] = 'ACTUAL' if 'cost' in safe else 'UNKNOWN'
    return Classification(choice, float(confidence), probabilities, safe)


def classify(subject, body, cfg, *, post=None):
    if cfg.provider != 'openrouter' or not cfg.model or not cfg.api_key:
        raise DeciderError('CLASSIFIER_NOT_CONFIGURED')
    send = post or httpx.post
    try:
        response = send(ENDPOINT, headers={'Authorization': 'Bearer ' + cfg.api_key},
                        json=build_request(subject, body, cfg), timeout=35, follow_redirects=False)
        if response.status_code == 429 or response.status_code >= 500:
            raise DeciderError('PROVIDER_UNAVAILABLE', retryable=True)
        if response.status_code >= 300:
            raise DeciderError('PROVIDER_REJECTED')
        if len(response.content) > 64000:
            raise DeciderError('RESPONSE_TOO_LARGE')
        payload = response.json()
        try:
            return parse_response(payload)
        except DeciderError as error:
            # Invalid output still incurs usage; retain numeric accounting, never raw output.
            usage = payload.get('usage', {}) if isinstance(payload, dict) else {}
            safe = {key: value for key, value in usage.items() if key in {'cost', 'prompt_tokens', 'completion_tokens', 'total_tokens'}
                    and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0} if isinstance(usage, dict) else {}
            error.usage = {**safe, 'cost_quality': 'ACTUAL' if 'cost' in safe else 'UNKNOWN'}
            raise
    except httpx.HTTPError:
        raise DeciderError('PROVIDER_UNAVAILABLE', retryable=True) from None
    except (ValueError, TypeError, AttributeError):
        raise DeciderError('INVALID_RESPONSE') from None
