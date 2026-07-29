import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { EuiProvider } from '@elastic/eui';

import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import UploadStories from './pages/UploadStories';
import SyncCodebase from './pages/SyncCodebase';
import GenerateTests from './pages/GenerateTests';
import RunTests from './pages/RunTests';
import GitHubPush from './pages/GitHubPush';
import ScanAndTest from './pages/ScanAndTest';
import LifecycleWorkspace from './pages/LifecycleWorkspace';

export type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'qa-copilot-theme';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export default function App() {
  const [theme, setTheme] = React.useState<ThemeMode>(getInitialTheme);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = React.useCallback(() => {
    setTheme(current => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <EuiProvider colorMode={theme}>
      <BrowserRouter>
        <AppLayout theme={theme} onToggleTheme={toggleTheme}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/lifecycle" element={<LifecycleWorkspace />} />
            <Route path="/stories" element={<UploadStories />} />
            <Route path="/codebase" element={<SyncCodebase />}/>
            <Route path="/generate" element={<GenerateTests />} />
            <Route path="/run" element={<RunTests />} />
            <Route path="/github" element={<GitHubPush />} />
            <Route path="/scan-test" element={<ScanAndTest />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </EuiProvider>
  );
}
