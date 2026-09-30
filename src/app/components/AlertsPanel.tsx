/**
 * Where agent failures go. A failed reading reaches the visitor as an error
 * inside a stream that already answered 200, so without this the operator only
 * hears about it from the visitor. See src/worker/alerts.ts.
 *
 * The webhook URL goes in and never comes back out: the Worker seals it and
 * only ever reports whether one is set.
 */

import { useEffect, useState } from 'react';
import type { AlertsView } from '../../shared/types';
import { api } from '../api';

export default function AlertsPanel() {
  const [view, setView] = useState<AlertsView | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    try {
      setView(await api<AlertsView>('/api/alerts'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const result = await api<{ delivered: boolean; alerts: AlertsView }>('/api/alerts/discord', {
        method: 'PUT',
        body: JSON.stringify({ url: url.trim() }),
      });
      setView(result.alerts);
      setUrl('');
      setNote(
        result.delivered
          ? 'Saved. A test message was posted to the channel.'
          : 'Saved, but Discord did not accept the test message — check the webhook still exists.',
      );
    });

  const remove = () =>
    run(async () => {
      const result = await api<{ alerts: AlertsView }>('/api/alerts/discord', { method: 'DELETE' });
      setView(result.alerts);
    });

  return (
    <>
      <h3>Failure alerts</h3>
      <p className="muted">
        When the reader fails a visitor, post it to a Discord channel — at most one message per 15
        minutes while it keeps failing, and one more when it recovers. Discord: channel settings →
        Integrations → Webhooks → New Webhook → Copy Webhook URL.
      </p>

      {view && (
        <p className="small">
          {view.discord.configured ? (
            <span className="badge ok">Discord connected</span>
          ) : (
            <span className="badge warn">no webhook</span>
          )}{' '}
          {view.failing ? (
            <span className="warn">
              ⚠ The reader has been failing since {new Date(view.failingSince!).toLocaleString()}.
            </span>
          ) : (
            <span className="muted">No ongoing failures.</span>
          )}
        </p>
      )}

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={view?.discord.configured ? 'Replace webhook URL' : 'https://discord.com/api/webhooks/…'}
          aria-label="Discord webhook URL"
        />
        <button className="button primary" type="submit" disabled={busy || !url.trim()}>
          {busy ? 'Saving…' : 'Save & test'}
        </button>
        {view?.discord.configured && (
          <button className="button danger-outline" type="button" onClick={() => void remove()} disabled={busy}>
            Remove
          </button>
        )}
      </form>

      {note && <div className="notice">{note}</div>}
      {error && <div className="notice error">{error}</div>}

      {view && view.failures.length > 0 && (
        <>
          <p className="muted small">Recent failures (newest first):</p>
          <ul className="small">
            {view.failures.map((failure, index) => (
              <li key={`${failure.at}-${index}`}>
                <span className="muted">{new Date(failure.at).toLocaleString()}</span> ·{' '}
                <code>{failure.kind}</code> · {failure.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
