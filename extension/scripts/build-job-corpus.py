"""Build a corpus of real job pages with independent ground truth from each job board's own API.

Writes corpus/<n>.html (the page as served) and corpus/<n>.json ({url, platform, truth}) where truth holds only the
facts the API states AND the page shows (a presence check on the page's HTML). Nothing here is committed."""
import html as htmllib
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"}


def get(url, data=None, as_json=True):
    body = json.dumps(data).encode() if data is not None else None
    headers = {**UA, **({"Content-Type": "application/json", "Accept": "application/json"} if data is not None else {})}
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=25) as response:
        raw = response.read().decode("utf-8", "replace")
    return json.loads(raw) if as_json else raw


def day(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc).date().isoformat()
    for fmt in ("%Y-%m-%d", "%B %d, %Y"):
        try:
            return datetime.strptime(value[:10] if fmt == "%Y-%m-%d" else value, fmt).date().isoformat()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


EMPLOYMENT = [(r"full", "Full-time"), (r"part", "Part-time"), (r"intern", "Internship"), (r"temp", "Temporary"),
              (r"contract", "Contract")]


def employment(value):
    word = str(value or "").lower().replace("_", " ").replace("-", " ")
    return next((label for pattern, label in EMPLOYMENT if re.search(pattern, word)), None)


def mode(value):
    word = str(value or "").lower()
    return "hybrid" if "hybrid" in word else "remote" if "remote" in word else "onsite" if re.search(r"on.?site|office", word) else None


def present(page, truth):
    """Keep a fact only when the page shows it."""
    # What a reader sees: the page's text and its JobPosting data, never its app scripts or styles.
    visible = re.sub(r"<script(?![^>]*ld\+json)[^>]*>.*?</script>|<style[^>]*>.*?</style>", " ", page, flags=re.S | re.I)
    text = htmllib.unescape(re.sub(r"\s+", " ", visible)).lower()
    # Facts besides the title and company count only where the job states them: the body and its JobPosting data,
    # never the head's site-wide description.
    body = htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<head.*?</head>", " ", visible, flags=re.S | re.I))).lower()
    ld = " ".join(re.findall(r"ld\+json[^>]*>(.*?)</script>", page, flags=re.S | re.I)).lower()
    digits = re.sub(r"[^0-9]", "", text)
    kept = {}
    for key, value in truth.items():
        if value in (None, ""):
            continue
        if key == "requisition_id":
            ok = bool(re.search(r"\d", str(value))) and str(value).lower() in text
        elif key in ("title", "company"):
            ok = str(value).strip().lower() in text
        elif key == "location":
            ok = str(value).split(",")[0].strip().lower() in text
        elif key == "work_mode":
            ok = {"remote": "remote", "hybrid": "hybrid", "onsite": "site"}[value] in text
        elif key == "employment_type":
            ok = bool(re.search({"Full-time": r"full[\s_-]?time", "Part-time": r"part[\s_-]?time", "Internship": r"\bintern",
                                 "Temporary": r"\btemp", "Contract": r"\bcontract"}[value], body + ld))
        elif key in ("salary_min", "salary_max"):
            ok = (f"{int(value):,}" in text or f"{int(value) // 1000}k" in text) if value >= 1000 else f"${value:g}" in text
        elif key == "posted_at":
            written = datetime.fromisoformat(value).strftime("%B %#d, %Y" if os.name == "nt" else "%B %-d, %Y").lower()
            ok = value in text or written in text
        else:
            ok = str(value).lower() in text
        if ok:
            kept[key] = value
    return kept


def save(n, platform, url, truth):
    try:
        page = get(url, as_json=False)
    except Exception as error:
        print(f"  skip {url}: {type(error).__name__}")
        return n
    truth = present(page, {k: v for k, v in truth.items()})
    if "title" not in truth:
        print(f"  skip {url}: title not on the served page (client-rendered)")
        return n
    with open(os.path.join(OUT, f"{n:02d}.html"), "w", encoding="utf-8") as f:
        f.write(page)
    with open(os.path.join(OUT, f"{n:02d}.json"), "w", encoding="utf-8") as f:
        json.dump({"url": url, "platform": platform, "truth": truth}, f, indent=1)
    print(f"  {n:02d} {platform}: {len(truth)} facts on the page")
    return n + 1


def greenhouse(n, board, count):
    name = get(f"https://boards-api.greenhouse.io/v1/boards/{board}")["name"]
    for job in get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs")["jobs"][:count]:
        detail = get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job['id']}?pay_transparency=true")
        pay = (detail.get("pay_input_ranges") or [{}])[0]
        n = save(n, "greenhouse", detail["absolute_url"], {
            "title": detail["title"], "company": name, "location": (detail.get("location") or {}).get("name"),
            "requisition_id": detail.get("requisition_id"),
            "salary_min": pay.get("min_cents", 0) / 100 or None, "salary_max": pay.get("max_cents", 0) / 100 or None,
            "salary_currency": pay.get("currency_type")})
    return n


def lever(n, company, name, count):
    for job in get(f"https://api.lever.co/v0/postings/{company}?mode=json&limit={count}"):
        pay = job.get("salaryRange") or {}
        period = {"per-year-salary": "year", "per-hour-wage": "hour", "per-month-salary": "month"}.get(pay.get("interval"))
        n = save(n, "lever", job["hostedUrl"], {
            "title": job["text"], "company": name, "location": (job.get("categories") or {}).get("location"),
            "employment_type": employment((job.get("categories") or {}).get("commitment")),
            "work_mode": mode(job.get("workplaceType")), "salary_min": pay.get("min"), "salary_max": pay.get("max"),
            "salary_currency": pay.get("currency"), "salary_period": period, "posted_at": day(job.get("createdAt"))})
    return n


def ashby(n, board, name, count):
    jobs = get(f"https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true")["jobs"]
    for job in [j for j in jobs if j.get("isListed", True)][:count]:
        component = next((c for c in ((job.get("compensation") or {}).get("summaryComponents") or [])
                          if c.get("compensationType") == "Salary"), {})
        n = save(n, "ashby", job["jobUrl"], {
            "title": job["title"], "company": name, "location": job.get("location"),
            "employment_type": employment(job.get("employmentType")), "work_mode": mode(job.get("workplaceType")),
            "salary_min": component.get("minValue"), "salary_max": component.get("maxValue"),
            "salary_currency": component.get("currencyCode"), "posted_at": day(job.get("publishedAt"))})
    return n


def workday(n, host, tenant, site, name, count):
    listed = get(f"https://{host}/wday/cxs/{tenant}/{site}/jobs", {"appliedFacets": {}, "limit": count, "offset": 0, "searchText": ""})
    for job in listed["jobPostings"][:count]:
        info = get(f"https://{host}/wday/cxs/{tenant}/{site}{job['externalPath']}")["jobPostingInfo"]
        n = save(n, "workday", f"https://{host}/en-US/{site}{job['externalPath']}", {
            "title": info["title"], "company": name, "location": info.get("location"),
            "employment_type": employment(info.get("timeType")), "work_mode": mode(info.get("remoteType")),
            "requisition_id": info.get("jobReqId"), "posted_at": day(info.get("startDate"))})
    return n


def amazon(n, count):
    for job in get(f"https://www.amazon.jobs/en/search.json?result_limit={count}&offset=0")["jobs"][:count]:
        n = save(n, "amazon", "https://www.amazon.jobs" + job["job_path"], {
            "title": job["title"], "company": "Amazon", "location": job.get("normalized_location") or job.get("location"),
            "employment_type": employment(job.get("job_schedule_type")), "requisition_id": job.get("id_icims"),
            "posted_at": day(job.get("posted_date"))})
    return n


def smartrecruiters(n, companies, count):
    for company in companies:
        listed = get(f"https://api.smartrecruiters.com/v1/companies/{company}/postings?limit={count}")
        if not listed.get("content"):
            continue
        for job in listed["content"][:count]:
            where = job.get("location") or {}
            n = save(n, "smartrecruiters", f"https://jobs.smartrecruiters.com/{company}/{job['id']}", {
                "title": job["name"], "company": (job.get("company") or {}).get("name"),
                "location": ", ".join(p for p in (where.get("city"), where.get("region")) if p),
                "employment_type": employment((job.get("typeOfEmployment") or {}).get("label")),
                "work_mode": "remote" if where.get("remote") else None, "requisition_id": job.get("refNumber"),
                "posted_at": day(job.get("releasedDate"))})
        return n
    return n


STEPS = [
    lambda n: greenhouse(n, "stripe", 2), lambda n: greenhouse(n, "airbnb", 2), lambda n: greenhouse(n, "discord", 2),
    lambda n: lever(n, "palantir", "Palantir", 3), lambda n: lever(n, "spotify", "Spotify", 2),
    lambda n: ashby(n, "openai", "OpenAI", 2), lambda n: ashby(n, "ramp", "Ramp", 2),
    lambda n: workday(n, "nvidia.wd5.myworkdayjobs.com", "nvidia", "NVIDIAExternalCareerSite", "NVIDIA", 3),
    lambda n: amazon(n, 3),
    lambda n: smartrecruiters(n, ["BoschGroup", "ServiceNow", "Visa", "IKEA"], 3),
]
n = 0
for step in STEPS:
    try:
        n = step(n)
    except Exception as error:
        print(f"  step failed: {type(error).__name__}: {str(error)[:120]}")
print(f"{n} pages")
