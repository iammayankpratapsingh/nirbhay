'use client';

import { useState } from 'react';

export default function UnlockForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        window.location.replace(next);
        return;
      }
      setError(body.error || 'Wrong password. Try again.');
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setBusy(false);
  }

  return (
    <form className="unlock-form" onSubmit={submit}>
      <label htmlFor="pw" className="field-label">
        Password
      </label>
      <div className="pw-row">
        <input
          id="pw"
          className="input"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'pw-error' : undefined}
          required
        />
        <button type="button" className="btn btn-ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && (
        <p id="pw-error" className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-lg" disabled={busy || !password}>
        {busy ? 'Checking…' : 'Enter the arena'}
      </button>
    </form>
  );
}
