import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiFieldSearch,
  EuiFieldNumber,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
} from '@elastic/eui';
import { useNavigate } from 'react-router-dom';
import AgentThinking from '../components/AgentThinking';
import QaIcon from '../components/QaIcon';
import { storiesApi, testsApi } from '../services/api';
import { useAgentStream } from '../hooks/useAgentStream';
import type { DevelopmentArtifact, GeneratedTest, TestCategory, TestPriority, TestStatus, UserStory } from '../types';
import { CATEGORY_META, PRIORITY_META, STORY_STATUS_META } from '../types';

type Mode = 'develop_test' | 'only_test';
type SourceType = 'synced' | 'local' | 'git';
type SaveTarget = 'local' | 'github' | 'both';
type StatusFilter = TestStatus | 'all';
type CategoryFilter = TestCategory | 'all';
type PriorityFilter = TestPriority | 'all';

const ACTIVE_JOB_KEY = 'qa_active_generation_job';
const ACTIVE_STORIES_KEY = 'qa_active_story_ids';
const RUN_QUEUE_KEY = 'qa_run_queue';
const ACTIVE_DEV_JOB_KEY = 'qa_active_development_job';
const APP_URL_KEY = 'qa_app_url';
const GITHUB_SOURCE_KEY = 'qa_github_source_path';
const GITHUB_BRANCH_KEY = 'qa_github_source_branch';
const GITHUB_BASE_BRANCH_KEY = 'qa_github_base_branch';

const priorityRank: Record<TestPriority, number> = { high: 0, medium: 1, low: 2 };

const STACK_PRESETS = [
  { id: 'next-postgres', label: 'Next.js Full Stack', popularity: 'Most popular', frontend: 'Next.js + TypeScript', backend: 'Next.js API routes', database: 'PostgreSQL + Prisma', description: 'A modern TypeScript stack for product teams shipping web apps quickly.' },
  { id: 'react-node', label: 'React + Node', popularity: 'Popular', frontend: 'React + TypeScript', backend: 'Node.js + Express', database: 'PostgreSQL', description: 'A flexible JavaScript stack with a mature package ecosystem.' },
  { id: 'react-fastapi', label: 'React + FastAPI', popularity: 'Popular for AI', frontend: 'React + TypeScript', backend: 'Python + FastAPI', database: 'PostgreSQL', description: 'A strong fit for data, automation, and AI-enabled applications.' },
  { id: 'angular-spring', label: 'Angular + Spring', popularity: 'Enterprise', frontend: 'Angular', backend: 'Java + Spring Boot', database: 'PostgreSQL', description: 'A structured stack for large teams and enterprise applications.' },
  { id: 'custom', label: 'Custom tech stack', popularity: 'Build your own', frontend: '', backend: '', database: '', description: 'Specify the exact frontend, backend, and data technologies to use.' },
] as const;

function loadSet(key: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? new Set<string>(raw) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function storyLabel(story?: UserStory) {
  return story ? story.title : 'Unlinked story';
}

const isUiTest = (test: Pick<GeneratedTest, 'test_type' | 'category'>) =>
  test.category === 'ui' || test.test_type === 'selenium' || test.test_type === 'playwright';

function TestCard({
  test,
  story,
  selected,
  onToggle,
  onApprove,
  onReject,
  onDelete,
}: {
  test: GeneratedTest;
  story?: UserStory;
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cat = CATEGORY_META[test.category] || CATEGORY_META.backend;
  const pri = PRIORITY_META[test.priority] || PRIORITY_META.medium;

  return (
    <EuiPanel
      paddingSize="m"
      style={{
        background: selected ? 'rgba(0,191,179,0.06)' : 'var(--surface-1)',
        border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
        borderRadius: 8,
        marginBottom: 10,
      }}
    >
      <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
        <EuiFlexItem grow={false}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={selected ? 'Remove test from run queue' : 'Add test to run queue'}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: `2px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
              background: selected ? '#00BFB3' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected && <QaIcon type="check" size="s" color="#000" />}
          </button>
        </EuiFlexItem>

        <EuiFlexItem style={{ minWidth: 0 }}>
          <EuiFlexGroup alignItems="center" gutterSize="s" wrap>
            <EuiFlexItem grow={false}>
              <EuiBadge color="hollow" style={{ color: cat.color }}>{cat.label}</EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color="hollow" style={{ color: pri.color }}>{test.priority}</EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color={isUiTest(test) ? 'warning' : 'accent'}>
                {isUiTest(test) ? 'UI' : 'API'}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color={test.status === 'approved' ? 'success' : test.status === 'rejected' ? 'danger' : 'default'}>
                {test.status}
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="xs" />
          <EuiText size="s">
            <strong>{test.name}</strong>
          </EuiText>
          <EuiText size="xs" color="subdued">
            <p style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-word' }}>
              {test.file_name || 'tests/generated_test.py'}
            </p>
          </EuiText>
          <EuiText size="xs" color="subdued">
            <p style={{ margin: 0 }}>Story: {storyLabel(story)}</p>
          </EuiText>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
            {test.status !== 'approved' && (
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="xs" color="success" onClick={onApprove}>
                  Approve
                </EuiButtonEmpty>
              </EuiFlexItem>
            )}
            {test.status !== 'rejected' && (
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="xs" color="danger" onClick={onReject}>
                  Reject
                </EuiButtonEmpty>
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty size="xs" color="text" onClick={() => setOpen(v => !v)}>
                {open ? 'Hide details' : 'Details'}
              </EuiButtonEmpty>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty size="xs" color="danger" iconType="trash" onClick={onDelete} aria-label="Delete test" />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>

      {open && (
        <>
          <EuiSpacer size="m" />
          <div style={{ borderTop: '1px solid var(--border-faint)', paddingTop: 14 }}>
            <EuiText size="s">
              <p style={{ marginTop: 0 }}>{test.description || 'No description provided.'}</p>
            </EuiText>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <DetailBlock title="Expected results">
                {test.expected_results?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {test.expected_results.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <span>No expected results recorded.</span>
                )}
              </DetailBlock>

              <DetailBlock title="Test data">
                {Object.keys(test.editable_data || {}).length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(test.editable_data).map(([key, value]) => (
                      <EuiBadge key={key} color="hollow">
                        {key}: {String(value)}
                      </EuiBadge>
                    ))}
                  </div>
                ) : (
                  <span>No editable data.</span>
                )}
              </DetailBlock>

              <DetailBlock title="Source files">
                {test.source_files?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {test.source_files.map(file => (
                      <code key={file} style={{ fontSize: 11 }}>{file}</code>
                    ))}
                  </div>
                ) : (
                  <span>No source files linked.</span>
                )}
              </DetailBlock>
            </div>

            {!!test.tags?.length && (
              <>
                <EuiSpacer size="s" />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {test.tags.map(tag => (
                    <EuiBadge key={tag} color="hollow">{tag}</EuiBadge>
                  ))}
                </div>
              </>
            )}

            <EuiSpacer size="s" />
            <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable overflowHeight={340}>
              {test.code}
            </EuiCodeBlock>
          </div>
        </>
      )}
    </EuiPanel>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--code-bg)',
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        padding: 12,
        minHeight: 92,
      }}
    >
      <EuiText size="xs" color="subdued">
        <strong>{title.toUpperCase()}</strong>
      </EuiText>
      <EuiSpacer size="xs" />
      <EuiText size="xs">{children}</EuiText>
    </div>
  );
}

export default function GenerateTests() {
  const navigate = useNavigate();
  const stream = useAgentStream();

  const [mode, setMode] = useState<Mode>('develop_test');
  const [sourceType, setSourceType] = useState<SourceType>('synced');
  const [codebasePath, setCodebasePath] = useState('');
  const [branch, setBranch] = useState('main');
  const [targetBranch, setTargetBranch] = useState('feature/custom-feature');
  const [featureTitle, setFeatureTitle] = useState('');
  const [featureDescription, setFeatureDescription] = useState('');
  const [featureAcceptance, setFeatureAcceptance] = useState('');
  const [appUrl, setAppUrl] = useState(() => localStorage.getItem(APP_URL_KEY) || 'http://localhost:3000');
  const [stackPreset, setStackPreset] = useState<(typeof STACK_PRESETS)[number]['id']>('next-postgres');
  const [frontendStack, setFrontendStack] = useState('Next.js + TypeScript');
  const [backendStack, setBackendStack] = useState('Next.js API routes');
  const [databaseStack, setDatabaseStack] = useState('PostgreSQL + Prisma');
  const [uiTestCount, setUiTestCount] = useState(5);
  const [backendTestCount, setBackendTestCount] = useState(5);
  const [customScenarios, setCustomScenarios] = useState('');
  const [saveTarget, setSaveTarget] = useState<SaveTarget>('local');
  const [developmentArtifact, setDevelopmentArtifact] = useState<DevelopmentArtifact | null>(null);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [tests, setTests] = useState<GeneratedTest[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(() => loadSet(ACTIVE_STORIES_KEY));
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [activeJobId, setActiveJobId] = useState<string | null>(() => localStorage.getItem(ACTIVE_JOB_KEY));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stackApproved, setStackApproved] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [savingDevelopment, setSavingDevelopment] = useState(false);

  const refreshTests = useCallback(() => {
    testsApi.list().then(setTests).catch(() => {});
  }, []);

  useEffect(() => {
    storiesApi.list().then(setStories).catch(() => {});
    refreshTests();
  }, [refreshTests]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_STORIES_KEY, JSON.stringify([...selectedStoryIds]));
  }, [selectedStoryIds]);

  useEffect(() => {
    localStorage.setItem(APP_URL_KEY, appUrl);
  }, [appUrl]);

  useEffect(() => {
    setStackApproved(false);
  }, [
    selectedStoryIds,
    sourceType,
    codebasePath,
    branch,
    targetBranch,
    featureTitle,
    featureDescription,
    featureAcceptance,
    appUrl,
    frontendStack,
    backendStack,
    databaseStack,
    uiTestCount,
    backendTestCount,
    customScenarios,
    saveTarget,
  ]);

  useEffect(() => {
    if (stream.generatedCount > 0 || stream.isComplete) {
      refreshTests();
    }
  }, [stream.generatedCount, stream.isComplete, refreshTests]);

  useEffect(() => {
    if (!stream.isComplete || !activeJobId || mode !== 'develop_test') return;
    testsApi.getDevelopment(activeJobId)
      .then(artifact => {
        setDevelopmentArtifact(artifact);
        localStorage.setItem(ACTIVE_DEV_JOB_KEY, activeJobId);
      })
      .catch(() => setDevelopmentArtifact(null));
  }, [activeJobId, mode, stream.isComplete]);

  const storyById = useMemo(() => Object.fromEntries(stories.map(story => [story.id, story])), [stories]);
  const selectedStories = stories.filter(story => selectedStoryIds.has(story.id));

  const applyStackPreset = (presetId: (typeof STACK_PRESETS)[number]['id']) => {
    const preset = STACK_PRESETS.find(item => item.id === presetId) || STACK_PRESETS[0];
    setStackPreset(preset.id);
    if (preset.id !== 'custom') {
      setFrontendStack(preset.frontend);
      setBackendStack(preset.backend);
      setDatabaseStack(preset.database);
    }
  };

  const baseTests = useMemo(() => {
    if (activeJobId) return tests.filter(test => test.generation_job_id === activeJobId);
    if (selectedStoryIds.size) return tests.filter(test => test.story_id && selectedStoryIds.has(test.story_id));
    return [];
  }, [activeJobId, selectedStoryIds, tests]);

  const visibleTests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return baseTests
      .filter(test => category === 'all' || test.category === category)
      .filter(test => priority === 'all' || test.priority === priority)
      .filter(test => status === 'all' || test.status === status)
      .filter(test => {
        if (!q) return true;
        return [
          test.name,
          test.description,
          test.file_name,
          test.tags.join(' '),
          storyById[test.story_id || '']?.title || '',
        ].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));
  }, [baseTests, category, priority, query, status, storyById]);

  const toggleStory = (id: string) => {
    setSelectedStoryIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setActiveJobId(null);
    localStorage.removeItem(ACTIVE_JOB_KEY);
  };

  const toggleTest = (id: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const generateSelectedStories = async (approved = stackApproved) => {
    const hasCustomFeature = sourceType === 'git' && Boolean(featureTitle.trim() && featureDescription.trim());
    if (!selectedStoryIds.size && !hasCustomFeature) {
      setError('Select a user story or describe a custom feature to develop.');
      return;
    }
    if (!approved) {
      setError('Review and approve the story, tech stack, source, and test plan before development starts.');
      return;
    }
    if (!frontendStack.trim() && !backendStack.trim()) {
      setError('Choose a tech stack preset or enter a custom frontend/backend stack.');
      return;
    }
    if (sourceType !== 'synced' && !codebasePath.trim()) {
      setError(sourceType === 'git' ? 'Enter the GitHub repository URL.' : 'Enter the local codebase path.');
      return;
    }
    if (sourceType === 'git' && !targetBranch.trim()) {
      setError('Enter the feature branch where the developed code should be pushed.');
      return;
    }

    setStarting(true);
    setError(null);
    setSelectedTestIds(new Set());
    setDevelopmentArtifact(null);

    try {
      const scenarios = customScenarios
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean);
      const result = await testsApi.startGeneration([...selectedStoryIds], {
        story_ids: [...selectedStoryIds],
        custom_feature: sourceType === 'git' ? {
          title: featureTitle.trim(),
          description: featureDescription.trim(),
          acceptance_criteria: featureAcceptance.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
          project_name: 'Existing repository',
        } : { title: '', description: '', acceptance_criteria: [] },
        workflow_mode: mode,
        source_type: sourceType,
        path_or_url: codebasePath.trim(),
        github_url: sourceType === 'git' ? codebasePath.trim() : undefined,
        branch: sourceType === 'local' ? 'local' : branch.trim() || 'main',
        target_branch: sourceType === 'git' ? targetBranch.trim() : branch.trim() || 'main',
        app_url: appUrl.trim() || 'http://localhost:3000',
        develop_code: mode === 'develop_test',
        tech_stack: {
          frontend: frontendStack,
          backend: backendStack,
          database: databaseStack || 'not specified',
        },
        ui_test_count: uiTestCount,
        backend_test_count: backendTestCount,
        custom_scenarios: scenarios,
        save_target: saveTarget,
      });
      setActiveJobId(result.job_id);
      localStorage.setItem(ACTIVE_JOB_KEY, result.job_id);
      localStorage.setItem(APP_URL_KEY, appUrl.trim() || 'http://localhost:3000');
      if (result.development_job_id) {
        localStorage.setItem(ACTIVE_DEV_JOB_KEY, result.development_job_id);
      }
      stream.reset();
      stream.start(testsApi.streamUrl(result.job_id));
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to start test generation.');
    } finally {
      setStarting(false);
    }
  };

  const approveAndStart = () => {
    setStackApproved(true);
    void generateSelectedStories(true);
  };

  const openGitHubPush = () => {
    localStorage.setItem(GITHUB_SOURCE_KEY, codebasePath.trim() || developmentArtifact?.path_or_url || '');
    localStorage.setItem(GITHUB_BASE_BRANCH_KEY, branch.trim() || 'main');
    localStorage.setItem(GITHUB_BRANCH_KEY, targetBranch.trim() || developmentArtifact?.target_branch || 'feature/custom-feature');
    navigate('/github');
  };

  const updateStatus = async (id: string, nextStatus: TestStatus) => {
    await testsApi.updateStatus(id, nextStatus);
    setTests(prev => prev.map(test => test.id === id ? { ...test, status: nextStatus } : test));
  };

  const deleteTest = async (id: string) => {
    await testsApi.delete(id);
    setTests(prev => prev.filter(test => test.id !== id));
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const queueAndRun = () => {
    const ids = selectedTestIds.size ? [...selectedTestIds] : visibleTests.map(test => test.id);
    if (!ids.length) {
      setError('No tests are available in the current view.');
      return;
    }
    localStorage.setItem(APP_URL_KEY, appUrl.trim() || 'http://localhost:3000');
    localStorage.setItem(RUN_QUEUE_KEY, JSON.stringify(ids));
    navigate('/run');
  };

  const exportLocal = async () => {
    const ids = selectedTestIds.size ? [...selectedTestIds] : visibleTests.map(test => test.id);
    if (!ids.length) {
      setError('No tests are available to export.');
      return;
    }
    try {
      setError(null);
      const result = await testsApi.exportPackage(activeJobId, ids);
      setExportPath(`${result.export_dir} (${result.files.length} files)`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to export tests locally.');
    }
  };

  const saveDevelopmentLocal = async () => {
    if (!activeJobId) return;
    const target = codebasePath.trim() || developmentArtifact?.path_or_url || '';
    if (!target) {
      setError('Enter a local codebase path before saving development files.');
      return;
    }
    setSavingDevelopment(true);
    setError(null);
    try {
      const result = await testsApi.saveDevelopmentLocal(activeJobId, target, false);
      setExportPath(`${result.target_dir} (${result.files.length} implementation files)`);
      const artifact = await testsApi.getDevelopment(activeJobId);
      setDevelopmentArtifact(artifact);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to save development files locally.');
    } finally {
      setSavingDevelopment(false);
    }
  };

  const selectReadyStories = () => {
    const ids = stories
      .filter(story => story.status === 'ready' || story.status === 'in_progress')
      .map(story => story.id);
    setSelectedStoryIds(new Set(ids.length ? ids : stories.map(story => story.id)));
    setActiveJobId(null);
    localStorage.removeItem(ACTIVE_JOB_KEY);
  };

  const selectVisibleTests = () => setSelectedTestIds(new Set(visibleTests.map(test => test.id)));
  const clearVisibleTests = () => setSelectedTestIds(new Set());

  const uiCount = visibleTests.filter(test => test.category === 'ui').length;
  const apiCount = visibleTests.filter(test => test.category === 'backend').length;
  const uploadCount = visibleTests.filter(test => test.category === 'file_upload').length;

  return (
    <div style={{ maxWidth: 1320 }}>
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="m" wrap>
        <EuiFlexItem>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <QaIcon type="beaker" size="xl" color="#7DE2D1" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiTitle size="m"><h2>Develop & Test</h2></EuiTitle>
              <EuiText size="s" color="subdued">
                <p>Select stories, generate implementation code, validate it with targeted tests, then ship the code branch.</p>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton iconType="search" onClick={() => navigate('/scan-test')}>
            Only Test Existing Code
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      <EuiFlexGroup gutterSize="m">
        <EuiFlexItem>
          <WorkflowCard
            selected={mode === 'develop_test'}
            icon="document"
            title="Build from stories"
            body="Generate application code from selected stories, then create focused validation tests for the changed behavior."
            onClick={() => setMode('develop_test')}
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <WorkflowCard
            selected={mode === 'only_test'}
            icon="searchProfilerApp"
            title="Only Test"
            body="Skip stories. Scan a local or GitHub codebase and generate tests for an already-running app."
            onClick={() => {
              setMode('only_test');
              navigate('/scan-test');
            }}
          />
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="m" />

      {error && (
        <>
          <EuiCallOut title={error} color="danger" iconType="alert" size="s" />
          <EuiSpacer size="m" />
        </>
      )}

      {exportPath && (
        <>
          <EuiCallOut
            title="Scoped tests exported locally"
            color="success"
            iconType="save"
            size="s"
          >
            <p style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{exportPath}</p>
          </EuiCallOut>
          <EuiSpacer size="m" />
        </>
      )}

      <EuiPanel paddingSize="m" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)', borderRadius: 8 }}>
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="m" wrap>
          <EuiFlexItem>
            <EuiTitle size="xs"><h3>1. Select user stories</h3></EuiTitle>
            <EuiText size="s" color="subdued">
              <p style={{ margin: 0 }}>Generation is scoped to the selected stories only. Nothing runs against all stories by default.</p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="s" onClick={selectReadyStories}>Select Ready</EuiButtonEmpty>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="s" onClick={() => setSelectedStoryIds(new Set())}>Clear</EuiButtonEmpty>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        {stories.length === 0 ? (
          <EuiEmptyPrompt
            icon={<QaIcon type="document" size="xl" />}
            title={<h3>No user stories found</h3>}
            body={<p>Add stories first, then return here to generate tests for the selected work.</p>}
            actions={<EuiButton fill onClick={() => navigate('/stories')}>Add Stories</EuiButton>}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {stories.map(story => {
              const selected = selectedStoryIds.has(story.id);
              const statusMeta = STORY_STATUS_META[story.status] || STORY_STATUS_META.draft;
              return (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => toggleStory(story.id)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 8,
                    border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
                    background: selected ? 'rgba(0,191,179,0.06)' : 'var(--code-bg)',
                    padding: 14,
                    cursor: 'pointer',
                    color: 'var(--text-1)',
                    minHeight: 136,
                  }}
                >
                  <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="s" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <QaIcon type={selected ? 'checkInCircleFilled' : 'empty'} color={selected ? '#00BFB3' : 'var(--text-3)'} />
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="hollow" style={{ color: statusMeta.color }}>{statusMeta.label}</EuiBadge>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                  <EuiSpacer size="s" />
                  <EuiText size="s"><strong>{story.title}</strong></EuiText>
                  <EuiText size="xs" color="subdued">
                    <p style={{ margin: '4px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {story.description}
                    </p>
                  </EuiText>
                  <EuiSpacer size="s" />
                  <EuiText size="xs" color="subdued">
                    <p style={{ margin: 0 }}>{story.acceptance_criteria.length} acceptance criteria</p>
                  </EuiText>
                </button>
              );
            })}
          </div>
        )}
      </EuiPanel>

      <EuiSpacer size="m" />

      <EuiPanel paddingSize="m" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)', borderRadius: 8 }}>
        <EuiTitle size="xs"><h3>2. Design the implementation workspace</h3></EuiTitle>
        <EuiText size="s" color="subdued">
          <p style={{ margin: '4px 0 0' }}>
            Choose where the code should be generated, pick the app architecture, and set the validation depth.
          </p>
        </EuiText>

        <EuiSpacer size="m" />

        <EuiFlexGroup gutterSize="m">
          <EuiFlexItem>
            <WorkflowCard
              selected={sourceType === 'synced'}
              icon="document"
              title="Use Synced Codebase"
              body="Use the latest codebase context already synced in the app."
              onClick={() => setSourceType('synced')}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <WorkflowCard
              selected={sourceType === 'local'}
              icon="folderOpen"
              title="Local Codebase"
              body="Scan a local repo path and save implementation files locally."
              onClick={() => {
                setSourceType('local');
                setBranch('local');
              }}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <WorkflowCard
              selected={sourceType === 'git'}
              icon="logoGithub"
              title="Extend an Existing Repo"
              body="Develop a custom feature against a GitHub repo, generate its tests, and prepare a feature branch."
              onClick={() => {
                setSourceType('git');
                setBranch(branch === 'local' ? 'main' : branch);
                setSaveTarget('github');
              }}
            />
          </EuiFlexItem>
        </EuiFlexGroup>

        {sourceType !== 'synced' && (
          <>
            <EuiSpacer size="m" />
            <EuiFlexGroup gutterSize="m" wrap>
              <EuiFlexItem style={{ minWidth: 320 }}>
                <EuiFormRow
                  label={sourceType === 'git' ? 'GitHub repository URL' : 'Local codebase path'}
                  fullWidth
                >
                  <EuiFieldText
                    fullWidth
                    value={codebasePath}
                    onChange={event => setCodebasePath(event.target.value)}
                    placeholder={sourceType === 'git' ? 'https://github.com/owner/repo' : 'C:\\path\\to\\project'}
                    disabled={stream.isStreaming}
                  />
                </EuiFormRow>
              </EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 180, maxWidth: 220 }}>
                <EuiFormRow label={sourceType === 'git' ? 'Base branch' : 'Branch'} fullWidth>
                  <EuiFieldText
                    fullWidth
                    value={branch}
                    onChange={event => setBranch(event.target.value)}
                    disabled={stream.isStreaming || sourceType === 'local'}
                  />
                </EuiFormRow>
              </EuiFlexItem>
              {sourceType === 'git' && (
                <EuiFlexItem style={{ minWidth: 220 }}>
                  <EuiFormRow label="Target feature branch" helpText="Created from the base branch" fullWidth>
                    <EuiFieldText
                      fullWidth
                      value={targetBranch}
                      onChange={event => setTargetBranch(event.target.value)}
                      placeholder="feature/customer-notifications"
                      disabled={stream.isStreaming}
                    />
                  </EuiFormRow>
                </EuiFlexItem>
              )}
              <EuiFlexItem style={{ minWidth: 240 }}>
                <EuiFormRow label="App URL for UI/API execution" fullWidth>
                  <EuiFieldText
                    fullWidth
                    value={appUrl}
                    onChange={event => setAppUrl(event.target.value)}
                    placeholder="http://localhost:3000"
                    disabled={stream.isStreaming}
                  />
                </EuiFormRow>
              </EuiFlexItem>
            </EuiFlexGroup>
          </>
        )}

        {sourceType === 'synced' && (
          <>
            <EuiSpacer size="m" />
            <EuiFormRow label="App URL for UI/API execution" fullWidth>
              <EuiFieldText
                fullWidth
                value={appUrl}
                onChange={event => setAppUrl(event.target.value)}
                placeholder="http://localhost:3000"
                disabled={stream.isStreaming}
              />
            </EuiFormRow>
          </>
        )}

        <EuiSpacer size="m" />

        {sourceType === 'git' && (
          <>
            <section className="develop-featureBrief">
              <div className="develop-featureBrief__head">
                <span className="develop-sectionKicker">Custom feature brief</span>
                <EuiBadge color="accent">Develop + test + ship</EuiBadge>
              </div>
              <EuiText size="s" color="subdued">
                <p>Describe the new behavior to add to this repository. You can use this instead of creating a user story first.</p>
              </EuiText>
              <div className="develop-featureBrief__grid">
                <EuiFormRow label="Feature name" fullWidth>
                  <EuiFieldText
                    fullWidth
                    value={featureTitle}
                    onChange={event => setFeatureTitle(event.target.value)}
                    placeholder="Add saved notification preferences"
                    disabled={stream.isStreaming}
                  />
                </EuiFormRow>
                <EuiFormRow label="Feature requirement" fullWidth>
                  <EuiTextArea
                    fullWidth
                    rows={4}
                    value={featureDescription}
                    onChange={event => setFeatureDescription(event.target.value)}
                    placeholder="Explain the users, behavior, rules, constraints, and expected outcome."
                    disabled={stream.isStreaming}
                  />
                </EuiFormRow>
                <EuiFormRow label="Acceptance criteria" helpText="One verifiable outcome per line" fullWidth>
                  <EuiTextArea
                    fullWidth
                    rows={4}
                    value={featureAcceptance}
                    onChange={event => setFeatureAcceptance(event.target.value)}
                    placeholder={'Users can save channel preferences\nSaved preferences are restored on reload\nInvalid values return a clear error'}
                    disabled={stream.isStreaming}
                  />
                </EuiFormRow>
              </div>
            </section>
            <EuiSpacer size="m" />
          </>
        )}

        <div className="develop-stackHeading">
          <div>
            <EuiTitle size="xs"><h3>Choose a proven tech stack</h3></EuiTitle>
            <EuiText size="s" color="subdued"><p>Start with one of the most-used combinations, or define your own architecture.</p></EuiText>
          </div>
          <EuiBadge color="hollow">{STACK_PRESETS.length - 1} recommended stacks</EuiBadge>
        </div>
        <EuiSpacer size="s" />

        <div className="develop-stackGrid" aria-label="Choose implementation tech stack">
          {STACK_PRESETS.map((preset, index) => {
            const selected = stackPreset === preset.id;
            const accents = ['#00BFB3', '#79AAD9', '#A987D1', '#F1D86F', '#FF9F43'];
            const accent = accents[index % accents.length];
            return (
              <button
                key={preset.id}
                type="button"
                className={`develop-stackCard ${selected ? 'develop-stackCard--selected' : ''}`}
                onClick={() => applyStackPreset(preset.id)}
                disabled={stream.isStreaming}
                style={{ '--stack-accent': accent } as React.CSSProperties}
              >
                <span className="develop-stackCard__check">
                  <QaIcon type={selected ? 'checkInCircleFilled' : 'empty'} size="m" color={selected ? accent : 'var(--text-3)'} />
                </span>
                <span className="develop-stackCard__eyebrow">{preset.popularity}</span>
                <strong>{preset.label}</strong>
                <span className="develop-stackCard__body">
                  {preset.description}
                </span>
                <span className="develop-stackCard__chips">
                  <span>{preset.frontend || 'Frontend'}</span>
                  <span>{preset.backend || 'Backend'}</span>
                  <span>{preset.database || 'Data layer'}</span>
                </span>
              </button>
            );
          })}
        </div>

        <EuiSpacer size="m" />

        <div className={`develop-configGrid ${stackPreset !== 'custom' ? 'develop-configGrid--preset' : ''}`}>
          {stackPreset === 'custom' ? <div className="develop-configPanel">
            <div className="develop-sectionKicker">Implementation stack</div>
            <EuiSpacer size="s" />
            <div className="develop-fieldGrid">
              <EuiFormRow label="Frontend">
                <EuiFieldText
                  value={frontendStack}
                  onChange={event => { setStackPreset('custom'); setFrontendStack(event.target.value); }}
                  disabled={stream.isStreaming}
                />
              </EuiFormRow>
              <EuiFormRow label="Backend">
                <EuiFieldText
                  value={backendStack}
                  onChange={event => { setStackPreset('custom'); setBackendStack(event.target.value); }}
                  disabled={stream.isStreaming}
                />
              </EuiFormRow>
              <EuiFormRow label="Database">
                <EuiFieldText
                  value={databaseStack}
                  onChange={event => { setStackPreset('custom'); setDatabaseStack(event.target.value); }}
                  placeholder="PostgreSQL, MongoDB, none"
                  disabled={stream.isStreaming}
                />
              </EuiFormRow>
            </div>
          </div> : <div className="develop-configPanel develop-selectedStack">
            <div>
              <div className="develop-sectionKicker">Selected architecture</div>
              <strong>{STACK_PRESETS.find(item => item.id === stackPreset)?.label}</strong>
              <p>{frontendStack} · {backendStack} · {databaseStack}</p>
            </div>
            <EuiButtonEmpty size="s" onClick={() => applyStackPreset('custom')}>Customize stack</EuiButtonEmpty>
          </div>}

          <div className="develop-configPanel">
            <div className="develop-sectionKicker">Validation mix</div>
            <EuiSpacer size="s" />
            <div className="develop-testMix">
              <div>
                <strong>UI browser coverage</strong>
                <span>Playwright/Selenium checks for the generated screens and flows.</span>
                <EuiFieldNumber min={0} max={20} value={uiTestCount} onChange={event => setUiTestCount(Number(event.target.value) || 0)} disabled={stream.isStreaming} />
              </div>
              <div>
                <strong>Backend/API coverage</strong>
                <span>Pytest checks for endpoints, validation, and data behavior.</span>
                <EuiFieldNumber min={0} max={30} value={backendTestCount} onChange={event => setBackendTestCount(Number(event.target.value) || 0)} disabled={stream.isStreaming} />
              </div>
            </div>
          </div>
        </div>

        <EuiSpacer size="m" />

        <EuiFormRow label="Custom scenarios" helpText="One scenario per line. These are added to the prompt as mandatory coverage." fullWidth>
          <EuiTextArea
            fullWidth
            compressed
            rows={4}
            value={customScenarios}
            onChange={event => setCustomScenarios(event.target.value)}
            placeholder={'Example:\nInvalid password shows field-level error\nUser cannot register with duplicate email'}
            disabled={stream.isStreaming}
          />
        </EuiFormRow>

        <EuiSpacer size="m" />

        <EuiText size="xs" color="subdued"><strong>DELIVERY TARGET</strong></EuiText>
        <EuiSpacer size="xs" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['local', 'Local'],
            ['github', 'GitHub'],
            ['both', 'Both'],
          ] as [SaveTarget, string][]).map(([value, label]) => (
            <ChoiceChip key={value} selected={saveTarget === value} onClick={() => setSaveTarget(value)}>
              {label}
            </ChoiceChip>
          ))}
        </div>
      </EuiPanel>

      <EuiSpacer size="m" />

      <EuiPanel paddingSize="m" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)', borderRadius: 8 }}>
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="m" wrap>
          <EuiFlexItem>
            <EuiTitle size="xs"><h3>3. Review and approve the plan</h3></EuiTitle>
            <EuiText size="s" color="subdued">
              <p style={{ margin: 0 }}>
                Development starts only after the selected stories, source, stack, and validation plan are approved.
              </p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              color="success"
              iconType="sortRight"
              onClick={approveAndStart}
              isLoading={starting || stream.isStreaming}
              disabled={(!selectedStoryIds.size && !(sourceType === 'git' && featureTitle.trim() && featureDescription.trim())) || starting || stream.isStreaming}
            >
              {stream.isStreaming ? 'Developing and generating' : 'Approve & Start'}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          <DetailBlock title="Selected stories">
            {sourceType === 'git' && featureTitle.trim() && featureDescription.trim() ? (
              <div style={{ display: 'grid', gap: 5 }}>
                <strong>{featureTitle}</strong>
                <span style={{ color: 'var(--text-3)' }}>Custom feature for existing repository</span>
                {selectedStories.length > 0 && <span>Plus {selectedStories.length} selected stor{selectedStories.length === 1 ? 'y' : 'ies'}</span>}
              </div>
            ) : selectedStories.length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {selectedStories.slice(0, 5).map(story => (
                  <span key={story.id}>
                    <strong>{story.title}</strong>
                    <br />
                    <span style={{ color: 'var(--text-3)' }}>{story.project_name || 'General'} • {STORY_STATUS_META[story.status]?.label || story.status}</span>
                  </span>
                ))}
                {selectedStories.length > 5 && <span>{selectedStories.length - 5} more selected</span>}
              </div>
            ) : (
              <span>No stories selected.</span>
            )}
          </DetailBlock>

          <DetailBlock title="Tech stack">
            <div style={{ display: 'grid', gap: 4 }}>
              <span>Frontend: {frontendStack || 'not specified'}</span>
              <span>Backend: {backendStack || 'not specified'}</span>
              <span>Database: {databaseStack || 'not specified'}</span>
            </div>
          </DetailBlock>

          <DetailBlock title="Source and tests">
            <div style={{ display: 'grid', gap: 4 }}>
              <span>Source: {sourceType === 'synced' ? 'latest synced codebase' : codebasePath || 'not set'}</span>
              <span>Branch: {sourceType === 'local' ? 'local' : branch || 'main'}</span>
              {sourceType === 'git' && <span>Push to: {targetBranch || 'not set'}</span>}
              <span>Tests: {uiTestCount} UI, {backendTestCount} backend</span>
              <span>Save: {saveTarget}</span>
            </div>
          </DetailBlock>
        </div>

        {(stream.isStreaming || stream.isComplete || stream.events.length > 0) && (
          <>
            <EuiSpacer size="m" />
            <AgentThinking
              events={stream.events}
              isStreaming={stream.isStreaming}
              isComplete={stream.isComplete}
              error={stream.error}
              generatedCount={stream.generatedCount}
            />
          </>
        )}
      </EuiPanel>

      <EuiSpacer size="m" />

      {developmentArtifact && (
        <>
          <EuiPanel className="develop-deliveryPanel" paddingSize="m">
            <EuiFlexGroup alignItems="flexStart" justifyContent="spaceBetween" gutterSize="m" wrap>
              <EuiFlexItem>
                <div className="develop-deliveryPanel__title">
                  <QaIcon type="document" size="l" color="var(--accent-teal)" />
                  <div>
                    <EuiTitle size="xs"><h3>Implementation code is ready</h3></EuiTitle>
                    <EuiText size="s" color="subdued">
                      <p>{developmentArtifact.files.length} generated file{developmentArtifact.files.length === 1 ? '' : 's'} prepared from the selected stories.</p>
                    </EuiText>
                  </div>
                </div>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <div className="develop-deliveryPanel__actions">
                  {sourceType === 'local' && (
                    <EuiButton size="s" iconType="save" onClick={saveDevelopmentLocal} isLoading={savingDevelopment}>
                      Save Code Locally
                    </EuiButton>
                  )}
                  <EuiButton size="s" fill iconType="logoGithub" onClick={openGitHubPush}>
                    Prepare GitHub Branch
                  </EuiButton>
                </div>
              </EuiFlexItem>
            </EuiFlexGroup>

            <EuiSpacer size="s" />
            <div className="develop-deliveryPanel__meta">
              <span><strong>Workspace</strong><code>{developmentArtifact.root}</code></span>
              <span><strong>Source</strong><code>{developmentArtifact.path_or_url || sourceType}</code></span>
              <span><strong>Target</strong><code>{developmentArtifact.save_target || saveTarget}</code></span>
            </div>
            <EuiSpacer size="s" />
            <div className="develop-fileChips">
              {developmentArtifact.files.slice(0, 8).map(file => (
                <span key={file.path} title={file.purpose || file.path}>
                  <QaIcon type="document" size="s" color="var(--accent-blue)" />
                  {file.path}
                </span>
              ))}
              {developmentArtifact.files.length > 8 && <span>+{developmentArtifact.files.length - 8} more</span>}
            </div>
          </EuiPanel>
          <EuiSpacer size="m" />
        </>
      )}

      <EuiPanel paddingSize="m" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)', borderRadius: 8 }}>
        <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="m" wrap>
          <EuiFlexItem>
            <EuiTitle size="xs"><h3>4. Review and run detailed test cases</h3></EuiTitle>
            <EuiText size="s" color="subdued">
              <p style={{ margin: 0 }}>
                {activeJobId
                  ? `Showing tests from active generation job ${activeJobId.slice(0, 8)}.`
                  : selectedStoryIds.size
                  ? 'Showing tests linked to the selected stories.'
                  : 'Select stories or generate a job to show scoped tests.'}
              </p>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="s" onClick={() => { setActiveJobId(null); localStorage.removeItem(ACTIVE_JOB_KEY); }}>
                  Show Selected Stories
                </EuiButtonEmpty>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton
                  fill
                  color="success"
                  iconType="playFilled"
                  onClick={queueAndRun}
                  disabled={!visibleTests.length}
                >
                  {selectedTestIds.size ? `Run ${selectedTestIds.size} Selected` : `Run ${visibleTests.length} Shown`}
                </EuiButton>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton iconType="save" onClick={exportLocal} disabled={!visibleTests.length}>
                  Save Locally
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        {baseTests.length > 0 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <StatBox label="Shown" value={visibleTests.length} color="#79AAD9" />
              <StatBox label="UI" value={uiCount} color="#F1D86F" />
              <StatBox label="API" value={apiCount} color="#A987D1" />
              <StatBox label="Upload" value={uploadCount} color="#79AAD9" />
              <StatBox label="Approved" value={visibleTests.filter(test => test.status === 'approved').length} color="#00BFB3" />
            </div>
            <EuiSpacer size="m" />
          </>
        )}

        <EuiFlexGroup alignItems="center" gutterSize="s" wrap>
          <EuiFlexItem style={{ minWidth: 240 }}>
            <EuiFieldSearch
              compressed
              fullWidth
              placeholder="Search tests, tags, files"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ChipGroup
              items={[
                ['all', 'All'],
                ['ui', 'UI'],
                ['backend', 'Backend'],
                ['file_upload', 'Upload'],
              ] as [CategoryFilter, string][]}
              value={category}
              onChange={setCategory}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ChipGroup
              items={[
                ['all', 'Any priority'],
                ['high', 'High'],
                ['medium', 'Medium'],
                ['low', 'Low'],
              ] as [PriorityFilter, string][]}
              value={priority}
              onChange={setPriority}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <ChipGroup
              items={[
                ['all', 'Any status'],
                ['generated', 'Pending'],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
              ] as [StatusFilter, string][]}
              value={status}
              onChange={setStatus}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" onClick={selectVisibleTests}>Select shown</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" onClick={clearVisibleTests}>Clear tests</EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="m" />

        {baseTests.length === 0 ? (
          <EuiEmptyPrompt
            icon={<QaIcon type="beaker" size="xl" />}
            title={<h3>No scoped tests yet</h3>}
            body={<p>Select stories and generate tests. Existing old tests stay out of this view until they are linked to the selected stories.</p>}
          />
        ) : visibleTests.length === 0 ? (
          <EuiCallOut title="No tests match the current filters" color="warning" iconType="search" size="s" />
        ) : (
          visibleTests.map(test => (
            <TestCard
              key={test.id}
              test={test}
              story={storyById[test.story_id || '']}
              selected={selectedTestIds.has(test.id)}
              onToggle={() => toggleTest(test.id)}
              onApprove={() => updateStatus(test.id, 'approved')}
              onReject={() => updateStatus(test.id, 'rejected')}
              onDelete={() => deleteTest(test.id)}
            />
          ))
        )}
      </EuiPanel>

      {stream.isStreaming && (
        <div
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--sidebar-bg)',
            border: '1px solid rgba(0,191,179,0.3)',
            boxShadow: 'var(--shadow-card)',
            zIndex: 20,
          }}
        >
          <EuiLoadingSpinner size="m" />
          <EuiText size="s"><strong>Generating selected-story tests...</strong></EuiText>
        </div>
      )}
    </div>
  );
}

function WorkflowCard({
  selected,
  icon,
  title,
  body,
  onClick,
}: {
  selected: boolean;
  icon: string;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        minHeight: 116,
        textAlign: 'left',
        borderRadius: 8,
        border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
        background: selected ? 'rgba(0,191,179,0.07)' : 'var(--surface-1)',
        color: 'var(--text-1)',
        padding: 16,
        cursor: 'pointer',
      }}
    >
      <EuiFlexGroup gutterSize="s" alignItems="flexStart" responsive={false}>
        <EuiFlexItem grow={false}>
          <QaIcon type={icon} size="l" color={selected ? '#00BFB3' : 'var(--text-3)'} />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="s"><strong>{title}</strong></EuiText>
          <EuiText size="xs" color="subdued">
            <p style={{ margin: '4px 0 0', lineHeight: 1.5 }}>{body}</p>
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    </button>
  );
}

function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${selected ? '#00BFB3' : 'var(--border-dim)'}`,
        background: selected ? 'rgba(0,191,179,0.08)' : 'var(--code-bg)',
        color: selected ? '#00BFB3' : 'var(--text-2)',
        borderRadius: 999,
        padding: '7px 12px',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ChipGroup<T extends string>({
  items,
  value,
  onChange,
}: {
  items: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map(([itemValue, label]) => (
        <ChoiceChip key={itemValue} selected={value === itemValue} onClick={() => onChange(itemValue)}>
          {label}
        </ChoiceChip>
      ))}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: 'var(--code-bg)',
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        padding: '12px 14px',
        textAlign: 'center',
      }}
    >
      <div style={{ color, fontSize: 24, lineHeight: 1, fontWeight: 800 }}>{value}</div>
      <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 5, textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}
