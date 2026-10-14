"use client";

import { useCallback, useEffect, useState } from "react";
import { actions } from "@/lib/client/api";
import QrCode from "@/components/QrCode";

type Phase = "starting" | "waiting" | "expired" | "error";

/**
 * The kid side of linking a device.
 *
 * The device asks the server for a short code, shows it as a QR code and as
 * text, then waits. A parent scans it (or types it) on their own phone and
 * chooses which child this device belongs to. As soon as that happens this
 * screen becomes that child's app — the device stays in kid mode until a parent
 * signs it out again.
 */
export default function KidDeviceLink({
  onLinked,
  onParentInstead,
  parentExists,
}: {
  onLinked: () => void;
  onParentInstead: () => void;
  parentExists: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"scan" | "kid-login">("scan");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // The QR code has to point at the server this device is talking to, so read the
  // origin on the client only (the code is empty during the first render).
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  const startPairing = useCallback(
    async (rotate: boolean) => {
      setError("");
      setPhase("starting");
      const result = await actions.pairingStart(rotate);
      if (!result.ok) {
        setError(result.error);
        setPhase("error");
        return;
      }
      if (result.data.status === "approved") {
        onLinked();
        return;
      }
      setCode(result.data.code);
      setExpiresAt(result.data.expiresAt);
      setPhase("waiting");
    },
    [onLinked],
  );

  useEffect(() => {
    const id = setTimeout(() => void startPairing(false), 0);
    return () => clearTimeout(id);
  }, [startPairing]);

  // Ticking clock for the countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The QR code points at the parent approval page on this same server.
  const link = code && origin ? `${origin}/pair/${code}` : "";

  // Wait for a parent: each call long-polls for up to 20 seconds.
  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const result = await actions.pairingStatus(true);
      if (cancelled) return;
      if (result.ok) {
        if (result.data.status === "approved") {
          onLinked();
          return;
        }
        if (result.data.status === "expired" || result.data.status === "none" || result.data.status === "unknown") {
          setPhase("expired");
          return;
        }
      }
      timer = setTimeout(() => void poll(), 800);
    };

    timer = setTimeout(() => void poll(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, onLinked]);

  async function kidLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await actions.kidLogin(username, pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLinked();
  }

  const secondsLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  if (mode === "kid-login") {
    return (
      <form className="auth-form" onSubmit={kidLogin}>
        <h2>Kid sign in</h2>
        <p className="muted">Use the kid username and PIN a parent set up in the parent dashboard.</p>
        <label>
          Kid username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="aria.q"
            autoCapitalize="none"
            autoComplete="username"
          />
        </label>
        <label>
          Kid PIN
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            inputMode="numeric"
            type="password"
            placeholder="4–6 digits"
            autoComplete="current-password"
          />
        </label>
        {error && <p className="banner error">{error}</p>}
        <div className="row gap">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in on this device"}
          </button>
          <button type="button" className="link" onClick={() => setMode("scan")}>
            Use a QR code instead
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="link-device">
      <h2>Link this device to your child</h2>
      {!parentExists && (
        <p className="banner info">
          No parent account exists yet. Ask a parent to create one first — tap “Parent sign in” below.
        </p>
      )}

      {phase === "starting" && <p className="muted">Creating a code…</p>}

      {phase === "error" && (
        <>
          <p className="banner error">{error}</p>
          <button className="primary" onClick={() => void startPairing(true)}>
            Try again
          </button>
        </>
      )}

      {(phase === "waiting" || phase === "expired") && (
        <>
          <ol className="steps">
            <li>A parent opens BrainyKids on their phone and signs in.</li>
            <li>They scan this code with the phone camera (or type it in the dashboard).</li>
            <li>They pick which child this device belongs to.</li>
          </ol>

          <div className={`pair-box ${phase === "expired" ? "faded" : ""}`}>
            {link && <QrCode value={link} />}
            <div className="pair-code">
              <span className="muted">Or share this code</span>
              <strong>{code.split("").join(" ")}</strong>
              {phase === "waiting" ? (
                <span className="muted">Expires in {mmss}</span>
              ) : (
                <span className="muted">Code expired</span>
              )}
            </div>
          </div>

          {link && phase === "waiting" && (
            <div className="share-link">
              <span className="muted small">Parent link</span>
              <code>{link}</code>
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          )}

          {phase === "waiting" ? (
            <p className="waiting">
              <span className="pulse" /> Waiting for a parent to approve…
            </p>
          ) : (
            <button className="primary" onClick={() => void startPairing(true)}>
              Show a new code
            </button>
          )}

          <button type="button" className="link" onClick={() => setMode("kid-login")}>
            Kid already has a username and PIN?
          </button>
        </>
      )}

      <button type="button" className="link" onClick={onParentInstead}>
        Parent? Sign in on this device
      </button>
    </div>
  );
}
