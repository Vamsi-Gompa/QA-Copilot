"""
Test generator from user stories plus synced codebase context.

The app sends one prompt to the configured LLM providers, then merges the JSON
test cases they return.
"""
import json
import re
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List

from models.schemas import AgentEvent, GeneratedTest, TestType, UserStory
from services import storage
from services.llm_service import call_parallel, parse_json_array, provider_label


SYSTEM_PROMPT = """You are an expert QA automation engineer.
Generate comprehensive automated tests from user stories and source code.
Return ONLY a valid JSON array. No markdown, no explanation, no code fences.
Start with [ and end with ]."""

DEVELOPMENT_SYSTEM_PROMPT = """You are a senior full-stack engineer.
Generate implementation files for the selected user story using the provided codebase context.
Return ONLY a valid JSON array. No markdown, no explanation, no code fences.
Start with [ and end with ]."""


def _story_terms(stories: List[UserStory]) -> set[str]:
    text = " ".join(
        f"{s.title} {s.description} {' '.join(s.acceptance_criteria)}"
        for s in stories
    ).lower()
    ignored = {"user", "want", "with", "and", "the", "that", "from", "for", "should"}
    return {
        term for term in re.findall(r"[a-z][a-z0-9_]{2,}", text)
        if term not in ignored
    }


def _score_source(path: str, content: str, terms: set[str]) -> int:
    haystack = f"{path}\n{content[:6000]}".lower()
    score = 0
    for term in terms:
        if term in haystack:
            score += 5
    if re.search(r"register|registration|signup|sign-up", haystack):
        score += 12
    if re.search(r"login|auth|password|credential", haystack):
        score += 8
    if re.search(r"validat|schema|required|error", haystack):
        score += 6
    if re.search(r"route|router|endpoint|api", haystack):
        score += 4
    if "test" in path.lower():
        score -= 10
    return score


def _build_codebase_context(
    codebase_context: Dict[str, Any],
    stories: List[UserStory],
    max_chars: int = 32_000,
) -> str:
    if not codebase_context:
        return "No synced codebase context is available."

    terms = _story_terms(stories)
    parts: list[str] = []

    summary = codebase_context.get("summary") or codebase_context.get("structure_summary")
    if summary:
        parts.append(f"SUMMARY:\n{summary}")

    module_summaries = codebase_context.get("module_summaries") or []
    if module_summaries:
        ranked_modules = sorted(
            module_summaries,
            key=lambda item: _score_source(
                item.get("path", ""),
                " ".join(item.get("features", [])) + " " + " ".join(item.get("symbols", [])),
                terms,
            ),
            reverse=True,
        )[:20]
        parts.append("MODULE SUMMARIES:\n" + json.dumps(ranked_modules, indent=2, default=str))

    endpoints = codebase_context.get("api_endpoints") or []
    if endpoints:
        parts.append("API ENDPOINTS:\n" + json.dumps(endpoints[:40], indent=2, default=str))

    components = codebase_context.get("components") or []
    if components:
        parts.append("UI COMPONENTS:\n" + json.dumps(components[:40], indent=2, default=str))

    structure = codebase_context.get("structure") or []
    if structure:
        parts.append("FILE STRUCTURE:\n" + "\n".join(f"  {item}" for item in structure[:120]))

    files: Dict[str, str] = codebase_context.get("files") or {}
    if not files and codebase_context.get("sampled_files"):
        files = {
            item.get("path", f"sample_{i}"): item.get("preview", "")
            for i, item in enumerate(codebase_context.get("sampled_files", []))
        }

    if files:
        used = sum(len(part) for part in parts)
        source_parts = ["RELEVANT SOURCE FILES:"]
        ranked_files = sorted(
            files.items(),
            key=lambda item: _score_source(item[0], item[1], terms),
            reverse=True,
        )
        for path, content in ranked_files:
            if used >= max_chars:
                break
            chunk = f"\n=== {path} ===\n{content[:5000]}\n"
            if used + len(chunk) > max_chars:
                continue
            source_parts.append(chunk)
            used += len(chunk)
        parts.append("\n".join(source_parts))

    return "\n\n".join(parts)[:max_chars] or "No usable source context was extracted."


def _safe_rel_path(path: str, fallback: str) -> str:
    raw = (path or fallback).replace("\\", "/").strip().lstrip("/")
    parts = [
        part for part in Path(raw).parts
        if part not in ("", ".", "..") and not part.endswith(":")
    ]
    return "/".join(parts) or fallback


def _test_mix(options: Dict[str, Any]) -> str:
    ui, backend = _requested_counts(options)
    scenarios = options.get("custom_scenarios") or []
    if isinstance(scenarios, str):
        scenarios = [s.strip() for s in scenarios.splitlines() if s.strip()]
    scenario_text = "\n".join(f"- {s}" for s in scenarios) or "- No extra custom scenarios supplied."
    return f"""REQUESTED TEST MIX:
- UI/Playwright test cases: {ui}
- Backend/API pytest test cases: {backend}
- Custom user scenarios:
{scenario_text}

Generate close to this mix. If UI count is 0, do not generate browser UI tests. If backend count is 0, do not generate backend/API tests."""


def _requested_counts(options: Dict[str, Any]) -> tuple[int, int]:
    ui = max(0, int(options.get("ui_test_count") or 0))
    backend = max(0, int(options.get("backend_test_count") or 0))
    if ui == 0 and backend == 0:
        return 5, 5
    return ui, backend


def _tech_stack_text(options: Dict[str, Any]) -> str:
    stack = options.get("tech_stack") or {}
    if not isinstance(stack, dict) or not stack:
        return "TECH STACK: Not provided. Infer carefully from the codebase context and file extensions."
    return "TECH STACK:\n" + "\n".join(f"- {k}: {v or 'not specified'}" for k, v in stack.items())


def _build_development_prompt(
    stories: List[UserStory],
    codebase_context: Dict[str, Any],
    options: Dict[str, Any],
) -> str:
    stories_text = json.dumps([s.model_dump() for s in stories], indent=2, default=str)
    source_context = _build_codebase_context(codebase_context, stories, max_chars=36_000)
    app_url = options.get("app_url") or "http://localhost:3000"

    return f"""Develop the selected user story as implementation code.

USER STORIES:
{stories_text}

{_tech_stack_text(options)}

CODEBASE SOURCE:
- source_type: {options.get("source_type", "synced")}
- path_or_url: {options.get("path_or_url") or options.get("github_url") or "latest synced codebase"}
- base_branch: {options.get("branch", "main")}
- target_branch: {options.get("target_branch", "feature/ai-developed-code")}
- app_url: {app_url}

SYNCED CODEBASE CONTEXT:
{source_context}

Return a JSON array of implementation files. Each object must use this shape:
{{
  "path": "src/modules/registration/RegisterForm.tsx",
  "purpose": "Implement registration form validation for the selected story",
  "content": "complete file content, no placeholders, no TODO comments"
}}

Rules:
- Generate the minimal set of files needed for the selected story.
- Follow the detected tech stack, routing style, naming style, and module layout.
- Prefer editing/adding feature-level files, services, routes, models, validators, and tests only when they fit the story.
- Do not include markdown fences.
- Do not return shell commands.
- If exact existing files are unknown, create clearly named files under a plausible module path.
- Code must be complete and locally saveable.

Return ONLY the JSON array starting with [ and ending with ]."""


def _save_development_files(job_id: str, files: List[dict], options: Dict[str, Any]) -> dict:
    root = Path(__file__).resolve().parent.parent / "data" / "developed_code" / job_id
    root.mkdir(parents=True, exist_ok=True)
    saved: list[dict] = []

    for index, raw in enumerate(files):
        if not isinstance(raw, dict):
            continue
        rel = _safe_rel_path(raw.get("path", ""), f"implementation/file_{index + 1}.txt")
        content = str(raw.get("content") or "")
        if not content.strip():
            continue
        out_path = root.joinpath(*rel.split("/"))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(content, encoding="utf-8")
        saved.append({
            "path": rel,
            "purpose": str(raw.get("purpose") or ""),
            "content": content,
            "saved_path": str(out_path),
        })

    artifact = {
        "job_id": job_id,
        "status": "completed" if saved else "empty",
        "root": str(root),
        "files": saved,
        "source_type": options.get("source_type", "synced"),
        "path_or_url": options.get("path_or_url") or options.get("github_url") or "",
        "branch": options.get("branch", "main"),
        "target_branch": options.get("target_branch", "feature/ai-developed-code"),
        "save_target": options.get("save_target", "local"),
    }
    storage.save_development_artifact(job_id, artifact)
    return artifact


async def _generate_development_artifact(
    job_id: str,
    stories: List[UserStory],
    codebase_context: Dict[str, Any],
    options: Dict[str, Any],
) -> tuple[dict | None, list[str]]:
    messages = [
        {"role": "system", "content": DEVELOPMENT_SYSTEM_PROMPT},
        {"role": "user", "content": _build_development_prompt(stories, codebase_context, options)},
    ]
    text, _second, errors = await call_parallel(messages, max_tokens=12_000, temperature=0.15)
    files = parse_json_array(text) + parse_json_array(_second)
    if not files:
        return None, errors or ["No implementation files were returned by the LLM."]
    return _save_development_files(job_id, files, options), []


def _development_context(artifact: dict | None, max_chars: int = 18_000) -> str:
    if not artifact or not artifact.get("files"):
        return "No generated implementation artifact is available."
    parts = ["GENERATED IMPLEMENTATION FILES:"]
    used = 0
    for item in artifact.get("files", []):
        chunk = f"\n=== {item.get('path')} ===\n{item.get('content', '')[:5000]}\n"
        if used + len(chunk) > max_chars:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n".join(parts)


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


def _build_prompt(
    stories: List[UserStory],
    codebase_context: Dict[str, Any],
    options: Dict[str, Any] | None = None,
    development_artifact: dict | None = None,
) -> str:
    options = options or {}
    stories_text = json.dumps([s.model_dump() for s in stories], indent=2, default=str)
    source_context = _build_codebase_context(codebase_context, stories)
    app_url = options.get("app_url") or "http://localhost:3000"
    ui_count, backend_count = _requested_counts(options)
    target_count = ui_count + backend_count

    return f"""Generate automated tests for these user stories and the selected application code.

USER STORIES:
{stories_text}

WORKFLOW:
- mode: {options.get("workflow_mode", "develop_test")}
- develop_code: {bool(options.get("develop_code"))}
- source_type: {options.get("source_type", "synced")}
- path_or_url: {options.get("path_or_url") or options.get("github_url") or "latest synced codebase"}
- branch: {options.get("branch", "main")}
- app_url: {app_url}

{_tech_stack_text(options)}

{_test_mix(options)}

SYNCED CODEBASE CONTEXT:
{source_context}

{_development_context(development_artifact)}

Return a JSON array of about {target_count} test cases. Each object must use this shape:
{{
  "test_name": "test_registration_valid_payload",
  "story_id": "story id from USER STORIES",
  "category": "backend",
  "priority": "high",
  "description": "one-line description",
  "file_name": "tests/registration/test_registration_api.py",
  "test_type": "pytest",
  "test_code": "COMPLETE python test file - no placeholders, no TODO comments",
  "expected_results": ["expected outcome"],
  "editable_data": {{"APP_URL": "{app_url}"}},
  "source_files": ["server.js", "src/pages/Register.tsx"],
  "tags": ["registration", "positive"]
}}

Rules:
- Treat the synced codebase as the source of truth.
- Do not invent routes, field names, selectors, request payloads, or response fields when they are present in the context.
- Organize tests by application module. Use file names like tests/registration/test_registration_validation.py or tests/auth/test_login_api.py.
- For a registration story, prioritize actual registration/signup modules, validation functions, routes, and form fields from the source context.
- UI stories use Playwright Python sync API with pytest. Set category "ui", test_type "playwright", and a .py file_name.
- Use the injected `page` fixture for Playwright UI tests: `def test_name(page): ...`.
- Import `expect` from `playwright.sync_api` when assertions need visibility/text checks.
- Do not generate JavaScript Playwright specs, `require('@playwright/test')`, `npx playwright`, or `.spec.js` files.
- Do not import Selenium, do not create webdriver.Chrome, and do not require ChromeDriver for new UI tests.
- Never use time.sleep(); rely on Playwright locators and expect auto-waiting.
- For single-page or tabbed UIs, click the tab/button for the target panel before interacting with fields in that panel, then wait until the panel is visible or active.
- Never interact with hidden elements. Use `locator(...).click()`, `get_by_role(...)`, `get_by_label(...)`, `get_by_placeholder(...)`, or source-proven CSS selectors.
- Prefer selectors proven by the source context: data-panel, data-form, data-fill, form [name=...], button[type='submit'], result IDs, and route constants.
- Use APP_URL root for single-page apps. Do not invent /login, /register, or other paths unless the source context explicitly defines those routes.
- API/backend stories use pytest + httpx.
- File upload stories use pytest + io.BytesIO or io.StringIO. Do not use real file paths.
- Include both positive happy-path and negative validation/error scenarios.
- APP_URL = os.getenv("APP_URL", "{app_url}") at top of each file.
- TEST_DATA dict at top with all editable values.
- editable_data must include {{"APP_URL": "{app_url}"}} for UI tests and API tests that hit the running app.
- source_files must list the modules/routes/components each test exercises.
- story_id must match the user story that the test validates.
- Custom scenarios supplied by the user are mandatory coverage items.

Return ONLY the JSON array starting with [ and ending with ]."""


async def generate_tests_stream(
    job_id: str,
    stories: List[UserStory],
    codebase_context: Dict[str, Any],
    options: Dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    options = options or {}
    yield _sse(AgentEvent(
        type="thinking",
        content=f"Preparing {options.get('workflow_mode', 'develop_test')} workflow for {len(stories)} selected story/stories...",
        metadata={"phase": "init", "has_codebase_context": bool(codebase_context), "options": options},
    ))

    development_artifact = None
    if options.get("develop_code"):
        yield _sse(AgentEvent(
            type="thinking",
            content=f"Generating implementation draft with {provider_label()} before test generation...",
            metadata={"phase": "develop_code"},
        ))
        development_artifact, dev_errors = await _generate_development_artifact(
            job_id, stories, codebase_context, options
        )
        if development_artifact and development_artifact.get("files"):
            yield _sse(AgentEvent(
                type="progress",
                content=(
                    f"Saved {len(development_artifact['files'])} implementation file(s) to "
                    f"{development_artifact['root']}"
                ),
                metadata={
                    "phase": "developed",
                    "development_job_id": job_id,
                    "files": [f["path"] for f in development_artifact["files"]],
                },
            ))
        else:
            yield _sse(AgentEvent(
                type="error",
                content="Development draft was not created. " + " | ".join(dev_errors),
                metadata={"phase": "develop_failed", "errors": dev_errors},
            ))
            return

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _build_prompt(stories, codebase_context, options, development_artifact)},
    ]

    yield _sse(AgentEvent(
        type="thinking",
        content=f"Sending test-generation prompt to {provider_label()} and waiting for JSON test cases...",
        metadata={"phase": "single_gen"},
    ))

    claude_text, _second, llm_errors = await call_parallel(messages, max_tokens=8192, temperature=0.25)
    claude_tests = parse_json_array(claude_text)
    gemini_tests = parse_json_array(_second)  # None under Anthropic; retained for fallback providers

    yield _sse(AgentEvent(
        type="progress",
        content=f"{provider_label()} returned {len(claude_tests) + len(gemini_tests)} test cases. Organizing by module...",
        metadata={
            "test_count": len(claude_tests) + len(gemini_tests),
            "chars": len((claude_text or "")) + len((_second or "")),
        },
    ))

    seen: set[str] = set()
    merged: list[dict] = []
    for raw in claude_tests + gemini_tests:
        if not isinstance(raw, dict):
            continue
        name = raw.get("test_name", "")
        if name and name not in seen:
            seen.add(name)
            merged.append(raw)

    if not merged:
        rate_hit = any("rate" in e.lower() or "429" in e or "quota" in e.lower() for e in llm_errors)
        auth_hit = any("401" in e or "invalid api key" in e.lower() for e in llm_errors)
        error_detail = " | ".join(llm_errors) if llm_errors else "unknown error"
        if auth_hit:
            msg = ("Anthropic API key rejected (401). Check ANTHROPIC_API_KEY in backend/.env, "
                   "then restart the backend.")
        elif rate_hit:
            msg = f"Claude is rate limited right now. Wait a moment and try again (details: {error_detail})."
        else:
            msg = f"No tests generated. LLM errors: {error_detail}"
        yield _sse(AgentEvent(
            type="error",
            content=msg,
            metadata={"errors": llm_errors, "rate_limited": rate_hit},
        ))
        return

    merged = _filter_to_requested_mix(merged, options)
    app_url = options.get("app_url") or "http://localhost:3000"
    generated_count = 0
    for raw in merged:
        test_id = str(uuid.uuid4())
        category = raw.get("category", "backend")
        if category not in ("ui", "backend", "file_upload"):
            category = "backend"

        test_type = _generated_test_type(raw, category)

        priority = raw.get("priority", "medium")
        if priority not in ("high", "medium", "low"):
            priority = "medium"

        editable = raw.get("editable_data", {}) or {}
        if isinstance(editable, str):
            try:
                editable = json.loads(editable)
            except Exception:
                editable = {}
        if not isinstance(editable, dict):
            editable = {}

        tags = raw.get("tags", []) or []
        if isinstance(tags, str):
            tags = [tags]

        source_files = raw.get("source_files", []) or []
        if isinstance(source_files, str):
            source_files = [source_files]

        code = raw.get("test_code", "")
        if test_type == TestType.SELENIUM:
            code = _harden_selenium_code(code, app_url)
        if test_type in (TestType.SELENIUM, TestType.PLAYWRIGHT) or "APP_URL" in code or "BASE_URL" in code:
            editable.setdefault("APP_URL", app_url)
        if "APP_URL" not in code and "BASE_URL" not in code:
            code = f'import os\nAPP_URL = os.getenv("APP_URL", "{app_url}")\nBASE_URL = APP_URL\n\n' + code
        if editable and "TEST_DATA" not in code:
            test_data = "\n".join(f'    "{k}": "{v}",' for k, v in editable.items())
            code = f"TEST_DATA = {{\n{test_data}\n}}\n\n" + code

        name = raw.get("test_name", f"test_{test_id[:8]}")
        file_name = raw.get("file_name", f"tests/{category}/test_{name}.py")
        story_id = raw.get("story_id")
        valid_story_ids = {s.id for s in stories}
        if story_id not in valid_story_ids:
            story_id = stories[0].id if len(stories) == 1 else None

        test = GeneratedTest(
            id=test_id,
            generation_job_id=job_id,
            story_id=story_id,
            test_type=test_type,
            category=category,
            priority=priority,
            tags=tags,
            source_files=source_files,
            editable_data=editable,
            name=name,
            description=raw.get("description", ""),
            code=code,
            expected_results=raw.get("expected_results", []) or [],
            file_name=file_name,
        )
        storage.save_generated_test(test)
        generated_count += 1

        label = {"ui": "UI", "backend": "Backend", "file_upload": "File Upload"}.get(category, category)
        yield _sse(AgentEvent(
            type="test_generated",
            content=f"Saved {label} [{priority.upper()}]: **{test.name}**",
            metadata={
                "test_id": test_id,
                "category": category,
                "priority": priority,
                "test_name": test.name,
                "test_type": test_type.value,
                "file_name": test.file_name,
                "source_files": source_files,
            },
        ))

    storage.update_generation_job(job_id, {"status": "completed", "test_count": generated_count})
    yield _sse(AgentEvent(
        type="complete",
        content=f"Done. Generated and organized {generated_count} tests by module.",
        metadata={"test_count": generated_count, "job_id": job_id},
    ))


def _sse(event: AgentEvent) -> str:
    return f"data: {event.model_dump_json()}\n\n"
