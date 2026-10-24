"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { actions } from "@/lib/client/api";
import { reportBehaviour } from "@/lib/client/diagnostics";
import { fingerprintBlockedReason, hasPlatformSensor, registerFingerprint, signInWithFingerprint } from "@/lib/client/webauthn";
import { t } from "@/lib/i18n";
import { formatStamp } from "@/lib/settings";
import QrCode from "@/components/QrCode";
import type { FamilySettings } from "@/lib/types";

type Phase = "starting" | "waiting" | "expired" | "error";

/**
 * The kid side of linking a device.
 *
 * The device asks the server for a short code, shows it as a QR code and as
 * text, then waits. A parent scans it (or types it) on their own phone and
 * chooses which child this device belongs to. As soon as that happens this
 * screen becomes that child's app — the device stays in kid mode until a parent
 * signs it out again.
 *
 * The code now looks after itself: it is renewed a little before it runs out, so
 * a parent who takes a minute longer is not sent back to “show a new code”, and
 * every renewal (and every failed wait) is written to the behavioural log.
 */
export default function KidDeviceLink({
  onLinked,
  onParentInstead,
  parentExists,
  settings,
}: {
  onLinked: () => void;
  onParentInstead: () => void;
  parentExists: boolean;
  settings?: FamilySettings;
}) {
  const locale = settings?.locale ?? "en";
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
  const [renewNote, setRenewNote] = useState("");
  // After a successful kid sign-in: offer to save the fingerprint on this device.
  const [offerFingerprint, setOfferFingerprint] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState({ sensor: false, any: false, why: null as string | null });
  // The QR code has to point at the server this device is talking to, so read the
  // origin on the client only (the code is empty during the first render).
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const renewals = useRef(0);
  const currentCode = useRef("");

  // Is there a sensor here, and has a fingerprint been set up on this server?
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const why = fingerprintBlockedReason();
      const sensor = await hasPlatformSensor();
      const status = await actions.passkeyStatus();
      if (cancelled) return;
      setFingerprint({ sensor, any: status.ok && status.data.hasAny, why });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startPairing = useCallback(
    async (rotate: boolean, reason: string) => {
      setError("");
      if (!code) setPhase("starting");
      const previous = currentCode.current;
      const result = await actions.pairingStart(rotate);
      if (!result.ok) {
        setError(result.error);
        setPhase("error");
        reportBehaviour("pairing.record_missing", { code: previous || "-", reason: result.error });
        return;
      }
      if (result.data.status === "approved") {
        onLinked();
        return;
      }
      currentCode.current = result.data.code;
      setCode(result.data.code);
      setExpiresAt(result.data.expiresAt);
      setPhase("waiting");
      if (rotate && previous) {
        renewals.current += 1;
        setRenewNote(`New code shown automatically (${previous} → ${result.data.code}). Ask a parent to approve it.`);
        reportBehaviour("pairing.renewed", {
          oldCode: previous,
          code: result.data.code,
          reason,
          ttlSeconds: result.data.ttlSeconds,
        });
      } else {
        reportBehaviour("pairing.started", {
          code: result.data.code,
          deviceLabel: navigator.userAgent.slice(0, 120),
          ttlSeconds: result.data.ttlSeconds,
          expiresAt: new Date(result.data.expiresAt).toISOString(),
        });
      }
    },
    [code, onLinked],
  );

  useEffect(() => {
    const id = setTimeout(() => void startPairing(false, "first code"), 0);
    return () => clearTimeout(id);
    // Only on mount: later renewals are driven by the ticking clock below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticking clock for the countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The QR code points at the parent approval page on this same server.
  const link = code && origin ? `${origin}/pair/${code}` : "";

  const secondsLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  // Renew a little before the code runs out, so the parent is never left with a
  // expired QR code on the child's screen.
  useEffect(() => {
    if (phase !== "waiting" || document.visibilityState === "hidden" || !navigator.onLine) return;
    if (secondsLeft > 45) return;
    if (renewals.current >= 20) return;
    void startPairing(true, `only ${secondsLeft}s left on ${code}`);
  }, [phase, secondsLeft, code, startPairing]);

  // Wait for a parent: each call long-polls for up to eight seconds.
  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const controller = new AbortController();

    const poll = async () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        timer = setTimeout(() => void poll(), 2_000);
        return;
      }
      const result = await actions.pairingStatus(true, controller.signal);
      if (cancelled) return;
      if (result.ok) {
        if (result.data.status === "approved") {
          onLinked();
          return;
        }
        if (result.data.status === "pending") {
          failures = 0;
          setCode(result.data.code);
          setExpiresAt(result.data.expiresAt);
          currentCode.current = result.data.code;
          timer = setTimeout(() => void poll(), 800);
          return;
        }
        // expired / none / unknown: get a fresh code instead of giving up.
        reportBehaviour(result.data.status === "expired" ? "pairing.expired_unapproved" : "pairing.record_missing", {
          code: currentCode.current || "-",
          createdAt: "-",
          expiresAt: new Date(expiresAt).toISOString(),
          rotated: true,
          reason: `the server answered “${result.data.status}”`,
        });
        await startPairing(true, `the server answered “${result.data.status}”`);
        return;
      }
      failures += 1;
      reportBehaviour("pairing.record_missing", { code: currentCode.current || "-", reason: result.error });
      timer = setTimeout(() => void poll(), Math.max((result.retryAfterSeconds ?? 0) * 1_000, Math.min(30_000, 800 * 2 ** Math.min(failures, 5))) * (1 + Math.random() * 0.2));
    };

    timer = setTimeout(() => void poll(), 1200);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [phase, code, expiresAt, onLinked, startPairing]);

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
    // Offer fingerprint unlock before dropping into the quiz.
    if (fingerprint.sensor) {
      setOfferFingerprint(result.data.kid?.name ?? username);
      return;
    }
    onLinked();
  }

  async function signInWithSensor() {
    setBusy(true);
    setError("");
    const result = await signInWithFingerprint();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLinked();
  }

  async function turnOnFingerprint() {
    setBusy(true);
    setError("");
    const result = await registerFingerprint();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLinked();
  }

  if (offerFingerprint) {
    return (
      <div className="auth-form">
        <h2>Turn on fingerprint unlock?</h2>
        <p className="muted">
          Next time {offerFingerprint} opens BrainyKids on this device, a finger on the sensor is enough — no username or
          PIN to type.
        </p>
        {error && <p className="banner error">{error}</p>}
        <div className="row gap wrap">
          <button type="button" className="fingerprint" disabled={busy} onClick={() => void turnOnFingerprint()}>
            <span className="fingerprint-icon" aria-hidden="true">
              🔒
            </span>
            {busy ? "Waiting for the sensor…" : "Turn on fingerprint"}
          </button>
          <button type="button" className="link" onClick={onLinked}>
            Not now
          </button>
        </div>
      </div>
    );
  }

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
        {fingerprint.sensor && fingerprint.any && (
          <div className="fingerprint-block">
            <span className="divider">or</span>
            <button type="button" className="fingerprint" disabled={busy} onClick={() => void signInWithSensor()}>
              <span className="fingerprint-icon" aria-hidden="true">
                🔒
              </span>
              Use fingerprint / face unlock
            </button>
          </div>
        )}
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
          <button className="primary" onClick={() => void startPairing(true, "retry after an error")}>
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
                <span className="muted">
                  Code is good until {formatStamp(expiresAt, settings, { zone: false })} · {mmss} left
                </span>
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
              <span className="pulse" /> Waiting for a parent to approve… the code refreshes itself, so this screen can
              stay open.
            </p>
          ) : (
            <button className="primary" onClick={() => void startPairing(true, "expired before a parent approved")}>
              Show a new code
            </button>
          )}

          {renewNote && <p className="banner info small">{renewNote}</p>}
          {error && <p className="banner error">{error}</p>}

          <button type="button" className="link" onClick={() => setMode("kid-login")}>
            Kid already has a username and PIN?
          </button>
        </>
      )}

      {fingerprint.why && fingerprint.any && <p className="muted small">{fingerprint.why}</p>}

      <button type="button" className="link" onClick={onParentInstead}>
        Parent? Sign in on this device
      </button>
      <p className="muted small">
        Touch-and-talk works here too: {t(locale, "chat.hint")}
      </p>
    </div>
  );
}
