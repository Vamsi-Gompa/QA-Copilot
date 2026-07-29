import React, { useEffect, useRef } from 'react';
import { EuiBadge, EuiLoadingSpinner } from '@elastic/eui';
import type { AgentEvent } from '../types';

interface Props {
  events: AgentEvent[];
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
  generatedCount: number;
}

const EV: Record<string, { color: string; prefix: string }> = {
  thinking:       { color: '#6B7D96',  prefix: '◆' },
  tool_use:       { color: '#79AAD9',  prefix: '⚙' },
  tool_result:    { color: '#A987D1',  prefix: '◀' },
  progress:       { color: '#F1D86F',  prefix: '▶' },
  test_generated: { color: '#00BFB3',  prefix: '✓' },
  complete:       { color: '#7DE2D1',  prefix: '✦' },
  error:          { color: '#F86B63',  prefix: '✕' },
};

export default function AgentThinking({ events, isStreaming, isComplete, error, generatedCount }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="qa-terminal" style={{ maxHeight: 460 }}>
      {/* Title bar */}
      <div className="qa-terminal-titlebar">
        <div className="qa-terminal-dot" style={{ background: '#F86B63' }} />
        <div className="qa-terminal-dot" style={{ background: '#F1D86F' }} />
        <div className="qa-terminal-dot" style={{ background: '#00BFB3' }} />
        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-3)', fontWeight: 500, letterSpacing: '0.04em' }}>
          Claude Opus 4.8 — Single-Pass Agent
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {generatedCount > 0 && (
            <EuiBadge color="success" style={{ fontSize: 10 }}>{generatedCount} generated</EuiBadge>
          )}
          {isStreaming && <EuiLoadingSpinner size="s" />}
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="qa-terminal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
        {/* Status line */}
        <div className="qa-terminal-line" style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--control-hover)' }}>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
            {isStreaming ? '$ running agent loop...' : isComplete ? '$ agent loop complete' : '$ ready — awaiting prompt'}
          </span>
          {isStreaming && <span className="qa-terminal-cursor" />}
        </div>

        {events.length === 0 && !isStreaming && (
          <div style={{ color: 'var(--text-3)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>
            Enter a GitHub URL or user stories and click generate to start
          </div>
        )}

        {events.map((ev, i) => {
          if (ev.type === 'tool_result') return null;
          const cfg = EV[ev.type] || EV.thinking;
          return (
            <div key={i} className="qa-terminal-line" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: cfg.color, flexShrink: 0, fontSize: 11, lineHeight: 1.7, minWidth: 12, opacity: 0.8 }}>
                {cfg.prefix}
              </span>
              <span style={{ fontSize: 11, lineHeight: 1.7, flex: 1, wordBreak: 'break-word' }}>
                {ev.type === 'test_generated' ? (
                  <>
                    <EuiBadge
                      color={['selenium', 'playwright'].includes(String(ev.metadata.test_type || '')) ? 'primary' : 'accent'}
                      style={{ fontSize: 9, marginRight: 6 }}
                    >
                      {String(ev.metadata.test_type || '').toUpperCase()}
                    </EuiBadge>
                    <span style={{ color: '#00BFB3', fontWeight: 600 }}>
                      {String(ev.metadata.test_name || '')}
                    </span>
                    {ev.metadata.file_name && (
                      <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>
                        → {String(ev.metadata.file_name)}
                      </span>
                    )}
                  </>
                ) : ev.type === 'tool_use' ? (
                  <span>
                    <span style={{ color: 'var(--text-3)' }}>fn </span>
                    <span style={{ color: '#79AAD9', fontWeight: 600 }}>
                      {ev.content.replace('Using tool: **', '').replace('**', '')}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>()</span>
                  </span>
                ) : ev.type === 'complete' ? (
                  <span style={{ color: '#7DE2D1', fontWeight: 600 }}>{ev.content}</span>
                ) : ev.type === 'error' ? (
                  <span style={{ color: '#F86B63' }}>{ev.content}</span>
                ) : (
                  <span style={{ color: cfg.color, opacity: 0.85 }}>{ev.content}</span>
                )}
              </span>
              <span style={{ color: 'var(--text-3)', fontSize: 9, flexShrink: 0, marginTop: 2 }}>
                {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          );
        })}

        {error && (
          <div className="qa-neg-error" style={{ marginTop: 8 }}>✕ {error}</div>
        )}

        {isStreaming && events.length > 0 && (
          <div className="qa-terminal-line" style={{ marginTop: 4 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>processing</span>
            <span className="qa-terminal-cursor" />
          </div>
        )}
      </div>
    </div>
  );
}
