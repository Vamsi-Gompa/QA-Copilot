import React, { useState } from 'react';
import { EuiBadge, EuiText, EuiButton, EuiButtonEmpty, EuiCodeBlock } from '@elastic/eui';
import type { GeneratedTest } from '../types';

interface Props {
  test: GeneratedTest;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDelete?: (id: string) => void;
  showActions?: boolean;
}

const STATUS_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  generated: { bg: 'rgba(121,170,217,0.06)', border: 'rgba(121,170,217,0.2)',  color: '#79AAD9' },
  approved:  { bg: 'rgba(0,191,179,0.06)',   border: 'rgba(0,191,179,0.25)',   color: '#00BFB3' },
  rejected:  { bg: 'rgba(248,107,99,0.06)',  border: 'rgba(248,107,99,0.22)',  color: '#F86B63' },
};

const TYPE_COLOR: Record<string, string> = {
  selenium: '#F1D86F',
  playwright: '#79AAD9',
  pytest: '#A987D1',
};

export default function TestPreview({ test, onApprove, onReject, onDelete, showActions = true }: Props) {
  const [showCode, setShowCode] = useState(false);
  const st = STATUS_STYLE[test.status] || STATUS_STYLE.generated;
  const lines = test.code.split('\n').length;
  const typeColor = TYPE_COLOR[test.test_type] || '#98A2B3';

  return (
    <div
      className="qa-glass"
      style={{
        marginBottom: 8,
        padding: '14px 16px',
        background: st.bg,
        borderColor: st.border,
        borderRadius: 12,
        transition: 'all 0.22s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Type badge */}
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px',
          borderRadius: 20, background: `${typeColor}20`,
          color: typeColor, border: `1px solid ${typeColor}30`,
        }}>
          {test.test_type.toUpperCase()}
        </span>

        {/* Status dot */}
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color, flexShrink: 0, boxShadow: `0 0 5px ${st.color}` }} />

        {/* Name */}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', flex: 1, minWidth: 0 }}>
          {test.name}
          <span style={{ color: 'var(--text-3)', fontSize: 11, fontWeight: 400, marginLeft: 10, fontFamily: 'JetBrains Mono, monospace' }}>
            {test.file_name}
          </span>
        </span>

        {/* Actions */}
        {showActions && test.status === 'generated' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onApprove?.(test.id)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(0,191,179,0.4)',
                background: 'rgba(0,191,179,0.1)', color: '#00BFB3', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,191,179,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,191,179,0.1)')}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => onReject?.(test.id)}
              style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(248,107,99,0.3)',
                background: 'transparent', color: '#F86B63', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,107,99,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              ✕ Reject
            </button>
          </div>
        )}
        {test.status !== 'generated' && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            color: st.color, padding: '2px 8px', borderRadius: 20,
            background: st.bg, border: `1px solid ${st.border}`,
          }}>
            {test.status.toUpperCase()}
          </span>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(test.id)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4, fontSize: 12,
              transition: 'color 0.15s ease' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#F86B63')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
          >
            ✕
          </button>
        )}
      </div>

      {/* Description */}
      {test.description && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {test.description}
        </div>
      )}

      {/* Expected results */}
      {test.expected_results.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {test.expected_results.map((r, i) => (
            <span key={i} className="qa-data-pill">
              <span style={{ color: 'var(--text-3)' }}>⟩</span>
              <span style={{ color: 'var(--text-2)' }}>{r}</span>
            </span>
          ))}
        </div>
      )}

      {/* Code toggle */}
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => setShowCode(!showCode)}
          style={{
            background: 'var(--control-hover)', border: '1px solid var(--border-faint)',
            borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget.style.borderColor = 'rgba(0,191,179,0.3)'); (e.currentTarget.style.color = '#00BFB3'); }}
          onMouseLeave={e => { (e.currentTarget.style.borderColor = 'var(--border-faint)'); (e.currentTarget.style.color = 'var(--text-3)'); }}
        >
          <span>{showCode ? '▲' : '▼'}</span>
          {showCode ? 'hide code' : `view code (${lines} lines)`}
        </button>

        {showCode && (
          <div style={{ marginTop: 8, animation: 'fadeInUp 0.2s ease' }}>
            <EuiCodeBlock language="python" fontSize="s" paddingSize="s" isCopyable overflowHeight={320}>
              {test.code}
            </EuiCodeBlock>
          </div>
        )}
      </div>
    </div>
  );
}
