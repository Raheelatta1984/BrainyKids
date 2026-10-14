"use client";

import { useState } from "react";
import { actions } from "@/lib/client/api";

export type ParentAuthMode = "login" | "signup";

/** Email + password sign-in / sign-up for the parent account. */
export default function ParentAuth({
  mode = "login",
  onModeChange,
  onSuccess,
  onBack,
  notice,
}: {
  mode?: ParentAuthMode;
  onModeChange?: (mode: ParentAuthMode) => void;
  onSuccess: () => void;
  onBack?: () => void;
  notice?: string | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signup = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (signup && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    const result = signup
      ? await actions.parentSignup({ name, email, password })
      : await actions.parentLogin({ email, password });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSuccess();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h2>{signup ? "Create a parent account" : "Parent sign in"}</h2>
      <p className="muted">
        {signup
          ? "Parents sign up first, then add each child and link their device."
          : "Sign in to see progress, link kid devices and approve screen time."}
      </p>
      {notice && <p className="banner info">{notice}</p>}

      {signup && (
        <label>
          Your name
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Alex" />
        </label>
      )}
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
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={signup ? "new-password" : "current-password"}
          placeholder={signup ? "At least 8 characters" : "Your password"}
          required
        />
      </label>
      {signup && (
        <label>
          Repeat password
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </label>
      )}

      {error && <p className="banner error">{error}</p>}

      <div className="row gap">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
        {onModeChange && (
          <button type="button" className="link" onClick={() => onModeChange(signup ? "login" : "signup")}>
            {signup ? "I already have an account" : "Create a parent account"}
          </button>
        )}
      </div>
      {onBack && (
        <button type="button" className="link" onClick={onBack}>
          ← Back
        </button>
      )}
    </form>
  );
}
