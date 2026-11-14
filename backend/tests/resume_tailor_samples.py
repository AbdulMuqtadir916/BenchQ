"""Shared samples for the résumé tailor's tests: JobNavigator's test résumé and posting (tests/test_focused_v2.py)
and the five recorded step replies of its Mads tailor tests (tests/test_mads_tailor.py), with no person's name in
them; and the same résumé as a stored BenchQ version (backend/candidates/versions.py `content_of`), with ids."""

BASE = {
    "header": {"name": "Candidate", "title": "Backend Developer",
               "contact_items": [{"text": "candidate@example.com", "url": "mailto:candidate@example.com"}]},
    "summary": "Backend developer with 7+ years of experience in Python and AWS.",
    "skills": {"Languages": "Python 3.x, Java 8/11/17, SQL", "Cloud": "AWS, CloudFormation, Docker",
               "Messaging": "RabbitMQ"},
    "experience": [
        {"title": "Developer", "company": "Acme", "start": "2021-01", "end": "", "current": True, "bullets": [
            "Built REST APIs with Python on AWS for 40 internal teams.",
            "Provisioned AWS environments with CloudFormation templates.",
            "Built event-driven workers with RabbitMQ.",
        ]},
        {"title": "Junior Developer", "company": "Beta", "start": "2017-03", "end": "2020-12", "current": False,
         "bullets": ["Maintained a SQL reporting database."]},
    ],
    "projects": [{"name": "Tracker", "bullets": ["Built a tracker in Python.", "Added Docker images.",
                                                 "Wrote SQL reports.", "Deployed it on AWS."]}],
    "education": [{"degree": "BSc Computer Science", "institution": "State University"}],
    "certifications": [],
}
POSTING = ("Senior Python Engineer at Acme\n\nRequired: Python, AWS, Terraform (Infrastructure as Code), "
           "Message Broker Systems. Fluent German preferred.")

ANALYSIS = {"title": "Senior Python Engineer", "role_type": "technical", "outside_home_domain": False,
            "requirements": [{"requirement": "Python", "priority": "required", "status": "matched", "evidence": "role 1"},
                             {"requirement": "Terraform", "priority": "required", "status": "adjacent",
                              "evidence": "CloudFormation"},
                             {"requirement": "Code reviews", "priority": "duty", "status": "gap", "evidence": ""}],
            "keywords": [{"keyword": "Python", "priority": "required"}], "headline_keyword": "Python"}
DRAFT = {"header": {"location": "", "work_authorization": ""}, "headline": "Backend Developer specializing in Python",
         "profile_statement": "Backend developer with 7+ years building Python REST APIs on AWS for 40 internal teams.",
         "core_competencies": [{"label": "Python APIs", "text": "REST APIs in Python and FastAPI on AWS."},
                               {"label": "Infrastructure", "text": "CloudFormation, conceptually aligned with Terraform."}],
         "experience": [{"role_number": 1, "bullets": ["Built REST APIs with Python on AWS for 40 internal teams.",
                                                       "Provisioned AWS environments with CloudFormation templates."]},
                        {"role_number": 2, "bullets": ["Maintained a SQL reporting database."]}],
         "projects": [], "certifications": [], "awards": [], "gaps": ["Code reviews"],
         "stretch_flags": [{"bullet": "Provisioned AWS environments with CloudFormation templates.", "why": "adjacent"}]}
REVIEW = {"edits": [{"old_string": "Backend Developer specializing in Python",
                     "new_string": "Python Backend Developer specializing in AWS APIs", "reason": "keyword"},
                    {"old_string": "text the draft never had", "new_string": "anything", "reason": "style"}],
          "missed_requirements": "no issues", "reframing": "Lead the profile with the 40 teams.",
          "tone_and_style": "no issues"}
VERIFY = {"keyword_coverage": [{"keyword": "Python", "priority": "required", "status": "covered", "note": "bullets"}],
          "checklist": [{"item": "All claims match the resume", "passed": True, "note": ""}],
          "edits": [{"old_string": "Maintained a SQL reporting database.",
                     "new_string": "Maintained a SQL reporting database for the reporting team.", "reason": "keyword"}]}


def _bullets(prefix: str, texts: list) -> list:
    return [{"id": f"{prefix}-b{n}", "text": t} for n, t in enumerate(texts, start=1)]


# The BASE résumé as a stored version: its header columns, its summary and sections, every item with an id. It adds
# what BASE lacks and a stored version can hold: a job with no bullets, a certification, two awards and a language.
CONTENT = {
    "full_name": "Candidate", "title": "Backend Developer", "city": "Austin", "state": "TX", "country": "US",
    "email": "candidate@example.com", "phone": "555-0100", "work_authorization": "H-1B", "github": None,
    "linkedin": None, "summary": "Backend developer with 7+ years of experience in Python and AWS.",
    "summary_id": "summary-1",
    "skills": [{"id": f"skill-{n}", "category": category, "name": name} for n, (category, name) in enumerate([
        ("Languages", "Python 3.x"), ("Languages", "Java 8/11/17"), ("Languages", "SQL"), ("Cloud", "AWS"),
        ("Cloud", "CloudFormation"), ("Cloud", "Docker"), ("Messaging", "RabbitMQ")], start=1)],
    "experiences": [
        {"id": "job-1", "job_title": "Developer", "company": "Acme", "location": "Austin, TX",
         "dates": "Jan 2021 – Present", "start": "2021-01", "end": "", "current": True,
         "bullets": _bullets("job-1", BASE["experience"][0]["bullets"])},
        {"id": "job-2", "job_title": "Intern", "company": "Gamma", "location": "", "dates": "2016",
         "start": "", "end": "2016", "current": False, "bullets": []},
        {"id": "job-3", "job_title": "Junior Developer", "company": "Beta", "location": "",
         "dates": "Mar 2017 – Dec 2020", "start": "2017-03", "end": "2020-12", "current": False,
         "bullets": _bullets("job-3", BASE["experience"][1]["bullets"])},
    ],
    "projects": [{"id": "project-1", "name": "Tracker", "url": "", "dates": "", "technologies": "Python",
                  "bullets": _bullets("project-1", BASE["projects"][0]["bullets"])}],
    "educations": [{"id": "edu-1", "degree": "BSc Computer Science", "institution": "State University",
                    "graduation_date": "2016", "grade": ""}],
    "certifications": [{"id": "cert-1", "name": "AWS Certified Developer", "issuer": "Amazon", "date": "2022",
                        "detail": ""}],
    "awards": [{"id": "award-1", "name": "Employee of the Year", "issuer": "Acme", "date": "2023", "detail": ""},
               {"id": "award-2", "name": "Hackathon winner", "issuer": "Beta", "date": "2019", "detail": ""}],
    "languages": [{"id": "lang-1", "name": "German"}],
}
