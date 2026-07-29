import axios from 'axios';
import type {
  UserStory, CodebaseSync, GeneratedTest, ExecutionJob,
  DashboardStats, Discrepancy, TestPatch, StoryInput, GenerateStoriesResult,
  ScanTestJob, SavedScreenshot, TestGenerationOptions, DevelopmentArtifact,
  GitHubRepoPlan,
  Lifecycle,
} from '../types';

const api = axios.create({ baseURL: '/api' });

// Stories
export const storiesApi = {
  list: () => api.get<UserStory[]>('/stories/').then(r => r.data),
  create: (data: StoryInput) =>
    api.post<UserStory>('/stories/', data).then(r => r.data),
  bulk: (stories: StoryInput[]) =>
    api.post<UserStory[]>('/stories/bulk', { stories }).then(r => r.data),
  uploadFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<UserStory[]>('/stories/upload-file', fd).then(r => r.data);
  },
  update: (id: string, data: StoryInput) =>
    api.put<UserStory>(`/stories/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/stories/${id}`),

  /** Generate draft stories from pasted text and/or uploaded docs & images. */
  generate: (opts: { text?: string; count?: number; files?: File[] }) => {
    const fd = new FormData();
    fd.append('text', opts.text ?? '');
    fd.append('count', String(opts.count ?? 0));
    (opts.files ?? []).forEach(f => fd.append('files', f));
    return api.post<GenerateStoriesResult>('/stories/generate', fd, {
      timeout: 180_000,
    }).then(r => r.data);
  },

  /** Ask the LLM to break one story into smaller stories (returns drafts). */
  aiSplit: (data: { title: string; project_name?: string; description: string; acceptance_criteria: string[]; parts?: number }) =>
    api.post<{ stories: StoryInput[]; warnings: string[] }>('/stories/ai-split', {
      ...data, parts: data.parts ?? 0,
    }, { timeout: 120_000 }).then(r => r.data),
};

// GitHub
export const githubApi = {
  configure: (
    token: string,
    repo: string,
    branch: string,
    pr_title: string,
    opts: { base_branch?: string; create_repo?: boolean } = {},
  ) =>
    api.post('/github/configure', {
      token,
      repo,
      branch,
      pr_title,
      base_branch: opts.base_branch || 'main',
      create_repo: opts.create_repo ?? false,
    }).then(r => r.data),
  getConfig: () => api.get('/github/config').then(r => r.data),
  repoPlan: (opts: { token?: string; repo?: string; path_or_url?: string; branch?: string }) =>
    api.post<GitHubRepoPlan>('/github/repo-plan', opts).then(r => r.data),
  push: (test_ids: string[], commit_message: string, create_pr: boolean, development_job_id?: string | null) =>
    api.post('/github/push', { test_ids, commit_message, create_pr, development_job_id }).then(r => r.data),
};

// Codebase
export const codebaseApi = {
  list: () => api.get<CodebaseSync[]>('/codebase/').then(r => r.data),
  latest: () => api.get<CodebaseSync>('/codebase/latest').then(r => r.data),
  sync: (source_type: string, path_or_url: string, branch: string) =>
    api.post('/codebase/sync', { source_type, path_or_url, branch }).then(r => r.data),
  get: (id: string) => api.get<CodebaseSync>(`/codebase/${id}`).then(r => r.data),
};

// Tests — extended with patch + run-ordered
export const testsApi = {
  list: () => api.get<GeneratedTest[]>('/tests/').then(r => r.data),
  get: (id: string) => api.get<GeneratedTest>(`/tests/${id}`).then(r => r.data),
  startGeneration: (story_ids: string[] = [], options?: Partial<TestGenerationOptions>) =>
    api.post<{ job_id: string; story_count: number; development_job_id?: string }>('/tests/generate', {
      story_ids,
      ...options,
    }, { timeout: 180_000 }).then(r => r.data),
  updateStatus: (id: string, status: string) =>
    api.put(`/tests/${id}/status`, null, { params: { status } }).then(r => r.data),
  patch: (id: string, patch: TestPatch) =>
    api.patch<GeneratedTest>(`/tests/${id}`, patch).then(r => r.data),
  delete: (id: string) => api.delete(`/tests/${id}`),
  exportLocal: (test_ids: string[]) =>
    api.post<{ export_dir: string; files: string[] }>('/tests/export-local', test_ids).then(r => r.data),
  exportPackage: (job_id: string | null, test_ids: string[]) =>
    api.post<{ export_dir: string; files: string[] }>('/tests/export-package', { job_id, test_ids }).then(r => r.data),
  getDevelopment: (jobId: string) =>
    api.get<DevelopmentArtifact>(`/tests/development/${jobId}`).then(r => r.data),
  saveDevelopmentLocal: (jobId: string, path: string, overwrite = false) =>
    api.post<{ target_dir: string; files: string[] }>(`/tests/development/${jobId}/save-local`, { path, overwrite }).then(r => r.data),
  streamUrl: (jobId: string) => `/api/tests/generate/${jobId}/stream`,
};

// Execution — now supports ordered selective runs
export const executionApi = {
  run: (test_ids?: string[]) =>
    api.post<{ job_id: string; total: number }>('/execution/run', test_ids || null).then(r => r.data),
  runOrdered: (test_ids: string[], custom_data: Record<string, Record<string, string>> = {}) =>
    api.post<{ job_id: string; total: number }>(
      '/execution/run', test_ids, { params: { ordered: '1' } }
    ).then(r => r.data),
  listJobs: () => api.get<ExecutionJob[]>('/execution/jobs/').then(r => r.data),
  getJob: (id: string) => api.get<ExecutionJob>(`/execution/jobs/${id}`).then(r => r.data),
  getResults: (id: string) => api.get(`/execution/jobs/${id}/results`).then(r => r.data),
  analyzeDiscrepancies: (id: string) =>
    api.post<Discrepancy[]>(`/execution/jobs/${id}/analyze-discrepancies`).then(r => r.data),
  preflight: (app_url: string) =>
    api.get<{ running: boolean; status_code: number | null; message: string }>('/execution/preflight', {
      params: { app_url },
    }).then(r => r.data),
};

// Dashboard
export const dashboardApi = {
  stats: () => api.get<DashboardStats>('/dashboard/stats').then(r => r.data),
};

// End-to-end Agentic SDLC
export const lifecycleApi = {
  list: () => api.get<Lifecycle[]>('/lifecycles/').then(r => r.data),
  get: (id: string) => api.get<Lifecycle>(`/lifecycles/${id}`).then(r => r.data),
  create: (body: {
    title: string; requirement_text: string; project_key: string;
    source_name?: string; sprint_name?: string; repository?: string; base_branch?: string;
  }) => api.post<Lifecycle>('/lifecycles/', body).then(r => r.data),
  decideGate: (id: string, gate: string, decision = 'approved', comment = '', actor = 'Architect') =>
    api.post<Lifecycle>(`/lifecycles/${id}/gates/${gate}`, { decision, comment, actor }).then(r => r.data),
  runStage: (id: string, stage: string) =>
    api.post<Lifecycle>(`/lifecycles/${id}/run/${stage}`).then(r => r.data),
  updateIssue: (id: string, key: string, patch: Record<string, unknown>) =>
    api.patch<Lifecycle>(`/lifecycles/${id}/issues/${key}`, patch).then(r => r.data),
  createIssue: (id: string, body: Record<string, unknown>) =>
    api.post<Lifecycle>(`/lifecycles/${id}/issues`, body).then(r => r.data),
  deleteIssue: (id: string, key: string) =>
    api.delete<Lifecycle>(`/lifecycles/${id}/issues/${key}`).then(r => r.data),
  answerClarification: (id: string, index: number, answer: string, actor = 'Architect') =>
    api.patch<Lifecycle>(`/lifecycles/${id}/clarifications/${index}`, { answer, actor }).then(r => r.data),
  reviseBrd: (id: string, section_name: string, content: string, comment = '', actor = 'Architect') =>
    api.post<Lifecycle>(`/lifecycles/${id}/brd/revisions`, { section_name, content, comment, actor }).then(r => r.data),
  configureRepository: (id: string, repository: string, base_branch: string, target_branch: string) =>
    api.post<Lifecycle>(`/lifecycles/${id}/repository`, { repository, base_branch, target_branch }).then(r => r.data),
};

// Scan & Test
export type ScanTestStartOptions = {
  source_type: 'git' | 'local';
  path_or_url: string;
  branch?: string;
  app_url: string;
  ui_test_count?: number;
  backend_test_count?: number;
  custom_scenarios?: string[];
};

export const scanTestApi = {
  start: (optsOrUrl: ScanTestStartOptions | string, branch?: string, app_url?: string) => {
    const body = typeof optsOrUrl === 'string'
      ? { source_type: 'git', path_or_url: optsOrUrl, github_url: optsOrUrl, branch, app_url }
      : {
          source_type: optsOrUrl.source_type,
          path_or_url: optsOrUrl.path_or_url,
          github_url: optsOrUrl.source_type === 'git' ? optsOrUrl.path_or_url : undefined,
          branch: optsOrUrl.branch || 'main',
          app_url: optsOrUrl.app_url,
          ui_test_count: optsOrUrl.ui_test_count ?? 3,
          backend_test_count: optsOrUrl.backend_test_count ?? 5,
          custom_scenarios: optsOrUrl.custom_scenarios ?? [],
        };
    return api.post<{ job_id: string; repo: string; branch: string; file_count: number }>(
      '/scan-test/start', body
    ).then(r => r.data);
  },
  streamUrl: (jobId: string) => `/api/scan-test/${jobId}/stream`,
  listJobs: () => api.get<ScanTestJob[]>('/scan-test/jobs/list').then(r => r.data),
  getJob: (jobId: string) => api.get<ScanTestJob>(`/scan-test/jobs/${jobId}`).then(r => r.data),
  getTests: (jobId: string) => api.get<GeneratedTest[]>(`/scan-test/${jobId}/tests`).then(r => r.data),
  listScreenshots: () => api.get<SavedScreenshot[]>('/scan-test/screenshots/list').then(r => r.data),
};

export default api;
