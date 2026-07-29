import React, { useState, useEffect, useCallback } from 'react';
import { EuiCodeBlock, EuiLoadingSpinner } from '@elastic/eui';
import { useNavigate } from 'react-router-dom';
import QaIcon from '../components/QaIcon';
import { executionApi, testsApi } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import type { ExecutionJob, GeneratedTest, Discrepancy, TestResult } from '../types';
import { CATEGORY_META, PRIORITY_META } from '../types';

type Tab = 'queue' | 'results' | 'discrepancies';

// ─── status helpers ────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  passed:  { bg: 'rgba(0,191,179,0.06)',  border: 'rgba(0,191,179,0.25)',  dot: '#00BFB3', glow: 'rgba(0,191,179,0.4)',  label: 'PASSED',  color: '#00BFB3' },
  failed:  { bg: 'rgba(248,107,99,0.06)', border: 'rgba(248,107,99,0.25)', dot: '#F86B63', glow: 'rgba(248,107,99,0.4)', label: 'FAILED',  color: '#F86B63' },
  error:   { bg: 'rgba(241,216,111,0.04)',border: 'rgba(241,216,111,0.2)', dot: '#F1D86F', glow: 'rgba(241,216,111,0.4)',label: 'ERROR',   color: '#F1D86F' },
  skipped: { bg: 'rgba(107,116,133,0.06)',border: 'rgba(107,116,133,0.2)', dot: 'var(--text-2)', glow: 'rgba(107,116,133,0.3)',label: 'SKIPPED', color: 'var(--text-2)' },
} as const;

function sStyle(s: string) { return STATUS_STYLE[s as keyof typeof STATUS_STYLE] ?? STATUS_STYLE.error; }

const isUiTest = (test: Pick<GeneratedTest, 'test_type' | 'category'>) =>
  test.category === 'ui' || test.test_type === 'selenium' || test.test_type === 'playwright';

// ─── Queue item with reorder controls ─────────────────────────────────────────
function QueueItem({ test, index, total, onRemove, onMoveUp, onMoveDown }: {
  test: GeneratedTest; index: number; total: number;
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  const cat = CATEGORY_META[test.category as keyof typeof CATEGORY_META] || CATEGORY_META.backend;
  const pri = PRIORITY_META[test.priority as keyof typeof PRIORITY_META] || PRIORITY_META.medium;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: 'var(--surface-1)', border: '1px solid var(--border-faint)',
      borderRadius: 10, marginBottom: 6, animation: 'fadeInUp 0.2s ease',
    }}>
      {/* Rank */}
      <div style={{
        width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,191,179,0.1)',
        border: '1px solid rgba(0,191,179,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#00BFB3', flexShrink: 0,
      }}>{index + 1}</div>

      {/* Priority dot + category badge */}
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: pri.dot, flexShrink: 0, boxShadow: `0 0 5px ${pri.dot}70` }} />
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
        background: cat.bg, color: cat.color, border: `1px solid ${cat.color}30`, flexShrink: 0,
      }}>{cat.label}</span>

      {/* Name + file */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{test.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>{test.file_name}</div>
      </div>

      {/* Reorder + remove */}
      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
        <IcoBtn onClick={onMoveUp}   disabled={index === 0}         title="Move up">↑</IcoBtn>
        <IcoBtn onClick={onMoveDown} disabled={index === total - 1} title="Move down">↓</IcoBtn>
        <IcoBtn onClick={onRemove} danger title="Remove from queue">✕</IcoBtn>
      </div>
    </div>
  );
}

function IcoBtn({ onClick, disabled, danger, title, children }: {
  onClick: () => void; disabled?: boolean; danger?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border-faint)',
        background: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-3)' : danger ? '#F86B63' : 'var(--text-2)',
        fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(248,107,99,0.1)' : 'var(--border-faint)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

// ─── Expected vs Actual panel ─────────────────────────────────────────────────
function BehaviorPanel({ expected, actual, status }: { expected: string; actual: string; status: string }) {
  const isPass = status === 'passed';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>Expected Behavior</div>
        <div style={{
          padding: '10px 13px', borderRadius: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6,
          background: 'var(--row-hover-bg)', border: '1px solid var(--border-faint)', minHeight: 52,
        }}>{expected || '—'}</div>
      </div>
      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
          color: isPass ? '#00BFB3' : status === 'failed' ? '#F86B63' : 'var(--text-3)' }}>Actual Behavior</div>
        <div style={{
          padding: '10px 13px', borderRadius: 8, fontSize: 12, lineHeight: 1.6, minHeight: 52,
          color: isPass ? '#7DE2D1' : status === 'failed' ? '#F8948D' : 'var(--text-2)',
          background: isPass ? 'rgba(0,191,179,0.04)' : status === 'failed' ? 'rgba(248,107,99,0.04)' : 'var(--row-hover-bg)',
          border: isPass ? '1px solid rgba(0,191,179,0.15)' : status === 'failed' ? '1px solid rgba(248,107,99,0.15)' : '1px solid var(--border-faint)',
        }}>{actual || '—'}</div>
      </div>
    </div>
  );
}

// ─── Step details timeline ────────────────────────────────────────────────────
function StepTimeline({ steps, logs }: { steps: any[]; logs: string[] }) {
  const items = steps.length > 0 ? steps : logs.map(l => ({ step: l, status: l.includes('PASSED') ? 'pass' : l.includes('FAILED') ? 'fail' : 'info' }));
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 8 }}>Execution Steps</div>
      <div style={{ position: 'relative', paddingLeft: 18 }}>
        <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 1, background: 'var(--border-faint)' }} />
        {items.map((s: any, i: number) => {
          const c = s.status === 'pass' ? '#00BFB3' : s.status === 'fail' ? '#F86B63' : 'var(--text-3)';
          return (
            <div key={i} style={{ position: 'relative', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ position: 'absolute', left: -15, top: 4, width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 4px ${c}60`, flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: c === 'var(--text-3)' ? 'var(--text-2)' : c, lineHeight: 1.5 }}>
                {s.step}
                {s.detail && <span style={{ color: 'var(--text-3)', marginLeft: 6, fontSize: 10 }}>— {s.detail}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Single result card ───────────────────────────────────────────────────────
function ResultCard({ result, test, index }: { result: TestResult; test?: GeneratedTest; index: number }) {
  const [open, setOpen] = useState(false);
  const st = sStyle(result.status);
  const shotSrc = result.screenshot_url || (result.screenshot_b64 ? `data:image/png;base64,${result.screenshot_b64}` : null);
  const hasShot = !!shotSrc;
  const hasData = result.test_data && Object.keys(result.test_data).length > 0;
  const hasNeg  = result.negative_errors && result.negative_errors.length > 0;

  return (
    <div style={{
      background: st.bg, border: `1px solid ${st.border}`,
      borderRadius: 12, marginBottom: 8, overflow: 'hidden',
      animation: `fadeInUp 0.3s ease ${index * 0.05}s both`,
    }}>
      {/* Compact row — click to expand */}
      <div style={{ padding: '13px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
        onClick={() => setOpen(o => !o)}>

        {/* Big status indicator */}
        <div style={{
          width: 48, height: 48, borderRadius: 10, flexShrink: 0,
          background: `linear-gradient(135deg, ${st.dot}22, ${st.dot}0a)`,
          border: `1px solid ${st.dot}40`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 14px ${st.glow}`,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: st.dot, marginBottom: 3, boxShadow: `0 0 8px ${st.dot}` }} />
          <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '0.06em', color: st.color }}>{st.label}</div>
        </div>

        {/* Category + priority */}
        {test && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
            {(() => {
              const cat = CATEGORY_META[test.category as keyof typeof CATEGORY_META] || CATEGORY_META.backend;
              const pri = PRIORITY_META[test.priority as keyof typeof PRIORITY_META] || PRIORITY_META.medium;
              return (
                <>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: cat.bg, color: cat.color }}>{cat.label}</span>
                  <span style={{ fontSize: 8, fontWeight: 600, color: pri.color }}>{test.priority.toUpperCase()}</span>
                </>
              );
            })()}
          </div>
        )}

        {/* Name + file */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2 }}>{result.test_name}</div>
          {test && <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace' }}>{test.file_name}</div>}
        </div>

        {/* Duration */}
        {!!result.duration_ms && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
            {result.duration_ms < 1000 ? `${Math.round(result.duration_ms)}ms` : `${(result.duration_ms / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Quick indicators */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {hasShot && <span title="Screenshot" style={{ fontSize: 12, opacity: 0.7 }}>📷</span>}
          {hasNeg  && <span title="Validation errors" style={{ fontSize: 12, color: '#F86B63' }}>⚠</span>}
          {hasData && <span title="Test data" style={{ fontSize: 12, opacity: 0.7 }}>🗂</span>}
        </div>

        <QaIcon type={open ? 'arrowUp' : 'arrowDown'} size="s" color="#3A4255" />
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ borderTop: '1px solid var(--control-hover)', padding: '16px', animation: 'fadeInUp 0.2s ease' }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {/* Left: screenshot */}
            {hasShot && (
              <div style={{ flex: '0 0 auto', maxWidth: 380 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 8 }}>UI Screenshot</div>
                <div style={{
                  borderRadius: 10, overflow: 'hidden', position: 'relative',
                  border: `2px solid ${st.dot}40`, boxShadow: `0 4px 20px ${st.glow}`,
                }}>
                  <img src={shotSrc!} alt={result.test_name}
                    style={{ width: '100%', display: 'block' }} />
                  <div style={{
                    position: 'absolute', top: 8, right: 8, padding: '3px 10px', borderRadius: 20,
                    background: `${st.dot}cc`, color: '#000', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                  }}>{st.label}</div>
                </div>
                {result.screenshot_path && (
                  <div style={{
                    marginTop: 6, fontSize: 10, color: 'var(--text-3)',
                    fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all',
                  }}>
                    Saved to {result.screenshot_path}
                  </div>
                )}
              </div>
            )}

            {/* Right: detail panel */}
            <div style={{ flex: 1, minWidth: 240 }}>
              {/* Expected vs Actual */}
              <BehaviorPanel
                expected={(test?.expected_results || []).join('\n') || result.expected_behavior || ''}
                actual={result.actual_behavior || (result.actual_output ? result.actual_output.substring(0, 300) : '')}
                status={result.status}
              />

              {/* Test data pills */}
              {hasData && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>Test Data</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {Object.entries(result.test_data!).map(([k, v]) => (
                      <span key={k} style={{
                        fontSize: 10, padding: '3px 9px', borderRadius: 20, fontFamily: 'JetBrains Mono, monospace',
                        background: 'var(--code-bg)', border: '1px solid var(--border-faint)',
                      }}>
                        <span style={{ color: '#A987D1' }}>{k}</span>
                        <span style={{ color: 'var(--text-3)', margin: '0 3px' }}>:</span>
                        <span style={{ color: 'var(--text-2)' }}>{String(v)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Negative errors */}
              {hasNeg && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#F86B63', textTransform: 'uppercase', marginBottom: 6 }}>
                    Validation Errors Captured
                  </div>
                  {result.negative_errors!.map((e, i) => (
                    <div key={i} style={{
                      padding: '7px 12px', borderRadius: 7, marginBottom: 4, fontSize: 11, color: '#F8948D',
                      background: 'rgba(248,107,99,0.06)', border: '1px solid rgba(248,107,99,0.2)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      ⚠ {e}
                    </div>
                  ))}
                </div>
              )}

              {/* Error trace */}
              {result.error_message && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#F86B63', textTransform: 'uppercase', marginBottom: 6 }}>Error Trace</div>
                  <pre style={{
                    margin: 0, padding: '10px 13px', borderRadius: 8, overflow: 'auto', maxHeight: 200,
                    background: 'rgba(248,107,99,0.06)', border: '1px solid rgba(248,107,99,0.18)',
                    fontSize: 11, color: '#F86B63', fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{result.error_message}</pre>
                </div>
              )}

              {/* Steps */}
              <StepTimeline steps={result.step_details || []} logs={result.steps_log || []} />

              {/* Raw output collapsible */}
              {result.actual_output && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', userSelect: 'none' }}>
                    ▸ raw output ({result.actual_output.length} chars)
                  </summary>
                  <pre style={{
                    margin: '8px 0 0', padding: '10px 13px', borderRadius: 8, overflow: 'auto', maxHeight: 220,
                    background: 'var(--code-bg)', border: '1px solid var(--border-faint)',
                    fontSize: 10, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{result.actual_output}</pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pass rate radial gauge ───────────────────────────────────────────────────
function PassGauge({ pct }: { pct: number }) {
  const r = 38, circ = 2 * Math.PI * r;
  const c = pct >= 80 ? '#00BFB3' : pct >= 50 ? '#F1D86F' : '#F86B63';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={100} height={100} viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--border-faint)" strokeWidth={8} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={c} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', fontSize: 18, fontWeight: 800, color: c }}>{pct}%</div>
      <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>Pass Rate</div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RunTests() {
  const navigate  = useNavigate();
  const [allTests,    setAllTests]    = useState<GeneratedTest[]>([]);
  const [queueIds,    setQueueIds]    = useState<string[]>([]);
  const [latestJob,   setLatestJob]   = useState<ExecutionJob | null>(null);
  const [jobId,       setJobId]       = useState<string | null>(null);
  const [running,     setRunning]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [activeTab,   setActiveTab]   = useState<Tab>('queue');

  // ── Bootstrap: read queue + tests ─────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem('qa_run_queue');
    if (raw) {
      try { setQueueIds(JSON.parse(raw)); } catch {}
    }
    testsApi.list().then(setAllTests).catch(() => {});
    executionApi.listJobs().then(jobs => {
      if (!jobs.length) return;
      const latest = jobs.sort((a: any, b: any) => ((b.started_at || '') > (a.started_at || '') ? 1 : -1))[0];
      setLatestJob(latest);
      if (latest.status === 'completed' || latest.status === 'failed') setActiveTab('results');
    }).catch(() => {});
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────
  const stopPolling = useCallback((j: ExecutionJob) => j.status === 'completed' || j.status === 'failed', []);
  const fetcher     = useCallback(() => executionApi.getJob(jobId!), [jobId]);
  const { data: polledJob, start: startPolling } = usePolling<ExecutionJob>(fetcher, stopPolling, 2000);

  useEffect(() => {
    if (!polledJob) return;
    setLatestJob(polledJob);
    if (polledJob.status === 'completed' || polledJob.status === 'failed') {
      setRunning(false);
      setActiveTab('results');
    }
  }, [polledJob]);

  // ── Queue helpers ─────────────────────────────────────────────────────────
  const queuedTests = queueIds
    .map(id => allTests.find(t => t.id === id))
    .filter(Boolean) as GeneratedTest[];

  const moveUp   = (i: number) => setQueueIds(ids => { const n = [...ids]; [n[i-1],n[i]] = [n[i],n[i-1]]; persist(n); return n; });
  const moveDown = (i: number) => setQueueIds(ids => { const n = [...ids]; [n[i],n[i+1]] = [n[i+1],n[i]]; persist(n); return n; });
  const remove   = (id: string) => setQueueIds(ids => { const n = ids.filter(x => x !== id); persist(n); return n; });
  const persist  = (ids: string[]) => localStorage.setItem('qa_run_queue', JSON.stringify(ids));

  const addAll = () => {
    const approved = allTests.filter(t => t.status !== 'rejected').map(t => t.id);
    setQueueIds(approved);
    persist(approved);
  };

  // ── Run ───────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!queueIds.length) return;
    setError(null); setRunning(true); setDiscrepancies([]);
    try {
      let runnableIds = queueIds;
      const queued = queueIds
        .map(id => allTests.find(t => t.id === id))
        .filter(Boolean) as GeneratedTest[];
      const hasUi = queued.some(isUiTest);
      if (hasUi) {
        const appUrl = localStorage.getItem('qa_app_url') || 'http://localhost:3000';
        const preflight = await executionApi.preflight(appUrl);
        if (!preflight.running) {
          runnableIds = queued
            .filter(t => !isUiTest(t))
            .map(t => t.id);
          if (!runnableIds.length) {
            setError(`${preflight.message}. UI tests were not started.`);
            setRunning(false);
            return;
          }
          setError(`${preflight.message}. Running backend tests only.`);
          setQueueIds(runnableIds);
          persist(runnableIds);
        }
      }
      const res = await executionApi.runOrdered(runnableIds);
      setJobId(res.job_id);
      startPolling();
      setActiveTab('results');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to start execution');
      setRunning(false);
    }
  };

  // ── Analyze ───────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!latestJob) return;
    setAnalyzing(true);
    try {
      const disc = await executionApi.analyzeDiscrepancies(latestJob.id);
      setDiscrepancies(disc);
      setActiveTab('discrepancies');
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Analysis failed');
    } finally { setAnalyzing(false); }
  };

  const job      = latestJob;
  const results  = (job?.results || []) as TestResult[];
  const progress = job && job.total > 0 ? Math.round((results.length / job.total) * 100) : 0;
  const passRate = job && job.total > 0 ? Math.round(((job.passed || 0) / job.total) * 100) : 0;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'queue',        label: `Queue (${queueIds.length})` },
    { id: 'results',      label: results.length ? `Results (${results.length})` : 'Results' },
    { id: 'discrepancies',label: discrepancies.length ? `AI Analysis (${discrepancies.length})` : 'AI Analysis' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <QaIcon type="playFilled" size="xl" color="#7DE2D1" />
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.03em' }}>Test Runner</h2>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
            Selective ordered execution — screenshots, expected vs. actual, step-by-step results
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate('/generate')} style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-dim)',
            background: 'none', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer',
          }}>← Test Manager</button>

          <button
            onClick={handleRun}
            disabled={!queueIds.length || running}
            style={{
              padding: '10px 22px', borderRadius: 9, border: 'none',
              cursor: queueIds.length && !running ? 'pointer' : 'not-allowed',
              background: queueIds.length && !running ? 'linear-gradient(135deg, #7DE2D1, #00BFB3)' : 'var(--border-faint)',
              color: queueIds.length && !running ? '#000' : 'var(--text-3)',
              fontWeight: 700, fontSize: 13,
              boxShadow: queueIds.length && !running ? '0 2px 16px rgba(0,191,179,0.35)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.18s ease',
            }}
            onMouseEnter={e => { if (queueIds.length && !running) e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {running ? <><EuiLoadingSpinner size="s" /> Running…</> : <><QaIcon type="playFilled" size="s" color={queueIds.length ? '#000' : 'var(--text-3)'} /> Run {queueIds.length} Tests</>}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(248,107,99,0.08)', border: '1px solid rgba(248,107,99,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#F86B63' }}>
          ✕ {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border-faint)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
            color: activeTab === tab.id ? '#00BFB3' : 'var(--text-2)',
            borderBottom: activeTab === tab.id ? '2px solid #00BFB3' : '2px solid transparent',
            transition: 'all 0.18s ease', marginBottom: -1,
          }}>{tab.label}</button>
        ))}
      </div>

      {/* ── QUEUE TAB ── */}
      {activeTab === 'queue' && (
        <div style={{ animation: 'fadeInUp 0.25s ease' }}>
          {/* Empty state */}
          {queueIds.length === 0 && (
            <div className="qa-glass" style={{ padding: '40px', textAlign: 'center' }}>
              <QaIcon type="playFilled" size="xl" color="#3A4255" />
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', marginTop: 14 }}>Queue is empty</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6, marginBottom: 20 }}>
                Select tests in the Test Manager and click "Run Selected" — or add all here.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => navigate('/generate')} style={{
                  padding: '10px 20px', borderRadius: 9, border: '1px solid rgba(0,191,179,0.3)',
                  background: 'rgba(0,191,179,0.06)', color: '#00BFB3',
                  fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}>Go to Test Manager</button>
                <button onClick={addAll} style={{
                  padding: '10px 20px', borderRadius: 9, border: 'none',
                  background: 'linear-gradient(135deg, #00BFB3, #00A099)', color: '#000',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>Add All Tests</button>
              </div>
            </div>
          )}

          {/* Queue list */}
          {queueIds.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {queueIds.length} tests · drag to reorder · tests run in this exact order
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={addAll} style={{ fontSize: 11, color: '#A987D1', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add All</button>
                  <button onClick={() => { setQueueIds([]); persist([]); }} style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear Queue</button>
                </div>
              </div>

              {queuedTests.map((t, i) => (
                <QueueItem
                  key={t.id} test={t} index={i} total={queuedTests.length}
                  onRemove={() => remove(t.id)}
                  onMoveUp={() => moveUp(i)}
                  onMoveDown={() => moveDown(i)}
                />
              ))}

              <div style={{ marginTop: 16 }}>
                <button
                  onClick={handleRun} disabled={running}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                    cursor: running ? 'wait' : 'pointer',
                    background: running ? 'var(--border-faint)' : 'linear-gradient(135deg, #7DE2D1, #00BFB3)',
                    color: running ? 'var(--text-3)' : '#000', fontWeight: 700, fontSize: 14,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    boxShadow: !running ? '0 4px 20px rgba(0,191,179,0.3)' : 'none',
                    transition: 'all 0.18s ease',
                  }}
                >
                  {running
                    ? <><EuiLoadingSpinner size="s" /> Running tests…</>
                    : <><QaIcon type="playFilled" size="s" color="#000" /> Run {queueIds.length} Tests in Order</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── RESULTS TAB ── */}
      {activeTab === 'results' && (
        <div style={{ animation: 'fadeInUp 0.25s ease' }}>
          {/* Running progress */}
          {running && (
            <div className="qa-glass" style={{ padding: '16px 20px', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <EuiLoadingSpinner size="m" />
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  <strong style={{ color: 'var(--text-1)' }}>{results.length}</strong> / <strong style={{ color: 'var(--text-1)' }}>{job?.total || queueIds.length}</strong> tests complete
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 13, color: '#00BFB3', fontWeight: 700 }}>{progress}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--control-hover)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, transition: 'width 0.5s ease',
                  background: 'linear-gradient(90deg, #00BFB3, #7DE2D1)',
                  width: `${progress}%`,
                }} />
              </div>
            </div>
          )}

          {/* Stats row */}
          {job && (job.status === 'completed' || job.status === 'failed') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10, marginBottom: 20 }}>
              <div className="qa-glass" style={{ padding: '12px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#79AAD9', lineHeight: 1 }}>{job.total}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total</div>
              </div>
              <div className="qa-glass" style={{ padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#00BFB3', lineHeight: 1 }}>{job.passed}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Passed</div>
              </div>
              <div className="qa-glass" style={{ padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#F86B63', lineHeight: 1 }}>{job.failed}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Failed</div>
              </div>
              <div className="qa-glass" style={{ padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#F1D86F', lineHeight: 1 }}>{job.errors}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Errors</div>
              </div>
              <div className="qa-glass" style={{ padding: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <PassGauge pct={passRate} />
              </div>
              {(job.failed > 0 || job.errors > 0) && (
                <button onClick={handleAnalyze} disabled={analyzing} style={{
                  padding: '12px', borderRadius: 12, border: '1px solid rgba(241,216,111,0.3)',
                  background: 'rgba(241,216,111,0.06)', color: '#F1D86F', cursor: analyzing ? 'wait' : 'pointer',
                  fontWeight: 600, fontSize: 11, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                  transition: 'all 0.18s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(241,216,111,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(241,216,111,0.06)')}>
                  {analyzing ? <EuiLoadingSpinner size="s" /> : <QaIcon type="inspect" size="m" color="#F1D86F" />}
                  <span>AI Analyze</span>
                </button>
              )}
            </div>
          )}

          {results.length === 0 && !running && (
            <div className="qa-glass" style={{ padding: '36px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                {queueIds.length > 0 ? 'Click "Run Tests in Order" to execute the queue.' : 'Add tests to the queue first.'}
              </div>
            </div>
          )}

          {results.map((r, i) => (
            <ResultCard
              key={r.test_id}
              result={r}
              test={allTests.find(t => t.id === r.test_id)}
              index={i}
            />
          ))}
        </div>
      )}

      {/* ── DISCREPANCIES TAB ── */}
      {activeTab === 'discrepancies' && (
        <div style={{ animation: 'fadeInUp 0.25s ease' }}>
          {discrepancies.length === 0 ? (
            <div className="qa-glass" style={{ padding: '40px', textAlign: 'center' }}>
              <QaIcon type="inspect" size="xl" color="#3A4255" />
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', marginTop: 14 }}>AI Failure Analysis</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6, marginBottom: 20 }}>
                {analyzing ? 'Analyzing failures with Claude…' : 'Run tests first, then click "AI Analyze" on failures.'}
              </div>
              {analyzing && <EuiLoadingSpinner size="l" />}
            </div>
          ) : (
            discrepancies.map((d, i) => {
              const sevColor = d.severity === 'high' ? '#F86B63' : d.severity === 'medium' ? '#F1D86F' : 'var(--text-2)';
              return (
                <div key={i} className="qa-glass" style={{
                  padding: '16px 18px', marginBottom: 10,
                  borderLeft: `3px solid ${sevColor}`,
                  animation: `fadeInUp 0.3s ease ${i * 0.06}s both`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px',
                      borderRadius: 20, background: `${sevColor}18`, color: sevColor, border: `1px solid ${sevColor}30`,
                    }}>{d.severity.toUpperCase()}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{d.test_name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>{d.test_type}</span>
                  </div>

                  {d.ai_analysis && (
                    <div style={{
                      fontSize: 12, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.7,
                      padding: '10px 14px', background: 'var(--row-hover-bg)', borderRadius: 8,
                    }}>
                      <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Root Cause Analysis: </span>{d.ai_analysis}
                    </div>
                  )}

                  {d.proposed_fix && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 8, fontSize: 12, color: '#7DE2D1', lineHeight: 1.6,
                      background: 'rgba(0,191,179,0.05)', border: '1px solid rgba(0,191,179,0.18)',
                    }}>
                      <span style={{ fontWeight: 600, marginRight: 6 }}>Proposed Fix:</span>{d.proposed_fix}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
