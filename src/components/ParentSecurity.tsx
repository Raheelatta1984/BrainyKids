"use client";

import { useEffect, useState } from "react";
import { actions } from "@/lib/client/api";
import { fingerprintBlockedReason, hasPlatformSensor, registerFingerprint } from "@/lib/client/webauthn";
import type { PasskeyView } from "@/lib/types";

function timeAgo(ts: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The one-time code a parent must keep: it is the way back in without email. */
export function RecoveryCodeBox({ code, onDismiss }: { code: string; onDismiss?: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="recovery-box">
      <span className="muted small">Your recovery code</span>
      <strong className="recovery-code">{code}</strong>
      <div className="row gap wrap">
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy code"}
        </button>
        {onDismiss && (
          <button type="button" className="link" onClick={onDismiss}>
            I have saved it
          </button>
        )}
      </div>
      <p className="muted small">
        Keep it somewhere safe — it is the only way to reset a forgotten password, because BrainyKids does not send email.
      </p>
    </div>
  );
}

/** Shown straight after signing up or resetting a password, once per code. */
export function SaveRecoveryCodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Save your recovery code">
      <div className="card modal">
        <h2>Save your recovery code</h2>
        <p className="muted">
          This code is shown only once. A parent can use it to set a new password if the old one is forgotten — no email
          needed.
        </p>
        <RecoveryCodeBox code={code} onDismiss={onClose} />
      </div>
    </div>
  );
}

/**
 * Dashboard card for everything to do with signing in: fingerprint / face
 * unlock, the recovery code, and the account password.
 */
export default function ParentSecurity({
  passkeys,
  onChanged,
  onRecoveryCode,
}: {
  passkeys: PasskeyView[];
  onChanged: () => void;
  onRecoveryCode: (code: string) => void;
}) {
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [sensor, setSensor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Everything runs inside the async callback so no state is set while the
    // effect itself is still running.
    void (async () => {
      const reason = fingerprintBlockedReason();
      const available = await hasPlatformSensor();
      if (cancelled) return;
      setBlockedReason(reason);
      setSensor(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const parentKeys = passkeys.filter((p) => p.kind === "parent");
  const kidKeys = passkeys.filter((p) => p.kind === "kid");

  async function addFingerprint() {
    setBusy(true);
    setError("");
    setDone("");
    const result = await registerFingerprint();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(`Fingerprint unlock is on for ${result.label}. Next time just tap the sensor.`);
    onChanged();
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError("");
    const result = await actions.passkeyRemove(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function newRecoveryCode() {
    setBusy(true);
    setError("");
    const result = await actions.parentNewRecoveryCode();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRecoveryCode(result.data.recoveryCode);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setDone("");
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await actions.parentChangePassword({ currentPassword: current, password: next });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setDone("Password changed. Your recovery code has been replaced with a new one.");
    onRecoveryCode(result.data.recoveryCode);
  }

  return (
    <section className="card security-card">
      <h2>Sign-in &amp; security</h2>
      <p className="muted">Fingerprint / face unlock, the recovery code and the parent password.</p>

      <div className="security-section">
        <h3>🔒 Fingerprint / face unlock</h3>
        <p className="muted small">
          Sign in on this device with the fingerprint or face already saved on it — the parent password is not needed.
        </p>

        {blockedReason ? (
          <p className="banner info">{blockedReason}</p>
        ) : sensor ? (
          <button type="button" className="primary" disabled={busy} onClick={() => void addFingerprint()}>
            {busy ? "Waiting for the sensor…" : "Turn on fingerprint on this device"}
          </button>
        ) : (
          <p className="banner info">
            This device has no fingerprint sensor or face unlock. Children can still sign in with a username and PIN.
          </p>
        )}

        {passkeys.length === 0 ? (
          <p className="muted small">Nothing is set up yet.</p>
        ) : (
          <ul className="passkey-list">
            {[...parentKeys, ...kidKeys].map((passkey) => (
              <li key={passkey.id} className="passkey">
                <span className="passkey-icon" aria-hidden="true">
                  {passkey.kind === "parent" ? "👤" : "🧒"}
                </span>
                <span>
                  <strong>
                    {passkey.label}
                    {passkey.kind === "kid" && passkey.kidName ? ` · ${passkey.kidName}` : ""}
                  </strong>
                  <small className="muted">
                    {passkey.kind === "parent" ? "Parent sign-in" : "Kid sign-in"} · last used {timeAgo(passkey.lastUsedAt)}
                    {passkey.synced ? " · saved in the cloud" : ""}
                  </small>
                </span>
                <button className="ghost" disabled={busy} onClick={() => void removePasskey(passkey.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="security-section">
        <h3>🆘 Recovery code</h3>
        <p className="muted small">
          Needed by “Forgot password?”. Creating a new code replaces the old one straight away, so the previous printout
          stops working.
        </p>
        <button type="button" className="ghost" disabled={busy} onClick={() => void newRecoveryCode()}>
          Create a new recovery code
        </button>
      </div>

      <div className="security-section">
        <h3>🔑 Change password</h3>
        <form className="add-kid" onSubmit={changePassword}>
          <label>
            Current password
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
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
          <button type="submit" className="primary" disabled={busy || !current || !next}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>

      {error && <p className="banner error">{error}</p>}
      {done && <p className="banner good">{done}</p>}
    </section>
  );
}
