import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  EuiTitle, EuiText, EuiSpacer, EuiPanel, EuiFlexGroup, EuiFlexItem,
  EuiButton, EuiCallOut, EuiLoadingSpinner, EuiBadge,
  EuiTabs, EuiTab, EuiFieldText, EuiFormRow, EuiForm,
  EuiAccordion, EuiCodeBlock, EuiButtonEmpty, EuiProgress,
  EuiEmptyPrompt, EuiHorizontalRule, EuiToolTip,
  EuiFieldNumber, EuiTextArea, EuiModal, EuiModalBody, EuiModalHeader,
  EuiModalHeaderTitle,
} from '@elastic/eui';
import QaIcon from '../components/QaIcon';
import { scanTestApi, executionApi } from '../services/api';
import { useAgentStream } from '../hooks/useAgentStream';
import AgentThinking from '../components/AgentThinking';
import type { ExecutionJob, GeneratedTest, SavedScreenshot, ScanTestJob, TestResult } from '../types';

type Tab = 'agent' | 'tests' | 'results';

// localStorage key for persisting a scan session across page refreshes.
const SCAN_LS_KEY = 'qa_scan_test_state';
const GITHUB_SOURCE_KEY = 'qa_github_source_path';
const GITHUB_BRANCH_KEY = 'qa_github_source_branch';

const TEST_TYPE_COLORS: Record<string, string> = {
  selenium: 'warning',
  playwright: 'primary',
  pytest: 'accent',
};

const TEST_TYPE_LABELS: Record<string, string> = {
  selenium: 'UI (Selenium)',
  playwright: 'UI (Playwright)',
  pytest: 'API (Pytest)',
};

type RepoInfo = { repo: string; file_count: number };

const repoInfoFromJob = (job: ScanTestJob): RepoInfo => ({
  repo: [job.repo_owner, job.repo_name].filter(Boolean).join('/') || job.github_url,
  file_count: job.file_count,
});

const latestScanJob = (jobs: ScanTestJob[]) =>
  [...jobs].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null;

const screenshotSrc = (result?: Partial<TestResult> | null) =>
  result?.screenshot_url || (result?.screenshot_b64 ? `data:image/png;base64,${result.screenshot_b64}` : null);

const isUiTest = (test: Pick<GeneratedTest, 'test_type' | 'category'>) =>
  test.category === 'ui' || test.test_type === 'selenium' || test.test_type === 'playwright';

const testTypeLabel = (test: Pick<GeneratedTest, 'test_type' | 'category'>) =>
  test.test_type === 'pytest' && test.category === 'ui'
    ? 'UI (Browser)'
    : TEST_TYPE_LABELS[test.test_type] || test.test_type;

const testTypeColor = (test: Pick<GeneratedTest, 'test_type' | 'category'>) =>
  test.test_type === 'pytest' && test.category === 'ui'
    ? 'warning'
    : TEST_TYPE_COLORS[test.test_type] || 'default';

const normalizeShotKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const screenshotTokens = (value: string) =>
  value.toLowerCase()
    .replace(/\.(py|png)$/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t && !['test', 'tests', 'ui', 'py', 'pass', 'fail'].includes(t));

const savedScreenshotsForTest = (test: GeneratedTest, screenshots: SavedScreenshot[]) => {
  if (!isUiTest(test)) return [];
  const nameKey = normalizeShotKey(test.name);
  const fileKey = normalizeShotKey(test.file_name || '');
  const tokens = screenshotTokens(test.name);

  const scored = screenshots
    .map(shot => {
      const shotKey = normalizeShotKey(`${shot.file} ${shot.test_name}`);
      const shotTokens = new Set(screenshotTokens(`${shot.file} ${shot.test_name}`));
      const exact = shotKey.includes(nameKey) || (!!fileKey && shotKey.includes(fileKey));
      const tokenHits = tokens.filter(t => shotTokens.has(t)).length;
      return { shot, score: exact ? 100 + tokenHits : tokenHits };
    })
    .filter(item => item.score >= Math.max(2, tokens.length))
    .sort((a, b) => b.score - a.score || (a.shot.step ?? 9999) - (b.shot.step ?? 9999) || b.shot.modified_at - a.shot.modified_at);

  return scored.slice(0, 28).map(item => item.shot);
};

function SourceButton({
  selected,
  disabled,
  icon,
  label,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
        background: selected ? 'rgba(0,191,179,0.08)' : 'var(--code-bg)',
        color: selected ? '#00BFB3' : 'var(--text-2)',
        borderRadius: 8,
        padding: '9px 10px',
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
      }}
    >
      <QaIcon type={icon} size="s" color={selected ? '#00BFB3' : 'var(--text-3)'} />
      {label}
    </button>
  );
}

export default function ScanAndTest() {
  const navigate = useNavigate();
  const [sourceType, setSourceType] = useState<'git' | 'local'>('git');
  const [githubUrl, setGithubUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [appUrl, setAppUrl] = useState('http://localhost:3000');
  const [uiTestCount, setUiTestCount] = useState(5);
  const [backendTestCount, setBackendTestCount] = useState(5);
  const [customScenarios, setCustomScenarios] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('agent');
  const [scanTests, setScanTests] = useState<GeneratedTest[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runningExecution, setRunningExecution] = useState(false);
  const [executionJobId, setExecutionJobId] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<ExecutionJob | null>(null);
  const [savedScreenshots, setSavedScreenshots] = useState<SavedScreenshot[]>([]);

  const stream = useAgentStream();

  // ── Persist scan/run state so a page refresh keeps repo + generated tests ──
  const persist = (patch: Record<string, any>) => {
    try {
      const cur = JSON.parse(localStorage.getItem(SCAN_LS_KEY) || '{}');
      localStorage.setItem(SCAN_LS_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch {}
  };

  const refreshSavedScreenshots = () => {
    scanTestApi.listScreenshots()
      .then(setSavedScreenshots)
      .catch(() => {});
  };

  // Rehydrate on mount: restore inputs + re-fetch generated tests and last results.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      let saved: any = null;
      try { saved = JSON.parse(localStorage.getItem(SCAN_LS_KEY) || 'null'); } catch {}

      if (saved?.sourceType) setSourceType(saved.sourceType);
      if (saved?.githubUrl) setGithubUrl(saved.githubUrl);
      if (saved?.branch) setBranch(saved.branch);
      if (saved?.appUrl) setAppUrl(saved.appUrl);
      if (typeof saved?.uiTestCount === 'number') setUiTestCount(saved.uiTestCount);
      if (typeof saved?.backendTestCount === 'number') setBackendTestCount(saved.backendTestCount);
      if (saved?.customScenarios) setCustomScenarios(saved.customScenarios);
      if (saved?.repoInfo) setRepoInfo(saved.repoInfo);

      let activeJobId: string | null = saved?.jobId || null;
      let activeJob: ScanTestJob | null = null;

      if (activeJobId) {
        try { activeJob = await scanTestApi.getJob(activeJobId); } catch {}
      }

      if (!activeJobId) {
        try {
          activeJob = latestScanJob(await scanTestApi.listJobs());
          activeJobId = activeJob?.id || null;
        } catch {}
      }

      if (cancelled) return;

      if (activeJobId) {
        setJobId(activeJobId);
        if (activeJob) {
          const info = repoInfoFromJob(activeJob);
          setSourceType((saved?.sourceType || activeJob.source_type || 'git') as 'git' | 'local');
          setGithubUrl(saved?.githubUrl || activeJob.github_url || '');
          setBranch(saved?.branch || activeJob.branch || 'main');
          setAppUrl(saved?.appUrl || activeJob.app_url || 'http://localhost:3000');
          setUiTestCount(saved?.uiTestCount ?? activeJob.ui_test_count ?? 5);
          setBackendTestCount(saved?.backendTestCount ?? activeJob.backend_test_count ?? 5);
          setCustomScenarios(saved?.customScenarios || (activeJob.custom_scenarios || []).join('\n'));
          setRepoInfo(info);
          persist({
            jobId: activeJob.id,
            repoInfo: info,
            sourceType: saved?.sourceType || activeJob.source_type || 'git',
            githubUrl: saved?.githubUrl || activeJob.github_url || '',
            branch: saved?.branch || activeJob.branch || 'main',
            appUrl: saved?.appUrl || activeJob.app_url || 'http://localhost:3000',
            uiTestCount: saved?.uiTestCount ?? activeJob.ui_test_count ?? 5,
            backendTestCount: saved?.backendTestCount ?? activeJob.backend_test_count ?? 5,
            customScenarios: saved?.customScenarios || (activeJob.custom_scenarios || []).join('\n'),
          });
        }

        try {
          const tests = await scanTestApi.getTests(activeJobId);
          if (!cancelled) {
            setScanTests(tests || []);
            if (tests?.length) setActiveTab('tests');
          }
        } catch {}
      }

      if (saved?.executionJobId) {
        setExecutionJobId(saved.executionJobId);
        try {
          const job = await executionApi.getJob(saved.executionJobId);
          if (!cancelled && job?.results?.length) {
            setExecutionResults(job);
            setActiveTab('results');
          }
        } catch {}
      }
    };

    restore();
    refreshSavedScreenshots();
    return () => { cancelled = true; };
  }, []);

  // Refresh generated tests when agent emits test_generated events
  useEffect(() => {
    if (stream.generatedCount > 0 && jobId) {
      scanTestApi.getTests(jobId)
        .then(tests => {
          setScanTests(tests);
          persist({ jobId, generatedCount: tests.length });
        })
        .catch(() => {});
    }
  }, [stream.generatedCount, jobId]);

  // Switch to tests tab on completion
  useEffect(() => {
    if (stream.isComplete && scanTests.length > 0) {
      setActiveTab('tests');
      persist({ activeTab: 'tests', generatedCount: scanTests.length });
    }
  }, [stream.isComplete]);

  const handleScan = async () => {
    if (!githubUrl.trim()) {
      setError(sourceType === 'git' ? 'Enter a GitHub repository URL' : 'Enter a local directory path');
      return;
    }
    if (!appUrl.trim()) {
      setError('Enter the local app URL');
      return;
    }
    setError(null);
    setStarting(true);
    setScanTests([]);
    setSelectedIds(new Set());
    setExecutionResults(null);
    setExecutionJobId(null);

    try {
      const res = await scanTestApi.start({
        source_type: sourceType,
        path_or_url: githubUrl.trim(),
        branch: branch.trim() || (sourceType === 'local' ? 'local' : 'main'),
        app_url: appUrl.trim(),
        ui_test_count: uiTestCount,
        backend_test_count: backendTestCount,
        custom_scenarios: customScenarios.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      });
      setJobId(res.job_id);
      setRepoInfo({ repo: res.repo, file_count: res.file_count });
      // Persist the new scan session; drop any previous run's results.
      persist({
        jobId: res.job_id,
        repoInfo: { repo: res.repo, file_count: res.file_count },
        sourceType,
        githubUrl: githubUrl.trim(),
        branch: branch.trim() || (sourceType === 'local' ? 'local' : 'main'),
        appUrl: appUrl.trim(),
        uiTestCount,
        backendTestCount,
        customScenarios,
        executionJobId: null,
      });
      stream.reset();
      setActiveTab('agent');
      stream.start(scanTestApi.streamUrl(res.job_id));
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to start scan';
      setError(String(msg));
    } finally {
      setStarting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(scanTests.map(t => t.id)));
  const clearAll = () => setSelectedIds(new Set());

  const handleRunSelected = async () => {
    let ids = selectedIds.size > 0 ? [...selectedIds] : scanTests.map(t => t.id);
    if (!ids.length) return;
    setRunningExecution(true);
    setExecutionResults(null);
    try {
      const selectedTests = scanTests.filter(t => ids.includes(t.id));
      const hasUi = selectedTests.some(isUiTest);
      if (hasUi) {
        const preflight = await executionApi.preflight(appUrl.trim() || 'http://localhost:3000');
        if (!preflight.running) {
          ids = selectedTests
            .filter(t => !isUiTest(t))
            .map(t => t.id);
          if (!ids.length) {
            setError(`${preflight.message}. UI tests were not started.`);
            setRunningExecution(false);
            return;
          }
          setError(`${preflight.message}. Running backend tests only.`);
        }
      }
      const job = await executionApi.run(ids);
      setExecutionJobId(job.job_id);
      persist({ executionJobId: job.job_id });
      // Poll until the job reaches a terminal state. Runs can take a while
      // (a browser test is ~15-30s), so keep polling and show live progress
      // instead of giving up after a fixed number of attempts.
      let attempts = 0;
      const MAX_ATTEMPTS = 900;        // ~30 min safety cap at 2s intervals
      let missing = 0;                 // tolerate transient fetch failures
      const poll = setInterval(async () => {
        attempts++;
        try {
          missing = 0;
          const result = await executionApi.getJob(job.job_id);
          setExecutionResults(result);         // live partial results while running
          if (result.status === 'completed' || result.status === 'failed') {
            clearInterval(poll);
            setActiveTab('results');
            persist({ executionJobId: job.job_id, activeTab: 'results' });
            refreshSavedScreenshots();
            setRunningExecution(false);
          } else if (attempts > MAX_ATTEMPTS) {
            clearInterval(poll);
            setRunningExecution(false);
          }
        } catch {
          if (++missing > 5 || attempts > MAX_ATTEMPTS) { clearInterval(poll); setRunningExecution(false); }
        }
      }, 2000);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to run tests');
      setRunningExecution(false);
    }
  };

  const handleReviewPush = () => {
    localStorage.setItem(GITHUB_SOURCE_KEY, githubUrl.trim());
    localStorage.setItem(GITHUB_BRANCH_KEY, branch.trim() || (sourceType === 'local' ? 'local' : 'main'));
    navigate('/github');
  };

  const uiBrowserCount = scanTests.filter(isUiTest).length;
  const pytestCount = scanTests.filter(t => !isUiTest(t)).length;
  const passRate = executionResults ? Math.round((executionResults.passed / (executionResults.total || 1)) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween">
        <EuiFlexItem>
          <EuiFlexGroup alignItems="center" gutterSize="s">
            <EuiFlexItem grow={false}>
              <QaIcon type="searchProfilerApp" size="xl" color="#00BFB3" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiTitle size="m"><h2>Only Test</h2></EuiTitle>
              <EuiText color="subdued" size="s">
                <p>Scan a local or GitHub codebase, generate UI/API tests, and run them against a local or public app URL</p>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        {scanTests.length > 0 && (
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              color="success"
              iconType="playFilled"
              onClick={handleRunSelected}
              isLoading={runningExecution}
              disabled={stream.isStreaming}
            >
              {runningExecution
                ? 'Running…'
                : selectedIds.size > 0
                ? `Run ${selectedIds.size} Selected`
                : `Run All ${scanTests.length} Tests`}
            </EuiButton>
            <EuiSpacer size="s" />
            <EuiButton iconType="logoGithub" onClick={handleReviewPush} disabled={stream.isStreaming}>
              Review GitHub Push
            </EuiButton>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {/* Config panel */}
      <EuiPanel paddingSize="l" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)' }}>
        <EuiForm>
          <EuiFlexGroup gutterSize="m" wrap>
            <EuiFlexItem style={{ minWidth: 320 }}>
              <EuiFormRow label="Codebase Source" fullWidth>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <SourceButton
                    selected={sourceType === 'git'}
                    disabled={stream.isStreaming}
                    icon="logoGithub"
                    label="GitHub"
                    onClick={() => {
                      setSourceType('git');
                      setBranch('main');
                    }}
                  />
                  <SourceButton
                    selected={sourceType === 'local'}
                    disabled={stream.isStreaming}
                    icon="folderOpen"
                    label="Local"
                    onClick={() => {
                      setSourceType('local');
                      setBranch('local');
                    }}
                  />
                </div>
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 320 }}>
              <EuiFormRow
                label={sourceType === 'git' ? 'GitHub Repository URL' : 'Local Directory Path'}
                helpText={sourceType === 'git' ? 'e.g. https://github.com/your-org/sample-app' : 'e.g. C:\\Users\\you\\projects\\sample-app'}
                fullWidth
              >
                <EuiFieldText
                  fullWidth
                  placeholder={sourceType === 'git' ? 'https://github.com/owner/repo' : 'C:\\path\\to\\project'}
                  value={githubUrl}
                  onChange={e => setGithubUrl(e.target.value)}
                  prepend={<QaIcon type={sourceType === 'git' ? 'logoGithub' : 'folderOpen'} />}
                  disabled={stream.isStreaming}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 120, maxWidth: 160 }}>
              <EuiFormRow label="Branch" fullWidth>
                <EuiFieldText
                  fullWidth
                  placeholder={sourceType === 'git' ? 'main' : 'local'}
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  disabled={stream.isStreaming || sourceType === 'local'}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 240 }}>
              <EuiFormRow
                label="Local App URL"
                helpText="Where the application under test is running"
                fullWidth
              >
                <EuiFieldText
                  fullWidth
                  placeholder="http://localhost:3000"
                  value={appUrl}
                  onChange={e => setAppUrl(e.target.value)}
                  disabled={stream.isStreaming}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <EuiButton
                fill
                iconType="search"
                onClick={handleScan}
                isLoading={starting || stream.isStreaming}
              >
                {stream.isStreaming ? 'Analyzing...' : 'Scan & Generate'}
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="m" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <EuiFormRow label="UI test cases">
              <EuiFieldNumber
                min={0}
                max={20}
                value={uiTestCount}
                onChange={e => setUiTestCount(Number(e.target.value) || 0)}
                disabled={stream.isStreaming}
              />
            </EuiFormRow>
            <EuiFormRow label="Backend test cases">
              <EuiFieldNumber
                min={0}
                max={30}
                value={backendTestCount}
                onChange={e => setBackendTestCount(Number(e.target.value) || 0)}
                disabled={stream.isStreaming}
              />
            </EuiFormRow>
          </div>

          <EuiSpacer size="m" />

          <EuiFormRow label="Custom scenarios" helpText="One scenario per line. Backend tests can still be generated even if the app URL is not running." fullWidth>
            <EuiTextArea
              fullWidth
              compressed
              rows={3}
              value={customScenarios}
              onChange={e => setCustomScenarios(e.target.value)}
              placeholder={'Example:\nMissing required field returns 422\nExpired token returns 401'}
              disabled={stream.isStreaming}
            />
          </EuiFormRow>
        </EuiForm>
      </EuiPanel>

      <EuiSpacer size="s" />

      {error && (
        <>
          <EuiCallOut title={error} color="danger" iconType="alert" size="s" />
          <EuiSpacer size="s" />
        </>
      )}

      {repoInfo && (
        <EuiCallOut
          title={`Repo: ${repoInfo.repo} — ${repoInfo.file_count} files fetched`}
          color="primary"
          iconType="logoGithub"
          size="s"
        />
      )}

      {scanTests.some(isUiTest) && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut
            title={
              savedScreenshots.length > 0
                ? `UI screenshots are attached inside matching test cases (${savedScreenshots.length} saved)`
                : 'UI test screenshots save under backend/data/screenshots and appear inside each UI test case'
            }
            color="primary"
            iconType="image"
            size="s"
          />
        </>
      )}

      <EuiSpacer size="m" />

      {/* Stats row */}
      {scanTests.length > 0 && (
        <>
          <div className="scan-summary" role="status" aria-label="Generated test summary">
            {[
              { v: scanTests.length, label: 'Tests Generated', color: '#79AAD9' },
              { v: uiBrowserCount, label: 'Browser UI', color: '#F1D86F' },
              { v: pytestCount, label: 'API/Backend', color: '#A987D1' },
              ...(executionResults ? [
                { v: executionResults.passed, label: 'Passed', color: '#00BFB3' },
                { v: executionResults.failed + executionResults.errors, label: 'Failed', color: '#F66' },
              ] : []),
            ].map(s => (
              <span className="scan-summary__item" key={s.label}>
                <strong style={{ color: s.color }}>{s.v}</strong>
                <span>{s.label}</span>
              </span>
            ))}
          </div>

          {runningExecution && (
            <>
              <EuiProgress size="xs" color="accent" />
              <EuiSpacer size="xs" />
              <EuiText size="xs" color="subdued"><p>Running tests against {appUrl}…</p></EuiText>
              <EuiSpacer size="s" />
            </>
          )}
        </>
      )}

      {/* Tabs */}
      <EuiTabs>
        <EuiTab isSelected={activeTab === 'agent'} onClick={() => setActiveTab('agent')}>
          <QaIcon type="editorComment" size="s" style={{ marginRight: 6 }} />
          Agent Stream
          {stream.isStreaming && <EuiLoadingSpinner size="s" style={{ marginLeft: 8 }} />}
        </EuiTab>
        <EuiTab isSelected={activeTab === 'tests'} onClick={() => setActiveTab('tests')}>
          <QaIcon type="listAdd" size="s" style={{ marginRight: 6 }} />
          Generated Tests
          {scanTests.length > 0 && (
            <EuiBadge color="accent" style={{ marginLeft: 6 }}>{scanTests.length}</EuiBadge>
          )}
        </EuiTab>
        <EuiTab isSelected={activeTab === 'results'} onClick={() => setActiveTab('results')} disabled={!executionResults}>
          <QaIcon type="visGauge" size="s" style={{ marginRight: 6 }} />
          Results
          {executionResults && (
            <EuiBadge color={passRate === 100 ? 'success' : passRate > 50 ? 'warning' : 'danger'} style={{ marginLeft: 6 }}>
              {passRate}%
            </EuiBadge>
          )}
        </EuiTab>
      </EuiTabs>

      <EuiSpacer size="m" />

      {/* Agent Stream tab */}
      {activeTab === 'agent' && (
        <>
          <AgentThinking
            events={stream.events}
            isStreaming={stream.isStreaming}
            isComplete={stream.isComplete}
            error={stream.error}
            generatedCount={stream.generatedCount}
          />
          {!stream.isStreaming && !stream.isComplete && !jobId && (
            <EuiPanel
              paddingSize="xl"
              style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-dim)', textAlign: 'center' }}
            >
              <QaIcon type="searchProfilerApp" size="xl" color="var(--text-3)" style={{ marginBottom: 12 }} />
              <EuiText color="subdued" size="s">
                <p>Enter a local path or GitHub repo URL and click <strong>Scan & Generate</strong></p>
                <p style={{ marginTop: 4 }}>
                  The AI agent will analyze your source code and generate Playwright UI + API pytest test cases
                </p>
              </EuiText>
            </EuiPanel>
          )}
        </>
      )}

      {/* Generated Tests tab */}
      {activeTab === 'tests' && (
        <>
          {scanTests.length === 0 ? (
            <EuiEmptyPrompt
              icon={<QaIcon type="beaker" size="xl" />}
              title={<h3>No tests generated yet</h3>}
              body={<p>Enter a GitHub repo URL and start the scan.</p>}
            />
          ) : (
            <>
              <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" style={{ marginBottom: 12 }}>
                <EuiFlexItem>
                  <EuiText size="s">Select tests to run (or run all)</EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiFlexGroup gutterSize="s">
                    <EuiFlexItem>
                      <EuiButtonEmpty size="s" onClick={selectAll}>Select All</EuiButtonEmpty>
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiButtonEmpty size="s" onClick={clearAll}>Clear</EuiButtonEmpty>
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiButton
                        size="s"
                        fill
                        color="success"
                        iconType="playFilled"
                        onClick={handleRunSelected}
                        isLoading={runningExecution}
                      >
                        {selectedIds.size > 0 ? `Run ${selectedIds.size}` : 'Run All'}
                      </EuiButton>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </EuiFlexItem>
              </EuiFlexGroup>

              {scanTests.map(test => (
                <ScanTestCard
                  key={test.id}
                  test={test}
                  selected={selectedIds.has(test.id)}
                  onToggle={() => toggleSelect(test.id)}
                  result={executionResults?.results?.find((r: TestResult) => r.test_id === test.id)}
                  savedScreenshots={savedScreenshotsForTest(test, savedScreenshots)}
                />
              ))}
            </>
          )}
        </>
      )}

      {/* Results tab */}
      {activeTab === 'results' && executionResults && (
        <ResultsView job={executionResults} tests={scanTests} appUrl={appUrl} />
      )}
    </div>
  );
}

/* ── Sub-components ── */

interface ScanTestCardProps {
  test: GeneratedTest;
  selected: boolean;
  onToggle: () => void;
  result?: TestResult;
  savedScreenshots?: SavedScreenshot[];
}

function screenshotLabel(shot: SavedScreenshot, fallback = 'screenshot') {
  const step = typeof shot.step === 'number' ? `#${shot.step}` : '';
  const phase = shot.phase || shot.tag || '';
  const action = (shot.action || '').replace(/_/g, ' ');
  return [step, phase, action].filter(Boolean).join(' - ') || fallback;
}

type ScreenshotPreview = {
  title: string;
  shot: SavedScreenshot;
};

const shotStatusForPreview = (status?: TestResult['status'] | SavedScreenshot['status']) =>
  status === 'passed' || status === 'failed' ? status : 'unknown';

const screenshotFromSource = (
  url: string,
  testName: string,
  path?: string | null,
  status?: TestResult['status'] | SavedScreenshot['status'],
): SavedScreenshot => ({
  file: path?.split(/[\\/]/).pop() || 'screenshot.png',
  path: path || '',
  url,
  status: shotStatusForPreview(status),
  test_name: testName,
  modified_at: Date.now(),
  size_bytes: 0,
});

function ScreenshotPreviewModal({ preview, onClose }: { preview: ScreenshotPreview | null; onClose: () => void }) {
  if (!preview) return null;
  const { shot, title } = preview;
  return (
    <EuiModal onClose={onClose} className="screenshot-modal">
      <EuiModalHeader>
        <EuiModalHeaderTitle>
          <span className="screenshot-modal__title">
            <QaIcon type="image" size="m" color="var(--accent-teal)" />
            {title}
          </span>
        </EuiModalHeaderTitle>
      </EuiModalHeader>
      <EuiModalBody>
        <div className="screenshot-modal__canvas">
          <img src={shot.url} alt={`${title} screenshot preview`} />
        </div>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
          <EuiFlexItem grow={false}>
            <EuiBadge color={shot.status === 'passed' ? 'success' : shot.status === 'failed' ? 'danger' : 'hollow'}>
              {shot.status.toUpperCase()}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="xs" color="subdued">
              <p style={{ margin: 0 }}>{screenshotLabel(shot, shot.file)}</p>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        {shot.path && (
          <EuiText size="xs" color="subdued">
            <p style={{ margin: '8px 0 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>Saved to {shot.path}</p>
          </EuiText>
        )}
      </EuiModalBody>
    </EuiModal>
  );
}

function ScreenshotTimeline({
  screenshots,
  testName,
  borderColor,
  onOpen,
}: {
  screenshots: SavedScreenshot[];
  testName: string;
  borderColor?: string;
  onOpen?: (shot: SavedScreenshot) => void;
}) {
  if (!screenshots.length) return null;
  return (
    <>
      <EuiText size="xs" color="subdued"><strong>SCREENSHOT TIMELINE</strong></EuiText>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 6 }}>
        {screenshots.map((shot, index) => (
          <div key={`${shot.file}-${index}`} style={{ minWidth: 0 }}>
            <button
              type="button"
              className="screenshot-thumb"
              onClick={() => onOpen?.(shot)}
              aria-label={`Open ${testName} ${screenshotLabel(shot)} screenshot`}
            >
              <img
                src={shot.url}
                alt={`${testName} ${screenshotLabel(shot)}`}
                style={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: `1px solid ${shot.status === 'passed' ? '#00BFB3' : shot.status === 'failed' ? '#BD271E' : borderColor || 'var(--border-dim)'}`,
                  display: 'block',
                }}
              />
            </button>
            <EuiText size="xs">
              <p style={{ margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {screenshotLabel(shot, `screenshot ${index + 1}`)}
              </p>
            </EuiText>
          </div>
        ))}
      </div>
    </>
  );
}

function ScanTestCard({ test, selected, onToggle, result, savedScreenshots = [] }: ScanTestCardProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ScreenshotPreview | null>(null);
  const statusColor = result
    ? result.status === 'passed' ? '#00BFB3' : result.status === 'failed' ? '#F66' : '#F1D86F'
    : undefined;
  const timeline = (result?.screenshots?.length ? result.screenshots : savedScreenshots) || [];
  const primaryShot = timeline.find(shot => shot.status === 'failed')
    || [...timeline].reverse().find(shot => shot.status === 'passed')
    || timeline[timeline.length - 1];
  const shotSrc = screenshotSrc(result) || primaryShot?.url || null;
  const shotPath = result?.screenshot_path || primaryShot?.path;
  const shotStatus = result?.status || primaryShot?.status;
  const hasShot = !!shotSrc || timeline.length > 0;
  const previewableShot = primaryShot || (shotSrc ? screenshotFromSource(shotSrc, test.name, shotPath, shotStatus) : null);
  const openPreview = (shot: SavedScreenshot) => setPreview({ title: test.name, shot });

  return (
    <EuiPanel
      paddingSize="m"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
        marginBottom: 8,
      }}
    >
      <EuiFlexGroup alignItems="center" gutterSize="m">
        {/* Selection checkbox — click to (de)select for the run queue */}
        <EuiFlexItem grow={false} onClick={onToggle} style={{ cursor: 'pointer' }}>
          <QaIcon
            type={selected ? 'checkInCircleFilled' : 'empty'}
            color={selected ? '#00BFB3' : 'var(--text-3)'}
            size="m"
          />
        </EuiFlexItem>

        {/* Body — click to expand the test-case description & details */}
        <EuiFlexItem style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
          <EuiFlexGroup alignItems="center" gutterSize="s" wrap>
            <EuiFlexItem grow={false}>
              <EuiBadge color={testTypeColor(test)}>
                {testTypeLabel(test)}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="s"><strong>{test.name}</strong></EuiText>
            </EuiFlexItem>
            {result && (
              <EuiFlexItem grow={false}>
                <EuiBadge
                  color={result.status === 'passed' ? 'success' : result.status === 'failed' ? 'danger' : 'warning'}
                  style={{ color: statusColor }}
                >
                  {result.status.toUpperCase()}
                  {result.duration_ms ? ` · ${Math.round(result.duration_ms)}ms` : ''}
                </EuiBadge>
              </EuiFlexItem>
            )}
            {hasShot && (
              <EuiFlexItem grow={false}>
                <EuiToolTip content={shotPath || 'Screenshot captured - expand to view'}>
                  <EuiBadge color="hollow" iconType="image">
                    {timeline.length > 1 ? `${timeline.length} screenshots` : result ? 'screenshot' : 'saved screenshot'}
                  </EuiBadge>
                </EuiToolTip>
              </EuiFlexItem>
            )}
            {isUiTest(test) && !hasShot && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="hollow" iconType="image">
                  {result ? 'no screenshot' : 'screenshot after run'}
                </EuiBadge>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
          {!open && test.description && (
            <EuiText size="xs" color="subdued">
              <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {test.description}
              </p>
            </EuiText>
          )}
          {test.file_name && (
            <EuiText size="xs" color="subdued">
              <p style={{ margin: 0, fontFamily: 'monospace' }}>{test.file_name}</p>
            </EuiText>
          )}
        </EuiFlexItem>

        {hasShot && (
          <EuiFlexItem grow={false}>
            <button
              type="button"
              className="screenshot-thumb screenshot-thumb--small"
              onClick={() => previewableShot && openPreview(previewableShot)}
              aria-label={`Open ${test.name} screenshot`}
            >
              <img
                src={shotSrc!}
                alt={`${test.name} screenshot thumbnail`}
                style={{
                  width: 96,
                  height: 54,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: `1px solid ${statusColor || 'var(--border-dim)'}`,
                  display: 'block',
                }}
              />
            </button>
          </EuiFlexItem>
        )}

        {/* Expand chevron */}
        <EuiFlexItem grow={false} onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
          <QaIcon type={open ? 'chevronUp' : 'chevronDown'} size="s" color="var(--text-3)" />
        </EuiFlexItem>
      </EuiFlexGroup>

      {/* Expanded detail — full description, expected results, run result, code */}
      {open && (
        <>
          <EuiHorizontalRule margin="s" />

          <EuiText size="xs" color="subdued"><strong>DESCRIPTION</strong></EuiText>
          <EuiText size="s"><p style={{ margin: '2px 0 10px' }}>{test.description || 'No description provided.'}</p></EuiText>

          {test.expected_results?.length > 0 && (
            <>
              <EuiText size="xs" color="subdued"><strong>EXPECTED RESULTS</strong></EuiText>
              <EuiFlexGroup gutterSize="xs" style={{ margin: '4px 0 10px', flexWrap: 'wrap' }}>
                {test.expected_results.map((r, i) => (
                  <EuiFlexItem key={i} grow={false}>
                    <EuiBadge color="hollow" style={{ fontSize: 10 }}>{r}</EuiBadge>
                  </EuiFlexItem>
                ))}
              </EuiFlexGroup>
            </>
          )}

          {/* Run result: error message + screenshot proof */}
          {result?.error_message && (
            <EuiCallOut title={`${result.status === 'error' ? 'Environment error' : 'Failure'} while running`} color="danger" size="s" iconType="alert">
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{result.error_message}</pre>
            </EuiCallOut>
          )}
          {hasShot && (
            <>
              <EuiSpacer size="s" />
              {!result && timeline.length > 0 && (
                <EuiText size="xs" color="subdued">
                  <p style={{ margin: '2px 0 6px' }}>
                    Saved {shotStatus === 'passed' ? 'PASS' : shotStatus === 'failed' ? 'FAIL' : 'screenshot'} from disk
                  </p>
                </EuiText>
              )}
              {timeline.length > 0 ? (
                <ScreenshotTimeline screenshots={timeline} testName={test.name} borderColor={statusColor} onOpen={openPreview} />
              ) : (
                <>
                  <EuiText size="xs" color="subdued"><strong>SCREENSHOT (PROOF)</strong></EuiText>
                  <button
                    type="button"
                    className="screenshot-thumb screenshot-thumb--proof"
                    onClick={() => previewableShot && openPreview(previewableShot)}
                    aria-label={`Open ${test.name} screenshot proof`}
                  >
                    <img
                      src={shotSrc!}
                      alt={`${test.name} screenshot`}
                      style={{ width: '100%', maxWidth: 420, borderRadius: 8, border: `2px solid ${statusColor || 'var(--border-dim)'}` }}
                    />
                  </button>
                </>
              )}
              {shotPath && (
                <EuiText size="xs" color="subdued">
                  <p style={{ margin: '6px 0 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    Saved to {shotPath}
                  </p>
                </EuiText>
              )}
            </>
          )}

          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued"><strong>TEST CODE</strong></EuiText>
          <EuiSpacer size="xs" />
          <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable overflowHeight={300}>
            {test.code}
          </EuiCodeBlock>
        </>
      )}
      <ScreenshotPreviewModal preview={preview} onClose={() => setPreview(null)} />
    </EuiPanel>
  );
}

interface ResultsViewProps {
  job: ExecutionJob;
  tests: GeneratedTest[];
  appUrl: string;
}

function ResultsView({ job, tests, appUrl }: ResultsViewProps) {
  const [preview, setPreview] = useState<ScreenshotPreview | null>(null);
  const passRate = Math.round((job.passed / (job.total || 1)) * 100);
  const testMap = Object.fromEntries(tests.map(t => [t.id, t]));

  return (
    <div>
      {/* Summary */}
      <div className="scan-summary scan-summary--results" role="status" aria-label="Execution result summary">
        {[
          { v: job.total, label: 'Total', color: '#79AAD9' },
          { v: job.passed, label: 'Passed', color: '#00BFB3' },
          { v: job.failed, label: 'Failed', color: '#F66' },
          { v: job.errors, label: 'Errors', color: '#F1D86F' },
          { v: `${passRate}%`, label: 'Pass Rate', color: passRate > 70 ? '#00BFB3' : passRate > 40 ? '#F1D86F' : '#F66' },
        ].map(s => (
          <span className="scan-summary__item" key={s.label}>
            <strong style={{ color: s.color }}>{s.v}</strong>
            <span>{s.label}</span>
          </span>
        ))}
      </div>

      <EuiCallOut
        title={`Tests ran against: ${appUrl}`}
        color="primary"
        iconType="link"
        size="s"
      />
      <EuiSpacer size="m" />

      {job.results?.map((r: TestResult) => {
        const test = testMap[r.test_id];
        const timeline = r.screenshots || [];
        const primaryShot = timeline.find(shot => shot.status === 'failed')
          || [...timeline].reverse().find(shot => shot.status === 'passed')
          || timeline[timeline.length - 1];
        const shotSrc = screenshotSrc(r) || primaryShot?.url || null;
        const previewableShot = primaryShot || (shotSrc ? screenshotFromSource(shotSrc, r.test_name, r.screenshot_path, r.status) : null);
        return (
          <EuiPanel
            key={r.test_id}
            paddingSize="m"
            style={{
              background: 'var(--surface-1)',
              border: `1px solid ${r.status === 'passed' ? '#00BFB3' : r.status === 'failed' ? '#BD271E' : '#F5A700'}`,
              marginBottom: 8,
            }}
          >
            <EuiFlexGroup alignItems="center">
              <EuiFlexItem grow={false}>
                <QaIcon
                  type={r.status === 'passed' ? 'checkInCircleFilled' : r.status === 'failed' ? 'crossInACircleFilled' : 'warning'}
                  color={r.status === 'passed' ? '#00BFB3' : r.status === 'failed' ? '#F66' : '#F5A700'}
                  size="m"
                />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiFlexGroup alignItems="center" gutterSize="s">
                  {test && (
                    <EuiFlexItem grow={false}>
                      <EuiBadge color={testTypeColor(test)}>
                        {testTypeLabel(test)}
                      </EuiBadge>
                    </EuiFlexItem>
                  )}
                  <EuiFlexItem>
                    <EuiText size="s"><strong>{r.test_name}</strong></EuiText>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiText size="xs" color="subdued">{r.duration_ms ? `${Math.round(r.duration_ms)}ms` : ''}</EuiText>
                  </EuiFlexItem>
                </EuiFlexGroup>
                {r.error_message && (
                  <EuiText size="xs" color="danger">
                    <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap' }}>{r.error_message}</pre>
                  </EuiText>
                )}
                {r.actual_output && (
                  <EuiText size="xs" color="subdued">
                    <pre style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'pre-wrap' }}>{r.actual_output.slice(0, 300)}</pre>
                  </EuiText>
                )}
                {(shotSrc || timeline.length > 0) && (
                  <>
                    <EuiSpacer size="xs" />
                    {timeline.length > 0 ? (
                      <ScreenshotTimeline
                        screenshots={timeline}
                        testName={r.test_name}
                        borderColor={r.status === 'passed' ? '#00BFB3' : r.status === 'failed' ? '#BD271E' : '#F5A700'}
                        onOpen={shot => setPreview({ title: r.test_name, shot })}
                      />
                    ) : (
                      <>
                        <EuiText size="xs" color="subdued"><strong>Screenshot (proof)</strong></EuiText>
                        <button
                          type="button"
                          className="screenshot-thumb screenshot-thumb--proof"
                          onClick={() => previewableShot && setPreview({ title: r.test_name, shot: previewableShot })}
                          aria-label={`Open ${r.test_name} screenshot proof`}
                        >
                          <img
                            src={shotSrc!}
                            alt={`${r.test_name} screenshot`}
                            style={{
                              width: '100%', maxWidth: 420, borderRadius: 8,
                              border: `2px solid ${r.status === 'passed' ? '#00BFB3' : r.status === 'failed' ? '#BD271E' : '#F5A700'}`,
                            }}
                          />
                        </button>
                      </>
                    )}
                    {r.screenshot_path && (
                      <EuiText size="xs" color="subdued">
                        <p style={{ margin: '6px 0 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          Saved to {r.screenshot_path}
                        </p>
                      </EuiText>
                    )}
                  </>
                )}
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        );
      })}
      <ScreenshotPreviewModal preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
