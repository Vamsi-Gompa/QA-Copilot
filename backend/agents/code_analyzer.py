"""
Scan & Test agent — LangChain context extraction + single parallel prompt.

Flow (NO iterative LLM loops):
  1. LangChain RecursiveCharacterTextSplitter splits code language-aware.
  2. TF-IDF RAG selects the most relevant chunks (~20K chars).
  3. ONE prompt sent to Claude (single completion).
  4. The returned JSON array is merged, deduplicated, saved — stream events per test.
"""
import json
import uuid
import asyncio
import re
from typing import AsyncGenerator, Dict, Any, List

from models.schemas import AgentEvent, GeneratedTest, TestType
from services import storage
from services.llm_service import call_parallel, parse_json_array, provider_label

# ── LangChain language-aware splitter ────────────────────────────────────────
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
    _HAS_LC = True
except ImportError:
    _HAS_LC = False

# ── Priority heuristics ───────────────────────────────────────────────────────
_HIGH_KW = re.compile(r"auth|login|logout|payment|register|password|token|security|admin", re.I)
_LOW_KW  = re.compile(r"color|typo|tooltip|hover|misc|corner|aesthetic", re.I)

def _priority(name: str, raw: str) -> str:
    if raw in ("high", "medium", "low"):
        return raw
    if _HIGH_KW.search(name): return "high"
    if _LOW_KW.search(name):  return "low"
    return "medium"


# ── LangChain context extraction ──────────────────────────────────────────────
_ROUTE_PAT  = re.compile(r'(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)', re.I)
_UPLOAD_PAT = re.compile(r'UploadFile|multipart|FormData|file_field|enctype="multipart', re.I)
_FORM_PAT   = re.compile(r'<form|handleSubmit|onSubmit|useForm|FormGroup', re.I)

_IMPORTANT = re.compile(
    r'route|router|controller|view|page|login|auth|register|upload|api|endpoint|'
    r'handler|service|form|modal|dashboard|user|file',
    re.I,
)

def _split_code(path: str, content: str) -> list[str]:
    """Split code with LangChain language-aware splitter if available."""
    if not _HAS_LC:
        # Fallback: simple line-based chunks
        lines = content.split('\n')
        size = 80
        return ['\n'.join(lines[i:i+size]) for i in range(0, len(lines), size)]

    ext = path.rsplit('.', 1)[-1].lower() if '.' in path else ''
    lang_map = {
        'py': Language.PYTHON, 'js': Language.JS, 'ts': Language.JS,
        'tsx': Language.JS, 'jsx': Language.JS,
    }
    lang = lang_map.get(ext)
    if lang:
        splitter = RecursiveCharacterTextSplitter.from_language(
            language=lang, chunk_size=1800, chunk_overlap=150
        )
    else:
        splitter = RecursiveCharacterTextSplitter(chunk_size=1800, chunk_overlap=150)
    return splitter.split_text(content)


def _extract_context(files: Dict[str, str], max_chars: int = 24_000) -> tuple[str, dict]:
    """
    Returns (context_string, detected_patterns).
    Uses LangChain splitter + importance heuristics to stay within token budget.
    """
    # Score each file by importance
    def _score(path: str, content: str) -> int:
        score = 0
        if _IMPORTANT.search(path):             score += 10
        if _ROUTE_PAT.search(content):          score += 8
        if _UPLOAD_PAT.search(content):         score += 7
        if _FORM_PAT.search(content):           score += 5
        if path.endswith(('.py','.ts','.tsx')): score += 3
        if 'test' in path.lower():              score -= 10  # skip existing tests
        if 'node_modules' in path:              score -= 20
        return score

    scored = sorted(files.items(), key=lambda kv: _score(kv[0], kv[1]), reverse=True)

    # Detect patterns
    routes, forms, uploads = [], [], []
    for path, content in files.items():
        for m in _ROUTE_PAT.finditer(content):
            routes.append(f"{m.group(1).upper()} {m.group(2)}")
        if _UPLOAD_PAT.search(content):
            uploads.append(path)
        if _FORM_PAT.search(content):
            forms.append(path)

    patterns = {
        "routes":  list(dict.fromkeys(routes))[:20],
        "forms":   list(dict.fromkeys(forms))[:10],
        "uploads": list(dict.fromkeys(uploads))[:5],
    }

    # Build context string within budget
    context_parts = []
    used = 0
    for path, content in scored:
        if used >= max_chars:
            break
        chunks = _split_code(path, content)
        file_ctx = f"=== {path} ===\n"
        for chunk in chunks:
            if used + len(chunk) > max_chars:
                break
            file_ctx += chunk + "\n"
            used += len(chunk)
        context_parts.append(file_ctx)

    return "\n\n".join(context_parts), patterns


def _file_tree(files: Dict[str, str]) -> str:
    lines = []
    for path in sorted(files)[:60]:
        content = files[path]
        lang = path.rsplit('.', 1)[-1] if '.' in path else '?'
        lines.append(f"  {path}  ({lang}, {len(content.splitlines())} lines)")
    return "\n".join(lines)


# ── Single comprehensive prompt ───────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert QA automation engineer.
Generate comprehensive automated tests for the given web application.
You MUST return ONLY a valid JSON array — no markdown, no explanation, no code fences.
Start your response with [ and end with ]."""

def _test_mix(options: Dict[str, Any]) -> str:
    ui, backend = _requested_counts(options)
    scenarios = options.get("custom_scenarios") or []
    if isinstance(scenarios, str):
        scenarios = [s.strip() for s in scenarios.splitlines() if s.strip()]
    scenario_text = "\n".join(f"- {s}" for s in scenarios) or "- No extra custom scenarios supplied."
    return f"""REQUESTED TEST MIX (overrides any default count guidance):
- UI/Playwright test cases: {ui}
- Backend/API pytest test cases: {backend}
- Custom user scenarios:
{scenario_text}

If UI count is 0, do not generate browser UI tests. If backend count is 0, do not generate backend/API tests."""


def _requested_counts(options: Dict[str, Any]) -> tuple[int, int]:
    ui = max(0, int(options.get("ui_test_count") or 0))
    backend = max(0, int(options.get("backend_test_count") or 0))
    if ui == 0 and backend == 0:
        return 5, 5
    return ui, backend


def _filter_to_requested_mix(tests: List[dict], options: Dict[str, Any]) -> List[dict]:
    ui_limit, backend_limit = _requested_counts(options)
    ui_tests = [
        t for t in tests
        if t.get("category") == "ui" or t.get("test_type") in ("selenium", "playwright")
    ]
    backend_tests = [t for t in tests if t not in ui_tests]
    selected: list[dict] = []
    if ui_limit:
        selected.extend(ui_tests[:ui_limit])
    if backend_limit:
        selected.extend(backend_tests[:backend_limit])
    return selected or tests


def _ensure_import(code: str, import_line: str) -> str:
    return code if import_line in code else f"{import_line}\n{code}"


def _harden_selenium_code(code: str, app_url: str) -> str:
    if "webdriver.Chrome" not in code:
        return code

    code = re.sub(r"\n\s*\w+\.implicitly_wait\([^)]*\)\s*", "\n", code)

    if "service=" not in code:
        code = _ensure_import(code, "import subprocess")
        code = _ensure_import(code, "from selenium.webdriver.chrome.service import Service")
        code = re.sub(
            r"webdriver\.Chrome\(\s*options\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)",
            r"webdriver.Chrome(options=\1, service=Service(log_output=subprocess.DEVNULL))",
            code,
        )
        code = re.sub(
            r"webdriver\.Chrome\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)",
            r"webdriver.Chrome(options=\1, service=Service(log_output=subprocess.DEVNULL))",
            code,
        )
        code = re.sub(
            r"webdriver\.Chrome\(\s*\)",
            "webdriver.Chrome(service=Service(log_output=subprocess.DEVNULL))",
            code,
        )

    if "APP_URL" not in code and "BASE_URL" not in code:
        code = f'import os\nAPP_URL = os.getenv("APP_URL", "{app_url}")\nBASE_URL = APP_URL\n\n{code}'
    return code


def _generated_test_type(raw: dict, category: str) -> TestType:
    raw_type = str(raw.get("test_type") or "").strip().lower()
    if raw_type == "selenium":
        return TestType.SELENIUM
    if raw_type == "playwright":
        return TestType.PLAYWRIGHT
    if category == "ui":
        return TestType.PLAYWRIGHT
    return TestType.PYTEST


def _py_string(value: str) -> str:
    return json.dumps(value)


def _fallback_ui_code(test_name: str, app_url: str, mode: str) -> str:
    return f'''import os
import pytest
from playwright.sync_api import expect

APP_URL = os.getenv("APP_URL", {_py_string(app_url)})
BASE_URL = APP_URL
TEST_DATA = {{"APP_URL": APP_URL, "FALLBACK_MODE": {_py_string(mode)}}}


def _open_app(page):
    page.goto(APP_URL)
    expect(page.locator("body")).to_be_visible()
    return page.locator("body")


def test_{test_name}(page):
    body = _open_app(page)
    assert body.inner_text(timeout=5000).strip()

    if TEST_DATA["FALLBACK_MODE"] == "required_form_validation":
        form = page.locator("form")
        if form.count() == 0:
            pytest.skip("No form detected on the rendered page.")
        submit = form.first.locator("button[type='submit'], input[type='submit'], button")
        if submit.count() == 0:
            pytest.skip("No submit control detected on the first form.")
        submit.first.click()
        expect(body).to_be_visible()
        assert page.url.startswith(APP_URL.rstrip("/")[: max(8, len(APP_URL.rstrip("/")) - 1)])

    elif TEST_DATA["FALLBACK_MODE"] == "fill_visible_fields":
        controls = page.locator("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea")
        if controls.count() == 0:
            pytest.skip("No text controls detected on the rendered page.")
        limit = min(controls.count(), 5)
        for index in range(limit):
            control = controls.nth(index)
            try:
                control.fill(f"qa-fallback-{{index}}")
            except Exception:
                continue
        expect(body).to_be_visible()

    elif TEST_DATA["FALLBACK_MODE"] == "click_safe_controls":
        buttons = page.locator("button, [role='button'], a[href]")
        if buttons.count() == 0:
            pytest.skip("No clickable controls detected on the rendered page.")
        limit = min(buttons.count(), 3)
        for index in range(limit):
            try:
                buttons.nth(index).click(timeout=1500)
                expect(page.locator("body")).to_be_visible()
            except Exception:
                continue

    elif TEST_DATA["FALLBACK_MODE"] == "file_inputs_present":
        file_inputs = page.locator("input[type='file']")
        if file_inputs.count() == 0:
            pytest.skip("No file input detected on the rendered page.")
        assert file_inputs.count() >= 1

    else:
        expect(body).to_be_visible()
'''


def _fallback_backend_code(test_name: str, app_url: str, route: str = "", method: str = "GET") -> str:
    return f'''import os
import httpx

APP_URL = os.getenv("APP_URL", {_py_string(app_url)})
BASE_URL = APP_URL
TEST_DATA = {{"APP_URL": APP_URL, "ROUTE": {_py_string(route)}, "METHOD": {_py_string(method)}}}


def _client():
    return httpx.Client(base_url=APP_URL, follow_redirects=True, timeout=15)


def test_{test_name}():
    route = TEST_DATA["ROUTE"] or "/"
    method = TEST_DATA["METHOD"].upper()
    with _client() as client:
        if method in ("POST", "PUT", "PATCH"):
            response = client.request(method, route, json={{}})
            assert response.status_code < 500
        elif method == "DELETE":
            response = client.delete(route)
            assert response.status_code < 500
        elif method == "OPTIONS":
            response = client.options(route)
            assert response.status_code < 500
        else:
            response = client.get(route)
            assert response.status_code < 500
            assert response.text is not None
'''


def _fallback_tests(patterns: dict, app_url: str, options: Dict[str, Any]) -> List[dict]:
    """Generate executable baseline tests when all configured LLMs fail."""
    ui_limit, backend_limit = _requested_counts(options)
    forms = patterns.get("forms") or []
    uploads = patterns.get("uploads") or []
    route_entries = patterns.get("routes") or []
    routes: list[tuple[str, str]] = []
    for entry in route_entries:
        parts = str(entry).split(" ", 1)
        if len(parts) == 2:
            routes.append((parts[0].upper(), parts[1]))

    ui_modes = [
        ("ui_app_loads_home_page", "load"),
        ("ui_required_form_validation", "required_form_validation"),
        ("ui_visible_fields_accept_input", "fill_visible_fields"),
        ("ui_safe_navigation_controls_do_not_crash", "click_safe_controls"),
        ("ui_file_inputs_are_available" if uploads else "ui_page_remains_stable_after_reload", "file_inputs_present" if uploads else "reload"),
    ]
    tests: list[dict] = []
    for index in range(ui_limit):
        base_name, mode = ui_modes[index % len(ui_modes)]
        name = base_name if index < len(ui_modes) else f"{base_name}_{index + 1}"
        description = "Fallback UI test generated from scanned context because the LLM did not return tests."
        if forms:
            description += f" Detected form source: {forms[0]}."
        tests.append({
            "test_name": f"test_{name}",
            "category": "ui",
            "priority": "high" if index < 2 else "medium",
            "description": description,
            "file_name": f"tests/ui/test_{name}.py",
            "test_type": "playwright",
            "test_code": _fallback_ui_code(name, app_url, mode),
            "expected_results": ["The application page renders and remains interactive."],
            "editable_data": {"APP_URL": app_url, "FALLBACK_MODE": mode},
            "tags": ["fallback", "ui"],
        })

    backend_targets = routes or [("GET", "/"), ("GET", "/api"), ("GET", "/health"), ("GET", "/non-existent-qa-path"), ("OPTIONS", "/")]
    for index in range(backend_limit):
        method, route = backend_targets[index % len(backend_targets)]
        safe_route = re.sub(r"[^a-zA-Z0-9]+", "_", route).strip("_") or "root"
        name = f"api_{method.lower()}_{safe_route}_{index + 1}"
        tests.append({
            "test_name": f"test_{name}",
            "category": "backend",
            "priority": "medium",
            "description": "Fallback API smoke test generated from scanned context because the LLM did not return tests.",
            "file_name": f"tests/backend/test_{name}.py",
            "test_type": "pytest",
            "test_code": _fallback_backend_code(name, app_url, route, method),
            "expected_results": ["The endpoint responds without a server-side 5xx error."],
            "editable_data": {"APP_URL": app_url, "ROUTE": route, "METHOD": method},
            "tags": ["fallback", "api"],
        })
    return tests


def _build_prompt(file_tree: str, context: str, patterns: dict, app_url: str, options: Dict[str, Any]) -> str:
    routes_txt  = "\n".join(f"  - {r}" for r in patterns["routes"])  or "  (none detected)"
    forms_txt   = "\n".join(f"  - {f}" for f in patterns["forms"])   or "  (none detected)"
    uploads_txt = "\n".join(f"  - {u}" for u in patterns["uploads"]) or "  (none detected)"
    ui_count, backend_count = _requested_counts(options)
    target_count = ui_count + backend_count

    return f"""Analyze this codebase and generate comprehensive tests.

APP URL: {app_url}

{_test_mix(options)}

FILE STRUCTURE:
{file_tree}

DETECTED API ROUTES:
{routes_txt}

DETECTED FORMS/UI:
{forms_txt}

FILE UPLOAD ENDPOINTS:
{uploads_txt}

KEY SOURCE CODE (LangChain extracted):
{context}

GENERATE a JSON array of about {target_count} test cases covering:
1. UI tests (Playwright Python sync API + pytest) - for each form/page: positive AND negative scenarios
2. Backend API tests (pytest + httpx) — for each route: valid AND invalid requests
3. File upload tests (pytest + io.BytesIO) — valid file, wrong format, missing columns

Each test object MUST have these exact keys:
{{
  "test_name": "test_login_success",
  "category": "ui",
  "priority": "high",
  "description": "one-line description",
  "file_name": "tests/ui/test_login.py",
  "test_type": "playwright",
  "test_code": "COMPLETE python test file — imports, fixtures, test functions, no placeholders",
  "expected_results": ["expected outcome 1", "expected outcome 2"],
  "editable_data": {{"APP_URL": "{app_url}", "TEST_USER": "admin"}},
  "tags": ["login", "auth", "positive"]
}}

RULES:
- category: "ui" for Playwright browser tests, "backend" for API, "file_upload" for uploads
- test_type: "playwright" for UI, "pytest" for backend/file_upload
- UI tests must use Playwright Python sync API with pytest. Prefer the injected `page` fixture: `def test_name(page): ...`.
- Import `expect` from `playwright.sync_api` when assertions need visibility/text checks.
- Do not generate JavaScript Playwright specs, `require('@playwright/test')`, `npx playwright`, or `.spec.js` files.
- Do not import Selenium, do not create webdriver.Chrome, and do not require ChromeDriver for new UI tests.
- Never use time.sleep(); rely on Playwright locators and expect auto-waiting.
- For single-page or tabbed UIs, click the tab/button for the target panel before interacting with fields in that panel, then wait until the panel is visible or active.
- Never interact with hidden elements. Use `locator(...).click()`, `get_by_role(...)`, `get_by_label(...)`, `get_by_placeholder(...)`, or source-proven CSS selectors.
- Prefer selectors proven by the source context: data-panel, data-form, data-fill, form [name=...], button[type='submit'], result IDs, and route constants.
- Use APP_URL root for single-page apps. Do not invent /login, /register, or other paths unless the source context explicitly defines those routes.
- API tests: import httpx, assert status_code AND response body fields
- File upload: create files with io.BytesIO/io.StringIO — NO real file paths
- APP_URL = os.getenv("APP_URL", "{app_url}") at top of each file
- TEST_DATA dict at top with all configurable values
- Include NEGATIVE tests (wrong password, missing fields, invalid format, 401, 422)

Return ONLY the JSON array starting with [ — nothing else."""


# ── Main streaming generator ──────────────────────────────────────────────────
async def analyze_and_generate_stream(
    job_id: str,
    repo_data: Dict[str, Any],
    app_url: str,
    options: Dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    options = options or {}

    files = repo_data.get("files", {})

    # Step 1 — LangChain context extraction (no LLM)
    yield _sse(AgentEvent(
        type="thinking",
        content=f"Extracting context from {len(files)} files with LangChain...",
        metadata={"phase": "context"},
    ))
    loop = asyncio.get_event_loop()
    context_limit = max(8_000, min(24_000, int(options.get("context_chars") or 16_000)))
    context_str, patterns = await loop.run_in_executor(
        None, lambda: _extract_context(files, max_chars=context_limit)
    )
    tree = _file_tree(files)
    yield _sse(AgentEvent(
        type="progress",
        content=(
            f"Context ready: {len(context_str):,} chars | "
            f"{len(patterns['routes'])} routes | "
            f"{len(patterns['forms'])} forms | "
            f"{len(patterns['uploads'])} upload endpoints"
        ),
        metadata={"phase": "context_done", "patterns": patterns},
    ))

    # Step 2 — Build prompt
    prompt = _build_prompt(tree, context_str, patterns, app_url, options)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]

    # Step 3 — One Claude call (single comprehensive completion)
    yield _sse(AgentEvent(
        type="thinking",
        content=f"Sending one prompt to {provider_label()}...",
        metadata={"phase": "single_gen"},
    ))

    claude_text, _second, llm_errors = await call_parallel(messages, max_tokens=4096, temperature=0.2)

    # Step 4 — Parse + merge + deduplicate
    claude_tests = parse_json_array(claude_text)
    extra_tests  = parse_json_array(_second)  # empty under Anthropic; retained for fallback providers
    total_tests = len(claude_tests) + len(extra_tests)
    fallback_note = " after fallback" if total_tests and llm_errors else ""

    yield _sse(AgentEvent(
        type="progress",
        content=f"LLM returned {total_tests} tests{fallback_note}. Merging...",
        metadata={"test_count": total_tests, "llm_errors": llm_errors},
    ))

    # Merge with unique test names
    seen_names: set = set()
    merged: list = []
    for t in claude_tests + extra_tests:
        name = t.get("test_name", "")
        if name and name not in seen_names:
            seen_names.add(name)
            merged.append(t)

    if not merged:
        auth_hit = any("401" in e or "invalid api key" in e.lower() for e in llm_errors)
        error_detail = " | ".join(llm_errors) if llm_errors else "unknown error"
        if auth_hit:
            yield _sse(AgentEvent(
                type="error",
                content=(
                    "Anthropic API key rejected (401). Check ANTHROPIC_API_KEY in backend/.env, "
                    "then restart the backend."
                ),
                metadata={"errors": llm_errors},
            ))
            return

        merged = _fallback_tests(patterns, app_url, options)
        if merged:
            yield _sse(AgentEvent(
                type="progress",
                content=(
                    f"LLM did not return tests ({error_detail}). "
                    f"Generated {len(merged)} fallback tests from the scanned context."
                ),
                metadata={"test_count": len(merged), "llm_errors": llm_errors, "fallback": True},
            ))
        else:
            yield _sse(AgentEvent(
                type="error",
                content=f"No tests generated. LLM errors: {error_detail}",
                metadata={"errors": llm_errors},
            ))
            return

    # Step 5 — Save each test + stream events
    merged = _filter_to_requested_mix(merged, options)
    generated_count = 0
    for raw in merged:
        test_id = str(uuid.uuid4())
        raw_priority = raw.get("priority", "medium")
        p = _priority(raw.get("test_name", ""), raw_priority)

        category = raw.get("category", "backend")
        if category not in ("ui", "backend", "file_upload"):
            category = "backend"

        test_type = _generated_test_type(raw, category)

        code = raw.get("test_code", "")
        editable = raw.get("editable_data", {}) or {}
        if isinstance(editable, str):
            try: editable = json.loads(editable)
            except Exception: editable = {}
        if not isinstance(editable, dict):
            editable = {}

        if test_type == TestType.SELENIUM:
            code = _harden_selenium_code(code, app_url)
        if test_type in (TestType.SELENIUM, TestType.PLAYWRIGHT) or "APP_URL" in code or "BASE_URL" in code:
            editable.setdefault("APP_URL", app_url)
        if "APP_URL" not in code and "BASE_URL" not in code:
            code = f'import os\nAPP_URL = os.getenv("APP_URL", "{app_url}")\nBASE_URL = APP_URL\n\n' + code
        if editable and "TEST_DATA" not in code:
            td = "\n".join(f'    "{k}": "{v}",' for k, v in editable.items())
            code = f"TEST_DATA = {{\n{td}\n}}\n\n" + code

        test = GeneratedTest(
            id=test_id,
            generation_job_id=job_id,
            story_id=None,
            test_type=test_type,
            category=category,
            priority=p,
            tags=raw.get("tags", []) or [],
            source_files=[],
            editable_data=editable,
            name=raw.get("test_name", "unnamed_test"),
            description=raw.get("description", ""),
            code=code,
            expected_results=raw.get("expected_results", []) or [],
            file_name=raw.get("file_name", f"tests/{category}/test_{raw.get('test_name','unnamed')}.py"),
        )
        storage.save_generated_test(test)
        generated_count += 1
        storage.update_scan_job(job_id, {"test_count": generated_count})

        lbl = {
            "ui": "UI (Playwright)" if test_type == TestType.PLAYWRIGHT else "UI (Selenium)",
            "backend": "API (pytest)",
            "file_upload": "File Upload",
        }.get(category, category)
        yield _sse(AgentEvent(
            type="test_generated",
            content=f"Saved {lbl} [{p.upper()}]: **{test.name}**",
            metadata={
                "test_id": test_id,
                "category": category,
                "priority": p,
                "test_name": test.name,
                "test_type": test_type.value,
                "file_name": test.file_name,
            },
        ))

    storage.update_generation_job(job_id, {"status": "completed", "test_count": generated_count})
    storage.update_scan_job(job_id, {"test_count": generated_count})
    yield _sse(AgentEvent(
        type="complete",
        content=f"Done. Generated {generated_count} tests.",
        metadata={"test_count": generated_count, "job_id": job_id, "llm_errors": llm_errors},
    ))


def _sse(event: AgentEvent) -> str:
    return f"data: {event.model_dump_json()}\n\n"
