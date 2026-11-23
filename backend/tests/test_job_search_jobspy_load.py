"""Two sources loading python-jobspy at once (found 2026-11-17): the first search after a start asked LinkedIn and
Indeed for a city together, each loaded jobspy in its own thread, and both failed ("cannot import name 'LinkedIn' from
partially initialized module", KeyError 'jobspy'), so the click saved no LinkedIn jobs. jobspy is now loaded once,
whole, under a lock (`providers.base.load_jobspy`), and at startup.

Each check runs in a fresh Python process, where jobspy isn't loaded yet; the sources' own loaders are called from
several threads released together. Nothing searches: no network, no database."""
import subprocess
import sys

SCRIPT = r"""
import threading
from backend.job_search.providers import indeed, linkedin

assert "jobspy" not in __import__("sys").modules, "jobspy was loaded before the threads started"
loaders = [indeed._pages_class, linkedin._jobspy, lambda: indeed._jobspy_model()] * 3
gate = threading.Barrier(len(loaders))
failures = []

def run(load):
    gate.wait()
    try:
        load()
    except Exception as error:
        failures.append(type(error).__name__)

threads = [threading.Thread(target=run, args=(load,)) for load in loaders]
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()
print("FAILURES", failures)
"""


def test_sources_loading_jobspy_together_never_fail():
    for _ in range(3):                     # a race: a few fresh processes
        done = subprocess.run([sys.executable, "-c", SCRIPT], capture_output=True, text=True, timeout=120)
        assert done.returncode == 0, done.stderr[-2000:]
        assert "FAILURES []" in done.stdout, done.stdout + done.stderr[-2000:]


def test_the_app_loads_jobspy_at_startup(monkeypatch):
    """The server's first search finds it loaded (backend/main.py `lifespan`)."""
    import inspect
    from backend import main
    assert "load_jobspy()" in inspect.getsource(main.lifespan)
