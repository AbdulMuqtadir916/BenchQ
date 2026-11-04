"""Offline independent-label scoring. Does not call a model or enable any gate.

Usage: python -m backend.inbox.evaluation LABELS.json PREDICTIONS.json
Predictions: [{id, category, confidence}], generated with a recorded model/prompt.
The output is a local report, not evidence of provider/privacy or launch approval.
"""
import json
import math
import sys

from backend.inbox.decider_categories import CATEGORIES, CONFIDENCE_THRESHOLD


def score(labels, predictions):
    index = {row['id']: row for row in labels}
    if len(index) != len(labels):
        raise ValueError('Duplicate labels')
    output = {row['id']: row for row in predictions}
    if len(output) != len(predictions) or set(output) != set(index):
        raise ValueError('Predictions must cover every labelled ID exactly once')
    matrix = {key: {other: 0 for other in CATEGORIES} for key in CATEGORIES}
    job_removed = []
    review_count = 0
    for identity, truth in index.items():
        prediction = output[identity]
        category, confidence = prediction['category'], prediction['confidence']
        if (category not in CATEGORIES or truth['category'] not in CATEGORIES
                or type(confidence) not in (float, int) or not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise ValueError('Invalid labelled/predicted category or confidence')
        matrix[truth['category']][category] += 1
        # Current shadow removal rule: valid Other, never actual erasure during evaluation.
        if category == 'other' and confidence >= CONFIDENCE_THRESHOLD and truth['job_related']:
            job_removed.append(identity)
        if confidence < CONFIDENCE_THRESHOLD or category in {'offer', 'move_on'}:
            review_count += 1
    per_category = {}
    for category in CATEGORIES:
        correct = matrix[category][category]
        actual = sum(matrix[category].values())
        predicted = sum(matrix[key][category] for key in CATEGORIES)
        per_category[category] = {'precision': correct / predicted if predicted else None,
                                  'recall': correct / actual if actual else None,
                                  'support': actual}
    return {'count': len(index), 'job_related': sum(bool(row['job_related']) for row in labels),
            'confusion_matrix': matrix, 'per_category': per_category, 'review_count': review_count,
            'job_related_would_remove': job_removed,
            'purge_accuracy_gate_passed_on_this_set': not job_removed,
            'note': 'No runtime gate enabled; needs independently reviewed labels, versions and actual model predictions.'}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python -m backend.inbox.evaluation LABELS.json PREDICTIONS.json')
    with open(sys.argv[1]) as handle:
        labels = json.load(handle)
    with open(sys.argv[2]) as handle:
        predictions = json.load(handle)
    print(json.dumps(score(labels, predictions), indent=2))
