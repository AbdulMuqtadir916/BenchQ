"""A firm's work hours and the candidate's Days (decided 2026-11-17, Q152–Q174).

- **Work hours** (`firms.work_start`, `firms.work_end`, in the firm's `primary_timezone`): required, entered when the
  firm is created and changed by its OWNER; the end may be past midnight ("6:30 PM – 4:00 AM").
- **A work day** runs from one start to the next (Q161): searches run at any time, and at 6:35 PM on the 12th a
  search from 10 AM that day belongs to the work day that began on the evening of the 11th. It is named by its start's
  local date (`work_date`). The daily limits reset at the start (Q157).
- **Day 1** is the work day the candidate was assigned to their current BDE in, when that was inside the hours; else
  the next one, and anything between the assignment and that next start counts in Day 1 too (Q164, Q169). A new BDE
  starts again at Day 1 (Q154). Every calendar day counts (Q171).
- **Recorded, not recomputed** (Q170): a search stamps its `work_date` when it starts, an assignment its Day 1 date
  (`candidates.bde_day_one`), so changing the hours or the time zone later never moves past work to another Day.
  Day numbers and empty days are worked out from those dates (Q156), never stored.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Hours:
    start: time
    end: time
    zone: ZoneInfo

    def label(self) -> str:
        """ "6:30 PM – 4:00 AM"."""
        return f"{_clock(self.start)} – {_clock(self.end)}"


# The hours every firm that existed before 0031 got (Q163); also what the limits use when no firm is named (tests).
DEFAULT = Hours(time(18, 30), time(4, 0), ZoneInfo("Asia/Kolkata"))


def _clock(value: time) -> str:
    return value.strftime("%I:%M %p").lstrip("0")


def of(firm) -> Hours:
    """The firm's hours."""
    return Hours(firm.work_start, firm.work_end, ZoneInfo(firm.primary_timezone))


def for_firm(db, firm_id) -> Hours:
    """The hours of the firm with this id (DEFAULT when there is none: a test without a firm)."""
    from backend.models.tenancy import Firm
    firm = db.get(Firm, firm_id) if firm_id is not None else None
    return of(firm) if firm is not None and firm.work_start is not None else DEFAULT


def work_date(moment: datetime, hours: Hours = DEFAULT) -> date:
    """The work day `moment` falls in: the local date of the last start at or before it."""
    local = moment.astimezone(hours.zone)
    return local.date() if local.time() >= hours.start else local.date() - timedelta(days=1)


def start_of(day: date, hours: Hours = DEFAULT) -> datetime:
    """When the work day `day` starts (its local start time on that date, daylight saving included)."""
    return datetime.combine(day, hours.start, tzinfo=hours.zone)


def day_start(moment: datetime, hours: Hours = DEFAULT) -> datetime:
    return start_of(work_date(moment, hours), hours)


def next_start(moment: datetime, hours: Hours = DEFAULT) -> datetime:
    return start_of(work_date(moment, hours) + timedelta(days=1), hours)


def in_hours(moment: datetime, hours: Hours = DEFAULT) -> bool:
    """Inside start..end; across midnight when the end is earlier than the start."""
    clock = moment.astimezone(hours.zone).time()
    if hours.start < hours.end:
        return hours.start <= clock < hours.end
    return clock >= hours.start or clock < hours.end


def day_one(assigned_at: datetime, hours: Hours = DEFAULT) -> date:
    """The work date of Day 1 for an assignment at `assigned_at` (Q164): its own work day inside the hours, else the
    next one."""
    own = work_date(assigned_at, hours)
    return own if in_hours(assigned_at, hours) else own + timedelta(days=1)


def day_number(of_work_date: date, first: date) -> int:
    """The Day a work date is, counted from Day 1's work date; work before Day 1's start is Day 1 (Q169)."""
    return max((of_work_date - first).days, 0) + 1


def assign(candidate, bde_id, now: datetime, hours: Hours) -> None:
    """Record a change of BDE on the candidate (Q155): a new BDE starts Day 1 now; no BDE clears both."""
    candidate.bde_id = bde_id
    candidate.bde_assigned_at = now if bde_id is not None else None
    candidate.bde_day_one = day_one(now, hours) if bde_id is not None else None


def parse_clock(value: str) -> time:
    """ "18:30" → 18:30; ValueError for anything else."""
    hour, minute = (int(part) for part in str(value).strip().split(":"))
    return time(hour, minute)


def clock_text(value: time) -> str:
    """18:30 → "18:30" (the API's form)."""
    return value.strftime("%H:%M")


def entered_hours(start: str, end: str) -> tuple[time, time]:
    """The hours a person entered ("18:30", "04:00"), checked (Q152, Q162): both required, as HH:MM, not equal.
    ValueError with the reason to show."""
    try:
        parsed = parse_clock(start), parse_clock(end)
    except (TypeError, ValueError):
        raise ValueError("Enter the work hours' start and end as HH:MM.")
    if parsed[0] == parsed[1]:
        raise ValueError("The work hours can't start and end at the same time.")
    return parsed
