"""
Execute generated pytest, Selenium, and Playwright Python tests.
- Injects a conftest.py that screenshots the browser on pass AND fail.
- Extracts TEST_DATA dict from test code and stores with result.
- Captures negative-scenario error messages from assertion output.
- Encodes screenshots as base64 so the frontend can display them inline.
"""
import asyncio
import os
import re
import ast
import sys
import json
import base64
import tempfile
import time
import subprocess
import signal
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Any
from urllib.parse import quote

from models.schemas import GeneratedTest, TestResult, ExecutionJob, JobStatus
from services import storage

# Persistent dir for screenshots (served via frontend)
SCREENSHOTS_DIR = Path(__file__).parent.parent / "data" / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

# How many tests to execute at once (each spawns its own pytest subprocess).
_MAX_CONCURRENCY = int(os.getenv("QA_TEST_CONCURRENCY", "4"))

# ── Conftest injected into every test run ─────────────────────────────────────
CONFTEST_PY = r'''
"""Auto-injected conftest — screenshot on pass AND fail, test-data capture."""
import pytest, os, json, sys, time, uuid
from pathlib import Path

SHOT_DIR = os.environ.get("QA_SHOT_DIR", "")
RUN_ID = os.environ.get("QA_RUN_ID", "") or uuid.uuid4().hex[:12]
BROWSER_LOG_DIR = os.environ.get("QA_BROWSER_LOG_DIR", "")
DEBUG_BROWSER = os.environ.get("QA_BROWSER_DEBUG", "").lower() in ("1", "true", "yes")
_ORIGINAL_CHROME = None
_ORIGINAL_WAIT = None
_ORIGINAL_WEBELEMENT_CLICK = None
_CREATED_DRIVERS = []
_CURRENT_ITEM = None
_SHOT_COUNTERS = {}


def _track_driver(driver):
    _configure_driver(driver)
    _attach_current_item(driver)
    _instrument_selenium_driver(driver)
    _CREATED_DRIVERS.append(driver)
    return driver


def _debug(message):
    if DEBUG_BROWSER:
        print(f"[qa-browser] {message}", file=sys.stderr, flush=True)


def _int_env(name, default):
    try:
        return int(os.environ.get(name, str(default)))
    except Exception:
        return default


def _float_env(name, default):
    try:
        return float(os.environ.get(name, str(default)))
    except Exception:
        return default


def _configure_driver(driver):
    page_timeout = _float_env("QA_PAGE_LOAD_TIMEOUT_SECONDS", 12)
    script_timeout = _float_env("QA_SCRIPT_TIMEOUT_SECONDS", 8)
    try:
        driver.set_page_load_timeout(page_timeout)
    except Exception:
        pass
    try:
        driver.set_script_timeout(script_timeout)
    except Exception:
        pass


def _attach_current_item(driver, item=None):
    item = item or _CURRENT_ITEM
    if item is None:
        return
    try:
        setattr(driver, "_qa_current_item", item)
    except Exception:
        pass


def _item_for_driver(driver):
    try:
        item = getattr(driver, "_qa_current_item", None)
        if item is not None:
            return item
    except Exception:
        pass
    return _CURRENT_ITEM


def _sanitize(value):
    import re
    return re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")[:96] or "state"


def _next_step(item):
    key = getattr(item, "nodeid", "test")
    current = _SHOT_COUNTERS.get(key, 0) + 1
    _SHOT_COUNTERS[key] = current
    return current


def _element_label(element):
    try:
        text = (element.text or "").strip()
    except Exception:
        text = ""
    bits = []
    try:
        tag = element.tag_name
        if tag:
            bits.append(tag)
    except Exception:
        pass
    for attr in ("id", "name", "type", "aria-label", "placeholder"):
        try:
            value = element.get_attribute(attr)
            if value:
                bits.append(value)
                break
        except Exception:
            pass
    if text:
        bits.append(text[:36])
    return _sanitize("_".join(bits) or "element")


def _script_changes_page(script):
    text = str(script or "").lower()
    return any(token in text for token in (
        ".click", "click()", "submit", "location", "history.",
        "dispatchevent", "scrollinto", "value =",
    ))


def _patch_selenium_element_click():
    global _ORIGINAL_WEBELEMENT_CLICK
    if _ORIGINAL_WEBELEMENT_CLICK is not None:
        return
    try:
        from selenium.webdriver.remote.webelement import WebElement
    except Exception:
        return

    _ORIGINAL_WEBELEMENT_CLICK = WebElement.click

    def _click_with_screenshots(self, *args, **kwargs):
        driver = getattr(self, "parent", None) or getattr(self, "_parent", None)
        item = _item_for_driver(driver)
        action = f"click_{_element_label(self)}"
        if driver is not None and item is not None:
            _shot(driver, item, "BEFORE", phase="before", action=action)
        result = _ORIGINAL_WEBELEMENT_CLICK(self, *args, **kwargs)
        if driver is not None and item is not None:
            time.sleep(0.2)
            _shot(driver, item, "AFTER", phase="after", action=action)
        return result

    WebElement.click = _click_with_screenshots


def _instrument_selenium_driver(driver):
    if driver is None:
        return driver
    try:
        if getattr(driver, "_qa_instrumented", False):
            return driver
        setattr(driver, "_qa_instrumented", True)
    except Exception:
        return driver

    _patch_selenium_element_click()
    original_get = getattr(driver, "get", None)
    original_execute_script = getattr(driver, "execute_script", None)

    if original_get:
        def _get_with_screenshots(url, *args, **kwargs):
            item = _item_for_driver(driver)
            if item is not None:
                _shot(driver, item, "BEFORE", phase="before", action="navigate")
            result = original_get(url, *args, **kwargs)
            if item is not None:
                time.sleep(0.3)
                _shot(driver, item, "AFTER", phase="after", action="navigate")
            return result
        try:
            driver.get = _get_with_screenshots
        except Exception:
            pass

    if original_execute_script:
        def _execute_script_with_screenshots(script, *args, **kwargs):
            item = _item_for_driver(driver)
            should_capture = _script_changes_page(script)
            if should_capture and item is not None:
                _shot(driver, item, "BEFORE", phase="before", action="script_change")
            result = original_execute_script(script, *args, **kwargs)
            if should_capture and item is not None:
                time.sleep(0.2)
                _shot(driver, item, "AFTER", phase="after", action="script_change")
            return result
        try:
            driver.execute_script = _execute_script_with_screenshots
        except Exception:
            pass
    return driver


def _instrument_playwright_page(page, item):
    if page is None:
        return page
    try:
        setattr(page, "_qa_current_item", item)
        if getattr(page, "_qa_instrumented", False):
            return page
        setattr(page, "_qa_instrumented", True)
    except Exception:
        return page

    def _wrap(name, action, settle=0.2):
        original = getattr(page, name, None)
        if original is None:
            return

        def _wrapped(*args, **kwargs):
            _shot(page, item, "BEFORE", phase="before", action=action)
            result = original(*args, **kwargs)
            time.sleep(settle)
            _shot(page, item, "AFTER", phase="after", action=action)
            return result

        try:
            setattr(page, name, _wrapped)
        except Exception:
            pass

    _wrap("goto", "navigate", 0.3)
    _wrap("click", "click", 0.2)
    _wrap("fill", "fill", 0.1)
    _wrap("press", "press", 0.1)
    return page


def _driver_log_path(name):
    if BROWSER_LOG_DIR:
        try:
            Path(BROWSER_LOG_DIR).mkdir(parents=True, exist_ok=True)
            return str(Path(BROWSER_LOG_DIR) / name)
        except Exception:
            pass
    import subprocess
    return subprocess.DEVNULL


def _chrome_startup_args():
    return (
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1366,768",
        "--remote-debugging-port=0",
        "--log-level=3",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-search-engine-choice-screen",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-client-side-phishing-detection",
        "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
        "--proxy-server=direct://",
        "--proxy-bypass-list=*",
        "--remote-allow-origins=*",
    )


def _playwright_startup_args():
    return (
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-extensions",
        "--proxy-server=direct://",
        "--proxy-bypass-list=*",
    )


def _patch_webdriver_wait():
    """Clamp generated WebDriverWait(driver, 10) calls so bad selectors fail fast."""
    global _ORIGINAL_WAIT
    if _ORIGINAL_WAIT is not None:
        return
    try:
        import selenium.webdriver.support.wait as wait_mod
        import selenium.webdriver.support.ui as ui_mod
    except Exception:
        return

    _ORIGINAL_WAIT = wait_mod.WebDriverWait

    class FastWebDriverWait(_ORIGINAL_WAIT):
        def __init__(self, driver, timeout, poll_frequency=0.5, ignored_exceptions=None):
            wait_cap = _float_env("QA_UI_WAIT_SECONDS", 4)
            try:
                timeout = min(float(timeout), wait_cap)
            except Exception:
                timeout = wait_cap
            try:
                poll_frequency = min(float(poll_frequency or 0.5), 0.2)
            except Exception:
                poll_frequency = 0.2
            super().__init__(driver, timeout, poll_frequency, ignored_exceptions)

    wait_mod.WebDriverWait = FastWebDriverWait
    ui_mod.WebDriverWait = FastWebDriverWait


def _patch_webdriver_chrome():
    """Make generated webdriver.Chrome() calls honor local driver config."""
    global _ORIGINAL_CHROME
    if _ORIGINAL_CHROME is not None:
        return

    try:
        import subprocess
        import tempfile
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
    except Exception:
        return

    _ORIGINAL_CHROME = webdriver.Chrome

    def _prepare_options(options):
        if options is None:
            options = Options()
        chrome_binary = (
            os.environ.get("QA_CHROME_BINARY", "")
            or os.environ.get("CHROME_BINARY_PATH", "")
            or os.environ.get("CHROME_BINARY", "")
        )
        if chrome_binary and os.path.exists(chrome_binary):
            options.binary_location = chrome_binary
        try:
            options.page_load_strategy = os.environ.get("QA_PAGE_LOAD_STRATEGY", "eager")
        except Exception:
            pass
        args = getattr(options, "arguments", []) or []
        if not any(str(a).startswith("--user-data-dir=") for a in args):
            options.add_argument(f"--user-data-dir={tempfile.mkdtemp(prefix='qa-chrome-')}")
        if not any(str(a).startswith("--remote-debugging-port=") for a in args):
            options.add_argument("--remote-debugging-port=0")
        for a in _chrome_startup_args():
            if not any(str(existing) == a or str(existing).startswith(a.split("=")[0] + "=") for existing in args):
                options.add_argument(a)
        return options

    def _chrome_with_config(*args, **kwargs):
        driver_url = os.environ.get("QA_CHROMEDRIVER_URL", "") or os.environ.get("CHROMEDRIVER_URL", "")
        driver_path = os.environ.get("QA_CHROMEDRIVER", "")
        kwargs["options"] = _prepare_options(kwargs.get("options"))

        if driver_url and "command_executor" not in kwargs:
            options = kwargs.pop("options", None)
            return _track_driver(webdriver.Remote(command_executor=driver_url, options=options, **kwargs))

        if driver_path and os.path.exists(driver_path):
            kwargs["service"] = Service(executable_path=driver_path, log_output=_driver_log_path("chromedriver_patched.log"))

        return _track_driver(_ORIGINAL_CHROME(*args, **kwargs))

    webdriver.Chrome = _chrome_with_config


def pytest_configure(config):
    _patch_webdriver_wait()
    _patch_webdriver_chrome()


def pytest_runtest_setup(item):
    global _CURRENT_ITEM
    _CURRENT_ITEM = item


def pytest_runtest_teardown(item, nextitem):
    global _CURRENT_ITEM
    _CURRENT_ITEM = None


def pytest_sessionfinish(session, exitstatus):
    for d in list(_CREATED_DRIVERS):
        try:
            d.quit()
        except Exception:
            pass


@pytest.fixture(scope="function")
def driver(request):
    """Headless Chrome fixture; skips gracefully if ChromeDriver missing."""
    import subprocess, tempfile
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    opts = Options()
    for a in _chrome_startup_args():
        opts.add_argument(a)
    opts.add_argument(f"--user-data-dir={tempfile.mkdtemp(prefix='qa-chrome-')}")
    # Silence Chrome's own console chatter (DevTools/USB/GCM warnings).
    opts.add_experimental_option("excludeSwitches", ["enable-logging"])
    chrome_binary = (
        os.environ.get("QA_CHROME_BINARY", "")
        or os.environ.get("CHROME_BINARY_PATH", "")
        or os.environ.get("CHROME_BINARY", "")
    )
    if chrome_binary and os.path.exists(chrome_binary):
        opts.binary_location = chrome_binary
    try:
        opts.page_load_strategy = os.environ.get("QA_PAGE_LOAD_STRATEGY", "eager")
    except Exception:
        pass

    driver_path = os.environ.get("QA_CHROMEDRIVER", "")

    def _launch(use_explicit):
        # Suppress the "Starting ChromeDriver ..." banner via DEVNULL.
        if use_explicit and driver_path and os.path.exists(driver_path):
            svc = Service(executable_path=driver_path, log_output=_driver_log_path("chromedriver_fixture.log"))
        else:
            svc = Service(log_output=_driver_log_path("chromedriver_fixture.log"))  # Selenium Manager auto-resolves
        return webdriver.Chrome(options=opts, service=svc)

    d = None
    try:
        try:
            _debug("selenium launching chrome")
            # Prefer the explicit chromedriver.exe (QA_CHROMEDRIVER) when provided.
            d = _launch(True)
            _debug("selenium chrome launched")
        except Exception as first:
            # Explicit driver failed (commonly a Chrome/driver VERSION MISMATCH).
            # Fall back to Selenium Manager so the right driver is fetched.
            if driver_path:
                try:
                    d = _launch(False)
                except Exception as second:
                    pytest.skip(
                        f"ChromeDriver unavailable. Explicit driver failed ({str(first)[:120]}); "
                        f"auto-resolve also failed ({str(second)[:120]}). "
                        "Install a chromedriver matching your Chrome version."
                    )
            else:
                pytest.skip(f"ChromeDriver not available: {str(first)[:160]}")
        d.implicitly_wait(0)
        _configure_driver(d)
        _attach_current_item(d, request.node)
        _instrument_selenium_driver(d)
        if SHOT_DIR:
            _shot(d, request.node, "START", phase="before", action="test_start")
        yield d
        # Screenshot the final state of the APP UNDER TEST on success.
        # request.node is the test item (has .nodeid / .user_properties).
        if SHOT_DIR:
            _shot(d, request.node, "PASS", phase="final", action="test_pass")
    finally:
        if d is not None:
            try:
                d.quit()
            except Exception:
                pass
            try:
                _CREATED_DRIVERS.remove(d)
            except ValueError:
                pass


@pytest.fixture(scope="function")
def page(request):
    """Headless Playwright page fixture for generated Python UI tests."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        pytest.skip(
            "Playwright is not installed in the backend environment. "
            "Run pip install playwright and python -m playwright install chromium, "
            f"then restart the backend. ({str(exc)[:120]})"
        )

    timeout_ms = int(_float_env("QA_UI_WAIT_SECONDS", 4) * 1000)
    navigation_timeout_ms = int(_float_env("QA_PAGE_LOAD_TIMEOUT_SECONDS", 12) * 1000)
    chrome_binary = (
        os.environ.get("QA_CHROME_BINARY", "")
        or os.environ.get("CHROME_BINARY_PATH", "")
        or os.environ.get("CHROME_BINARY", "")
    )
    launch_kwargs = {
        "headless": True,
        "args": list(_playwright_startup_args()),
    }
    if chrome_binary and os.path.exists(chrome_binary):
        launch_kwargs["executable_path"] = chrome_binary

    pw = browser = context = pg = None
    try:
        _debug("playwright starting")
        pw = sync_playwright().start()
        _debug("playwright started")
        _debug("playwright launching chromium")
        browser = pw.chromium.launch(**launch_kwargs)
        _debug("playwright chromium launched")
        context = browser.new_context(viewport={"width": 1366, "height": 768})
        _debug("playwright context created")
        context.set_default_timeout(timeout_ms)
        context.set_default_navigation_timeout(navigation_timeout_ms)
        pg = context.new_page()
        _instrument_playwright_page(pg, request.node)
        _debug("playwright page created")
        if SHOT_DIR:
            _shot(pg, request.node, "START", phase="before", action="test_start")
        yield pg
        if SHOT_DIR:
            _shot(pg, request.node, "PASS", phase="final", action="test_pass")
    finally:
        for obj in (context, browser):
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
        if pw is not None:
            try:
                pw.stop()
            except Exception:
                pass


def _find_driver(item):
    for name in ("driver", "browser", "page"):
        d = item.funcargs.get(name)
        if hasattr(d, "save_screenshot") or hasattr(d, "screenshot"):
            return d
    for d in item.funcargs.values():
        if hasattr(d, "save_screenshot") or hasattr(d, "screenshot"):
            return d
    return None


def _shot(driver, item, tag: str, report=None, phase="", action=""):
    if not SHOT_DIR or driver is None or item is None:
        return
    max_shots = _int_env("QA_MAX_SCREENSHOTS_PER_TEST", 28)
    step = _next_step(item)
    if step > max_shots:
        return
    safe = (item.nodeid
            .replace("::", "__").replace("/", "_")
            .replace(".", "_").replace("[", "_").replace("]", "_"))
    tag = _sanitize(tag).upper()
    action = _sanitize(action or tag.lower())
    path = os.path.join(SHOT_DIR, f"{RUN_ID}__{safe}__shot{step:03d}_{tag}_{action}.png")
    meta = {
        "path": path,
        "file": os.path.basename(path),
        "run_id": RUN_ID,
        "step": step,
        "tag": tag,
        "phase": phase or tag.lower(),
        "action": action,
    }
    try:
        if hasattr(driver, "save_screenshot"):
            driver.save_screenshot(path)
        else:
            driver.screenshot(path=path, full_page=True)
        item.user_properties.append(("screenshot", path))
        item.user_properties.append(("screenshot_meta", json.dumps(meta)))
        if report is not None:
            report.user_properties.append(("screenshot", path))
            report.user_properties.append(("screenshot_meta", json.dumps(meta)))
    except Exception:
        pass


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call" and SHOT_DIR:
        d = _find_driver(item)
        if d and (rep.failed or rep.passed):
            _shot(d, item, "FAIL" if rep.failed else "PASS", rep, phase="final", action="test_fail" if rep.failed else "test_pass")
'''

# ── JSON results collector ────────────────────────────────────────────────────
JSON_PLUGIN_PY = r'''
import json, pytest

class _Collector:
    def __init__(self):
        self.rows = []

    def pytest_runtest_logreport(self, report):
        if report.when != "call":
            return
        shots, shot_meta, tdata = [], [], {}
        for k, v in report.user_properties:
            if k == "screenshot":
                if v not in shots:
                    shots.append(v)
            elif k == "screenshot_meta":
                try:
                    meta = json.loads(v)
                    if isinstance(meta, dict) and meta.get("path") not in {m.get("path") for m in shot_meta if isinstance(m, dict)}:
                        shot_meta.append(meta)
                except Exception:
                    pass
            elif k == "test_data":
                try:
                    tdata = json.loads(v)
                except Exception:
                    tdata = {"raw": str(v)}
        self.rows.append({
            "nodeid": report.nodeid,
            "status": "passed" if report.passed else "failed" if report.failed else "skipped",
            "duration": getattr(report, "duration", 0),
            "longrepr": str(report.longrepr) if report.longrepr else "",
            "capstdout": report.capstdout or "",
            "capstderr": report.capstderr or "",
            "screenshots": shots,
            "screenshot_meta": shot_meta,
            "test_data": tdata,
        })

    def dump(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.rows, f, indent=2, default=str, ensure_ascii=False)


_PLUGIN = _Collector()

def pytest_configure(config):
    config.pluginmanager.register(_PLUGIN, "_json_collector")

def pytest_sessionfinish(session, exitstatus):
    out = os.environ.get("QA_JSON_OUT", "")
    if out:
        _PLUGIN.dump(out)
    if os.environ.get("QA_FORCE_EXIT_AFTER_PYTEST", "").lower() in ("1", "true", "yes"):
        code = getattr(exitstatus, "value", exitstatus)
        try:
            code = int(code)
        except Exception:
            code = 0
        os._exit(code)

import os
'''


async def run_tests(job_id: str, tests: List[GeneratedTest]):
    storage.update_execution_job(job_id, {
        "status": JobStatus.RUNNING.value,
        "started_at": _now(),
    })
    # Run tests concurrently (bounded) so a queue of 20 doesn't take 10 minutes.
    # Each test already runs pytest in its own worker thread via _run_test.
    results = []
    sem = asyncio.Semaphore(_MAX_CONCURRENCY)

    async def _guarded(t: GeneratedTest):
        async with sem:
            return await _run_single(t)

    tasks = [asyncio.create_task(_guarded(t)) for t in tests]
    for done in asyncio.as_completed(tasks):
        r = await done
        results.append(r.model_dump())
        # Persist a copy after each completion so the UI can poll live progress.
        storage.update_execution_job(job_id, {"results": list(results)})

    passed = sum(1 for r in results if r["status"] == "passed")
    failed = sum(1 for r in results if r["status"] == "failed")
    errors  = sum(1 for r in results if r["status"] == "error")
    storage.update_execution_job(job_id, {
        "status": JobStatus.COMPLETED.value,
        "completed_at": _now(),
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "total": len(results),
    })


async def _run_single(test: GeneratedTest) -> TestResult:
    is_browser = test.test_type.value in ("selenium", "playwright") or test.category == "ui"
    return await _run_test(test, is_browser=is_browser)


def _read_bytes(path: str) -> bytes:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return b""


def _terminate_process_tree(pid: int) -> None:
    if not pid:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        pass
    time.sleep(0.5)
    try:
        os.killpg(pid, signal.SIGKILL)
    except Exception:
        pass


async def _run_test(test: GeneratedTest, is_browser: bool) -> TestResult:
    start = time.time()
    test_data = _extract_test_data(test.code)
    shot_dir = str(SCREENSHOTS_DIR)
    run_id = f"{_safe(test.id)[:8]}_{uuid.uuid4().hex[:8]}"
    language_error = _unsupported_language_reason(test)
    if language_error:
        return TestResult(
            test_id=test.id,
            test_name=test.name,
            status="error",
            category=test.category,
            duration_ms=(time.time() - start) * 1000,
            actual_output=test.code[:3000],
            error_message=language_error,
            test_data=test_data,
        )

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        json_out = os.path.join(tmp, "results.json")

        # Write files — always UTF-8. On Windows the default is cp1252, which
        # corrupts non-ASCII (e.g. the em-dash in conftest, or smart quotes the
        # LLM emits in test code) and makes pytest fail to import the file.
        with open(os.path.join(tmp, "conftest.py"), "w", encoding="utf-8") as f:
            f.write(CONFTEST_PY)
        with open(os.path.join(tmp, "json_plugin.py"), "w", encoding="utf-8") as f:
            f.write(JSON_PLUGIN_PY)

        test_file = os.path.join(tmp, f"test_{_safe(test.name)}.py")
        with open(test_file, "w", encoding="utf-8") as f:
            f.write(_prepare_runtime_code(test))

        forced_driver = (
            os.getenv("CHROMEDRIVER_PATH", "")
            if os.getenv("QA_FORCE_CHROMEDRIVER", "").lower() in ("1", "true", "yes")
            else ""
        )
        chrome_binary = os.getenv("CHROME_BINARY_PATH", "") or os.getenv("CHROME_BINARY", "")
        env = {
            **os.environ,
            **{str(k): str(v) for k, v in (test.editable_data or {}).items()},
            "QA_SHOT_DIR": shot_dir,
            "QA_RUN_ID": run_id,
            "QA_MAX_SCREENSHOTS_PER_TEST": os.getenv("QA_MAX_SCREENSHOTS_PER_TEST", "28"),
            "QA_JSON_OUT": json_out,
            "QA_BROWSER_LOG_DIR": tmp,
            # Prefer Selenium Manager by default so Chrome/ChromeDriver versions
            # stay aligned. Set QA_FORCE_CHROMEDRIVER=1 to force .env's
            # CHROMEDRIVER_PATH when a pinned driver is required.
            "QA_CHROMEDRIVER": forced_driver,
            "CHROMEDRIVER_PATH": forced_driver,
            "QA_CHROME_BINARY": chrome_binary,
            "CHROME_BINARY_PATH": chrome_binary,
            "QA_UI_WAIT_SECONDS": os.getenv("QA_UI_WAIT_SECONDS", "4"),
            "QA_PAGE_LOAD_TIMEOUT_SECONDS": os.getenv("QA_PAGE_LOAD_TIMEOUT_SECONDS", "12"),
            "QA_SCRIPT_TIMEOUT_SECONDS": os.getenv("QA_SCRIPT_TIMEOUT_SECONDS", "8"),
            "QA_PAGE_LOAD_STRATEGY": os.getenv("QA_PAGE_LOAD_STRATEGY", "eager"),
            # Optional running chromedriver server, e.g. http://127.0.0.1:50167
            "QA_CHROMEDRIVER_URL": os.getenv("QA_CHROMEDRIVER_URL", "") or os.getenv("CHROMEDRIVER_URL", ""),
            # Playwright on some Windows/Python combinations can leave driver
            # threads alive after tests finish. Each generated test runs in an
            # isolated subprocess, so force-exit after the JSON plugin flushes.
            "QA_FORCE_EXIT_AFTER_PYTEST": "1" if is_browser else "",
            # Force UTF-8 inside the test subprocess so file reads/writes and
            # stdout in the generated tests don't hit cp1252 decode errors.
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        timeout = (
            int(os.getenv("QA_BROWSER_TIMEOUT_SECONDS", os.getenv("QA_SELENIUM_TIMEOUT_SECONDS", "60")))
            if is_browser else
            int(os.getenv("QA_PYTEST_TIMEOUT_SECONDS", "90"))
        )

        # Run pytest in a worker thread with a *synchronous* subprocess. asyncio's
        # create_subprocess_exec raises NotImplementedError on Windows unless the
        # running loop is a ProactorEventLoop — uvicorn's loop often isn't, which
        # made every test error out. subprocess.run works on any platform/loop.
        cmd = [
            sys.executable, "-m", "pytest", test_file,
            "-v", "--tb=long", "--no-header", "-p", "no:warnings",
            "-p", "json_plugin",
            "-o", "asyncio_mode=auto",  # run `async def test_*` even without @pytest.mark.asyncio
            f"--rootdir={tmp}",
        ]
        if os.getenv("QA_BROWSER_DEBUG", "").lower() in ("1", "true", "yes"):
            cmd.insert(5, "-s")

        stdout_path = os.path.join(tmp, "pytest.stdout.log")
        stderr_path = os.path.join(tmp, "pytest.stderr.log")

        def _run_pytest():
            popen_kwargs = {
                "cwd": tmp,
                "env": env,
                "stdout": None,
                "stderr": None,
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            else:
                popen_kwargs["start_new_session"] = True

            with open(stdout_path, "wb") as stdout_file, open(stderr_path, "wb") as stderr_file:
                popen_kwargs["stdout"] = stdout_file
                popen_kwargs["stderr"] = stderr_file
                proc = subprocess.Popen(cmd, **popen_kwargs)
                try:
                    returncode = proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    _terminate_process_tree(proc.pid)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5)
                    raise

            return subprocess.CompletedProcess(
                cmd,
                returncode,
                stdout=_read_bytes(stdout_path),
                stderr=_read_bytes(stderr_path),
            )

        try:
            completed = await asyncio.to_thread(_run_pytest)
            raw = (completed.stdout + completed.stderr).decode("utf-8", errors="replace")
            duration = (time.time() - start) * 1000

            rows = _read_json(json_out)
            screenshots = _all_screenshots(rows, test.name, run_id)
            screenshot = _best_screenshot(screenshots)
            steps = _parse_steps(raw)
            neg_errors = _neg_errors(raw)

            status, error_message = _resolve_status(rows, raw, completed.returncode)
            return TestResult(
                test_id=test.id, test_name=test.name, status=status,
                category=test.category,
                duration_ms=duration, actual_output=raw[-3000:],
                error_message=error_message,
                screenshot_b64=screenshot.get("b64"),
                screenshot_path=screenshot.get("path"),
                screenshot_url=screenshot.get("url"),
                screenshot_file=screenshot.get("file"),
                screenshots=screenshots,
                test_data=test_data,
                steps_log=steps,
                negative_errors=neg_errors if status in ("failed", "error") else [],
            )

        except subprocess.TimeoutExpired:
            raw = (
                _read_bytes(stdout_path)
                + _read_bytes(stderr_path)
                + _browser_log_bytes(tmp)
            ).decode("utf-8", errors="replace")
            rows = _read_json(json_out)
            screenshots = _all_screenshots(rows, test.name, run_id)
            screenshot = _best_screenshot(screenshots)
            return TestResult(
                test_id=test.id, test_name=test.name, status="error",
                category=test.category,
                duration_ms=(time.time() - start) * 1000,
                actual_output=raw[-3000:] if raw else None,
                error_message=f"Timed out after {timeout}s",
                screenshot_b64=screenshot.get("b64"),
                screenshot_path=screenshot.get("path"),
                screenshot_url=screenshot.get("url"),
                screenshot_file=screenshot.get("file"),
                screenshots=screenshots,
                test_data=test_data,
            )
        except Exception as exc:
            return TestResult(
                test_id=test.id, test_name=test.name, status="error",
                category=test.category,
                duration_ms=(time.time() - start) * 1000,
                error_message=str(exc) or f"{type(exc).__name__} (no message)",
                test_data=test_data,
            )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def _looks_like_javascript_test(code: str, file_name: str = "") -> bool:
    text = (code or "").lstrip()
    file_lower = (file_name or "").lower()
    if file_lower.endswith((".js", ".jsx", ".ts", ".tsx")):
        return True
    return any(marker in text for marker in (
        "require('@playwright/test')",
        'require("@playwright/test")',
        "from '@playwright/test'",
        'from "@playwright/test"',
        "const { test, expect }",
        "test.describe(",
        "async ({ page })",
        "module.exports",
    )) or text.startswith("//")


def _unsupported_language_reason(test: GeneratedTest) -> Optional[str]:
    if _looks_like_javascript_test(test.code, test.file_name):
        return (
            "This generated test is JavaScript/TypeScript Playwright, but the backend runner executes "
            "Python pytest files. Regenerate this UI test as Python Playwright with test_type='playwright' "
            "and code using `from playwright.sync_api import expect` plus the injected `page` fixture."
        )
    return None


def _prepare_runtime_code(test: GeneratedTest) -> str:
    code = test.code or ""
    if test.test_type.value == "selenium" or test.category == "ui":
        code = _harden_generated_selenium_helpers(code)
    return code


def _harden_generated_selenium_helpers(code: str) -> str:
    """Patch common fragile Selenium snippets produced by LLMs."""
    code = code.replace(
        "Select(control).select_by_value(value)",
        (
            "select = Select(control)\n"
            "        try:\n"
            "            select.select_by_value(str(value))\n"
            "        except Exception:\n"
            "            select.select_by_visible_text(str(value))"
        ),
    )
    code = code.replace(
        "    elif control.get_attribute(\"type\") == \"checkbox\":\n"
        "        if value and not control.is_selected():\n"
        "            js_click(driver, control)\n"
        "    else:\n"
        "        control.clear()\n"
        "        control.send_keys(value)\n",
        "    elif control.get_attribute(\"type\") == \"checkbox\":\n"
        "        if value and not control.is_selected():\n"
        "            js_click(driver, control)\n"
        "    elif control.get_attribute(\"type\") == \"radio\":\n"
        "        radio = driver.find_element(By.CSS_SELECTOR, f\"#{panel_id} form [name='{name}'][value='{value}']\")\n"
        "        js_click(driver, radio)\n"
        "    elif control.get_attribute(\"type\") in (\"date\", \"month\", \"color\"):\n"
        "        driver.execute_script(\"arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input', {bubbles: true})); arguments[0].dispatchEvent(new Event('change', {bubbles: true}));\", control, str(value))\n"
        "    else:\n"
        "        control.clear()\n"
        "        control.send_keys(str(value))\n",
    )
    return code


def _extract_test_data(code: str) -> Dict[str, Any]:
    """Pull TEST_DATA = {...} from the top of the test file."""
    m = re.search(r"^TEST_DATA\s*=\s*(\{.*?\})\s*$", code, re.MULTILINE | re.DOTALL)
    if m:
        try:
            return ast.literal_eval(m.group(1))
        except Exception:
            pass
    return {}


def _read_json(path: str) -> list:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _browser_log_bytes(tmp: str) -> bytes:
    chunks: list[bytes] = []
    try:
        for p in Path(tmp).glob("chromedriver_*.log"):
            data = _read_bytes(str(p))
            if data:
                chunks.append(f"\n\n===== {p.name} =====\n".encode("utf-8"))
                chunks.append(data[-6000:])
    except Exception:
        pass
    return b"".join(chunks)


def list_saved_screenshots() -> List[Dict[str, Any]]:
    """Return saved screenshot PNGs newest-first for UI display."""
    screenshots: List[Dict[str, Any]] = []
    try:
        paths = sorted(
            SCREENSHOTS_DIR.glob("*.png"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except Exception:
        return screenshots

    for path in paths:
        meta = _screenshot_meta(str(path))
        if meta:
            screenshots.append(meta)
    return screenshots


def _screenshot_status(stem: str) -> str:
    upper = stem.upper()
    if "_FAIL" in upper:
        return "failed"
    if "_PASS" in upper:
        return "passed"
    return "unknown"


def _parse_screenshot_name(filename: str) -> Dict[str, Any]:
    stem = Path(filename).stem
    status = _screenshot_status(stem)
    run_id = ""
    test_node = stem
    step = None
    tag = ""
    action = ""

    if "__shot" in stem:
        prefix, suffix = stem.rsplit("__shot", 1)
        if "__" in prefix:
            run_id, test_node = prefix.split("__", 1)
        else:
            test_node = prefix
        m = re.match(r"(\d+)_([A-Z]+)(?:_(.*))?$", suffix)
        if m:
            step = int(m.group(1))
            tag = m.group(2)
            action = m.group(3) or ""
    else:
        if status != "unknown":
            test_node = stem.rsplit("_", 1)[0]
            tag = "PASS" if status == "passed" else "FAIL"

    test_name = test_node.split("__")[-1] if "__" in test_node else test_node
    phase = "final" if tag in ("PASS", "FAIL") else "before" if tag == "BEFORE" else "after" if tag == "AFTER" else "state"
    return {
        "run_id": run_id,
        "step": step,
        "tag": tag,
        "phase": phase,
        "action": action,
        "status": status,
        "test_name": test_name,
    }


def _screenshot_meta(path_value: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        path = Path(path_value).resolve()
        if not path.exists():
            return {}
        stat = path.stat()
    except Exception:
        return {}

    parsed = _parse_screenshot_name(path.name)
    merged = {**parsed, **(extra or {})}
    filename = path.name
    merged.update({
        "file": filename,
        "path": str(path),
        "url": f"/api/screenshots/{quote(filename)}",
        "status": _screenshot_status(path.stem),
        "modified_at": stat.st_mtime,
        "size_bytes": stat.st_size,
    })
    return merged


def _all_screenshots(rows: list, test_name: str, run_id: str = "") -> List[Dict[str, Any]]:
    """Return screenshot timeline metadata for this test run."""
    paths: List[str] = []
    meta_by_path: Dict[str, Dict[str, Any]] = {}

    def _remember(path_value: str, meta: Optional[Dict[str, Any]] = None):
        if not path_value:
            return
        try:
            key = str(Path(path_value).resolve())
        except Exception:
            key = path_value
        if key not in paths:
            paths.append(key)
        if meta:
            meta_by_path[key] = meta

    for row in rows:
        for p in row.get("screenshots", []):
            _remember(p)
        for meta in row.get("screenshot_meta", []):
            if isinstance(meta, dict):
                _remember(meta.get("path", ""), meta)

    # Fallback for timeouts or hard-killed workers: scan recently-written files.
    cutoff = time.time() - 900
    key = _safe(test_name).lower()
    try:
        for p in SCREENSHOTS_DIR.glob("*.png"):
            name = p.name.lower()
            if run_id and run_id.lower() in name:
                _remember(str(p))
            elif key and key in name and p.stat().st_mtime > cutoff:
                _remember(str(p))
    except Exception:
        pass

    screenshots = [
        _screenshot_meta(path, meta_by_path.get(path))
        for path in paths
    ]
    screenshots = [s for s in screenshots if s]
    screenshots.sort(key=lambda s: (
        0 if run_id and s.get("run_id") == run_id else 1,
        s.get("step") if isinstance(s.get("step"), int) else 9999,
        s.get("modified_at", 0),
    ))
    return screenshots


def _best_screenshot(screenshots: List[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    """Return screenshot metadata for this test (prefer FAIL, fallback PASS/final/latest)."""
    chosen = None
    for shot in reversed(screenshots):
        if shot.get("status") == "failed":
            chosen = shot
            break
    if chosen is None:
        for shot in reversed(screenshots):
            if shot.get("status") == "passed":
                chosen = shot
                break
    if chosen is None and screenshots:
        chosen = screenshots[-1]

    if chosen and chosen.get("path") and os.path.exists(chosen["path"]):
        path = Path(chosen["path"]).resolve()
        filename = path.name
        try:
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
        except Exception:
            b64 = None
        return {
            "b64": b64,
            "path": str(path),
            "url": f"/api/screenshots/{quote(filename)}",
            "file": filename,
        }
    return {"b64": None, "path": None, "url": None, "file": None}


def _infra_reason(raw: str) -> Optional[str]:
    """Detect environment problems (not real assertion failures) and return a
    human-friendly message. These are reported as status='error' so the user can
    tell "the app/tool wasn't ready" apart from "the test genuinely failed"."""
    low = raw.lower()
    if "no module named 'playwright'" in low or "no module named playwright" in low:
        return ("Playwright is not installed in the backend environment. "
                "Run  pip install playwright  and  python -m playwright install chromium, "
                "then restart the backend.")
    if "no module named 'selenium'" in low or "no module named selenium" in low:
        return ("Selenium isn't installed in the backend environment. "
                "Run  pip install selenium  and restart the backend.")
    if any(k in low for k in (
        "executable doesn't exist",
        "browser executable not found",
        "please run the following command to download new browsers",
        "playwright install",
    )):
        return ("Playwright is installed, but its browser runtime is missing. "
                "Run  python -m playwright install chromium  or set CHROME_BINARY_PATH "
                "to an existing Chrome/Chromium executable, then restart the backend.")
    m = re.search(r"no module named ['\"]?([\w\.]+)", raw, re.IGNORECASE)
    if m:
        pkg = m.group(1).split(".")[0]
        return f"Missing Python package '{pkg}'. Install it in the backend: pip install {pkg}"
    if any(k in raw for k in (
        "ConnectError", "ConnectTimeout", "Connection refused", "ConnectionRefusedError",
        "Max retries", "All connection attempts failed", "Failed to establish a new connection",
        "NewConnectionError", "getaddrinfo failed",
    )):
        return ("Could not reach the application under test at APP_URL. Start the target app "
                "(or set APP_URL in the test's TEST_DATA to the correct host) and re-run.")
    m = re.search(
        r"This version of ChromeDriver only supports Chrome version\s+(\d+).*?"
        r"Current browser version is\s+([\d.]+)",
        raw,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        return (
            "ChromeDriver / Chrome version mismatch. "
            f"Configured ChromeDriver supports Chrome {m.group(1)}, "
            f"but installed Chrome is {m.group(2)}. "
            "Download the matching ChromeDriver major version or update CHROMEDRIVER_PATH, "
            "then restart the backend and re-run."
        )
    if any(k in raw for k in (
        "session not created", "chromedriver", "cannot find Chrome", "WebDriverException",
        "DevToolsActivePort", "unable to obtain", "no chrome binary",
    )):
        return ("Chrome / ChromeDriver isn't available for Selenium. Install Google Chrome on "
                "the backend host (Selenium Manager fetches the driver automatically), then re-run.")
    return None


def _skip_reason(raw: str) -> Optional[str]:
    """Pull the reason text out of a pytest SKIPPED line."""
    m = re.search(r"SKIPPED\s*\[\d+\][^:]*:\s*(.+)", raw)
    if m:
        return m.group(1).strip()[:250]
    m = re.search(r"Skipped:\s*(.+)", raw)
    return m.group(1).strip()[:250] if m else None


def _resolve_status(rows: list, raw: str, returncode: int) -> tuple[str, Optional[str]]:
    """Map a pytest run to (status, error_message).

    Priority: environment problems → 'error' (with guidance); otherwise use the
    per-test results collected by json_plugin; fall back to the exit code.
    pytest exit codes: 0 pass · 1 failed · 2 collection error · 5 no tests.
    """
    reason = _infra_reason(raw)
    if reason:
        return "error", reason

    statuses = [r.get("status") for r in rows]
    if statuses:
        if "failed" in statuses:
            return "failed", _extract_error(raw)
        if "passed" in statuses:
            return "passed", None
        # everything skipped — didn't really run
        return "skipped", (_skip_reason(raw) or "Test skipped — environment not ready.")

    # No per-test rows were collected.
    if returncode == 5:
        return "skipped", "No tests were collected from the generated file."
    if returncode == 0:
        return "passed", None
    return "error", (_extract_error(raw) or "Test could not be executed.")


def _extract_error(output: str) -> str:
    lines = output.splitlines()
    # Grab FAILURES section
    buf, in_fail = [], False
    for line in lines:
        if re.match(r"=+ FAILURES =+", line) or "FAILED" in line:
            in_fail = True
        if in_fail:
            buf.append(line)
            if len(buf) > 40:
                break
    if buf:
        return "\n".join(buf[:40])
    errs = [l for l in lines if any(k in l for k in ["AssertionError", "Error:", "FAILED", "assert "])]
    return "\n".join(errs[:8]) if errs else output[-600:]


def _neg_errors(output: str) -> List[str]:
    """Capture validation/error messages that the tested app returned."""
    results = []
    for line in output.splitlines():
        stripped = line.strip().lstrip("E >").strip()
        if not stripped or len(stripped) > 250:
            continue
        if any(kw in stripped.lower() for kw in [
            "assert", "assertionerror", "400", "401", "403", "422",
            "validation", "invalid", "error:", "failed:", "expected", "got"
        ]):
            results.append(stripped)
    return list(dict.fromkeys(results))[:6]  # dedup, keep 6


def _parse_steps(output: str) -> List[str]:
    steps = []
    for line in output.splitlines():
        s = line.strip()
        if re.match(r"(PASSED|FAILED|ERROR|SKIPPED)", s):
            steps.append(s[:120])
        elif s.startswith(("INFO", "DEBUG", "STEP")):
            steps.append(s[:120])
    return steps[:20]


def _now() -> str:
    from datetime import datetime
    return datetime.utcnow().isoformat()
