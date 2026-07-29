import React, { useEffect, useMemo, useState } from 'react';
import { lifecycleApi } from '../services/api';
import type { Lifecycle, LifecycleIssue } from '../types';

const STAGES = [
  ['intake', 'Intake'], ['context', 'Context'], ['brd', 'BRD'], ['planning', 'Plan'],
  ['code_plan', 'Code plan'], ['implementation', 'Build'], ['review', 'Review'],
  ['sanity', 'Sanity'], ['release', 'Release'],
] as const;
const COLUMNS = ['Backlog', 'Selected', 'In Progress', 'Review', 'Done'] as const;
const tabs = ['Board', 'Requirement', 'BRD', 'Sprint plan', 'Code & Git', 'Validation', 'Release', 'Lineage'] as const;
type Tab = typeof tabs[number];

const panel: React.CSSProperties = {
  background: 'var(--panel-bg)', border: '1px solid var(--border-faint)', borderRadius: 12,
  boxShadow: 'var(--shadow-card)', backdropFilter: 'blur(18px)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', borderRadius: 7, border: '1px solid var(--border-dim)',
  background: 'var(--control-bg)', color: 'var(--text-1)', padding: '9px 11px', fontSize: 13,
};
const primary: React.CSSProperties = {
  border: 0, borderRadius: 7, padding: '9px 14px', background: '#6554C0', color: '#fff',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
};

function Badge({ children, color = '#6554C0' }: { children: React.ReactNode; color?: string }) {
  return <span style={{ borderRadius: 999, background: `${color}20`, color, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>{children}</span>;
}

function EmptyWorkspace({ onCreated }: { onCreated: (item: Lifecycle) => void }) {
  const [title, setTitle] = useState('');
  const [projectKey, setProjectKey] = useState('SDLC');
  const [requirement, setRequirement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (!title.trim() || !requirement.trim()) { setError('Feature title and requirement are required.'); return; }
    setBusy(true); setError('');
    try {
      onCreated(await lifecycleApi.create({ title, project_key: projectKey, requirement_text: requirement, sprint_name: 'Sprint 1' }));
    } catch (e: any) { setError(e?.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...panel, maxWidth: 820, margin: '28px auto', padding: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6554C0', letterSpacing: '.1em', textTransform: 'uppercase' }}>New delivery workspace</div>
      <h1 style={{ margin: '7px 0 8px', color: 'var(--text-1)', fontSize: 27 }}>Turn one requirement into a traceable release</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6, margin: '0 0 22px' }}>
        The agent team normalizes scope, creates an approvable BRD, builds a Jira-style backlog and sprint,
        prepares code and tests, validates the result, and packages the QA handoff.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 12 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 11 }}>Feature title
          <input style={{ ...input, marginTop: 5 }} value={title} onChange={e => setTitle(e.target.value)} placeholder="Customer notification preferences" />
        </label>
        <label style={{ color: 'var(--text-2)', fontSize: 11 }}>Project key
          <input style={{ ...input, marginTop: 5 }} value={projectKey} onChange={e => setProjectKey(e.target.value.toUpperCase())} />
        </label>
      </div>
      <label style={{ color: 'var(--text-2)', fontSize: 11 }}>Raw requirement or meeting notes
        <textarea style={{ ...input, minHeight: 170, resize: 'vertical', marginTop: 5 }} value={requirement}
          onChange={e => setRequirement(e.target.value)}
          placeholder="Paste the business requirement, constraints, actors, rules and expected outcome..." />
      </label>
      {error && <div style={{ color: '#DE350B', fontSize: 12, marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Local deterministic fallback · no external LLM key required</span>
        <button style={{ ...primary, opacity: busy ? .6 : 1 }} onClick={create} disabled={busy}>{busy ? 'Starting agents…' : 'Create workspace'}</button>
      </div>
    </div>
  );
}

function IssueCard({ issue, move }: { issue: LifecycleIssue; move: (issue: LifecycleIssue, status: string) => void }) {
  const color = issue.type === 'Defect' ? '#DE350B' : issue.type === 'Epic' ? '#6554C0' : issue.type === 'Story' ? '#0052CC' : '#00875A';
  return (
    <div draggable onDragStart={e => e.dataTransfer.setData('issue', issue.key)}
      style={{ background: 'var(--control-bg)', border: '1px solid var(--border-faint)', borderRadius: 8, padding: 10, marginBottom: 8, cursor: 'grab' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 7 }}>
        <span style={{ color, fontSize: 10, fontWeight: 800 }}>{issue.key} · {issue.type}</span>
        <span style={{ color: issue.priority === 'High' ? '#DE350B' : 'var(--text-3)', fontSize: 9 }}>{issue.priority}</span>
      </div>
      <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{issue.summary}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, alignItems: 'center' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{issue.parent_key || issue.sprint || 'Unscheduled'}</span>
        {issue.story_points > 0 && <Badge color="#0052CC">{issue.story_points} SP</Badge>}
      </div>
      <select aria-label={`Move ${issue.key}`} value={issue.status} onChange={e => move(issue, e.target.value)}
        style={{ ...input, fontSize: 10, padding: '4px 6px', marginTop: 8 }}>
        {COLUMNS.map(c => <option key={c}>{c}</option>)}
      </select>
    </div>
  );
}

export default function LifecycleWorkspace() {
  const [items, setItems] = useState<Lifecycle[]>([]);
  const [current, setCurrent] = useState<Lifecycle | null>(null);
  const [tab, setTab] = useState<Tab>('Board');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { lifecycleApi.list().then(data => { setItems(data); setCurrent(data[0] || null); }).catch(() => {}); }, []);
  const refresh = (item: Lifecycle) => {
    setCurrent(item);
    setItems(previous => [item, ...previous.filter(x => x.id !== item.id)]);
  };
  const action = async (name: string, request: () => Promise<Lifecycle>) => {
    setBusy(name); setError('');
    try { refresh(await request()); } catch (e: any) { setError(e?.response?.data?.detail || e.message); }
    finally { setBusy(''); }
  };
  const move = (issue: LifecycleIssue, status: string) => action(issue.key, () => lifecycleApi.updateIssue(current!.id, issue.key, { status }));
  const run = (stage: string) => action(stage, () => lifecycleApi.runStage(current!.id, stage));
  const approve = (gate: string) => action(gate, () => lifecycleApi.decideGate(current!.id, gate));
  const grouped = useMemo(() => Object.fromEntries(COLUMNS.map(c => [c, current?.issues.filter(x => x.status === c) || []])), [current]);
  if (!current) return <EmptyWorkspace onCreated={refresh} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{current.project_key} / Delivery workspace</div>
          <h1 style={{ color: 'var(--text-1)', fontSize: 24, margin: '4px 0 6px' }}>{current.title}</h1>
          <div style={{ display: 'flex', gap: 7 }}><Badge>{current.status}</Badge><Badge color="#00875A">Local AI fallback</Badge><Badge color="#0052CC">{current.issues.length} issues</Badge></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ ...input, width: 220 }} value={current.id} onChange={e => setCurrent(items.find(x => x.id === e.target.value) || current)}>
            {items.map(x => <option key={x.id} value={x.id}>{x.project_key} · {x.title}</option>)}
          </select>
          <button style={primary} onClick={() => setCurrent(null)}>New workspace</button>
        </div>
      </div>

      <div style={{ ...panel, padding: 12, marginBottom: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', minWidth: 860, alignItems: 'center' }}>
          {STAGES.map(([key, label], index) => {
            const state = current.stages[key]?.status || 'waiting';
            const color = state === 'completed' ? '#00875A' : state === 'approval_required' ? '#FF991F' : state === 'ready' ? '#0052CC' : '#6B778C';
            return <React.Fragment key={key}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ width: 25, height: 25, borderRadius: '50%', margin: '0 auto 5px', display: 'grid', placeItems: 'center', background: `${color}22`, color, border: `1px solid ${color}`, fontSize: 10, fontWeight: 800 }}>
                  {state === 'completed' ? '✓' : index + 1}
                </div>
                <div style={{ color: state === 'waiting' ? 'var(--text-3)' : 'var(--text-1)', fontSize: 10, fontWeight: 700 }}>{label}</div>
              </div>
              {index < STAGES.length - 1 && <div style={{ width: 18, height: 1, background: state === 'completed' ? '#00875A' : 'var(--border-dim)' }} />}
            </React.Fragment>;
          })}
        </div>
      </div>

      {error && <div style={{ background: '#DE350B18', border: '1px solid #DE350B55', color: '#DE350B', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>{error}</div>}
      <div style={{ borderBottom: '1px solid var(--border-faint)', display: 'flex', gap: 2, marginBottom: 15, overflowX: 'auto' }}>
        {tabs.map(x => <button key={x} onClick={() => setTab(x)} style={{
          background: 'transparent', color: tab === x ? '#6554C0' : 'var(--text-2)', border: 0,
          borderBottom: tab === x ? '2px solid #6554C0' : '2px solid transparent', padding: '9px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
        }}>{x}</button>)}
      </div>

      {tab === 'Board' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', gap: 10, overflowX: 'auto', paddingBottom: 10 }}>
        {COLUMNS.map(column => <div key={column} onDragOver={e => e.preventDefault()} onDrop={e => {
          const issue = current.issues.find(x => x.key === e.dataTransfer.getData('issue')); if (issue) move(issue, column);
        }} style={{ ...panel, minWidth: 180, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, color: 'var(--text-2)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <span>{column}</span><span>{grouped[column].length}</span>
          </div>
          {grouped[column].map((issue: LifecycleIssue) => <IssueCard key={issue.key} issue={issue} move={move} />)}
        </div>)}
      </div>}

      {tab === 'Requirement' && <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 14 }}>
        <div style={{ ...panel, padding: 18 }}>
          <h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Normalized requirement · {current.requirement.id}</h3>
          <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>{current.requirement.intent}</div>
          {['actors', 'business_rules', 'constraints', 'non_functional_requirements', 'dependencies', 'assumptions'].map(key => <div key={key} style={{ marginTop: 16 }}>
            <div style={{ color: 'var(--text-3)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}</div>
            <ul style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.6, paddingLeft: 18 }}>{(current.requirement[key] || []).map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>)}
        </div>
        <div>
          <div style={{ ...panel, padding: 16, marginBottom: 12 }}>
            <h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Context pack</h3>
            {(current.context_pack.related_artifacts || []).map((x: any) => <div key={x.name} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-faint)' }}>
              <div style={{ color: 'var(--text-1)', fontSize: 12 }}>{x.name}</div><div style={{ color: 'var(--text-3)', fontSize: 10 }}>{x.type} · {Math.round(x.relevance * 100)}% relevance</div>
            </div>)}
          </div>
          <div style={{ ...panel, padding: 16 }}>
            <h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Clarification loop</h3>
            {current.clarifications.map((x, i) => <div key={i} style={{ color: 'var(--text-2)', fontSize: 12, padding: '7px 0' }}>? {x.question}</div>)}
          </div>
        </div>
      </div>}

      {tab === 'BRD' && <div style={{ ...panel, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h2 style={{ color: 'var(--text-1)', margin: 0 }}>Business Requirements Document</h2><span style={{ color: 'var(--text-3)', fontSize: 11 }}>Version {current.brd.version} · {current.brd.status}</span></div>
          {current.brd.status !== 'Approved' && <button style={primary} disabled={busy === 'brd'} onClick={() => approve('brd')}>Architect approve BRD</button>}
        </div>
        {current.brd.sections.map(section => <div key={section.name} style={{ padding: '16px 0', borderBottom: '1px solid var(--border-faint)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ color: 'var(--text-1)', fontSize: 13 }}>{section.name}</strong><Badge color={section.confidence > .9 ? '#00875A' : '#FF991F'}>{Math.round(section.confidence * 100)}% confidence</Badge></div>
          <p style={{ color: 'var(--text-2)', fontSize: 12, lineHeight: 1.6, marginBottom: 0 }}>{section.content}</p>
        </div>)}
      </div>}

      {tab === 'Sprint plan' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ ...panel, padding: 18 }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>{current.sprint_plan.name}</h3><p style={{ color: 'var(--text-2)', fontSize: 13 }}>{current.sprint_plan.goal}</p>
          <div style={{ display: 'flex', gap: 10 }}><Badge color="#0052CC">{current.sprint_plan.committed_points}/{current.sprint_plan.capacity_points} points</Badge><Badge color="#FF991F">{current.sprint_plan.handoff_readiness}% ready</Badge></div>
          <h4 style={{ color: 'var(--text-2)' }}>Critical path</h4><div style={{ display: 'flex', gap: 6 }}>{current.sprint_plan.critical_path.map((x: string) => <Badge key={x}>{x}</Badge>)}</div>
        </div>
        <div style={{ ...panel, padding: 18 }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Risks and dependencies</h3>{current.sprint_plan.risks.map((x: string) => <div key={x} style={{ padding: 9, background: '#FF991F12', color: 'var(--text-2)', borderRadius: 6, marginBottom: 7, fontSize: 12 }}>⚠ {x}</div>)}</div>
      </div>}

      {tab === 'Code & Git' && <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 14 }}>
        <div style={{ ...panel, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Two-step code agent</h3><Badge>{current.code_plan.status}</Badge></div>
          {current.code_plan.status === 'Not generated' && <button style={primary} onClick={() => run('code_plan')}>Generate code plan</button>}
          {current.code_plan.status === 'Approval required' && <button style={primary} onClick={() => approve('code_plan')}>Architect approve plan</button>}
          {current.code_plan.status === 'Approved' && current.implementation.status !== 'Generated' && <button style={primary} onClick={() => run('implementation')}>Generate implementation + unit tests</button>}
          {(current.code_plan.modules || []).map((x: any) => <div key={x.path} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-faint)' }}><code style={{ color: '#0052CC', fontSize: 11 }}>{x.path}</code><div style={{ color: 'var(--text-2)', fontSize: 11 }}>{x.purpose}</div></div>)}
          {(current.implementation.files || []).length > 0 && <><h4 style={{ color: 'var(--text-1)' }}>Generated files</h4>{current.implementation.files.map((x: any) => <div key={x.path} style={{ color: 'var(--text-2)', fontSize: 11, padding: 5 }}>✓ {x.path} — {x.purpose}</div>)}</>}
        </div>
        <RepositoryCard current={current} refresh={refresh} />
      </div>}

      {tab === 'Validation' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ ...panel, padding: 18 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Traceable review</h3>{current.review.status !== 'Completed' && <button style={primary} onClick={() => run('review')}>Run review agent</button>}</div>
          {(current.review.findings || []).map((x: any) => <div key={x.summary} style={{ padding: 9, borderBottom: '1px solid var(--border-faint)', color: 'var(--text-2)', fontSize: 12 }}><Badge color={x.severity === 'medium' ? '#FF991F' : '#00875A'}>{x.severity}</Badge> &nbsp;{x.summary}</div>)}
        </div>
        <div style={{ ...panel, padding: 18 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Sanity and defects</h3>{current.review.status === 'Completed' && current.sanity.status === 'Not started' && <button style={primary} onClick={() => run('sanity')}>Run sanity agent</button>}</div>
          {(current.sanity.results || []).map((x: any) => <div key={x.name} style={{ padding: 9, color: x.status === 'passed' ? '#00875A' : '#DE350B', fontSize: 12 }}>{x.status === 'passed' ? '✓' : '✕'} {x.name} · {x.issue}</div>)}
        </div>
      </div>}

      {tab === 'Release' && <div style={{ ...panel, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><h2 style={{ color: 'var(--text-1)', margin: 0 }}>QA release handoff</h2><span style={{ color: 'var(--text-3)', fontSize: 11 }}>{current.release.status}</span></div>
          {!String(current.release.status).startsWith('Approval') && current.release.status !== 'Approved' && <button style={primary} onClick={() => run('release')}>Generate handoff</button>}
          {String(current.release.status).startsWith('Approval') && <button style={primary} onClick={() => approve('release')}>Approve QA handoff</button>}
        </div>
        {current.release.notes && <><p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>{current.release.notes}</p><pre style={{ background: 'var(--control-bg)', color: 'var(--text-2)', padding: 14, borderRadius: 8, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(current.release.qa_handoff, null, 2)}</pre></>}
      </div>}

      {tab === 'Lineage' && <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 14 }}>
        <div style={{ ...panel, padding: 18 }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Artifact lineage graph</h3>{current.lineage.map((x, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', padding: 8, borderBottom: '1px solid var(--border-faint)', fontSize: 11 }}><code style={{ color: '#0052CC' }}>{x.from}</code><span style={{ color: 'var(--text-3)' }}>— {x.type} →</span><code style={{ color: '#6554C0' }}>{x.to}</code></div>)}</div>
        <div style={{ ...panel, padding: 18 }}><h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Agent activity</h3>{current.activity.map((x, i) => <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--border-faint)' }}><div style={{ color: 'var(--text-1)', fontSize: 11, fontWeight: 700 }}>{x.actor}</div><div style={{ color: 'var(--text-2)', fontSize: 11 }}>{x.message}</div></div>)}</div>
      </div>}
    </div>
  );
}

function RepositoryCard({ current, refresh }: { current: Lifecycle; refresh: (item: Lifecycle) => void }) {
  const [repo, setRepo] = useState(current.repository.repo || '');
  const [base, setBase] = useState(current.repository.base_branch || 'main');
  const [branch, setBranch] = useState(current.repository.target_branch || 'feature/agentic-sdlc');
  const [busy, setBusy] = useState(false);
  return <div style={{ ...panel, padding: 18 }}>
    <h3 style={{ color: 'var(--text-1)', marginTop: 0 }}>Git agent</h3>
    <label style={{ color: 'var(--text-3)', fontSize: 10 }}>Repository (owner/name)<input style={{ ...input, margin: '5px 0 10px' }} value={repo} onChange={e => setRepo(e.target.value)} placeholder="acme/product" /></label>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <label style={{ color: 'var(--text-3)', fontSize: 10 }}>Base branch<input style={{ ...input, marginTop: 5 }} value={base} onChange={e => setBase(e.target.value)} /></label>
      <label style={{ color: 'var(--text-3)', fontSize: 10 }}>Feature branch<input style={{ ...input, marginTop: 5 }} value={branch} onChange={e => setBranch(e.target.value)} /></label>
    </div>
    <button style={{ ...primary, marginTop: 12 }} disabled={busy || !repo} onClick={async () => { setBusy(true); try { refresh(await lifecycleApi.configureRepository(current.id, repo, base, branch)); } finally { setBusy(false); } }}>Save repository target</button>
    <p style={{ color: 'var(--text-3)', fontSize: 10, lineHeight: 1.5 }}>Branch creation, commit, push and pull request use the existing GitHub Push workspace after a token is configured. Generated files are already linked to this lifecycle job.</p>
  </div>;
}
