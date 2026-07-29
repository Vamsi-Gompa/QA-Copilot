import React, { useState, useEffect } from 'react';
import {
  EuiTitle, EuiText, EuiSpacer, EuiPanel, EuiFlexGroup, EuiFlexItem,
  EuiButton, EuiFieldText, EuiFormRow, EuiSelect, EuiCallOut,
  EuiLoadingSpinner, EuiBadge, EuiStat, EuiProgress,
} from '@elastic/eui';
import QaIcon from '../components/QaIcon';
import { codebaseApi } from '../services/api';
import type { CodebaseSync } from '../types';

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'danger',
};

export default function SyncCodebase() {
  const [sourceType, setSourceType] = useState('local');
  const [pathOrUrl, setPathOrUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [syncing, setSyncing] = useState(false);
  const [latest, setLatest] = useState<CodebaseSync | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    codebaseApi.latest().then(setLatest).catch(() => {});
  }, []);

  const handleSync = async () => {
    if (!pathOrUrl.trim()) return;
    setError(null); setSuccess(null); setSyncing(true);
    try {
      const res = await codebaseApi.sync(sourceType, pathOrUrl.trim(), branch);
      setSuccess(`Sync started (ID: ${res.id})`);
      setPolling(true);
      pollStatus(res.id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to start sync');
    } finally {
      setSyncing(false);
    }
  };

  const pollStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const sync = await codebaseApi.get(id);
        setLatest(sync as any);
        if (sync.status === 'completed' || sync.status === 'failed') {
          clearInterval(interval);
          setPolling(false);
          if (sync.status === 'completed') setSuccess('Codebase synced successfully!');
          if (sync.status === 'failed') setError(`Sync failed: ${sync.structure_summary}`);
        }
      } catch {
        clearInterval(interval);
        setPolling(false);
      }
    }, 2000);
  };

  const examplePaths = [
    'C:\\Users\\yourname\\projects\\myapp',
    'D:\\workspace\\backend-api',
    'https://github.com/username/repo',
  ];

  return (
    <div>
      <EuiTitle size="m"><h2>Sync Codebase</h2></EuiTitle>
      <EuiText color="subdued" size="s">
        <p>Connect your codebase so the AI can generate context-aware tests</p>
      </EuiText>

      <EuiSpacer size="l" />

      {success && <><EuiCallOut color="success" title={success} iconType="check" size="s" /><EuiSpacer size="m" /></>}
      {error && <><EuiCallOut color="danger" title={error} iconType="alert" size="s" /><EuiSpacer size="m" /></>}

      <EuiPanel paddingSize="l" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)', borderRadius: 10 }}>
        <EuiText size="m"><strong>Configure Source</strong></EuiText>
        <EuiSpacer size="m" />

        <EuiFormRow label="Source Type">
          <EuiSelect
            options={[
              { value: 'local', text: 'Local Directory' },
              { value: 'git', text: 'Git Repository (URL)' },
            ]}
            value={sourceType}
            onChange={e => setSourceType(e.target.value)}
          />
        </EuiFormRow>

        <EuiSpacer size="m" />

        <EuiFormRow
          label={sourceType === 'git' ? 'Repository URL' : 'Directory Path'}
          helpText={
            sourceType === 'git'
              ? 'e.g. https://github.com/username/repo'
              : `e.g. ${examplePaths[0]}`
          }
        >
          <EuiFieldText
            value={pathOrUrl}
            onChange={e => setPathOrUrl(e.target.value)}
            placeholder={sourceType === 'git' ? 'https://github.com/...' : 'C:\\path\\to\\project'}
            prepend={<QaIcon type={sourceType === 'git' ? 'logoGithub' : 'folderOpen'} />}
          />
        </EuiFormRow>

        {sourceType === 'git' && (
          <>
            <EuiSpacer size="m" />
            <EuiFormRow label="Branch">
              <EuiFieldText
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
              />
            </EuiFormRow>
          </>
        )}

        <EuiSpacer size="l" />
        <EuiButton
          fill
          onClick={handleSync}
          isLoading={syncing || polling}
          disabled={!pathOrUrl.trim()}
          iconType="refresh"
        >
          {polling ? 'Scanning...' : 'Sync Codebase'}
        </EuiButton>
      </EuiPanel>

      {polling && (
        <>
          <EuiSpacer size="m" />
          <EuiPanel paddingSize="m" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-dim)' }}>
            <EuiFlexGroup alignItems="center" gutterSize="m">
              <EuiFlexItem grow={false}><EuiLoadingSpinner size="m" /></EuiFlexItem>
              <EuiFlexItem><EuiText size="s">Scanning files and extracting code structure...</EuiText></EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="s" />
            <EuiProgress size="xs" color="accent" />
          </EuiPanel>
        </>
      )}

      {latest && latest.status === 'completed' && (
        <>
          <EuiSpacer size="l" />
          <EuiPanel paddingSize="l" style={{ background: 'var(--surface-1)', border: '1px solid #00BFB3', borderRadius: 10 }}>
            <EuiFlexGroup alignItems="center" gutterSize="s" style={{ marginBottom: 16 }}>
              <EuiFlexItem grow={false}>
                <QaIcon type="checkInCircleFilled" size="l" color="#00BFB3" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiText><strong>Codebase synced</strong></EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge color="success">Ready</EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>

            <EuiFlexGroup gutterSize="xl">
              <EuiFlexItem grow={false}>
                <EuiStat title={String(latest.file_count)} description="Files found" titleColor="#00BFB3" titleSize="m" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiStat title={latest.languages.slice(0, 2).join(', ') || '—'} description="Languages" titleSize="m" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiStat title={latest.source_type.toUpperCase()} description="Source" titleSize="m" />
              </EuiFlexItem>
            </EuiFlexGroup>

            {latest.structure_summary && (
              <>
                <EuiSpacer size="m" />
                <EuiText size="s" color="subdued">
                  <p>{latest.structure_summary}</p>
                </EuiText>
              </>
            )}

            <EuiSpacer size="s" />
            <EuiText size="xs" color="subdued">
              <p>Source: {latest.path_or_url}</p>
            </EuiText>
          </EuiPanel>
        </>
      )}
    </div>
  );
}
