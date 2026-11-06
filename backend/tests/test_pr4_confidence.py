"""PR 4 T1.2 (DEBUG D-01): two provider numbers, min decision value, disagreement routes to review."""
import pytest

from backend.inbox import classification_worker as worker
from backend.inbox.decider import Classification, decision_value, parse_response, values_disagree
from backend.inbox.decider_categories import CATEGORIES, QUESTION_KEY
from backend.models.candidates import InboxMessage
from backend.models.db import Application, ApplicationReview, EmailClassification
from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)
from backend.tests.test_pr3_pipeline import pipeline  # noqa: F401 (fixture)


def payload(category='assessment', probability=.9, confidence=.9, include_confidence=True):
    probabilities = {key: (1 - probability) / (len(CATEGORIES) - 1) for key in CATEGORIES}
    probabilities[category] = probability
    answer = {'type': 'choice', 'choice': category, 'probabilities': probabilities}
    if include_confidence:
        answer['confidence'] = confidence
    return {'answers': {QUESTION_KEY: answer}}


def two_numbers(category, probability, confidence):
    probabilities = {key: (1 - probability) / (len(CATEGORIES) - 1) for key in CATEGORIES}
    probabilities[category] = probability
    return Classification(category, confidence, probabilities, {'cost_quality': 'UNKNOWN'})


def test_live_style_gap_is_accepted_and_both_numbers_kept():
    result = parse_response(payload(probability=.9685, confidence=.9650))
    assert result.confidence == pytest.approx(.9650) and result.probabilities['assessment'] == pytest.approx(.9685)
    assert decision_value(result.confidence, result.probabilities, 'assessment') == pytest.approx(.9650)
    assert not values_disagree(result.confidence, result.probabilities, 'assessment')


def test_missing_confidence_uses_the_probability():
    result = parse_response(payload(probability=.85, include_confidence=False))
    assert result.confidence == pytest.approx(.85)


def test_large_gap_is_a_disagreement_not_a_failure():
    result = parse_response(payload(probability=.81, confidence=.99))
    assert values_disagree(result.confidence, result.probabilities, 'assessment')
    assert decision_value(result.confidence, result.probabilities, 'assessment') == pytest.approx(.81)


@pytest.mark.parametrize(('category', 'probability', 'confidence', 'reason'), [
    ('assessment', .81, .99, 'CONFIDENCE_DISAGREEMENT'),   # min 0.81 passes 0.8, but the numbers disagree
    ('other', .81, .99, 'CONFIDENCE_DISAGREEMENT'),        # disagreement wins over hiding
    ('assessment', .79, .82, 'LOW_CONFIDENCE'),            # min below 0.8
    ('assessment', .85, .83, 'AUTO_STATUS_DISABLED'),      # small gap, min 0.83 passes
])
def test_worker_routes_by_min_value_and_disagreement(test_db, pipeline, category, probability, confidence, reason):
    app_id, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: two_numbers(category, probability, confidence))
    test_db.expire_all()
    record = test_db.query(EmailClassification).one()
    assert record.reason == reason and record.outcome == 'REVIEW'
    assert record.confidence == pytest.approx(confidence) and record.probabilities[category] == pytest.approx(probability)
    assert test_db.get(InboxMessage, message_id).hidden_at is None
    assert test_db.query(ApplicationReview).one().reason == reason
    assert test_db.get(Application, app_id).status == 'applied'


def test_confident_other_without_disagreement_is_still_hidden(test_db, pipeline):
    _, _, message_id = pipeline
    assert worker.process_one(message_id, provider=lambda *a: two_numbers('other', .95, .93))
    test_db.expire_all()
    assert test_db.get(InboxMessage, message_id).hidden_at is not None
    assert test_db.query(EmailClassification).one().reason == 'OTHER'
