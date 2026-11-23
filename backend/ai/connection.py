"""The checks before an AI setup is saved: the key, then one tiny real request per active model, in the form its use case
sends. Results carry fixed messages only, never the key, a prompt or the provider's body."""
from dataclasses import dataclass
import time

import httpx

from backend.ai.modules import PresetModule

BASE = "https://openrouter.ai/api/v1"
TIMEOUT_SECONDS = 20.0
LIVE_MODELS_KEPT_FOR_SECONDS = 3600
_CHECK_FORMAT = {"type": "json_schema", "json_schema": {"name": "connection_check", "strict": True, "schema": {
    "type": "object", "additionalProperties": False, "required": ["ok"], "properties": {"ok": {"type": "boolean"}}}}}
_live: dict = {"models": [], "at": 0.0}


@dataclass(frozen=True)
class Check:
    ok: bool
    rejected: bool = False          # the key or model was refused: a save stops. False with ok False: unreachable
    message: str = ""


OK = Check(True)
UNREACHABLE = Check(False, False, "OpenRouter couldn't be reached.")


def _answer(status: int, what: str) -> Check:
    if 200 <= status < 300:
        return OK
    if status in (401, 403):
        return Check(False, True, "OpenRouter rejected this API key.")
    if status == 402:
        return Check(False, True, "This OpenRouter account is out of credit.")
    if status in (400, 404, 422):
        return Check(False, True, f"{what} isn't available for this use case.")
    return UNREACHABLE


async def check_key(key: str) -> Check:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.get(f"{BASE}/key", headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError:
        return UNREACHABLE
    return _answer(response.status_code, "The key")


async def check_model(key: str, module: PresetModule, model: str, effort: str = "",
                      prompts: dict | None = None) -> Check:
    """`prompts`: the preset's own, so a classifier check sends the State and Question it would really run with."""
    headers = {"Authorization": f"Bearer {key}"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            if module.request == "decision":
                from backend.ai.config import AiConfig
                from backend.inbox.decider import ENDPOINT, build_request
                from backend.inbox.decider_request import identity_prompts
                cfg = AiConfig(module=module.key, provider="openrouter", model=model, api_key=key, effort="",
                               prompts=prompts or {})
                body = build_request("Connection check", "This is a connection check, not a real email.", cfg)
                response = await client.post(ENDPOINT, headers=headers, json=body)
                if response.status_code in (400, 422) and identity_prompts(cfg.prompts) not in ({}, {"instructions": ""}):
                    return Check(False, True, f"OpenRouter refused {model} with this State and Question.")
            else:
                body = {"model": model, "messages": [{"role": "user", "content": 'Return {"ok": true}.'}],
                        "max_tokens": 64, "response_format": _CHECK_FORMAT, "provider": {"require_parameters": True},
                        "reasoning": {"effort": effort} if effort else {"enabled": False}}
                response = await client.post(f"{BASE}/chat/completions", headers=headers, json=body)
    except httpx.HTTPError:
        return UNREACHABLE
    return _answer(response.status_code, f"{model}")


async def live_models() -> list[dict]:
    """OpenRouter's public model list, kept for an hour. Raises httpx.HTTPError when it can't be read and none is kept."""
    if _live["models"] and time.monotonic() - _live["at"] < LIVE_MODELS_KEPT_FOR_SECONDS:
        return _live["models"]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.get(f"{BASE}/models")
            response.raise_for_status()
        models = [{"id": row["id"], "name": row.get("name") or row["id"]}
                  for row in response.json().get("data", []) if isinstance(row, dict) and row.get("id")]
    except (httpx.HTTPError, ValueError):
        if _live["models"]:
            return _live["models"]
        raise httpx.HTTPError("the model list couldn't be read") from None
    _live.update(models=models, at=time.monotonic())
    return models
