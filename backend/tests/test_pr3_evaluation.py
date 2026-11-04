import json
from pathlib import Path
import pytest
from backend.inbox.evaluation import score


def test_evaluation_catches_job_related_other_even_with_correct_category():
    labels=json.loads((Path(__file__).parent/'fixtures/email_classification/initial_labels.json').read_text())
    # This validates the scoring harness, NOT real model accuracy.
    predictions=[{'id':r['id'],'category':r['category'],'confidence':.95} for r in labels]
    report=score(labels,predictions)
    assert report['count']==24
    assert report['job_related_would_remove']==['other-6']
    assert not report['purge_accuracy_gate_passed_on_this_set']


def test_missing_predictions_do_not_pass_evaluation():
    with pytest.raises(ValueError):
        score([{'id':'one','category':'other','job_related':True}],[])
