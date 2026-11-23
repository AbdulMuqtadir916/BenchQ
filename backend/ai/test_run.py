"""A preset's test run (08 Q7, Q16): the Super Admin's pasted sample through the preset's model and prompts. Nothing is
saved, no firm data is read, and the cost is logged with no firm under `preset_test:<use case>`. Tailoring runs its
first step (analyse), so a test costs one call rather than five."""
import asyncio
import json

from backend.ai.config import AiConfig
from backend.ai.modules import PRESET_MODULES
from backend.analyzer.llm_client import call_llm
from backend.analyzer.llm_logger import log_llm_call, track_llm_call
from backend.analyzer.model_json import parse_model_json
from backend.analyzer.prompt_fence import fence


class TestRunRefused(ValueError):
    """The sample is missing a field this use case needs."""


def _need(sample: dict, *names: str) -> list[str]:
    values = [(sample.get(name) or "").strip() for name in names]
    if not all(values):
        raise TestRunRefused("Add " + ", ".join(n.replace("_", " ") for n, v in zip(names, values) if not v) + ".")
    return values


async def _strict(cfg: AiConfig, prompt: str, system: str, response_format: dict, max_tokens: int) -> dict:
    async with track_llm_call(f"preset_test:{cfg.module}", cfg.provider, cfg.model, preset_id=cfg.preset_id,
                              preset_version=cfg.preset_version) as tracker:
        response = await call_llm(prompt=prompt, system=system, max_tokens=max_tokens, provider=cfg.provider,
                                  model=cfg.model, api_key=cfg.api_key, effort=cfg.effort,
                                  response_format=response_format, reasoning_off=not cfg.effort, use_fallback=False,
                                  retry_cut_off=True, attempt_timeout=90)
        tracker.record(response)
    return parse_model_json(response.get("text") or "")


async def _parse(cfg: AiConfig, sample: dict) -> dict:
    from backend.candidates.parse import MAX_OUTPUT_TOKENS
    from backend.candidates.parse_defaults import DEFAULT_RESPONSE_FORMAT, INPUT_NOTE, PDF_INPUT_NOTE, RESUME
    [resume] = _need(sample, "resume")
    prompt = cfg.prompts["parse"].replace(INPUT_NOTE, PDF_INPUT_NOTE).replace(RESUME, fence(resume, "RESUME", note=False))
    return await _strict(cfg, prompt, cfg.prompts["system"], json.loads(DEFAULT_RESPONSE_FORMAT), MAX_OUTPUT_TOKENS)


async def _titles(cfg: AiConfig, sample: dict) -> dict:
    from backend.job_search.search_titles import DEFAULT_FORMAT, ROLE
    [role] = _need(sample, "target_role")
    return await _strict(cfg, cfg.prompts["prompt"].replace(ROLE, role), "You name job titles. Reply in JSON.",
                         json.loads(DEFAULT_FORMAT), 200)


async def _tailor(cfg: AiConfig, sample: dict) -> dict:
    from backend.resume_tailor.pipeline import MAX_TOKENS, _filled
    from backend.resume_tailor.settings import response_format
    resume, posting = _need(sample, "resume", "posting")
    prompt = _filled(cfg.prompts["analyse"], {"{resume}": resume, "{posting}": fence(posting, "JOB POSTING")})
    return await _strict(cfg, prompt, cfg.prompts["system"], response_format("analyse"), MAX_TOKENS)


async def _classify(cfg: AiConfig, sample: dict) -> dict:
    from backend.inbox.decider import DeciderError, classify
    subject, body = _need(sample, "subject", "body")
    try:
        result = await asyncio.to_thread(classify, subject, body, cfg)
    except DeciderError as error:
        log_llm_call("preset_test:email_classification", cfg.provider, cfg.model, {}, success=False, error=error.code,
                     preset_id=cfg.preset_id, preset_version=cfg.preset_version)
        raise
    usage = result.usage or {}
    log_llm_call("preset_test:email_classification", cfg.provider, cfg.model,
                 {"input_tokens": int(usage.get("prompt_tokens") or 0),
                  "output_tokens": int(usage.get("completion_tokens") or 0)},
                 cost_usd=usage.get("cost") if isinstance(usage.get("cost"), (int, float)) else None,
                 preset_id=cfg.preset_id, preset_version=cfg.preset_version)
    return {"category": result.category, "confidence": result.confidence, "probabilities": result.probabilities}


_RUNNERS = {"resume_parse": _parse, "search_titles": _titles, "resume_tailor": _tailor, "email_classification": _classify}


async def run_test(cfg: AiConfig, sample: dict) -> dict:
    if cfg.module not in PRESET_MODULES:
        raise TestRunRefused("This use case has no test run.")
    return await _RUNNERS[cfg.module](cfg, sample)
