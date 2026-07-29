import React, { useEffect, useState } from 'react';
import { EuiLoadingSpinner } from '@elastic/eui';
import QaIcon from '../components/QaIcon';
import { useNavigate } from 'react-router-dom';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import MetricCard from '../components/MetricCard';
import { dashboardApi } from '../services/api';
import type { DashboardStats } from '../types';

const STEPS = [
  { label: 'Upload Stories',  path: '/stories',   icon: 'document',     color: '#79AAD9' },
  { label: 'Sync Codebase',   path: '/codebase',  icon: 'branchUser',   color: '#A987D1' },
  { label: 'Develop & Test',  path: '/generate',  icon: 'beaker',       color: '#F1D86F' },
  { label: 'Run Tests',       path: '/run',       icon: 'playFilled',   color: '#00BFB3' },
  { label: 'Push to GitHub',  path: '/github',    icon: 'logoGithub',   color: '#E8E8E8' },
];

const CHART_COLORS = ['#00BFB3', '#F86B63', '#A987D1', '#F1D86F'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--tooltip-bg)', border: '1px solid var(--border-dim)',
      borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(12px)',
    }}>
      <div style={{ color: 'var(--text-2)', fontSize: 11, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color, fontSize: 12, fontWeight: 600 }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.stats().then(setStats).catch(console.error).finally(() => setLoading(false));
    const t = setInterval(() => dashboardApi.stats().then(setStats).catch(() => {}), 8000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <EuiLoadingSpinner size="xl" />
      </div>
    );
  }

  const s = stats!;
  const passRate = s.pass_rate || 0;
  const currentStep = s.total_stories === 0 ? 0 : s.total_tests_generated === 0 ? 2 : s.tests_executed === 0 ? 3 : 4;

  const pieData = [
    { name: 'Approved', value: s.tests_approved },
    { name: 'Pending', value: Math.max(0, s.total_tests_generated - s.tests_approved) },
  ].filter(d => d.value > 0);

  const runCoverage = s.total_tests_generated
    ? Math.round((s.tests_executed / s.total_tests_generated) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, animation: 'fadeInUp 0.4s ease' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 11,
              background: 'linear-gradient(135deg, rgba(0,191,179,0.22), rgba(169,135,209,0.18))',
              border: '1px solid rgba(0,191,179,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(0,191,179,0.18)',
            }}>
              <QaIcon type="beaker" size="l" color="#00BFB3" />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.03em' }}>
                AI QA Copilot
              </h1>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
                From requirements to full test coverage — automatically.
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate(s.total_stories === 0 ? '/stories' : '/generate')}
          style={{
            padding: '10px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #00BFB3, #00A099)',
            color: '#000', fontWeight: 700, fontSize: 13, letterSpacing: '0.02em',
            boxShadow: '0 2px 16px rgba(0,191,179,0.38)',
            transition: 'all 0.18s ease', display: 'flex', alignItems: 'center', gap: 7,
          }}
          onMouseEnter={e => { (e.currentTarget.style.transform = 'translateY(-2px)'); (e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,191,179,0.55)'); }}
          onMouseLeave={e => { (e.currentTarget.style.transform = 'translateY(0)'); (e.currentTarget.style.boxShadow = '0 2px 16px rgba(0,191,179,0.38)'); }}
        >
          <QaIcon type="playFilled" size="s" color="#000" />
          {s.total_stories === 0 ? 'Get Started' : 'Continue Workflow'}
        </button>
      </div>

      {/* Workflow progress */}
      <div className="qa-glass" style={{ padding: '16px 20px', marginBottom: 24, animation: 'fadeInUp 0.4s ease 0.05s both' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 14 }}>
          Workflow Progress
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {STEPS.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <React.Fragment key={step.label}>
                <div
                  className={`qa-wf-step${active ? ' qa-wf-step--active' : ''}`}
                  onClick={() => navigate(step.path)}
                  style={{ flex: 1 }}
                >
                  <div className={`qa-wf-step__num qa-wf-step__num--${done ? 'done' : active ? 'active' : 'todo'}`}>
                    {done ? <QaIcon type="check" size="s" color={step.color} /> : <span style={{ fontSize: 10 }}>{i + 1}</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? 'var(--text-1)' : done ? 'var(--text-2)' : 'var(--text-3)', transition: 'color 0.2s' }}>
                      {step.label}
                    </div>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ width: 20, height: 1, background: i < currentStep ? 'rgba(0,191,179,0.35)' : 'var(--border-faint)', flexShrink: 0 }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Metric cards */}
      <div className="qa-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <MetricCard title="User Stories"    value={s.total_stories}         icon="document"   color="#79AAD9" description="requirements loaded"   delay={0.05} onClick={() => navigate('/stories')} />
        <MetricCard title="Tests Generated" value={s.total_tests_generated} icon="beaker"     color="#00BFB3" description={`${s.tests_approved} approved`} delay={0.10} onClick={() => navigate('/generate')} />
        <MetricCard title="Tests Executed"  value={s.tests_executed}        icon="playFilled" color="#A987D1" description={`${passRate}% pass rate`} delay={0.15} onClick={() => navigate('/run')} />
        <MetricCard title="Time Saved"      value={`${s.time_saved_hours}h`} icon="clock"     color="#F1D86F" description="from generated tests"      delay={0.20} onClick={() => navigate('/scan-test')} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 16, marginBottom: 24 }}>
        {/* Pie chart */}
        <div className="qa-glass" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 12 }}>Test Status</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={44} outerRadius={68} dataKey="value" paddingAngle={3}>
                  {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} stroke="none" />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              No tests yet
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 4 }}>
            {pieData.map((d, i) => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i] }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{d.name} ({d.value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pass rate gauge */}
        <div className="qa-glass" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 16 }}>Pass Rate</div>
          <div style={{ position: 'relative', width: 120, height: 120 }}>
            <svg viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-faint)" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="50" fill="none"
                stroke={passRate >= 80 ? '#00BFB3' : passRate >= 50 ? '#F1D86F' : '#F86B63'}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(passRate / 100) * 314} 314`}
                style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)' }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: passRate >= 80 ? '#00BFB3' : passRate >= 50 ? '#F1D86F' : '#F86B63', letterSpacing: '-0.04em' }}>{passRate}%</div>
              <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 500 }}>pass rate</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
            {[{ v: s.tests_executed, l: 'Executed', c: 'var(--text-2)' }].map(it => (
              <div key={it.l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: it.c }}>{it.v}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{it.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity feed */}
        <div className="qa-glass" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 12 }}>Recent Activity</div>
          {s.recent_activity.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>No activity yet</div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 200 }}>
              {s.recent_activity.slice(0, 8).map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '7px 0', borderBottom: '1px solid var(--control-hover)',
                  animation: `slideInRow 0.2s ease ${i * 0.04}s both`,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00BFB3', marginTop: 5, flexShrink: 0, opacity: 0.7 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{a.message}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Workspace summary */}
      <div className="qa-glass" style={{ padding: '20px 24px', animation: 'fadeInUp 0.4s ease 0.3s both' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 4 }}>
              Workspace Summary
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Live totals from saved jobs and generated assets</div>
          </div>
          <div style={{ display: 'flex', gap: 32 }}>
            {[
              { value: s.generation_jobs, label: 'Generation jobs', color: '#00BFB3', path: '/generate' },
              { value: s.execution_jobs,  label: 'Execution jobs',  color: '#A987D1', path: '/run' },
              { value: '2×',  label: 'Edge case coverage',      color: '#A987D1' },
              { value: `${runCoverage}%`, label: 'Generated tests run', color: '#F1D86F', path: '/run' },
            ].filter(it => Boolean((it as any).path)).map(it => (
              <button
                key={it.label}
                onClick={() => navigate((it as any).path || '/')}
                style={{ textAlign: 'center', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 28, fontWeight: 800, color: it.color, letterSpacing: '-0.04em', lineHeight: 1 }}>{it.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{it.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
