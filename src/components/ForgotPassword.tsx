"use client";

import { useState } from "react";
import { actions } from "@/lib/client/api";

/**
 * “Forgot password?” — a parent sets a new password with their recovery code.
 *
 * BrainyKids does not send email, so there is no reset link to wait for: the
 * recovery code shown when the account was created (and re-issued any time from
 * the dashboard) is what proves the account belongs to the parent.
 */
export default function ForgotPassword({
  onDone,
  onBack,
  onRecoveryCode,
  notice,
}: {
  onDone: () => void;
  onBack: () => void;
  onRecoveryCode: (code: string) => void;
  notice?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await actions.parentRecovery({ email, code, password });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRecoveryCode(result.data.recoveryCode);
    setDone(true);
  }

  if (done) {
    return (
      <div className="auth-form">
        <h2>Password updated</h2>
        <p className="banner good">You are signed in with your new password.</p>
        <p className="muted">
          Your old recovery code has been used up. The new one is saved on your dashboard — open{" "}
          <strong>Sign-in &amp; security</strong> to see it again or to create a fresh one.
        </p>
        <button type="button" className="primary" onClick={onDone}>
          Go to my dashboard
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h2>Forgot password?</h2>
      <p className="muted">
        Use the recovery code you saved when you created the account. It looks like{" "}
        <code>ABCD-2EFG-3HJK</code>.
      </p>
      {notice && <p className="banner info">{notice}</p>}

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="parent@example.com"
          required
        />
      </label>
      <label>
        Recovery code
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD-2EFG-3HJK"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          required
        />
      </label>
      <label>
        New password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
        />
      </label>
      <label>
        Repeat new password
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
        />
      </label>

      {error && <p className="banner error">{error}</p>}

      <div className="row gap">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Set a new password"}
        </button>
        <button type="button" className="link" onClick={onBack}>
          ← Back to sign in
        </button>
      </div>

      <p className="muted small">
        Lost the recovery code too? Anyone still signed in as a parent can create a new one under{" "}
        <strong>Sign-in &amp; security</strong> on the dashboard. On a self-hosted copy, whoever runs the server can also
        run <code>npm run reset-password</code>.
      </p>
    </form>
  );
}
