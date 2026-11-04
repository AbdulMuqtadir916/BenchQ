"""What a work authorization means for submissions: whether the candidate needs an employer to sponsor the visa, and
whether an H-1B needs a transfer. One rule for the whole backend (decided 2026-11-04, Zuhair): a value a person entered
wins; one nobody entered is worked out from the work authorization here."""

# The frontend's NEEDS_SPONSOR (src/components/app/work-auth-chip.tsx); change both together. `OTHER` has no rule: when
# nobody entered a value it stays unknown (None), not "no" (Zuhair, 2026-11-04); the new-candidate flow could ask the
# person (a question for Abdul).
NEEDS_SPONSOR = ("H1B", "OPT", "CPT", "H4_EAD", "TN")
NEEDS_TRANSFER = ("H1B",)
NO_RULE = ("OTHER",)


def needs_sponsorship(work_auth: str) -> bool | None:
    """True or False for the nine statuses with a rule; None (unknown) for `OTHER`."""
    return None if work_auth in NO_RULE else work_auth in NEEDS_SPONSOR


def needs_transfer(work_auth: str) -> bool:
    return work_auth in NEEDS_TRANSFER
