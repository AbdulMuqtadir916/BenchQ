"""The ATS lab's patches on top of JobNavigator's match-1.1 (2026-11-13) and BenchQ's changes (backend/UPSTREAM.md):
one test each, so a later copy from upstream that drops one shows here. Pure; every sentence is made up."""
from types import SimpleNamespace

from backend.match import ats_match as m
from backend.match import clearance, work_auth
from backend.match.ats_match_terms import ResumeFacts
from backend.match.job_quality import outside_country
from backend.match.main_skills import technologies
from backend.match.title_fit import title_variants

H1B_TRANSFER = {"country": "US", "work_auth": "H1B", "needs_sponsorship": True, "needs_transfer": True,
                "employment_types": ["C2C"]}


def _flags(text, who=H1B_TRANSFER, title="Java Developer", location=""):
    return {f["flag"]: f["capped"] for f in m.eligibility_flags(title, text, who, location)}


# ── v13: H-1B transfers welcome; "no C2C" in more words ──────────────────────────────────────────────────────────────

def test_v13_no_new_sponsorship_but_transfers_welcome_does_not_cap_a_transfer_candidate():
    flags = _flags("We are unable to sponsor new H-1B petitions. H-1B transfer candidates are encouraged.")
    assert flags == {"no new sponsorship": False}


def test_v13_no_c2c_also_reads_not_open_to_and_w2_only():
    for text in ("We are not open to C2C.", "W2 only.", "No corp to corp."):
        assert _flags(text)["no C2C"] is True


# ── v14: common technologies, status lists, citizenship wording, two-role titles, a clearance over two lines,
#    a lower-case country code ──────────────────────────────────────────────────────────────────────────────────────

def test_v14_common_technologies_the_dictionary_held_only_as_tags_count():
    assert {"Perl", "JBoss", "Apache Tomcat"} <= set(technologies("Perl scripts on JBoss and Tomcat"))


def test_v14_a_list_of_the_only_statuses_taken_rules_out_the_rest():
    accepted, _ = work_auth.status_lists("Visa : Only US citizens and Greencard holders")
    assert accepted == {"USC", "GC"}
    assert _flags("Visa : Only US citizens and Greencard holders")["statuses listed"] is True
    assert work_auth.status_lists("Location: Nashville, TN only") == (None, set())     # a state, not the TN visa
    assert "H1B" not in work_auth.status_lists("No H1B transfers.")[1]                  # NO_TRANSFER's rule, not a list


def test_v14_citizenship_required_in_its_other_wordings():
    for text in ("Must be US Citizen", "US Citizenship Required: Yes", "This role requires U.S. citizenship."):
        assert work_auth.CITIZENS_ONLY.search(text), text


def test_v14_a_title_with_two_roles_or_a_slash_is_each_of_them():
    assert {"AI Engineer", "LLM Engineer"} <= set(title_variants("AI/LLM Engineer"))
    assert {"GenAI Engineer", "Python Backend Engineer"} <= set(title_variants("GenAI Engineer | Python Backend Engineer"))
    assert title_variants("CI/CD Engineer") == ["CI/CD Engineer"]


def test_v14_a_clearance_label_reads_with_the_next_line():
    assert clearance.required("Software Engineer", "Clearance Required:\nTS/SCI w Poly")


def test_v14_a_lower_case_country_code_is_the_country():
    assert outside_country(SimpleNamespace(title="Java Developer", location="Toronto, ca", description=""), "US") == "CA"
    assert not outside_country(SimpleNamespace(title="Java Developer", location="San Ramon, CA, us", description=""), "US")


# ── v16: W2 with a word before "only", USC/GC shorthand, citizenship required later in the sentence ─────────────────

def test_v16_w2_contract_only_is_no_c2c():
    for text in ("Required: (W2 Contract Only)", "W2 position only", "Only W2."):
        assert work_auth.NO_C2C.search(text), text


def test_v16_usc_gc_shorthand_is_the_only_statuses_taken_but_h1b_opt_is_not_a_closed_list():
    assert work_auth.status_lists("C2C USC/GC Duration: Long term")[0] == {"USC", "GC"}
    assert work_auth.status_lists("Supports H1B/OPT candidates.")[0] is None


def test_v16_citizenship_required_later_in_the_sentence():
    text = "U.S. citizenship and the ability to obtain and maintain a DoD security clearance are required."
    assert work_auth.CITIZENS_ONLY.search(text)


# ── v17: a title with no subject, GC/Citizen, a clearance in the title, a required language ─────────────────────────

def test_v17_a_title_made_only_of_kind_and_level_words_names_no_subject():
    assert m.names_no_subject("Software Systems Engineer - IV") and m.names_no_subject("Senior Back End Developer")
    assert not m.names_no_subject("Senior Android Developer")


def test_v17_gc_citizen_is_the_only_statuses_taken():
    assert work_auth.status_lists("Multiple Openings for GC/Citizen")[0] == {"USC", "GC"}


def test_v17_a_clearance_named_in_the_title_is_required_unless_it_can_be_obtained():
    assert clearance.required("Full-Stack Software Engineer with Security Clearance", "")
    assert not clearance.required("Engineer - ability to obtain clearance", "")


def test_v17_a_required_language_is_read_and_a_preference_is_not():
    assert m.languages_needed("Java Developer - Bilingual (English / Korean)", "") == {"korean"}
    assert m.languages_needed("Java Developer", "Must be fluent in Japanese") == {"japanese"}
    assert m.languages_needed("Java Developer", "Spanish is a plus.") == set()


# ── v18: the title cap only for a title with another subject ─────────────────────────────────────────────────────────

def test_v18_only_a_title_with_another_subject_caps():
    assert m.other_subject("Sales Account Executive", ["Java Developer"])
    assert m.other_subject("Sr. Android Developer", ["Java Developer"])
    assert not m.other_subject("Sr. Java Application Support Consultant", ["Java Developer"])
    assert not m.other_subject("Software Systems Engineer - IV", ["Java Developer"])


# ── BenchQ's changes ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_benchq_an_unknown_country_is_never_assumed_to_be_the_us():
    abroad = "Our team in Toronto, Ontario."
    assert "outside the country" in _flags(abroad, location="Toronto, ON, Canada")
    assert "outside the country" not in _flags(abroad, who={**H1B_TRANSFER, "country": None}, location="Toronto, ON, Canada")


def test_benchq_the_resumes_languages_count_when_it_is_read_once():
    job = {"title": "Java Developer - Bilingual (English / Korean)", "description": "Build Java services with Spring."}
    speaks = ResumeFacts.read({"languages": ["English", "Korean"], "skills": {"Languages": ["Java"]}})
    silent = ResumeFacts.read({"languages": ["English"], "skills": {"Languages": ["Java"]}})
    assert not any("Korean" in cap for cap in m.ats_match(speaks, job)["caps"])
    assert any("Korean" in cap for cap in m.ats_match(silent, job)["caps"])


def test_benchq_the_wordings_bench_q_first_rules_caught():
    for text in ("We don't offer sponsorship.", "Company doesn’t sponsor visas.", "Sponsorship unavailable."):
        assert work_auth.NO_SPONSORSHIP.search(text), text
    assert not work_auth.NO_SPONSORSHIP.search("Our casino sponsors the league.")
    assert work_auth.NO_TRANSFER.search("Unable to consider transfers.")
    assert not work_auth.CITIZENS_ONLY.search("Bonus: plus citizens only club perks")


def test_benchq_a_us_citizen_takes_a_job_open_to_green_card_holders():
    accepted, _ = work_auth.status_lists("Green card holders only.")
    assert work_auth.accepts(accepted, "USC") and work_auth.accepts(accepted, "GC")
    assert not work_auth.accepts(accepted, "H1B")
