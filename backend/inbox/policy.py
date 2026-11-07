"""Approved initial eligibility reasons, never a status writer.

PR 3 records review/no-op evidence. PR 4 must still enforce its independent Undo
and activation gates before executing any automatic command.
"""
import re

from backend.inbox.decider_categories import CONFIDENCE_THRESHOLD
from backend.inbox.decider import decision_value

STAGES = ('saved', 'applied', 'screening_call', 'shortlisted', 'interview_schedule_request',
          'interview_scheduled', 'assessment', 'offer')
AUTO_TARGETS = frozenset({'screening_call', 'shortlisted', 'interview_schedule_request',
                          'interview_scheduled', 'assessment'})
_REPEAT = re.compile(r'\b(?:second|third|fourth|2nd|3rd|4th|next)\s+(?:interview|round)|\bround\s*(?:2|3|4|ii|iii)\b', re.I)


def review_reason(app, message, result, body=''):
    if app is None:
        return 'UNMATCHED'
    if decision_value(result.confidence, result.probabilities, result.category) < CONFIDENCE_THRESHOLD:
        return 'LOW_CONFIDENCE'
    if result.category in {'offer', 'move_on'}:
        return 'OUTCOME_REQUIRES_REVIEW'
    if message.sender_auth_result != 'PASS':
        return 'SENDER_UNVERIFIED'
    if not message.receive_time_verified:
        return 'RECEIVE_TIME_UNVERIFIED'
    barriers = [v for v in (app.applied_at, app.last_manual_change_at, app.status_effective_at) if v]
    if any(message.received_at <= barrier for barrier in barriers):
        return 'STALE_EMAIL'
    if _REPEAT.search(body):
        return 'REPEATED_ROUND'
    if result.category == app.status:
        return 'SAME_STAGE'
    if app.status == 'incomplete_application':
        # A completion confirmation returns an incomplete application to Applied; anything else needs a person
        # (PR 4, DEBUG D-14). Every earlier check (confidence, sender, freshness, rounds) still applies.
        return 'AUTO_STATUS_DISABLED' if result.category == 'applied' else 'MANUAL_STAGE_REVIEW'
    if app.status not in STAGES:
        return 'LEGACY_OR_CLOSED_STATUS'
    if result.category not in AUTO_TARGETS:
        return 'MANUAL_STAGE_REVIEW'
    if STAGES.index(result.category) < STAGES.index(app.status):
        return 'BACKWARD_STAGE'
    return 'AUTO_STATUS_DISABLED'
