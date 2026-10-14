"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGateway from "@/components/AuthGateway";
import KidApp from "@/components/KidApp";
import ParentDashboard from "@/components/ParentDashboard";
import { actions, useLive } from "@/lib/client/api";

const HEARTBEAT_MS = 20_000;

/**
 * Chooses what this device shows:
 *   guest  → sign up / sign in screen
 *   parent → parent dashboard (any device the parent signs in on)
 *   kid    → the child's app, locked to that profile until a parent signs out
 */
export default function AppShell() {
  const live = useLive();
  const role = live.snapshot?.role ?? null;
  const refresh = live.refresh;
  const setNotice = live.setNotice;
  // A recovery code handed out at sign-up or after a password reset. It is kept
  // in memory only, long enough for the parent to save it.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const beat = useCallback(
    async (expectedRole: string | null) => {
      const result = await actions.heartbeat();
      // A failed heartbeat means the parent unlinked this device: back to sign-in.
      if (!result.ok && expectedRole === "kid") {
        setNotice("A parent signed this device out of kid mode.");
        await refresh();
      }
    },
    [refresh, setNotice],
  );

  // Kid devices report in so parents see who is online, and so an unlinked
  // device drops straight back to the sign-in screen.
  useEffect(() => {
    if (role !== "kid") return;
    const id = setTimeout(() => void beat(role), 400);
    const interval = setInterval(() => void beat(role), HEARTBEAT_MS);
    return () => {
      clearTimeout(id);
      clearInterval(interval);
    };
  }, [role, beat]);

  if (live.loading && !live.snapshot) {
    return (
      <main className="gateway">
        <div className="loading">
          <span className="pulse" /> Loading BrainyKids…
        </div>
      </main>
    );
  }

  const snapshot = live.snapshot;

  if (snapshot && snapshot.role === "parent") {
    return (
      <ParentDashboard
        parent={snapshot.parent}
        kids={snapshot.kids}
        pairings={snapshot.pairings}
        passkeys={snapshot.passkeys}
        recoveryCode={recoveryCode}
        onRecoveryCodeSaved={() => setRecoveryCode(null)}
        storageNotice={snapshot.storage?.notice ?? null}
        live={live}
      />
    );
  }

  if (snapshot && snapshot.role === "kid") {
    return <KidApp kid={snapshot.kid} parent={snapshot.parent} live={live} />;
  }

  return (
    <AuthGateway
      hasAccounts={snapshot?.role === "guest" ? snapshot.hasAccounts : true}
      notice={live.notice}
      storageNotice={snapshot?.storage?.notice ?? null}
      onRecoveryCode={setRecoveryCode}
      onDone={() => {
        live.setNotice(null);
        void live.refresh();
      }}
    />
  );
}
