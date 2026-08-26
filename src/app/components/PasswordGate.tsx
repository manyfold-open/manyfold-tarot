/**
 * Shown when this browser has not given the console's password, or gave a wrong
 * one. The password lives in sessionStorage — gone when the tab closes, never in
 * a cookie, never in a URL.
 *
 * Two doors, because there are two ways to be standing outside one. The ordinary
 * case is a locked console and a person who may know the password, and it gets an
 * input. The other is a deployment that never set ADMIN_PASSWORD, where no input
 * can succeed and offering one is a puzzle with no solution — the operator who
 * just deployed this is owed the sentence that fixes it instead.
 *
 * Naming the secret to a stranger costs nothing. It is the name of an environment
 * variable in a public repository, not a hint about the value, and the person most
 * likely to be reading it is the one who owns the Worker.
 */

import { useState } from 'react';
import { setStoredPassword } from '../api';

/** The half that can be typed past. */
function Locked(props: { onSubmitted: () => Promise<void> }) {
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
  );
}

/** The half that cannot, until someone sets a secret. */
function Unconfigured() {
  return (
    <div className="dialog">
      <h2>This deployment has no admin password</h2>
      <p className="muted">
        The console stays closed until one is set — there is no default, so nobody can open it,
        including whoever published this code. Add an <code>ADMIN_PASSWORD</code> secret to the
        Worker and reload this page:
      </p>
      <p className="muted">
        Cloudflare dashboard → your Worker → <b>Settings</b> → <b>Variables and Secrets</b> → add{' '}
        <code>ADMIN_PASSWORD</code> as a <b>Secret</b>, then deploy the new version. Or, from a
        checkout: <code>npx wrangler secret put ADMIN_PASSWORD</code>.
      </p>
      <p className="muted">
        The reading is unaffected — it is at <a href="/">the front page</a> and needs no password.
      </p>
    </div>
  );
}

export default function PasswordGate(props: {
  configured: boolean;
  onSubmitted: () => Promise<void>;
}) {
  return (
    <div className="overlay">
      {props.configured ? <Locked onSubmitted={props.onSubmitted} /> : <Unconfigured />}
    </div>
  );
}
