from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime
import uuid


class TestType(str, Enum):
    SELENIUM = "selenium"
    PLAYWRIGHT = "playwright"
    PYTEST = "pytest"


class TestCategory(str, Enum):
    UI = "ui"
    BACKEND = "backend"
    FILE_UPLOAD = "file_upload"


class TestPriority(str, Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


class JobStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"


class TestStatus(str, Enum):
    GENERATED = "generated"
    APPROVED  = "approved"
    REJECTED  = "rejected"


class StoryStatus(str, Enum):
    DRAFT       = "draft"
    READY       = "ready"
    IN_PROGRESS = "in_progress"
    DONE        = "done"
    BLOCKED     = "blocked"


class UserStory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_name: str = "General"
    title: str
    description: str
    acceptance_criteria: List[str] = []
    story_points: int = 0                     # 0 = unestimated; otherwise Fibonacci (1,2,3,5,8,13)
    priority: str = "medium"                  # "high" | "medium" | "low"
    status: str = "draft"                     # see StoryStatus
    references: List[str] = []                # source refs / requirement IDs / URLs
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class UserStoryCreate(BaseModel):
    project_name: str = "General"
    title: str
    description: str
    acceptance_criteria: List[str] = []
    story_points: int = 0
    priority: str = "medium"
    status: str = "draft"
    references: List[str] = []


class UserStoriesUpload(BaseModel):
    stories: List[UserStoryCreate]


class StoryGenerateText(BaseModel):
    """Generate stories from pasted requirements text (no file upload)."""
    text: str = ""
    count: int = 0                            # 0 = let the model decide (3-12)


class StorySplitRequest(BaseModel):
    """Ask the LLM to break one story into smaller INVEST-compliant stories."""
    project_name: str = "General"
    title: str
    description: str
    acceptance_criteria: List[str] = []
    parts: int = 0                            # 0 = let the model decide (2-4)


class CodebaseSync(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_type: str
    path_or_url: str
    branch: str = "main"
    status: JobStatus = JobStatus.PENDING
    file_count: int = 0
    languages: List[str] = []
    structure_summary: str = ""
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class CodebaseSyncRequest(BaseModel):
    source_type: str
    path_or_url: str
    branch: str = "main"


class GeneratedTest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    generation_job_id: str
    story_id: Optional[str] = None

    # Classification
    test_type: TestType
    category: str = "backend"       # "ui" | "backend" | "file_upload"
    priority: str = "medium"        # "high" | "medium" | "low"
    tags: List[str] = []            # e.g. ["login", "validation", "negative"]
    source_files: List[str] = []    # source files this test exercises

    # Content
    name: str
    description: str
    code: str
    expected_results: List[str] = []

    # User-editable test parameters (injected as env vars at run time)
    editable_data: Dict[str, Any] = {}

    file_name: str = ""
    status: TestStatus = TestStatus.GENERATED
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class TestUpdateRequest(BaseModel):
    """PATCH body for editing a test before running."""
    name: Optional[str] = None
    description: Optional[str] = None
    expected_results: Optional[List[str]] = None
    editable_data: Optional[Dict[str, Any]] = None
    code: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None


class TestGenerationRequest(BaseModel):
    story_ids: List[str] = []
    custom_feature: Dict[str, Any] = {}
    workflow_mode: str = "develop_test"       # "develop_test" | "only_test"
    source_type: str = "synced"               # "synced" | "local" | "git"
    path_or_url: Optional[str] = None
    github_url: Optional[str] = None
    branch: str = "main"
    target_branch: str = "feature/ai-developed-code"
    app_url: str = "http://localhost:3000"
    develop_code: bool = False
    tech_stack: Dict[str, str] = {}
    ui_test_count: int = 5
    backend_test_count: int = 5
    custom_scenarios: List[str] = []
    save_target: str = "local"                # "local" | "github" | "both"


class StepDetail(BaseModel):
    step: str
    status: str = "pass"  # "pass" | "fail" | "info"
    detail: Optional[str] = None


class TestResult(BaseModel):
    test_id: str
    test_name: str
    status: str       # passed | failed | error | skipped
    category: str = "backend"
    duration_ms: float = 0.0

    # Behaviour summary (human-readable)
    expected_behavior: str = ""   # what was expected
    actual_behavior: str = ""     # what actually happened

    actual_output: Optional[str] = None
    error_message: Optional[str] = None
    screenshot_b64: Optional[str] = None
    screenshot_path: Optional[str] = None
    screenshot_url: Optional[str] = None
    screenshot_file: Optional[str] = None
    screenshots: List[Dict[str, Any]] = []
    test_data: Optional[Dict[str, Any]] = None
    steps_log: List[str] = []
    step_details: List[Dict[str, Any]] = []  # rich per-step info
    negative_errors: List[str] = []


class ExecutionJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    test_ids: List[str]
    status: JobStatus = JobStatus.PENDING
    results: List[TestResult] = []
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    total: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0


class RunOrderedRequest(BaseModel):
    """Run a specific ordered list of tests with optional per-test data overrides."""
    test_ids: List[str]
    custom_data: Dict[str, Dict[str, Any]] = {}  # {test_id: {key: value}}


class Discrepancy(BaseModel):
    test_id: str
    test_name: str
    test_type: str
    expected: List[str]
    actual_output: Optional[str] = None
    error: Optional[str] = None
    ai_analysis: Optional[str] = None
    proposed_fix: Optional[str] = None
    severity: str = "medium"


class GitHubConfigRequest(BaseModel):
    token: str
    repo: str
    branch: str = "feature/ai-developed-code"
    base_branch: str = "main"
    pr_title: str = "feat: Add AI-developed story implementation"
    create_repo: bool = False


class GitHubPushRequest(BaseModel):
    test_ids: List[str]
    commit_message: str = "Add AI-developed story implementation"
    create_pr: bool = True
    development_job_id: Optional[str] = None


class GitHubRepoPlanRequest(BaseModel):
    token: Optional[str] = None
    repo: Optional[str] = None
    path_or_url: Optional[str] = None
    branch: str = "feature/ai-developed-code"


class LifecycleCreateRequest(BaseModel):
    """Start one traceable requirement-to-release lifecycle."""
    title: str
    requirement_text: str
    project_key: str = "SDLC"
    source_name: str = "Pasted requirement"
    sprint_name: str = "Sprint 1"
    repository: str = ""
    base_branch: str = "main"


class LifecycleGateRequest(BaseModel):
    decision: str = "approved"  # approved | changes_requested
    comment: str = ""
    actor: str = "Architect"


class LifecycleIssueUpdate(BaseModel):
    summary: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee: Optional[str] = None
    story_points: Optional[int] = None
    sprint: Optional[str] = None


class LifecycleRepositoryRequest(BaseModel):
    repository: str
    base_branch: str = "main"
    target_branch: str = "feature/agentic-sdlc"


class LifecycleClarificationRequest(BaseModel):
    answer: str
    actor: str = "Architect"


class LifecycleBrdRevisionRequest(BaseModel):
    section_name: str
    content: str
    actor: str = "Architect"
    comment: str = ""


class LifecycleIssueCreate(BaseModel):
    issue_type: str = "Story"
    summary: str
    description: str = ""
    status: str = "Backlog"
    priority: str = "Medium"
    assignee: str = "Unassigned"
    story_points: int = 0
    sprint: str = ""
    parent_key: str = ""
    dependencies: List[str] = []
    acceptance_criteria: List[str] = []


class AgentEvent(BaseModel):
    type: str
    content: str
    metadata: Dict[str, Any] = {}
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class DashboardStats(BaseModel):
    total_stories: int = 0
    total_tests_generated: int = 0
    tests_approved: int = 0
    tests_executed: int = 0
    pass_rate: float = 0.0
    time_saved_hours: float = 0.0
    generation_jobs: int = 0
    execution_jobs: int = 0
    recent_activity: List[Dict[str, Any]] = []


class ScanTestConfig(BaseModel):
    source_type: str = "git"  # "git" | "local"
    path_or_url: Optional[str] = None
    github_url: Optional[str] = None  # Backward-compatible alias for path_or_url
    branch: str = "main"
    app_url: str = "http://localhost:3000"
    github_token: Optional[str] = None
    ui_test_count: int = 5
    backend_test_count: int = 5
    custom_scenarios: List[str] = []


class ScanTestJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    github_url: str
    source_type: str = "git"
    branch: str = "main"
    app_url: str
    status: JobStatus = JobStatus.PENDING
    file_count: int = 0
    test_count: int = 0
    repo_owner: str = ""
    repo_name: str = ""
    ui_test_count: int = 5
    backend_test_count: int = 5
    custom_scenarios: List[str] = []
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
