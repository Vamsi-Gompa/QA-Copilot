import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import QaIcon from './QaIcon';
import type { ThemeMode } from '../App';

const NAV: Array<{
  id: string;
  label: string;
  path: string;
  icon: string;
  color: string;
  isNew?: boolean;
}> = [
  { id: 'dashboard',  label: 'Dashboard',      path: '/',          icon: 'dashboardApp',      color: '#00BFB3' },
  { id: 'stories',    label: 'User Stories',    path: '/stories',   icon: 'document',          color: '#79AAD9' },
  // { id: 'codebase',   label: 'Sync Codebase',   path: '/codebase',  icon: 'branchUser',        color: '#A987D1' },
  { id: 'generate',   label: 'Develop & Test',  path: '/generate',  icon: 'beaker',            color: '#F1D86F' },
  { id: 'run',        label: 'Run Tests',       path: '/run',       icon: 'playFilled',        color: '#7DE2D1' },
  { id: 'scan-test',  label: 'Only Test',       path: '/scan-test', icon: 'searchProfilerApp', color: '#00BFB3' },
  { id: 'github',     label: 'GitHub Push',     path: '/github',    icon: 'logoGithub',        color: '#E8E8E8' },
];

interface Props {
  children: React.ReactNode;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export default function AppLayout({ children, theme, onToggleTheme }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0, position: 'sticky', top: 0, height: '100vh',
        background: 'var(--sidebar-bg)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'background 0.2s ease, border-color 0.2s ease',
      }}>
        {/* Logo */}
        <div style={{ padding: '22px 18px 14px', borderBottom: '1px solid var(--border-faint)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'linear-gradient(135deg, rgba(0,191,179,0.25), rgba(169,135,209,0.2))',
              border: '1px solid rgba(0,191,179,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 16px rgba(0,191,179,0.2)',
            }}>
              <QaIcon type="beaker" size="m" color="#00BFB3" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>AI QA Copilot</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, letterSpacing: '0.04em' }}>Provider-configurable AI</div>
            </div>
          </div>
          {/* Gradient line */}
          <div className="qa-header-line" style={{ marginTop: 12 }} />
        </div>

        {/* Section label */}
        <div style={{ padding: '12px 18px 6px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
            Navigation
          </span>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', border: 'none', cursor: 'pointer',
                borderRadius: 9, marginBottom: 2, transition: 'all 0.18s ease',
                background: pathname === item.path
                  ? `linear-gradient(90deg, ${item.color}18, transparent)`
                  : 'transparent',
                borderLeft: pathname === item.path ? `2px solid ${item.color}` : '2px solid transparent',
                textAlign: 'left',
              }}
              onMouseEnter={e => {
                if (pathname !== item.path)
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--control-hover)';
              }}
              onMouseLeave={e => {
                if (pathname !== item.path)
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <QaIcon
                type={item.icon as any} size="m"
                color={pathname === item.path ? item.color : 'var(--text-3)'}
                style={{ transition: 'color 0.18s ease', flexShrink: 0 }}
              />
              <span style={{
                fontSize: 13, fontWeight: pathname === item.path ? 600 : 400,
                color: pathname === item.path ? 'var(--text-1)' : 'var(--text-2)',
                transition: 'all 0.18s ease', flex: 1,
              }}>
                {item.label}
              </span>
              {item.isNew && <span className="qa-new">NEW</span>}
            </button>
          ))}
        </nav>

        {/* Theme toggle */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-faint)' }}>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${nextTheme} theme`}
            title={`Switch to ${nextTheme} theme`}
            style={{
              width: '100%', borderRadius: 9, border: '1px solid var(--theme-toggle-border)',
              background: 'var(--theme-toggle-bg)', color: 'var(--text-2)', cursor: 'pointer',
              padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9,
              fontSize: 12, fontWeight: 600, transition: 'all 0.18s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--control-hover)';
              e.currentTarget.style.color = 'var(--text-1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--theme-toggle-bg)';
              e.currentTarget.style.color = 'var(--text-2)';
            }}
          >
            <QaIcon type={theme === 'dark' ? 'sun' : 'moon'} size="m" color="var(--accent-teal)" />
            <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-faint)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00BFB3', boxShadow: '0 0 6px rgba(0,191,179,0.8)', animation: 'pulseGlow 2s infinite' }} />
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>Agentic Test Generation</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 40px' }}>
        {children}
      </main>
    </div>
  );
}
