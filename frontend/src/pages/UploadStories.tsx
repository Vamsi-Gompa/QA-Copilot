import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCheckbox,
  EuiFieldText,
  EuiFilePicker,
  EuiLoadingSpinner,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiSelect,
  EuiSpacer,
  EuiTextArea,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import QaIcon from '../components/QaIcon';
import { storiesApi } from '../services/api';
import {
  PRIORITY_META, STORY_POINTS, STORY_STATUS_META,
} from '../types';
import type {
  StoryDraft, StoryInput, StoryStatus, TestPriority, UserStory,
} from '../types';

const SAMPLE_REQUIREMENTS = `Project: Online Bookstore — Checkout & Account

The customer must be able to create an account using an email and password. Passwords
need at least 8 characters with one number. After signing up they should receive a
confirmation email (REQ-12).

Registered users can add books to a cart, change quantities, and remove items. The cart
must persist across sessions. At checkout the user picks a saved address or adds a new one,
chooses a payment method, and sees an order summary with taxes before confirming (REQ-27).

If a payment fails the user should see a clear error and be able to retry without losing the
cart. Admins need a dashboard to view daily orders and mark them as shipped.`;

// ── helpers ───────────────────────────────────────────────────────────────────
const PRIORITY_RANK: Record<TestPriority, number> = { low: 1, medium: 2, high: 3 };
const POINT_SET = [1, 2, 3, 5, 8, 13];
const DEFAULT_PROJECT = 'General';

function snapPoints(n: number): number {
  if (n <= 0) return 0;
  return POINT_SET.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}
const newKey = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const uniq = (arr: string[]) =>
  Array.from(new Map(arr.map(s => s.trim()).filter(Boolean).map(s => [s.toLowerCase(), s])).values());
const projectName = (value?: string) => (value || DEFAULT_PROJECT).trim() || DEFAULT_PROJECT;
const storyWord = (count: number) => (count === 1 ? 'story' : 'stories');

const blankDraft = (): StoryDraft => ({
  _key: newKey(), project_name: DEFAULT_PROJECT, title: '', description: '', acceptance_criteria: [],
  story_points: 0, priority: 'medium', status: 'draft', references: [],
});
const toInput = (d: StoryDraft | UserStory): StoryInput => ({
  project_name: projectName(d.project_name),
  title: d.title.trim(),
  description: d.description.trim(),
  acceptance_criteria: d.acceptance_criteria.map(s => s.trim()).filter(Boolean),
  story_points: d.story_points,
  priority: d.priority,
  status: d.status,
  references: d.references.map(s => s.trim()).filter(Boolean),
});
const inputToDraft = (s: StoryInput, replaces?: string[]): StoryDraft => ({ _key: newKey(), ...s, replaces });
const storyToDraft = (s: UserStory): StoryDraft => ({
  _key: newKey(), project_name: projectName(s.project_name), title: s.title, description: s.description,
  acceptance_criteria: [...s.acceptance_criteria], story_points: s.story_points,
  priority: s.priority, status: s.status, references: [...s.references], replaces: [s.id],
});

const POINT_OPTIONS = STORY_POINTS.map(p => ({ value: String(p), text: p === 0 ? '— pts' : `${p} pts` }));
const PRIORITY_OPTIONS = (['high', 'medium', 'low'] as TestPriority[]).map(p => ({ value: p, text: p[0].toUpperCase() + p.slice(1) }));
const STATUS_OPTIONS = (Object.keys(STORY_STATUS_META) as StoryStatus[]).map(s => ({ value: s, text: STORY_STATUS_META[s].label }));
const COUNT_OPTIONS = [
  { value: '0', text: 'Auto' }, { value: '3', text: '3' }, { value: '5', text: '5' },
  { value: '8', text: '8' }, { value: '10', text: '10' }, { value: '15', text: '15' },
];

// ── small visual atoms ──────────────────────────────────────────────────────
function PointsBadge({ value }: { value: number }) {
  return (
    <span className="spoints" title={`${value || 0} story points`}>
      <span className="spoints__num">{value || '—'}</span>
      <span className="spoints__lbl">pts</span>
    </span>
  );
}
function StatusPill({ status }: { status: StoryStatus }) {
  const m = STORY_STATUS_META[status] ?? STORY_STATUS_META.draft;
  return <span className="spill" style={{ color: m.color, background: m.bg, borderColor: `${m.color}55` }}>{m.label}</span>;
}
function PriorityChip({ priority }: { priority: TestPriority }) {
  const m = PRIORITY_META[priority];
  return (
    <span className="sprio" style={{ color: m.color }}>
      <span className="sprio__dot" style={{ background: m.dot }} />{priority}
    </span>
  );
}
function ProjectChip({ name }: { name: string }) {
  return (
    <span className="sproject">
      <QaIcon type="folderOpen" size="s" color="var(--accent-blue)" />
      {projectName(name)}
    </span>
  );
}
function RefChip({ value }: { value: string }) {
  const isUrl = /^https?:\/\//i.test(value);
  const text = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return isUrl ? (
    <a className="sref" href={value} target="_blank" rel="noreferrer" title={value}>
      <QaIcon type="link" size="s" color="var(--accent-teal)" /><span>{text}</span>
    </a>
  ) : (
    <span className="sref" title={value}><QaIcon type="link" size="s" color="var(--text-3)" /><span>{text}</span></span>
  );
}
function IconBtn({ icon, label, color, onClick, loading, disabled }: {
  icon: string; label: string; color?: string; onClick: () => void; loading?: boolean; disabled?: boolean;
}) {
  return (
    <EuiToolTip content={label} position="top">
      <button type="button" className="iconbtn" aria-label={label} onClick={onClick} disabled={disabled || loading}>
        {loading ? <EuiLoadingSpinner size="s" /> : <QaIcon type={icon} size="m" color={color || 'var(--text-2)'} />}
      </button>
    </EuiToolTip>
  );
}
function StatPill({ label, value, color = 'var(--accent-teal)' }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="stories-stat">
      <div className="stories-stat__value" style={{ color }}>{value}</div>
      <div className="stories-stat__label">{label}</div>
    </div>
  );
}

// ── editable fields (shared by drafts + edit modal) ─────────────────────────
function StoryFields({ value, onChange }: { value: StoryInput; onChange: (patch: Partial<StoryInput>) => void }) {
  const setAc = (i: number, v: string) => {
    const a = [...value.acceptance_criteria]; a[i] = v; onChange({ acceptance_criteria: a });
  };
  const setRef = (i: number, v: string) => {
    const r = [...value.references]; r[i] = v; onChange({ references: r });
  };
  return (
    <div className="sfields">
      <div className="sfields__topRow">
        <EuiFieldText
          placeholder="Project name"
          value={value.project_name}
          onChange={e => onChange({ project_name: e.target.value })}
          prepend="Project"
          fullWidth
        />
        <EuiFieldText
          className="sfields__title"
          placeholder="Story title"
          value={value.title}
          onChange={e => onChange({ title: e.target.value })}
          fullWidth
        />
      </div>
      <EuiTextArea
        placeholder="As a <role>, I want <goal> so that <benefit>…"
        value={value.description}
        onChange={e => onChange({ description: e.target.value })}
        rows={3}
        fullWidth
      />

      <div className="sfields__metaRow">
        <EuiSelect
          compressed options={POINT_OPTIONS} value={String(value.story_points)}
          onChange={e => onChange({ story_points: Number(e.target.value) })}
          aria-label="Story points" prepend="Points"
        />
        <EuiSelect
          compressed options={PRIORITY_OPTIONS} value={value.priority}
          onChange={e => onChange({ priority: e.target.value as TestPriority })}
          aria-label="Priority" prepend="Priority"
        />
        <EuiSelect
          compressed options={STATUS_OPTIONS} value={value.status}
          onChange={e => onChange({ status: e.target.value as StoryStatus })}
          aria-label="Status" prepend="Status"
        />
      </div>

      <div className="sfields__group">
        <div className="sfields__groupHead">
          <span><QaIcon type="check" size="s" color="var(--accent-teal)" /> Acceptance criteria</span>
          <EuiButtonEmpty size="xs" iconType="plusInCircle"
            onClick={() => onChange({ acceptance_criteria: [...value.acceptance_criteria, ''] })}>
            Add
          </EuiButtonEmpty>
        </div>
        {value.acceptance_criteria.length === 0 && <p className="sfields__empty">No criteria yet.</p>}
        {value.acceptance_criteria.map((c, i) => (
          <div className="sfields__line" key={`ac-${i}`}>
            <EuiFieldText compressed fullWidth value={c} placeholder="Given … when … then …" onChange={e => setAc(i, e.target.value)} />
            <IconBtn icon="cross" label="Remove criterion" color="var(--text-3)"
              onClick={() => onChange({ acceptance_criteria: value.acceptance_criteria.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </div>

      <div className="sfields__group">
        <div className="sfields__groupHead">
          <span><QaIcon type="link" size="s" color="#79AAD9" /> References</span>
          <EuiButtonEmpty size="xs" iconType="plusInCircle"
            onClick={() => onChange({ references: [...value.references, ''] })}>
            Add
          </EuiButtonEmpty>
        </div>
        {value.references.length === 0 && <p className="sfields__empty">No references.</p>}
        {value.references.map((r, i) => (
          <div className="sfields__line" key={`ref-${i}`}>
            <EuiFieldText compressed fullWidth value={r} placeholder="REQ-12 · Section 2.1 · https://…" onChange={e => setRef(i, e.target.value)} />
            <IconBtn icon="cross" label="Remove reference" color="var(--text-3)"
              onClick={() => onChange({ references: value.references.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── draft card (editable, lives in the review workspace) ────────────────────
function DraftCard({ draft, index, selected, onChange, onToggle, onDuplicate, onQuickSplit, onAiSplit, onRemove, splitting }: {
  draft: StoryDraft; index: number; selected: boolean;
  onChange: (patch: Partial<StoryInput>) => void;
  onToggle: () => void; onDuplicate: () => void; onQuickSplit: () => void; onAiSplit: () => void; onRemove: () => void;
  splitting: boolean;
}) {
  return (
    <article className={`scard scard--draft qa-glass ${selected ? 'scard--sel' : ''}`} style={{ animationDelay: `${Math.min(index * 0.03, 0.2)}s` }}>
      <span className="scard__accent" style={{ background: 'var(--accent-teal)' }} />
      <header className="scard__top">
        <span className="scard__ribbon"><QaIcon type="sparkles" size="s" color="#fff" /> Draft</span>
        <div className="scard__actions">
          <EuiToolTip content="Select to merge" position="top">
            <EuiCheckbox id={`sel-${draft._key}`} checked={selected} onChange={onToggle} />
          </EuiToolTip>
          <IconBtn icon="copy" label="Duplicate" onClick={onDuplicate} />
          <IconBtn icon="scissors" label="Quick split (halve criteria)" onClick={onQuickSplit} />
          <IconBtn icon="sparkles" label="AI split into smaller stories" color="#A987D1" onClick={onAiSplit} loading={splitting} />
          <IconBtn icon="trash" label="Remove draft" color="#F86B63" onClick={onRemove} />
        </div>
      </header>
      <StoryFields value={draft} onChange={onChange} />
    </article>
  );
}

// ── saved story card (read view) ────────────────────────────────────────────
function SavedCard({ story, index, selected, onToggle, onEdit, onAiSplit, onDelete, splitting }: {
  story: UserStory; index: number; selected: boolean;
  onToggle: () => void; onEdit: () => void; onAiSplit: () => void; onDelete: () => void; splitting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ac = story.acceptance_criteria || [];
  const refs = story.references || [];
  const shown = open ? ac : ac.slice(0, 4);
  const created = story.created_at ? new Date(story.created_at).toLocaleDateString() : '';

  return (
    <article className={`scard qa-glass ${selected ? 'scard--sel' : ''}`} style={{ animationDelay: `${Math.min(index * 0.03, 0.2)}s` }}>
      <span className="scard__accent" style={{ background: PRIORITY_META[story.priority]?.color || 'var(--accent-teal)' }} />
      <header className="scard__top">
        <div className="scard__badges">
          <ProjectChip name={story.project_name} />
          <PointsBadge value={story.story_points} />
          <StatusPill status={story.status} />
          <PriorityChip priority={story.priority} />
        </div>
        <div className="scard__actions">
          <EuiToolTip content="Select to merge" position="top">
            <EuiCheckbox id={`sel-${story.id}`} checked={selected} onChange={onToggle} />
          </EuiToolTip>
          <IconBtn icon="pencil" label="Edit" onClick={onEdit} />
          <IconBtn icon="sparkles" label="AI split into smaller stories" color="#A987D1" onClick={onAiSplit} loading={splitting} />
          <IconBtn icon="trash" label="Delete" color="#F86B63" onClick={onDelete} />
        </div>
      </header>

      <h3 className="scard__title">{story.title}</h3>
      {story.description && <p className="scard__desc">{story.description}</p>}

      {ac.length > 0 && (
        <ul className="scard__ac">
          {shown.map((item, i) => (
            <li key={`${story.id}-ac-${i}`}><QaIcon type="check" size="s" color="var(--accent-teal)" /><span>{item}</span></li>
          ))}
          {ac.length > 4 && (
            <button type="button" className="scard__more" onClick={() => setOpen(o => !o)}>
              <QaIcon type={open ? 'chevronUp' : 'chevronDown'} size="s" color="var(--text-3)" />
              {open ? 'Show less' : `+${ac.length - 4} more criteria`}
            </button>
          )}
        </ul>
      )}

      {refs.length > 0 && (
        <div className="scard__refs">{refs.map((r, i) => <RefChip key={`${story.id}-r-${i}`} value={r} />)}</div>
      )}

      <footer className="scard__foot">
        <span>{ac.length} criteria{refs.length ? ` · ${refs.length} refs` : ''}</span>
        {created && <span>{created}</span>}
      </footer>
    </article>
  );
}

// ── edit modal (saved story) ────────────────────────────────────────────────
function EditModal({ story, onClose, onSave }: { story: UserStory; onClose: () => void; onSave: (input: StoryInput) => void }) {
  const [buf, setBuf] = useState<StoryInput>(() => toInput(story));
  return (
    <EuiModal onClose={onClose} className="story-modal">
      <EuiModalHeader>
        <EuiModalHeaderTitle><QaIcon type="pencil" size="m" color="#79AAD9" /> Edit story</EuiModalHeaderTitle>
      </EuiModalHeader>
      <EuiModalBody>
        <StoryFields value={buf} onChange={p => setBuf(prev => ({ ...prev, ...p }))} />
      </EuiModalBody>
      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose}>Cancel</EuiButtonEmpty>
        <EuiButton fill iconType="save" onClick={() => onSave(buf)} disabled={!buf.title.trim()}>Save changes</EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
}

// ── page ───────────────────────────────────────────────────────────────────
export default function UploadStories() {
  const [stories, setStories] = useState<UserStory[]>([]);
  const [drafts, setDrafts] = useState<StoryDraft[]>([]);
  const [loading, setLoading] = useState(false);

  // generation inputs
  const [reqText, setReqText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [count, setCount] = useState('0');
  const [generating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileKey = useRef(0); // force-remount EuiFilePicker to clear it

  // workspace state
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [splitId, setSplitId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<UserStory | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>('all');

  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { fetchStories(); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const totals = useMemo(() => ({
    points: stories.reduce((n, s) => n + (s.story_points || 0), 0),
    criteria: stories.reduce((n, s) => n + (s.acceptance_criteria?.length || 0), 0),
  }), [stories]);

  const projectSummaries = useMemo(() => {
    const map = new Map<string, {
      name: string;
      count: number;
      points: number;
      criteria: number;
      statuses: Record<StoryStatus, number>;
    }>();
    stories.forEach(story => {
      const name = projectName(story.project_name);
      const existing = map.get(name) || {
        name,
        count: 0,
        points: 0,
        criteria: 0,
        statuses: { draft: 0, ready: 0, in_progress: 0, done: 0, blocked: 0 },
      };
      existing.count += 1;
      existing.points += story.story_points || 0;
      existing.criteria += story.acceptance_criteria?.length || 0;
      existing.statuses[story.status] = (existing.statuses[story.status] || 0) + 1;
      map.set(name, existing);
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [stories]);

  const visibleStories = useMemo(
    () => selectedProject === 'all'
      ? stories
      : stories.filter(story => projectName(story.project_name) === selectedProject),
    [selectedProject, stories],
  );

  useEffect(() => {
    if (selectedProject === 'all') return;
    if (!projectSummaries.some(project => project.name === selectedProject)) {
      setSelectedProject('all');
    }
  }, [projectSummaries, selectedProject]);

  const selectedCount = sel.size;

  async function fetchStories() {
    setLoading(true);
    try {
      setStories(await storiesApi.list());
    } catch {
      setError('Failed to load stories');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!reqText.trim() && files.length === 0) return;
    setGenerating(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await storiesApi.generate({ text: reqText, count: Number(count), files });
      const newDrafts = res.stories.map(s => inputToDraft(s));
      setDrafts(prev => [...newDrafts, ...prev]);
      setWarnings(res.warnings || []);
      if (newDrafts.length) {
        setToast(`Generated ${newDrafts.length} draft ${newDrafts.length === 1 ? 'story' : 'stories'} — review below`);
        setTimeout(() => draftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      } else if (!res.warnings?.length) {
        setError('No stories could be generated from that input.');
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Generation failed. Check the backend and API key.');
    } finally {
      setGenerating(false);
    }
  }

  const updateDraft = (key: string, patch: Partial<StoryInput>) =>
    setDrafts(prev => prev.map(d => (d._key === key ? { ...d, ...patch } : d)));

  const removeDraft = (key: string) => {
    setDrafts(prev => prev.filter(d => d._key !== key));
    setSel(prev => { const n = new Set(prev); n.delete(`draft:${key}`); return n; });
  };

  const duplicateDraft = (key: string) => setDrafts(prev => {
    const i = prev.findIndex(d => d._key === key);
    if (i < 0) return prev;
    const copy: StoryDraft = { ...prev[i], _key: newKey(), replaces: undefined, title: `${prev[i].title} (copy)` };
    const next = [...prev]; next.splice(i + 1, 0, copy); return next;
  });

  const quickSplit = (key: string) => setDrafts(prev => prev.flatMap(d => {
    if (d._key !== key) return [d];
    const ac = d.acceptance_criteria;
    const mid = Math.max(1, Math.ceil(ac.length / 2));
    return [
      { ...d, _key: newKey(), title: `${d.title} (1)`, acceptance_criteria: ac.slice(0, mid), story_points: snapPoints(Math.ceil((d.story_points || 0) / 2)) },
      { ...d, _key: newKey(), title: `${d.title} (2)`, acceptance_criteria: ac.slice(mid), story_points: snapPoints(Math.ceil((d.story_points || 0) / 2)) },
    ];
  }));

  async function aiSplitDraft(d: StoryDraft) {
    setSplitId(`draft:${d._key}`);
    setError(null);
    try {
      const res = await storiesApi.aiSplit({
        title: d.title,
        project_name: projectName(d.project_name),
        description: d.description,
        acceptance_criteria: d.acceptance_criteria,
      });
      const children = res.stories.map(s => inputToDraft(s, d.replaces));
      setDrafts(prev => prev.flatMap(x => (x._key === d._key ? children : [x])));
      setToast(`Split into ${children.length} stories`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'AI split failed.');
    } finally {
      setSplitId(null);
    }
  }

  async function aiSplitSaved(story: UserStory) {
    setSplitId(`saved:${story.id}`);
    setError(null);
    try {
      const res = await storiesApi.aiSplit({
        title: story.title,
        project_name: projectName(story.project_name),
        description: story.description,
        acceptance_criteria: story.acceptance_criteria,
      });
      const children = res.stories.map(s => inputToDraft(s, [story.id]));
      setDrafts(prev => [...children, ...prev]);
      setToast(`Split “${story.title}” into ${children.length} drafts — review & save`);
      setTimeout(() => draftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'AI split failed.');
    } finally {
      setSplitId(null);
    }
  }

  const toggleSel = (token: string) =>
    setSel(prev => { const n = new Set(prev); n.has(token) ? n.delete(token) : n.add(token); return n; });

  function mergeSelected() {
    const savedSel = stories.filter(s => sel.has(`saved:${s.id}`));
    const draftSel = drafts.filter(d => sel.has(`draft:${d._key}`));
    const all = [...savedSel, ...draftSel];
    if (all.length < 2) return;

    const priority = (['high', 'medium', 'low'] as TestPriority[])
      .find(p => all.some(x => x.priority === p)) || 'medium';

    const merged: StoryDraft = {
      _key: newKey(),
      project_name: uniq(all.map(x => projectName(x.project_name))).length === 1
        ? projectName(all[0].project_name)
        : 'Cross-project',
      title: uniq(all.map(x => x.title)).join(' + ').slice(0, 200) || 'Merged story',
      description: all.map(x => x.description).filter(Boolean).join('\n\n'),
      acceptance_criteria: uniq(all.flatMap(x => x.acceptance_criteria)),
      references: uniq(all.flatMap(x => x.references)),
      story_points: snapPoints(all.reduce((n, x) => n + (x.story_points || 0), 0)),
      priority,
      status: 'draft',
      replaces: savedSel.map(s => s.id),
    };
    setDrafts(prev => [merged, ...prev.filter(d => !sel.has(`draft:${d._key}`))]);
    setSel(new Set());
    setToast(`Merged ${all.length} stories into one draft`);
    setTimeout(() => draftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function saveAll() {
    const valid = drafts.filter(d => d.title.trim());
    if (!valid.length) { setError('Give at least one draft a title before saving.'); return; }
    setSaving(true);
    setError(null);
    try {
      await storiesApi.bulk(valid.map(toInput));
      const toDelete = uniq(valid.flatMap(d => d.replaces ?? []));
      await Promise.all(toDelete.map(id => storiesApi.delete(id).catch(() => undefined)));
      setDrafts([]);
      setSel(new Set());
      setToast(`Saved ${valid.length} ${valid.length === 1 ? 'story' : 'stories'}`);
      await fetchStories();
    } catch {
      setError('Failed to save stories.');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(input: StoryInput) {
    if (!editing) return;
    try {
      await storiesApi.update(editing.id, input);
      setEditing(null);
      setToast('Story updated');
      await fetchStories();
    } catch {
      setError('Failed to update story.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await storiesApi.delete(id);
      setSel(prev => { const n = new Set(prev); n.delete(`saved:${id}`); return n; });
      setToast('Story deleted');
      await fetchStories();
    } catch {
      setError('Failed to delete story.');
    }
  }

  const canGenerate = (reqText.trim().length > 0 || files.length > 0) && !generating;

  return (
    <div className="stories-page">
      <header className="stories-header">
        <div className="stories-heading">
          <div className="stories-heading__icon"><QaIcon type="document" size="l" color="#79AAD9" /></div>
          <div>
            <EuiTitle size="m"><h2>User Stories</h2></EuiTitle>
            <p>Turn requirements, docs &amp; images into ready-to-test stories</p>
          </div>
        </div>
        <div className="stories-actions">
          <EuiButtonEmpty iconType="refresh" onClick={fetchStories} size="s" isLoading={loading}>Refresh</EuiButtonEmpty>
          <EuiButton iconType="plusInCircle" size="s" onClick={() => { setDrafts(prev => [blankDraft(), ...prev]); setTimeout(() => draftsRef.current?.scrollIntoView({ behavior: 'smooth' }), 60); }}>
            Add blank
          </EuiButton>
        </div>
      </header>

      {(toast || error) && (
        <div className="stories-alerts">
          {toast && <EuiCallOut color="success" title={toast} iconType="check" size="s" />}
          {error && <EuiCallOut color="danger" title={error} iconType="alert" size="s" onDismiss={() => setError(null)} />}
        </div>
      )}

      {/* stats */}
      <section className="stories-stats stories-stats--4">
        <StatPill label="Stories" value={stories.length} color="#79AAD9" />
        <StatPill label="Story points" value={totals.points} color="#00BFB3" />
        <StatPill label="Criteria" value={totals.criteria} color="#A987D1" />
        <StatPill label="In review" value={drafts.length} color="#F1D86F" />
      </section>

      {/* generator */}
      <section className="sgen qa-glass">
        <div className="sgen__head">
          <span className="sgen__title"><QaIcon type="sparkles" size="m" color="var(--accent-teal)" /> Create stories from requirements</span>
          <span className="sgen__hint">Paste text and/or drop documents &amp; images — the AI extracts and writes structured stories.</span>
        </div>

        <div className="sgen__grid">
          <div className="sgen__col">
            <label className="sgen__label">Requirements text</label>
            <EuiTextArea
              placeholder="Paste a requirements doc, feature brief, meeting notes…"
              value={reqText}
              onChange={e => setReqText(e.target.value)}
              rows={6}
              fullWidth
            />
            <EuiButtonEmpty size="xs" iconType="document" onClick={() => setReqText(SAMPLE_REQUIREMENTS)}>Try a sample</EuiButtonEmpty>
          </div>

          <div className="sgen__col">
            <label className="sgen__label"><QaIcon type="upload" size="s" color="var(--text-2)" /> Documents &amp; images</label>
            <EuiFilePicker
              key={fileKey.current}
              accept=".txt,.md,.pdf,.docx,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.bmp"
              multiple
              fullWidth
              initialPromptText="Drop .pdf, .docx, .txt, .md or images here"
              onChange={fl => setFiles(fl ? Array.from(fl) : [])}
            />
            {files.length > 0 && (
              <div className="sgen__files">
                {files.map((f, i) => (
                  <span className="sgen__file" key={`${f.name}-${i}`}>
                    <QaIcon type={/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? 'image' : 'document'} size="s" color="#79AAD9" />
                    {f.name}
                  </span>
                ))}
                <EuiButtonEmpty size="xs" color="text" onClick={() => { setFiles([]); fileKey.current += 1; }}>Clear</EuiButtonEmpty>
              </div>
            )}
            <p className="sgen__note">Scanned PDFs work best uploaded as images (vision OCR via Claude).</p>
          </div>
        </div>

        <div className="sgen__actions">
          <EuiSelect compressed prepend="Stories" options={COUNT_OPTIONS} value={count} onChange={e => setCount(e.target.value)} aria-label="How many stories" />
          <EuiButton fill iconType={generating ? undefined : 'sortRight'} isLoading={generating} onClick={handleGenerate} disabled={!canGenerate}>
            {generating ? 'Extracting & writing…' : 'Generate stories'}
          </EuiButton>
        </div>

        {warnings.length > 0 && (
          <div className="sgen__warn">
            <EuiCallOut
              color="warning"
              size="s"
              iconType="alert"
              title={warnings.some(w => w.toLowerCase().includes('local draft')) ? 'Generated with local fallback' : 'Some inputs needed attention'}
            >
              <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </EuiCallOut>
          </div>
        )}
      </section>

      {/* drafts review workspace */}
      {drafts.length > 0 && (
        <section className="draftbar" ref={draftsRef}>
          <div className="draftbar__bar qa-glass">
            <div className="draftbar__label">
              <QaIcon type="sparkles" size="m" color="var(--accent-teal)" />
              <strong>{drafts.length} draft {drafts.length === 1 ? 'story' : 'stories'}</strong>
              <span>review &amp; refine before saving</span>
            </div>
            <div className="draftbar__actions">
              <EuiButtonEmpty size="s" iconType="plusInCircle" onClick={() => setDrafts(prev => [blankDraft(), ...prev])}>Add blank</EuiButtonEmpty>
              {selectedCount >= 2 && (
                <EuiButton size="s" iconType="merge" onClick={mergeSelected}>Merge selected ({selectedCount})</EuiButton>
              )}
              <EuiButton size="s" color="danger" onClick={() => { setDrafts([]); setSel(new Set()); }}>Discard</EuiButton>
              <EuiButton size="s" fill iconType="save" isLoading={saving} onClick={saveAll}>Save all ({drafts.length})</EuiButton>
            </div>
          </div>

          <div className="scards">
            {drafts.map((d, i) => (
              <DraftCard
                key={d._key}
                draft={d}
                index={i}
                selected={sel.has(`draft:${d._key}`)}
                onChange={patch => updateDraft(d._key, patch)}
                onToggle={() => toggleSel(`draft:${d._key}`)}
                onDuplicate={() => duplicateDraft(d._key)}
                onQuickSplit={() => quickSplit(d._key)}
                onAiSplit={() => aiSplitDraft(d)}
                onRemove={() => removeDraft(d._key)}
                splitting={splitId === `draft:${d._key}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* saved stories */}
      <section className="stories-list">
        <div className="stories-list__header">
          <div>
            <div className="stories-sectionLabel">Projects &amp; stories</div>
            <div className="stories-list__meta">
              {stories.length
                ? `${projectSummaries.length} project${projectSummaries.length === 1 ? '' : 's'} • ${visibleStories.length} ${storyWord(visibleStories.length)} shown`
                : 'No saved stories yet'}
            </div>
          </div>
          {selectedCount >= 2 && (
            <EuiButton size="s" iconType="merge" onClick={mergeSelected}>Merge selected ({selectedCount})</EuiButton>
          )}
        </div>

        {loading ? (
          <div className="stories-empty qa-glass"><EuiLoadingSpinner size="xl" /></div>
        ) : stories.length === 0 ? (
          <div className="stories-empty qa-glass">
            <QaIcon type="document" size="xl" color="var(--text-3)" />
            <h3>No stories yet</h3>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '6px 0 0' }}>Generate from requirements above, or add a blank story.</p>
          </div>
        ) : (
          <div className="project-story-layout">
            <aside className="project-rail qa-glass" aria-label="Projects">
              <button
                type="button"
                className={`project-tab ${selectedProject === 'all' ? 'project-tab--active' : ''}`}
                onClick={() => setSelectedProject('all')}
              >
                <div>
                  <strong>All projects</strong>
                  <span>{stories.length} stories</span>
                </div>
                <QaIcon type={selectedProject === 'all' ? 'checkInCircleFilled' : 'folderOpen'} size="m" color="var(--accent-teal)" />
              </button>

              {projectSummaries.map(project => (
                <button
                  type="button"
                  key={project.name}
                  className={`project-tab ${selectedProject === project.name ? 'project-tab--active' : ''}`}
                  onClick={() => setSelectedProject(project.name)}
                >
                  <div className="project-tab__main">
                    <strong>{project.name}</strong>
                    <span>{project.count} stories • {project.points} pts • {project.criteria} criteria</span>
                    <div className="project-tab__statuses">
                      {(Object.keys(STORY_STATUS_META) as StoryStatus[]).map(statusKey => (
                        <span
                          key={statusKey}
                          title={`${STORY_STATUS_META[statusKey].label}: ${project.statuses[statusKey] || 0}`}
                          style={{
                            width: `${Math.max(8, (project.statuses[statusKey] || 0) * 16)}px`,
                            background: STORY_STATUS_META[statusKey].color,
                            opacity: project.statuses[statusKey] ? 1 : 0.18,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <QaIcon type={selectedProject === project.name ? 'checkInCircleFilled' : 'folderOpen'} size="m" color={selectedProject === project.name ? 'var(--accent-teal)' : 'var(--text-3)'} />
                </button>
              ))}
            </aside>

            <div className="project-story-detail">
              <div className="project-story-detail__head qa-glass">
                <div>
                  <h3>{selectedProject === 'all' ? 'All projects' : selectedProject}</h3>
                  <p>{visibleStories.length} {storyWord(visibleStories.length)} in view</p>
                </div>
                <div className="project-story-detail__status">
                  {(Object.keys(STORY_STATUS_META) as StoryStatus[]).map(statusKey => {
                    const countForStatus = visibleStories.filter(story => story.status === statusKey).length;
                    return (
                      <span key={statusKey} style={{ color: STORY_STATUS_META[statusKey].color }}>
                        {STORY_STATUS_META[statusKey].label}: {countForStatus}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="scards">
                {visibleStories.map((s, i) => (
                  <SavedCard
                    key={s.id}
                    story={s}
                    index={i}
                    selected={sel.has(`saved:${s.id}`)}
                    onToggle={() => toggleSel(`saved:${s.id}`)}
                    onEdit={() => setEditing(s)}
                    onAiSplit={() => aiSplitSaved(s)}
                    onDelete={() => handleDelete(s.id)}
                    splitting={splitId === `saved:${s.id}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <EuiSpacer size="m" />
      {editing && <EditModal story={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}
