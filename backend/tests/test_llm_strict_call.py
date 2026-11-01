"""call_llm's options for the résumé parser (docs/team/resume-versioning.md §2.1): the strict format with
require_parameters, reasoning off, no backup model, a cut-off reply retried, a deadline per attempt. Off by default,
so every other caller's request is unchanged. The OpenRouter client is mocked; no model is called."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.analyzer import llm_client as L
from backend.analyzer.llm_client import LLMDeadlineError, NonRetryableLLMError
from backend.models.db import Setting

FORMAT = {"type": "json_schema", "json_schema": {"name": "base_resume", "strict": True,
                                                  "schema": {"type": "object", "properties": {}, "required": []}}}
PARSER = dict(provider="openrouter", model="openai/gpt-6-luna", api_key="k", effort="",
              response_format=FORMAT, reasoning_off=True, use_fallback=False, retry_cut_off=True,
              attempt_timeout=80)


def _reply(text='{"a": 1}', finish="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text), finish_reason=finish)],
                           usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))


@pytest.fixture
def openrouter(monkeypatch):
    """The OpenAI-compatible client, mocked: `create` records each request and answers from `replies`."""
    create = AsyncMock(return_value=_reply())
    monkeypatch.setattr(L, "_openai_client", lambda api_key, base_url: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    return create


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr(L.asyncio, "sleep", sleep)
    return sleep


def _settings(db, **values):
    for k, v in values.items():
        db.add(Setting(key=k, value=v))
    db.commit()


@pytest.mark.asyncio
async def test_the_parse_request_carries_the_strict_format_and_reasoning_off(test_db, openrouter):
    await L.call_llm("p", "s", max_tokens=16000, **PARSER)
    sent = openrouter.call_args.kwargs
    assert sent["response_format"] == FORMAT
    assert sent["extra_body"] == {"provider": {"require_parameters": True}, "reasoning": {"enabled": False}}
    assert sent["max_tokens"] == 16000
    assert "temperature" not in sent


@pytest.mark.asyncio
async def test_reasoning_off_replaces_an_effort_and_adds_no_headroom(test_db, openrouter):
    """A shared effort on the same provider would otherwise reach the parser (handoff test 12)."""
    _settings(test_db, llm_provider="openrouter", llm_effort="high")
    await L.call_llm("p", "s", max_tokens=16000, **(PARSER | {"effort": None}))
    sent = openrouter.call_args.kwargs
    assert sent["extra_body"]["reasoning"] == {"enabled": False}
    assert sent["max_tokens"] == 16000


@pytest.mark.asyncio
async def test_without_the_options_a_request_is_as_before(test_db, openrouter):
    await L.call_llm("p", "s", max_tokens=600, provider="openrouter", model="m", api_key="k", effort="")
    sent = openrouter.call_args.kwargs
    assert "response_format" not in sent and "extra_body" not in sent
    assert sent["max_tokens"] == 600


@pytest.mark.asyncio
async def test_a_strict_format_on_another_provider_is_refused_not_dropped(test_db, openrouter):
    with pytest.raises(NonRetryableLLMError, match="need openrouter"):
        await L.call_llm("p", "s", **(PARSER | {"provider": "claude_api"}))
    openrouter.assert_not_called()


@pytest.mark.asyncio
async def test_a_cut_off_reply_is_retried(test_db, openrouter):
    openrouter.side_effect = [_reply('{"a": ', "length"), _reply()]
    res = await L.call_llm("p", "s", max_tokens=16000, **PARSER)
    assert res["text"] == '{"a": 1}'
    assert openrouter.call_count == 2


@pytest.mark.asyncio
async def test_without_the_option_a_cut_off_reply_is_returned_as_before(test_db, openrouter):
    openrouter.return_value = _reply('{"a": ', "length")
    res = await L.call_llm("p", "s", provider="openrouter", model="m", api_key="k", effort="")
    assert res["text"] == '{"a":'
    assert openrouter.call_count == 1


@pytest.mark.asyncio
async def test_four_attempts_two_four_eight_seconds_apart_and_no_backup_model(test_db, openrouter, no_backoff):
    """The backup model is set to Claude; the parse still never calls it (handoff test 13)."""
    _settings(test_db, llm_fallback_provider="claude_api", llm_fallback_model="claude-sonnet-5")
    openrouter.side_effect = RuntimeError("502 Bad Gateway")
    with pytest.raises(RuntimeError, match="502"):
        await L.call_llm("p", "s", **PARSER)
    assert openrouter.call_count == 4
    assert [c.args[0] for c in no_backoff.call_args_list] == [2, 4, 8]


@pytest.mark.asyncio
async def test_with_the_backup_allowed_it_still_runs_as_before(test_db, openrouter, monkeypatch):
    _settings(test_db, llm_fallback_provider="claude_api", llm_fallback_model="claude-sonnet-5")
    openrouter.side_effect = RuntimeError("502 Bad Gateway")
    claude = AsyncMock(return_value={"text": "ok", "usage": {}})
    monkeypatch.setattr(L, "_call_claude_api", claude)
    res = await L.call_llm("p", "s", provider="openrouter", model="m", api_key="k", effort="")
    assert res["provider"] == "claude_api"
    claude.assert_called_once()


@pytest.mark.asyncio
async def test_an_attempt_past_the_deadline_ends_the_call(test_db, monkeypatch):
    calls = []

    async def slow(*args, **kwargs):
        calls.append(1)
        await asyncio.Event().wait()                 # never answers

    monkeypatch.setattr(L, "_dispatch", slow)
    with pytest.raises(LLMDeadlineError, match="within 0.05s"):
        await L.call_llm("p", "s", **(PARSER | {"attempt_timeout": 0.05}))
    assert len(calls) == 1
