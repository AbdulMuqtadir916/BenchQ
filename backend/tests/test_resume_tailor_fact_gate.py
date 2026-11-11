"""The résumé tailor's code gate: every bullet checked against its own role's lines, not the skills list or other roles
(docs/team/tailoring.md). Ported from JobNavigator's tests/test_mads_fact_gate.py."""
from backend.resume_tailor import fact_gate
from backend.tests.resume_tailor_samples import BASE


def _gated(*role_bullets):
    draft = {"experience": [{"role_number": number, "bullets": list(bullets)}
                            for number, bullets in enumerate(role_bullets, start=1)]}
    gated, changes = fact_gate.checked_against_each_role(draft, BASE)
    return [entry["bullets"] for entry in gated["experience"]], changes


def test_a_bullet_its_role_states_is_kept_as_written():
    bullets, changes = _gated(["Built REST APIs with Python on AWS for 40 internal teams."])
    assert bullets == [["Built REST APIs with Python on AWS for 40 internal teams."]] and changes == []


def test_a_tool_only_the_skills_list_names_is_taken_out_of_a_bullets_list():
    # Docker is in the résumé's skills, but no bullet of role 1 names it.
    bullets, changes = _gated(["Built event-driven workers with Python, RabbitMQ, and Docker."])
    assert "Docker" not in bullets[0][0] and "RabbitMQ" in bullets[0][0]
    assert changes[0]["action"] == fact_gate.TAKEN_OUT and changes[0]["unsupported"] == ["Docker"]


def test_a_number_from_another_role_sends_the_bullet_back_to_the_resumes_own():
    # 40 internal teams is role 1's; role 2 states no number.
    bullets, changes = _gated(["Built REST APIs with Python on AWS for 40 internal teams."],
                              ["Maintained a SQL reporting database for 40 internal teams."])
    assert bullets[1] == ["Maintained a SQL reporting database."]
    assert changes == [{"role_number": 2, "was": "Maintained a SQL reporting database for 40 internal teams.",
                        "unsupported": ["40"], "now": "Maintained a SQL reporting database.",
                        "action": fact_gate.PUT_BACK}]


def test_a_narrower_name_than_the_role_uses_is_not_supported():
    bullets, changes = _gated(["Provisioned AWS EKS environments with CloudFormation templates for the platform team."])
    assert bullets == [["Provisioned AWS environments with CloudFormation templates."]]
    assert "EKS" in changes[0]["unsupported"]


def test_a_bullet_whose_resume_bullet_is_already_in_the_copy_is_dropped():
    bullets, changes = _gated(["Provisioned AWS environments with CloudFormation templates.",
                               "Provisioned AWS EKS environments with CloudFormation templates for the platform team."])
    assert bullets == [["Provisioned AWS environments with CloudFormation templates."]]
    assert changes[0]["action"] == fact_gate.DROPPED
