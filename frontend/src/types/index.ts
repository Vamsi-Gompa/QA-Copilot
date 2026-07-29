export type StoryStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'blocked';

export interface UserStory {
  id: string;
  project_name: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  story_points: number;
  priority: TestPriority;
  status: StoryStatus;
  references: string[];
  created_at: string;
}

/** A story being authored/refined client-side before it is persisted. */
export interface StoryDraft {
  _key: string;                 // local-only id
  project_name: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  story_points: number;
  priority: TestPriority;
  status: StoryStatus;
  references: string[];
  replaces?: string[];          // saved story ids this draft should replace on save
}

export interface StoryInput {
  project_name: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  story_points: number;
  priority: TestPriority;
  status: StoryStatus;
  references: string[];
}

export interface GenerateStoriesResult {
  stories: StoryInput[];
  warnings: string[];
  char_count: number;
  source_preview: string;
}

export const STORY_POINTS = [0, 1, 2, 3, 5, 8, 13] as const;

export const STORY_STATUS_META: Record<StoryStatus, { label: string; color: string; bg: string }> = {
  draft:       { label: 'Draft',       color: '#98A2B3', bg: 'rgba(152,162,179,0.14)' },
  ready:       { label: 'Ready',       color: '#79AAD9', bg: 'rgba(121,170,217,0.14)' },
  in_progress: { label: 'In Progress', color: '#F1D86F', bg: 'rgba(241,216,111,0.14)' },
  done:        { label: 'Done',        color: '#00BFB3', bg: 'rgba(0,191,179,0.14)' },
  blocked:     { label: 'Blocked',     color: '#F86B63', bg: 'rgba(248,107,99,0.14)' },
};

export interface CodebaseSync {
  id: string;
  source_type: 'git' | 'local';
  path_or_url: string;
  branch: string;
  status: JobStatus;
  file_count: number;
  languages: string[];
  structure_summary: string;
  created_at: string;
}

export type JobStatus    = 'pending' | 'running' | 'completed' | 'failed';
export type TestType     = 'selenium' | 'playwright' | 'pytest';
export type TestStatus   = 'generated' | 'approved' | 'rejected';
export type TestCategory = 'ui' | 'backend' | 'file_upload';
export type TestPriority = 'high' | 'medium' | 'low';

export interface GeneratedTest {
  id: string;
  generation_job_id: string;
  story_id: string | null;
  test_type: TestType;
  category: TestCategory;
  priority: TestPriority;
  tags: string[];
  source_files: string[];
  name: string;
  description: string;
  code: string;
  expected_results: string[];
  editable_data: Record<string, string | number | boolean>;
  file_name: string;
  status: TestStatus;
  created_at: string;
}

export interface TestGenerationOptions {
  story_ids: string[];
  custom_feature: {
    title: string;
    description: string;
    acceptance_criteria: string[];
    project_name?: string;
  };
  workflow_mode: 'develop_test' | 'only_test';
  source_type: 'synced' | 'local' | 'git';
  path_or_url?: string;
  github_url?: string;
  branch?: string;
  target_branch?: string;
  app_url: string;
  develop_code: boolean;
  tech_stack: Record<string, string>;
  ui_test_count: number;
  backend_test_count: number;
  custom_scenarios: string[];
  save_target: 'local' | 'github' | 'both';
}

export interface GitHubRepoPlan {
  source_path: string;
  is_git_repo: boolean;
  detected_repo: string;
  repo: string;
  suggested_repo_name: string;
  repo_exists: boolean;
  default_branch: string;
  branches: string[];
  target_branch: string;
  create_repo: boolean;
  message: string;
}

export interface DevelopmentFile {
  path: string;
  purpose: string;
  content: string;
  saved_path?: string;
}

export interface DevelopmentArtifact {
  job_id: string;
  status: string;
  root: string;
  files: DevelopmentFile[];
  source_type: string;
  path_or_url: string;
  branch: string;
  target_branch?: string;
  save_target: string;
  last_saved_local?: string;
  last_saved_files?: string[];
}

export interface StepDetail {
  step: string;
  status: 'pass' | 'fail' | 'info';
  detail?: string;
}

export interface TestResult {
  test_id: string;
  test_name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  category: TestCategory;
  duration_ms: number;
  expected_behavior: string;
  actual_behavior: string;
  actual_output: string | null;
  error_message: string | null;
  screenshot_b64: string | null;
  screenshot_path?: string | null;
  screenshot_url?: string | null;
  screenshot_file?: string | null;
  screenshots?: SavedScreenshot[];
  test_data: Record<string, unknown> | null;
  steps_log: string[];
  step_details: StepDetail[];
  negative_errors: string[];
}

export interface SavedScreenshot {
  file: string;
  path: string;
  url: string;
  status: 'passed' | 'failed' | 'unknown';
  test_name: string;
  modified_at: number;
  size_bytes: number;
  run_id?: string;
  step?: number | null;
  tag?: string;
  phase?: string;
  action?: string;
}

export interface ExecutionJob {
  id: string;
  test_ids: string[];
  status: JobStatus;
  results: TestResult[];
  started_at: string | null;
  completed_at: string | null;
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

export interface Discrepancy {
  test_id: string;
  test_name: string;
  test_type: string;
  expected: string[];
  actual_output: string | null;
  error: string | null;
  ai_analysis: string | null;
  proposed_fix: string | null;
  severity: 'low' | 'medium' | 'high';
}

export interface AgentEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'progress' | 'test_generated' | 'complete' | 'error';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface DashboardStats {
  total_stories: number;
  total_tests_generated: number;
  tests_approved: number;
  tests_executed: number;
  pass_rate: number;
  time_saved_hours: number;
  generation_jobs: number;
  execution_jobs: number;
  recent_activity: ActivityItem[];
}

export interface ActivityItem {
  type: string;
  message: string;
  ref_id: string;
  timestamp: string;
}

export interface GenerationJob {
  id: string;
  status: string;
  story_ids: string[];
  test_count: number;
}

export interface ScanTestJob {
  id: string;
  github_url: string;
  source_type?: 'git' | 'local';
  branch: string;
  app_url: string;
  status: JobStatus;
  file_count: number;
  test_count: number;
  repo_owner: string;
  repo_name: string;
  ui_test_count?: number;
  backend_test_count?: number;
  custom_scenarios?: string[];
  created_at: string;
}

export interface TestPatch {
  name?: string;
  description?: string;
  expected_results?: string[];
  editable_data?: Record<string, string>;
  code?: string;
  priority?: TestPriority;
  tags?: string[];
  status?: TestStatus;
}

export type LifecycleStageStatus = 'waiting' | 'ready' | 'approval_required' | 'completed';

export interface LifecycleIssue {
  id: string;
  key: string;
  type: 'Epic' | 'Story' | 'Subtask' | 'Defect';
  summary: string;
  description: string;
  status: 'Backlog' | 'Selected' | 'In Progress' | 'Review' | 'Done';
  priority: string;
  assignee: string;
  story_points: number;
  sprint: string;
  parent_key: string;
  dependencies: string[];
  acceptance_criteria: string[];
  requirement_refs: string[];
}

export interface Lifecycle {
  id: string;
  project_key: string;
  title: string;
  status: string;
  current_stage: string;
  created_at: string;
  updated_at: string;
  model: { provider: string; local: boolean; external_api_key_required: boolean };
  requirement: Record<string, any>;
  context_pack: Record<string, any>;
  clarifications: Array<{ question: string; answer: string; status: string }>;
  brd: {
    version: number; status: string; approved_by: string; approved_at: string | null;
    sections: Array<{ name: string; content: string; confidence: number }>;
  };
  issues: LifecycleIssue[];
  sprint_plan: Record<string, any>;
  code_plan: Record<string, any>;
  implementation: Record<string, any>;
  review: Record<string, any>;
  sanity: Record<string, any>;
  release: Record<string, any>;
  repository: Record<string, string>;
  stages: Record<string, { status: LifecycleStageStatus; updated_at: string }>;
  approvals: Array<Record<string, string>>;
  lineage: Array<{ from: string; to: string; type: string }>;
  activity: Array<{ at: string; actor: string; message: string }>;
}

export const CATEGORY_META: Record<TestCategory, { label: string; color: string; bg: string }> = {
  ui:          { label: 'UI',          color: '#F1D86F', bg: 'rgba(241,216,111,0.12)' },
  backend:     { label: 'Backend',     color: '#A987D1', bg: 'rgba(169,135,209,0.12)' },
  file_upload: { label: 'File Upload', color: '#79AAD9', bg: 'rgba(121,170,217,0.12)' },
};

export const PRIORITY_META: Record<TestPriority, { color: string; dot: string }> = {
  high:   { color: '#F86B63', dot: '#F86B63' },
  medium: { color: '#F1D86F', dot: '#F1D86F' },
  low:    { color: 'var(--text-2)', dot: 'var(--text-2)' },
};
