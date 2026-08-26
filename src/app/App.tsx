/**
 * The shell: loads /api/state once, routes between the two tabs by location.hash
 * (#chat, #settings — no router dependency), and raises the password gate whenever
 * the deployment requires one and the stored password is missing or wrong.
 *
 * With no hash the path decides, so /settings opens on Settings — see route.ts.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../shared/types';
import { api, onUnauthorized } from './api';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import PasswordGate from './components/PasswordGate';
import { tabFor, type Tab } from './route';

const currentTab = (): Tab => tabFor(location.pathname, location.hash);

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>(currentTab);
  const [gateOpen, setGateOpen] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const next = await api<AppState>('/api/state');
      setState(next);
      setLoadError('');
      setGateOpen(next.adminRequired && !next.adminOk);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => setGateOpen(true));
    void refreshState();
    return () => onUnauthorized(null);
  }, [refreshState]);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (loadError) {
    return (
      <main className="shell">
        <div className="notice error">
          Could not reach the API: {loadError}{' '}
          <button className="link" onClick={() => void refreshState()}>
            Retry
          </button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  // Locked, and nothing behind the lock. The gate used to be an overlay laid over
  // a rendered console, which reads as a lock and is not one: the agent list was
  // in the DOM, one devtools panel away. The Worker no longer sends it (see
  // /api/state), so there is nothing here to cover up — and the page says so
  // rather than flashing an empty console at whoever just typed the URL.
  if (gateOpen) {
    return (
      <main className="shell">
        <PasswordGate onSubmitted={refreshState} />
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ✳
          </span>
          <div>
            <h1>Manyfold Agent Starter</h1>
            <p className="muted">Your Cloudflare app, wired to your Manyfold agents.</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Pages">
          <a className={tab === 'chat' ? 'tab active' : 'tab'} href="#chat">
            Chat
          </a>
          <a className={tab === 'settings' ? 'tab active' : 'tab'} href="#settings">
            Settings
          </a>
        </nav>
      </header>

      {tab === 'chat' ? (
        <ChatView agents={state.agents} initialSession={state.connect.session} refreshState={refreshState} />
      ) : (
        <SettingsView agents={state.agents} initialSession={state.connect.session} refreshState={refreshState} />
      )}
    </main>
  );
}
