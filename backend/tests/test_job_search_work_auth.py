"""The work-authorization rules a search applies to each job's text (decided 2026-11-14, Q5). Pure. Every sentence
here is made up."""
import pytest

from backend.job_search import work_auth

H1B = dict(work_auth="H1B", needs_sponsorship=True, needs_transfer=True)
H1B_NO_TRANSFER = dict(work_auth="H1B", needs_sponsorship=False, needs_transfer=False)
GC = dict(work_auth="GC", needs_sponsorship=False, needs_transfer=False)
GC_EAD = dict(work_auth="GC_EAD", needs_sponsorship=False, needs_transfer=False)
USC = dict(work_auth="USC", needs_sponsorship=False, needs_transfer=False)


def out(text, who):
    return work_auth.ruled_out(text, **who)


@pytest.mark.parametrize("text", [
    "We do not sponsor visas for this role.", "Unable to sponsor H1B at this time.", "No visa sponsorship available.",
    "Candidates must not require sponsorship now or in the future.", "Sponsorship is not available.",
    "Must be authorized to work without the need for sponsorship.", "We don't offer sponsorship.",
])
def test_no_sponsorship_rules_out_a_candidate_who_needs_it(text):
    assert out(text, H1B) == "no_sponsorship"
    assert out(text, H1B_NO_TRANSFER) is None and out(text, GC) is None


@pytest.mark.parametrize("text", [
    "US citizens only.", "U.S. citizenship required.", "Must be a United States citizen.", "Java Developer (USC only)",
    "Active secret clearance needed.", "Security clearance is required for this position.",
])
def test_citizens_only_or_a_clearance_rules_out_everyone_but_a_citizen(text):
    for who in (H1B_NO_TRANSFER, GC, GC_EAD):
        assert out(text, who) == "citizens_only"
    assert out(text, USC) is None


@pytest.mark.parametrize("text", ["Green card holders only.", "GC required.", "USC/GC only.",
                                  "US citizens or green card holders only."])
def test_citizens_or_green_card_only_rules_out_a_gc_ead_and_a_visa_holder_but_not_a_gc(text):
    assert out(text, GC_EAD) is not None and out(text, H1B_NO_TRANSFER) is not None
    assert out(text, GC) is None and out(text, USC) is None


@pytest.mark.parametrize("text", ["No H1B transfers.", "We cannot accept H-1B transfer candidates.",
                                  "Unable to consider transfers."])
def test_no_transfers_rules_out_a_candidate_who_needs_a_transfer(text):
    assert out(text, {**H1B, "needs_sponsorship": False}) == "no_transfer"
    assert out(text, H1B_NO_TRANSFER) is None


@pytest.mark.parametrize("text", [
    "", "Build data pipelines in Python and Spark.", "We sponsor H-1B visas and welcome transfers.",
    "Open to all work authorizations; sponsorship available.", "Bonus: plus citizens only club perks",
    "Our customers include US citizens and companies worldwide.", "No C2C. W2 only.",
])
def test_a_job_that_says_nothing_against_the_candidate_is_kept(text):
    for who in (H1B, GC_EAD, GC, USC):
        assert out(text, who) is None
