"""Bounded account locks and an exchange/revocation barrier.

Different exchanges run concurrently, as do different-account revocations.
The two groups exclude each other because identity is unknown during exchange.
Known-account activation/cleanup uses an account key, never one global mutex.
Lock order: account, then barrier; exchange releases barrier before account.
"""
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
import hashlib
from time import monotonic

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from backend.models.db import engine

_held = ContextVar('candidate_google_locks', default=frozenset())
_deadline = ContextVar('candidate_google_lock_deadline', default=None)
_phase_keys = {'entry': 104, 'exchange': 105, 'revoke': 106}


@contextmanager
def _lock(key, *, shared=False):
    identity = (key, shared)
    if identity in _held.get():
        yield
        return
    acquired = False
    with engine.connect() as conn:
        registered = False
        previous = conn.execute(text('SHOW lock_timeout')).scalar_one()
        try:
            remaining = 5000 if _deadline.get() is None else int((_deadline.get() - monotonic()) * 1000)
            if remaining <= 0:
                raise HTTPException(503, 'This Google account is busy. Try again shortly.')
            conn.execute(text("SELECT set_config('lock_timeout', :value, false)"), {'value': f'{remaining}ms'})
            conn.commit()
            suffix = '_shared' if shared else ''
            args = f'104, {_phase_keys[key]}' if key in _phase_keys else ':key'
            try:
                conn.execute(text(f'SELECT pg_advisory_lock{suffix}({args})'), {'key': key})
                conn.commit()
            except DBAPIError as exc:
                if getattr(exc.orig, 'pgcode', None) != '55P03':
                    raise
                raise HTTPException(503, 'This Google account is busy. Try again shortly.') from exc
            acquired = True
            _held.set(_held.get() | {identity})
            registered = True
            yield
        finally:
            if registered:
                # Group locks outlive their entry locks: release is deliberately
                # not LIFO, so restoring a ContextVar token would revive stale locks.
                _held.set(_held.get() - {identity})
            conn.rollback()
            if acquired:
                conn.execute(text(f'SELECT pg_advisory_unlock{suffix}({args})'), {'key': key})
            conn.execute(text("SELECT set_config('lock_timeout', :value, false)"), {'value': previous})
            conn.commit()


def account_lock(address):
    normalized = address.strip().lower()
    key = int.from_bytes(hashlib.sha256(normalized.encode()).digest()[:8], 'big', signed=True)
    return _lock(key)


@contextmanager
def _phase(group):
    if (group, True) in _held.get():
        yield
        return
    other = 'revoke' if group == 'exchange' else 'exchange'
    if (other, True) in _held.get():
        raise RuntimeError('Release exchange coordination before revocation.')
    # The entry lock is held only while switching/joining a group, never over
    # provider I/O. Taking the other group exclusively proves it is empty;
    # holding our group shared prevents the other group from entering afterward.
    deadline = _deadline.set(monotonic() + 5)
    try:
        with ExitStack() as active:
            with _lock('entry'), _lock(other):
                active.enter_context(_lock(group, shared=True))
            # Waiting is finished; the deadline does not limit provider I/O.
            _deadline.reset(deadline)
            deadline = None
            yield
    finally:
        if deadline is not None:
            _deadline.reset(deadline)


def exchange_barrier():
    return _phase('exchange')


def revoke_barrier():
    return _phase('revoke')
