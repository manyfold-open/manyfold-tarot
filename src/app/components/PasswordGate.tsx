/**
 * Shown when this browser has not given the console's password, or gave a wrong
 * one. The password lives in sessionStorage — gone when the tab closes, never in
 * a cookie, never in a URL.
 *
 * The copy no longer names ADMIN_PASSWORD. It used to, back when the secret was
 * the only way the app could be locked and its absence meant no lock at all; now
 * a default ships with the deployment (src/worker/admin.ts) and the secret is one
 * of two answers. Naming the wrong one to a stranger is a hint they have not
 * earned, and naming both is a paragraph nobody standing at a locked door wants.
 */

import { useState } from 'react';
import { setStoredPassword } from '../api';

export default function PasswordGate(props: { onSubmitted: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStoredPassword(value.trim());
    await props.onSubmitted();
    setSubmitting(false);
    setTouched(true);
  };

  return (
    <div className="overlay">
      <form className="dialog" onSubmit={(event) => void submit(event)}>
        <h2>Admin password required</h2>
        <p className="muted">
          The operator console is locked. The reading itself is not — it is at{' '}
          <a href="/">the front page</a>, and needs no password.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Admin password"
          aria-label="Admin password"
        />
        {touched && <div className="notice error">That password was not accepted.</div>}
        <button className="button primary" type="submit" disabled={submitting || !value.trim()}>
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
