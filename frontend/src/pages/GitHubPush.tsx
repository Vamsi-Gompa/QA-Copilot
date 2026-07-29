import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiFieldPassword,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useNavigate } from 'react-router-dom';
import QaIcon from '../components/QaIcon';
import { githubApi, testsApi } from '../services/api';
import type { DevelopmentArtifact, DevelopmentFile, GitHubRepoPlan } from '../types';

const ACTIVE_DEV_JOB_KEY = 'qa_active_development_job';
const GITHUB_SOURCE_KEY = 'qa_github_source_path';
const GITHUB_BRANCH_KEY = 'qa_github_source_branch';
const DEFAULT_CODE_BRANCH = 'feature/ai-developed-code';

function ShipMetric({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="github-shipMetric">
      <strong style={{ color }}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function CodeFileCard({ file }: { file: DevelopmentFile }) {
  const preview = file.content.length > 900 ? `${file.content.slice(0, 900)}\n...` : file.content;
  return (
    <article className="github-codeFile">
      <div className="github-codeFile__head">
        <div>
          <strong>{file.path}</strong>
          <p>{file.purpose || 'Generated implementation file'}</p>
        </div>
        <EuiBadge color="hollow">{file.path.split('.').pop() || 'file'}</EuiBadge>
      </div>
      <EuiCodeBlock language="tsx" fontSize="s" paddingSize="s" overflowHeight={160} transparentBackground>
        {preview || '// Empty file'}
      </EuiCodeBlock>
    </article>
  );
}

export default function GitHubPush() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [sourcePath, setSourcePath] = useState(() => localStorage.getItem(GITHUB_SOURCE_KEY) || '');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState(() => localStorage.getItem(GITHUB_BRANCH_KEY) || DEFAULT_CODE_BRANCH);
  const [baseBranch, setBaseBranch] = useState('main');
  const [createRepo, setCreateRepo] = useState(false);
  const [prTitle, setPrTitle] = useState('feat: Add AI-developed story implementation');
  const [createPr, setCreatePr] = useState(true);
  const [commitMsg, setCommitMsg] = useState('Add AI-developed story implementation');
  const [developmentJobId, setDevelopmentJobId] = useState<string | null>(null);
  const [developmentArtifact, setDevelopmentArtifact] = useState<DevelopmentArtifact | null>(null);
  const [repoPlan, setRepoPlan] = useState<GitHubRepoPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    githubApi.getConfig().then(cfg => {
      if (cfg?.repo) {
        setRepo(cfg.repo);
        setBranch(cfg.branch || DEFAULT_CODE_BRANCH);
        setBaseBranch(cfg.base_branch || 'main');
        setCreateRepo(Boolean(cfg.create_repo));
        setConfigured(true);
      }
    }).catch(() => {});

    const devId = localStorage.getItem(ACTIVE_DEV_JOB_KEY);
    if (devId) {
      setDevelopmentJobId(devId);
      testsApi.getDevelopment(devId)
        .then(artifact => {
          setDevelopmentArtifact(artifact);
          setSourcePath(prev => prev || artifact.path_or_url || '');
          setBranch(prev => prev || artifact.branch || DEFAULT_CODE_BRANCH);
        })
        .catch(() => {});
    }

    const initialSource = localStorage.getItem(GITHUB_SOURCE_KEY) || '';
    const initialBranch = localStorage.getItem(GITHUB_BRANCH_KEY) || DEFAULT_CODE_BRANCH;
    if (initialSource) {
      githubApi.repoPlan({ path_or_url: initialSource, branch: initialBranch })
        .then(plan => {
          setRepoPlan(plan);
          if (plan.repo) setRepo(plan.repo);
          if (plan.target_branch) setBranch(plan.target_branch);
          if (plan.default_branch) setBaseBranch(plan.default_branch);
          setCreateRepo(plan.create_repo);
        })
        .catch(() => {});
    }
  }, []);

  const files = developmentArtifact?.files || [];
  const branchOptions = useMemo(
    () => Array.from(new Set([...(repoPlan?.branches || []), branch, DEFAULT_CODE_BRANCH].filter(Boolean)))
      .map(item => ({ value: item, text: item })),
    [branch, repoPlan],
  );

  const handlePlan = useCallback(async () => {
    setPlanning(true);
    setError(null);
    try {
      const plan = await githubApi.repoPlan({
        token: token || undefined,
        repo: repo || undefined,
        path_or_url: sourcePath || undefined,
        branch,
      });
      setRepoPlan(plan);
      if (plan.repo) setRepo(plan.repo);
      if (plan.target_branch) setBranch(plan.target_branch);
      if (plan.default_branch) setBaseBranch(plan.default_branch);
      setCreateRepo(plan.create_repo);
      localStorage.setItem(GITHUB_SOURCE_KEY, sourcePath || plan.source_path || '');
      localStorage.setItem(GITHUB_BRANCH_KEY, plan.target_branch || branch);
      setConfigured(false);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Repository scan failed');
    } finally {
      setPlanning(false);
    }
  }, [branch, repo, sourcePath, token]);

  const handleConfigure = async () => {
    if (!token || !repo || !branch) return false;
    setConfiguring(true);
    setError(null);
    try {
      await githubApi.configure(token, repo, branch, prTitle, {
        base_branch: baseBranch || 'main',
        create_repo: createRepo,
      });
      setConfigured(true);
      return true;
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Configuration failed');
      return false;
    } finally {
      setConfiguring(false);
    }
  };

  const handlePush = async () => {
    if (!developmentJobId || files.length === 0) {
      setError('Generate implementation code from Develop & Test before pushing.');
      return;
    }
    setPushing(true);
    setError(null);
    setResult(null);
    try {
      if (!configured) {
        const ok = await handleConfigure();
        if (!ok) return;
      }
      const res = await githubApi.push([], commitMsg, createPr, developmentJobId);
      setResult(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="github-page github-shipPage">
      <section className="github-shipHero qa-glass">
        <div>
          <div className="github-shipHero__eyebrow">
            <QaIcon type="logoGithub" size="s" color="var(--accent-teal)" />
            Code delivery
          </div>
          <EuiTitle size="m"><h2>Ship Developed Code</h2></EuiTitle>
          <EuiText size="s" color="subdued">
            <p>Push the implementation generated from user stories to a feature branch and optionally open a pull request.</p>
          </EuiText>
        </div>
        <div className="github-shipHero__metrics">
          <ShipMetric label="Code files" value={files.length} color="#00BFB3" />
          <ShipMetric label="Target branch" value={branch || 'not set'} color="#79AAD9" />
          <ShipMetric label="PR mode" value={createPr ? 'On' : 'Off'} color="#A987D1" />
        </div>
      </section>

      <EuiSpacer size="m" />

      {error && (
        <>
          <EuiCallOut title={error} color="danger" iconType="alert" size="s" onDismiss={() => setError(null)} />
          <EuiSpacer size="m" />
        </>
      )}

      <div className="github-shipGrid">
        <EuiPanel className="github-shipPanel" paddingSize="m">
          <div className="github-shipPanel__head">
            <span className="github-stepBadge">1</span>
            <div>
              <EuiTitle size="xs"><h3>Repository target</h3></EuiTitle>
              <EuiText size="s" color="subdued"><p>Detect the repo, choose the branch, and save the GitHub target.</p></EuiText>
            </div>
          </div>

          <EuiSpacer size="m" />
          <EuiFlexGroup gutterSize="m" wrap>
            <EuiFlexItem style={{ minWidth: 280 }}>
              <EuiFormRow label="Source folder or GitHub URL" helpText="Used to detect owner/repo and available branches">
                <EuiFieldText
                  value={sourcePath}
                  onChange={e => { setSourcePath(e.target.value); setConfigured(false); }}
                  placeholder="C:\\path\\to\\project or https://github.com/owner/repo"
                  prepend={<QaIcon type="folderOpen" />}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 260 }}>
              <EuiFormRow label="GitHub token" helpText="Needs repository write access">
                <EuiFieldPassword
                  value={token}
                  onChange={e => { setToken(e.target.value); setConfigured(false); }}
                  placeholder="ghp_..."
                />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="s" />
          <EuiButton iconType="search" onClick={handlePlan} isLoading={planning} disabled={!sourcePath && !repo}>
            Detect Repository
          </EuiButton>

          {repoPlan && (
            <>
              <EuiSpacer size="m" />
              <div className="github-repoPlan">
                <span><strong>Detected</strong>{repoPlan.detected_repo || 'none'}</span>
                <span><strong>Repository</strong>{repo || repoPlan.repo || 'not set'}</span>
                <span><strong>Base</strong>{repoPlan.default_branch || baseBranch}</span>
                <span><strong>Target</strong>{branch}</span>
              </div>
            </>
          )}

          <EuiSpacer size="m" />
          <EuiFlexGroup gutterSize="m" wrap>
            <EuiFlexItem style={{ minWidth: 240 }}>
              <EuiFormRow label="Repository" helpText="owner/repo">
                <EuiFieldText
                  value={repo}
                  onChange={e => { setRepo(e.target.value); setConfigured(false); }}
                  placeholder="owner/repo"
                  prepend={<QaIcon type="logoGithub" />}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 190 }}>
              <EuiFormRow label="Existing branch">
                <EuiSelect
                  value={branch}
                  options={branchOptions.length ? branchOptions : [{ value: branch, text: branch }]}
                  onChange={e => { setBranch(e.target.value); setConfigured(false); }}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 230 }}>
              <EuiFormRow label="Create or target branch">
                <EuiFieldText
                  value={branch}
                  onChange={e => { setBranch(e.target.value); setConfigured(false); }}
                  placeholder={DEFAULT_CODE_BRANCH}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 160 }}>
              <EuiFormRow label="Base branch">
                <EuiFieldText value={baseBranch} onChange={e => { setBaseBranch(e.target.value); setConfigured(false); }} />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="m" />
          <EuiSwitch
            label={`Create repository if it does not exist${repo ? ` (${repo})` : ''}`}
            checked={createRepo}
            onChange={e => { setCreateRepo(e.target.checked); setConfigured(false); }}
          />
          <EuiSpacer size="m" />
          <EuiButton fill onClick={handleConfigure} isLoading={configuring} disabled={!token || !repo || !branch}>
            {configured ? 'GitHub Target Saved' : 'Save GitHub Target'}
          </EuiButton>
        </EuiPanel>

        <EuiPanel className="github-shipPanel" paddingSize="m">
          <div className="github-shipPanel__head">
            <span className="github-stepBadge">2</span>
            <div>
              <EuiTitle size="xs"><h3>Review code bundle</h3></EuiTitle>
              <EuiText size="s" color="subdued"><p>These are the generated application files that will be pushed.</p></EuiText>
            </div>
          </div>

          <EuiSpacer size="m" />
          {!developmentArtifact ? (
            <EuiEmptyPrompt
              icon={<QaIcon type="document" size="xl" />}
              title={<h3>No development bundle selected</h3>}
              body={<p>Generate implementation code from selected stories in Develop & Test, then return here.</p>}
              actions={<EuiButton fill onClick={() => navigate('/generate')}>Open Develop & Test</EuiButton>}
            />
          ) : (
            <>
              <div className="github-bundleSummary">
                <span><strong>{files.length}</strong> code files</span>
                <span><strong>{developmentArtifact.source_type}</strong> source</span>
                <span><strong>{developmentArtifact.save_target}</strong> target</span>
              </div>
              <EuiSpacer size="s" />
              <EuiText size="xs" color="subdued">
                <p style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>{developmentArtifact.root}</p>
              </EuiText>
              <EuiSpacer size="m" />
              <div className="github-codeFiles">
                {files.slice(0, 5).map(file => <CodeFileCard key={file.path} file={file} />)}
                {files.length > 5 && <EuiBadge color="hollow">+{files.length - 5} more files</EuiBadge>}
              </div>
            </>
          )}
        </EuiPanel>
      </div>

      <EuiSpacer size="m" />

      <EuiPanel className="github-shipPanel github-shipPanel--commit" paddingSize="m">
        <div className="github-shipPanel__head">
          <span className="github-stepBadge">3</span>
          <div>
            <EuiTitle size="xs"><h3>Commit and open PR</h3></EuiTitle>
            <EuiText size="s" color="subdued"><p>Push only the developed code bundle. Test files are not included in this action.</p></EuiText>
          </div>
        </div>

        <EuiSpacer size="m" />
        <EuiCallOut
          title={`${repo || 'Repository not set'} -> ${branch || 'branch not set'}`}
          color={configured ? 'success' : 'primary'}
          iconType={configured ? 'checkInCircleFilled' : 'logoGithub'}
          size="s"
        >
          <p style={{ margin: 0 }}>
            {createRepo ? 'A missing repository will be created before code is pushed.' : 'Existing repository will be used.'}
          </p>
        </EuiCallOut>

        <EuiSpacer size="m" />
        <div className="github-commitGrid">
          <EuiFormRow label="Commit message">
            <EuiFieldText value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
          </EuiFormRow>
          <EuiFormRow label="Pull request title">
            <EuiFieldText value={prTitle} onChange={e => { setPrTitle(e.target.value); setConfigured(false); }} />
          </EuiFormRow>
        </div>
        <EuiSpacer size="m" />
        <EuiSwitch label="Create pull request after pushing code" checked={createPr} onChange={e => setCreatePr(e.target.checked)} />
        <EuiSpacer size="m" />
        <EuiFlexGroup alignItems="center" gutterSize="s" wrap>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              iconType="logoGithub"
              onClick={handlePush}
              isLoading={pushing}
              disabled={!token || !repo || !branch || !developmentJobId || files.length === 0}
              color="success"
            >
              Push {files.length} Code File{files.length === 1 ? '' : 's'}
            </EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={() => navigate('/generate')} iconType="beaker">
              Back to Develop & Test
            </EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>

      {result && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut title="Code pushed successfully" color="success" iconType="checkInCircleFilled">
            <p><strong>{result.pushed?.length || 0}</strong> files pushed to branch <code>{result.branch}</code></p>
            {result.pr_url && (
              <p>
                <QaIcon type="logoGithub" style={{ marginRight: 4 }} />
                <a href={result.pr_url} target="_blank" rel="noreferrer" style={{ color: '#00BFB3' }}>
                  View Pull Request
                </a>
              </p>
            )}
          </EuiCallOut>
        </>
      )}
    </div>
  );
}
