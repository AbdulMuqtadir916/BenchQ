"""The résumé tailor's five steps (docs/team/tailoring.md; the tailoring handoff §13), on recorded replies: no model
is called. Ported from JobNavigator's tests/test_mads_tailor.py; its tests of the route's mode names, of other models
and of thinking are left out (BenchQ runs Luna without thinking only). Added: the request each call sends (§1), the
failures (Q8) and the replay."""
import asyncio
import json
from contextlib import asynccontextmanager

import pytest

from backend.resume_tailor import pipeline, schemas
from backend.resume_tailor.settings import default_setup
from backend.tests.resume_tailor_samples import ANALYSIS, BASE, DRAFT, POSTING, REVIEW, VERIFY

SETUP = default_setup(api_key="test-key")


@asynccontextmanager
async def _untracked(*args, **kwargs):
    """track_llm_call without its llm_call_log row: these tests have no database."""
    class _Tracker:
        def record(self, response):
            return response
    yield _Tracker()


def _replies_from(monkeypatch, replies: list, seen: list | None = None):
    async def fake(prompt, system, **kwargs):
        if seen is not None:
            seen.append({"prompt": prompt, "system": system, **kwargs})
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return {"text": reply if isinstance(reply, str) else json.dumps(reply),
                "usage": {"input_tokens": 10, "output_tokens": 5}}
    monkeypatch.setattr(pipeline, "call_llm", fake)
    monkeypatch.setattr(pipeline, "track_llm_call", _untracked)


def _fake_model(monkeypatch, seen: list, revised: dict | None = None):
    _replies_from(monkeypatch, [ANALYSIS, DRAFT, REVIEW, revised if revised is not None else DRAFT, VERIFY], seen)


def _run(base=BASE):
    return asyncio.run(pipeline.tailor(base, POSTING, setup=SETUP))


def _name(call) -> str:
    return call["response_format"]["json_schema"]["name"]


def test_five_steps_on_luna_through_openrouter(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    copy = _run()
    assert [_name(call) for call in seen] == ["mads_analyse", "mads_draft", "mads_review", "mads_revise", "mads_verify"]
    assert {call["model"] for call in seen} == {"openai/gpt-6-luna"}
    assert {call["provider"] for call in seen} == {"openrouter"}
    assert set(copy["_focused_report"]["seconds"]) == {"analyse", "draft", "review", "revise", "verify"}


def test_each_call_is_the_handoffs_request(monkeypatch):
    """§1: the strict format with require_parameters, reasoning off, no temperature, 12,000 tokens, no fallback model,
    a cut-off reply retried; the key from the setup."""
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    for call in seen:
        assert call["response_format"]["type"] == "json_schema" and call["response_format"]["json_schema"]["strict"]
        assert call["reasoning_off"] is True and call["use_fallback"] is False and call["retry_cut_off"] is True
        assert call["max_tokens"] == 12000 and call["api_key"] == "test-key" and call["effort"] == ""
        assert "temperature" not in call


def test_the_prompts_carry_his_rules_and_the_resume_not_a_profile(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    draft_prompt = seen[1]["prompt"]
    for rule in ("4-6 bullets for the most recent role", "matched or honestly gapped", "interview backtrack test",
                 "NO em-dashes", "elevator pitch", "Cut by signal, not by section"):
        assert rule in draft_prompt
    assert "ROLE 1" in draft_prompt and "JOB POSTING" in draft_prompt
    assert "hiring manager proxy" in seen[2]["system"]
    assert "Part A" in seen[2]["prompt"] and "Backend Developer specializing in Python" in seen[2]["prompt"]


def test_the_reviewers_exact_edits_are_applied_and_missing_ones_skipped(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    copy = _run()
    revise_prompt = seen[3]["prompt"]
    assert "Python Backend Developer specializing in AWS APIs" in revise_prompt
    assert "Lead the profile with the 40 teams." in revise_prompt
    assert copy["_focused_report"]["review_edits_applied"] == 1


def test_the_verify_edits_reach_the_copy(monkeypatch):
    _fake_model(monkeypatch, [])
    copy = _run()
    assert copy["experience"][1]["bullets"] == ["Maintained a SQL reporting database for the reporting team."]
    assert copy["_focused_report"]["verify_edits_applied"] == 1


def test_the_copy_is_our_resume_with_the_resumes_facts(monkeypatch):
    _fake_model(monkeypatch, [])
    copy = _run()
    assert copy["header"]["target_title"] == "Backend Developer specializing in Python"
    assert copy["summary"].startswith("Backend developer with 7+ years")
    assert copy["skills"]["Infrastructure"] == "CloudFormation, conceptually aligned with Terraform."
    assert [role["company"] for role in copy["experience"]] == ["Acme", "Beta"]
    assert " - " in copy["experience"][1]["date"]
    report = copy["_focused_report"]
    assert report["gaps"] == ["Code reviews"] and report["stretch_flags"][0]["why"] == "adjacent"
    assert [r["kind"] for r in report["requirements"]] == ["must", "must", "duty"]


def test_a_revision_that_leaves_a_part_empty_keeps_the_draft_part(monkeypatch):
    _fake_model(monkeypatch, [], revised={**DRAFT, "core_competencies": [], "profile_statement": ""})
    copy = _run()
    assert copy["summary"].startswith("Backend developer with 7+ years")
    assert "Python APIs" in copy["skills"]


def test_with_the_edits_skips_text_found_twice():
    draft = {"headline": "Python", "profile_statement": "Python and Python", "core_competencies": [], "experience": []}
    edited, applied, missed = pipeline.with_the_edits(draft, [{"old_string": "Python", "new_string": "Go"}])
    assert applied == 0 and edited == draft
    assert missed == [{"old_string": "Python", "why": "found more than once in the CV"}]


def test_markdown_bold_in_a_label_is_not_printed(monkeypatch):
    bold = {**DRAFT, "core_competencies": [{"label": "**Python APIs**", "text": "REST APIs in Python."}]}
    _fake_model(monkeypatch, [], revised=bold)
    assert "Python APIs" in _run()["skills"]


def test_an_edit_with_an_empty_replacement_drops_the_bullet():
    draft = {"headline": "", "profile_statement": "", "core_competencies": [],
             "experience": [{"role_number": 1, "bullets": ["Built A.", "Built B."]}]}
    edited, applied, missed = pipeline.with_the_edits(draft, [{"old_string": "  - Built B.", "new_string": ""}])
    assert applied == 1 and missed == [] and edited["experience"][0]["bullets"] == ["Built A.", ""]


def test_the_verify_step_checks_counts_repetition_and_verbs(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    verify = seen[4]["prompt"]
    assert "Bullet counts: at most 6" in verify and "No repetition" in verify and "Participated in code reviews" in verify
    assert "(2 bullets)" in verify


# ── Every step reads the latest CV, and no edit is lost in silence ─────────────

def _marked(text):
    """DRAFT with the latest role's first bullet replaced by a marker, so each version can be traced."""
    return {**DRAFT, "experience": [{"role_number": 1, "bullets": [text, "Provisioned AWS environments with "
                                                                         "CloudFormation templates."]},
                                    DRAFT["experience"][1]]}


def test_each_step_reads_the_latest_cv_and_the_copy_carries_the_last_edit(monkeypatch):
    seen = []
    review = {**REVIEW, "edits": [{"old_string": "DRAFT-MARK bullet.", "new_string": "REVIEWED-MARK bullet.",
                                   "reason": "keyword"}]}
    # The last edit is a sentence role 1 states, so the code gate after verify keeps it as written.
    verified = "Built event-driven workers with RabbitMQ in Python."
    verify = {**VERIFY, "edits": [{"old_string": "REVISED-MARK bullet.", "new_string": verified, "reason": "keyword"}]}
    _replies_from(monkeypatch, [ANALYSIS, _marked("DRAFT-MARK bullet."), review, _marked("REVISED-MARK bullet."),
                                verify], seen)
    copy = _run()
    review_prompt, revise_prompt, verify_prompt = (call["prompt"] for call in seen[2:5])
    assert "DRAFT-MARK" in review_prompt                                   # the reviewer reads the draft
    assert "REVIEWED-MARK" in revise_prompt and "DRAFT-MARK" not in revise_prompt    # Part A applied before revise
    assert "REVISED-MARK" in verify_prompt and "REVIEWED-MARK" not in verify_prompt  # verify reads the revision
    assert copy["experience"][0]["bullets"][0] == verified                 # the copy carries the last edit
    report = copy["_focused_report"]
    assert report["fact_gate_changes"] == []
    assert report["review_edits_applied"] == 1 and report["verify_edits_applied"] == 1
    assert report["review_edits_missed"] == [] and report["verify_edits_missed"] == []


def test_an_edit_quoting_the_original_resume_is_reported_not_lost(monkeypatch):
    verify = {**VERIFY, "edits": [{"old_string": "Organised the team's yearly offsite.", "new_string": "x"},
                                  {"old_string": "Built REST APIs with Python and FastAPI for 40 internal teams.",
                                   "new_string": "x"},
                                  {"old_string": "A sentence nobody wrote.", "new_string": "x"}]}
    _replies_from(monkeypatch, [ANALYSIS, DRAFT, REVIEW, DRAFT, verify])
    base = {**BASE, "experience": [{**BASE["experience"][0], "bullets": BASE["experience"][0]["bullets"]
                                    + ["Organised the team's yearly offsite."]}] + BASE["experience"][1:]}
    missed = _run(base)["_focused_report"]["verify_edits_missed"]
    assert [entry["why"] for entry in missed] == ["quotes the original résumé, not the CV", "not in the CV",
                                                  "not in the CV"]


def test_the_verify_prompt_puts_the_cv_last_and_names_it_as_the_only_source_of_edits(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    verify = seen[4]["prompt"]
    heading = verify.index("THE TAILORED CV (the document you are verifying")
    assert heading > verify.index("RESUME (the sole source of truth")
    assert heading > verify.index("JOB POSTING") and "Maintained a SQL reporting database." in verify[heading:]
    assert "never from the RESUME" in verify


def test_a_quoted_run_of_a_roles_bullets_under_its_role_line_is_trimmed():
    draft = {"core_competencies": [], "experience": [
        {"role_number": 1, "bullets": ["Built A.", "Built B.", "Built C."]},
        {"role_number": 2, "bullets": ["Built D."]}]}
    old = "Developer | Acme | Jan 2021 - Present (3 bullets)\n  - Built A.\n  - Built B.\n  - Built C."
    new = "Developer | Acme | Jan 2021 - Present (2 bullets)\n  - Built A and B.\n  - Built C."
    edited, applied, missed = pipeline.with_the_edits(draft, [{"old_string": old, "new_string": new}])
    assert applied == 1 and missed == []
    assert edited["experience"][0]["bullets"] == ["Built A and B.", "Built C."]
    assert edited["experience"][1]["bullets"] == ["Built D."]


def test_a_competency_quoted_as_the_reader_saw_it_is_edited():
    draft = {"core_competencies": [{"label": "**CI/CD**", "text": "Jenkins pipelines."}], "experience": []}
    edit = {"old_string": "**CI/CD**: Jenkins pipelines.", "new_string": "CI/CD Automation: Jenkins and Git pipelines."}
    edited, applied, missed = pipeline.with_the_edits(draft, [edit])
    assert applied == 1 and missed == []
    assert edited["core_competencies"][0] == {"label": "CI/CD Automation", "text": "Jenkins and Git pipelines."}


def test_a_list_marker_the_model_wrote_into_a_bullet_is_never_printed(monkeypatch):
    marked = {**DRAFT, "experience": [{"role_number": 1, "bullets": ["- Built REST APIs.", "• - Provisioned AWS.", "- "]},
                                      DRAFT["experience"][1]]}
    _fake_model(monkeypatch, [], revised=marked)
    copy = _run()
    assert copy["experience"][0]["bullets"] == ["Built REST APIs.", "Provisioned AWS."]


def test_the_cv_is_written_without_pronouns_and_with_a_short_dateless_profile(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    draft, verify = seen[1]["prompt"], seen[4]["prompt"]
    assert "no personal pronouns anywhere in the CV" in draft
    assert "3-4 lines (at most about 80 words)" in draft and "no role-by-role timeline, no dates" in draft
    assert "I bring" not in draft and "my daily toolkit" not in draft
    assert "No personal pronouns" in verify and "no dates or role-by-role timeline" in verify


def test_only_the_verify_step_sees_the_bullet_counts(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    assert "bullets)" not in seen[2]["prompt"]       # the reviewer
    assert "(2 bullets)" in seen[4]["prompt"]        # verify


def test_a_replacement_holding_an_editors_note_is_refused_and_reported():
    draft = {"core_competencies": [], "experience": [{"role_number": 1, "bullets": ["Built A.", "Built B."]}]}
    edit = {"old_string": "  - Built B.",
            "new_string": "  - Built B.\n\n  [Reduce this role from 10 bullets to no more than 6, keeping React.]"}
    edited, applied, missed = pipeline.with_the_edits(draft, [edit])
    assert applied == 0 and edited["experience"][0]["bullets"] == ["Built A.", "Built B."]
    assert missed[0]["why"] == "the replacement is not CV text (an editor's note)"


def test_one_bullet_replaced_by_several_lines_is_refused():
    draft = {"core_competencies": [], "experience": [{"role_number": 1, "bullets": ["Built A.", "Built B."]}]}
    edit = {"old_string": "Built B.", "new_string": "Built B.\nAlso built C."}
    edited, applied, missed = pipeline.with_the_edits(draft, [edit])
    assert applied == 0 and missed[0]["why"] == "the replacement is not CV text (one line replaced by several)"


def test_the_list_marker_comes_off_the_replacement_too():
    draft = {"core_competencies": [], "experience": [{"role_number": 1, "bullets": ["Built A."]}]}
    edited, applied, _ = pipeline.with_the_edits(draft, [{"old_string": "  - Built A.", "new_string": "  - Built A in Python."}])
    assert applied == 1 and edited["experience"][0]["bullets"] == ["Built A in Python."]


def test_the_verify_prompt_forbids_notes_in_replacements(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    edits = seen[4]["response_format"]["json_schema"]["schema"]["properties"]["edits"]["items"]["properties"]
    assert "never a note, an instruction or a bracketed comment" in edits["new_string"]["description"]


# ── Strict response formats ─────────────────────────────────────────────────────

FORMATS = {"analyse": schemas.ANALYSIS_SCHEMA, "draft": schemas.DRAFT_SCHEMA, "review": schemas.REVIEW_SCHEMA,
           "revise": schemas.DRAFT_SCHEMA, "verify": schemas.VERIFY_SCHEMA}


def _nodes(node, path="$"):
    yield path, node
    for name, child in (node.get("properties") or {}).items():
        yield from _nodes(child, f"{path}.{name}")
    if "items" in node:
        yield from _nodes(node["items"], f"{path}[]")


def test_every_format_is_strict_and_every_field_is_described():
    for step, schema in FORMATS.items():
        for path, node in _nodes(schema):
            assert node.get("description"), f"{step} {path} has no description"
            if node.get("type") == "object":
                assert node["additionalProperties"] is False, f"{step} {path} allows extra fields"
                assert node["required"] == list(node["properties"]), f"{step} {path} leaves a field optional"


def test_fixed_values_are_enums():
    requirement = schemas.ANALYSIS_SCHEMA["properties"]["requirements"]["items"]["properties"]
    assert requirement["priority"]["enum"] == ["required", "preferred", "duty"]
    assert requirement["status"]["enum"] == ["matched", "adjacent", "gap"]
    assert schemas.REVIEW_SCHEMA["properties"]["edits"]["items"]["properties"]["reason"]["enum"] == \
        ["keyword", "reframing", "style", "grounding"]
    coverage = schemas.VERIFY_SCHEMA["properties"]["keyword_coverage"]["items"]["properties"]["status"]
    assert coverage["enum"] == ["covered", "synonym-only", "missing (have it)", "missing (gap)"]


def test_each_call_sends_its_strict_format_and_the_prompt_no_longer_lists_the_fields(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    for call, (step, schema) in zip(seen, FORMATS.items()):
        assert _name(call) == f"mads_{step}" and call["response_format"]["json_schema"]["schema"] == schema
        assert "Return:" not in call["prompt"] and "\n- headline:" not in call["prompt"]
    assert "each field's description says what goes in it" in seen[0]["prompt"]


def test_the_cv_never_comments_on_the_resume(monkeypatch):
    seen = []
    _fake_model(monkeypatch, seen)
    _run()
    assert "The CV presents the candidate, never the resume" in seen[1]["prompt"]
    assert "No commentary about the resume" in seen[4]["prompt"]
    competency = schemas.DRAFT_SCHEMA["properties"]["core_competencies"]["items"]["properties"]["text"]
    assert "never commentary about the resume" in competency["description"]


def test_the_skills_heading_says_the_list_is_names_not_work():
    labelled = pipeline.with_the_skills_list_labelled("Name: Candidate\n\nSKILLS\n  1. Cloud: AWS\n\nROLE 1: Developer")
    assert labelled.split("\n")[2] == pipeline.SKILLS_LIST_HEADING
    assert "SKILLS\n" not in labelled


# ── Failures (decided 2026-11-12, Q8): a failed step fails the run, with a reason class ──────────────────────────────

def test_a_model_that_fails_every_attempt_fails_the_run_naming_the_step(monkeypatch):
    _replies_from(monkeypatch, [ANALYSIS, RuntimeError("502 from the provider")])
    with pytest.raises(pipeline.TailorFailed) as failed:
        _run()
    assert (failed.value.code, failed.value.step) == (pipeline.PROVIDER_FAILED, "draft")


def test_a_reply_that_is_not_json_is_asked_for_once_more(monkeypatch):
    seen = []
    _replies_from(monkeypatch, ["Sure! Here is the analysis.", ANALYSIS, DRAFT, REVIEW, DRAFT, VERIFY], seen)
    copy = _run()
    assert len(seen) == 6 and copy["experience"]
    assert seen[1]["prompt"].endswith("Reply with the JSON object only, nothing before or after it.")
    assert not seen[0]["prompt"].endswith("nothing before or after it.")


def test_a_second_unreadable_reply_fails_the_run(monkeypatch):
    _replies_from(monkeypatch, [ANALYSIS, "no json", "still no json"])
    with pytest.raises(pipeline.TailorFailed) as failed:
        _run()
    assert (failed.value.code, failed.value.step) == (pipeline.UNREADABLE_REPLY, "draft")


# ── Replay (§13): the same replies give the same copy and report every time ──────────────────────────────────────────

def test_a_replay_gives_the_same_copy_and_report(monkeypatch):
    def once():
        _fake_model(monkeypatch, [])
        copy = _run()
        copy["_focused_report"].pop("seconds")
        return copy
    first, second = once(), once()
    assert first == second
    assert first["experience"][0]["bullets"] == ["Built REST APIs with Python on AWS for 40 internal teams.",
                                                 "Provisioned AWS environments with CloudFormation templates."]
