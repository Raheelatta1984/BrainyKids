"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParentAuth from "@/components/ParentAuth";
import { actions, useLive } from "@/lib/client/api";

type Phase = "loading" | "ready" | "approved" | "problem";

/**
 * Where a QR code (or a typed link) lands on the parent's phone: choose which
 * child the waiting device belongs to and approve it.
 */
export default function PairApproval({ code }: { code: string }) {
  const live = useLive();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [label, setLabel] = useState<string | undefined>();
  const [kidId, setKidId] = useState("");
  const [busy, setBusy] = useState(false);
  const role = live.snapshot?.role ?? null;
  const kids = useMemo(() => (live.snapshot?.role === "parent" ? live.snapshot.kids : []), [live.snapshot]);

  useEffect(() => {
    if (role !== "parent") return;
    let cancelled = false;
    // Deferred a tick: the check runs after paint and never sets state mid-render.
    const timer = setTimeout(() => {
      void (async () => {
        const result = await actions.pairingLookup(code);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setPhase("problem");
          return;
        }
        if (!result.data.found) {
          setError(`Code ${code} was not found. Ask the child's device to show a new code.`);
          setPhase("problem");
          return;
        }
        if (result.data.status !== "pending") {
          setError(
            result.data.status === "approved"
              ? "This code has already been used."
              : "This code has expired. Ask the child's device for a new code.",
          );
          setPhase("problem");
          return;
        }
        setLabel(result.data.label);
        setPhase("ready");
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [role, code]);

  const selectedKid = kidId || kids[0]?.id || "";

  return (
    <main className="gateway">
      <header className="gateway-brand">
        <div className="logo">🔗</div>
        <h1>Link a device</h1>
        <p className="muted">Code {code}</p>
      </header>

      <section className="card gateway-card">
        {role === "kid" && (
          <>
            <p className="banner info">This device is already signed in as a child profile.</p>
            <Link className="button primary" href="/">
              Open the kid app
            </Link>
          </>
        )}

        {role === null && <p className="muted">Loading…</p>}

        {role === "guest" && (
          <ParentAuth
            mode="login"
            notice="Sign in as a parent to approve this device."
            onSuccess={() => void live.refresh()}
          />
        )}

        {role === "parent" && (
          <>
            {phase === "loading" && <p className="muted">Checking code {code}…</p>}
            {phase === "problem" && (
              <>
                <p className="banner error">{error}</p>
                <Link className="button" href="/">
                  Go to dashboard
                </Link>
              </>
            )}
            {phase === "approved" && (
              <>
                <h2>✅ Device linked</h2>
                <p className="muted">
                  The child&apos;s device is signing in now. You can close this page — progress, screen-time requests and
                  cheers appear in your dashboard in realtime.
                </p>
                <Link className="button primary" href="/">
                  Go to dashboard
                </Link>
              </>
            )}
            {phase === "ready" && (
              <form
                className="auth-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError("");
                  const result = await actions.pairingApprove(code, selectedKid);
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setPhase("approved");
                  void live.refresh();
                }}
              >
                <h2>Approve this device</h2>
                <p className="muted">
                  A {label ?? "kid device"} is waiting to sign in. Choose which child it belongs to.
                </p>
                {kids.length === 0 ? (
                  <>
                    <p className="banner info">You have no child profiles yet.</p>
                    <Link className="button primary" href="/">
                      Add a child first
                    </Link>
                  </>
                ) : (
                  <label>
                    Which child?
                    <select value={selectedKid} onChange={(event) => setKidId(event.target.value)}>
                      {kids.map((kid) => (
                        <option key={kid.id} value={kid.id}>
                          {kid.name} (@{kid.username})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {error && <p className="banner error">{error}</p>}
                {kids.length > 0 && (
                  <button className="primary" type="submit" disabled={busy}>
                    {busy ? "Linking…" : "Link this device"}
                  </button>
                )}
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
