"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AuthGateway from "@/components/AuthGateway";
import KidApp from "@/components/KidApp";
import ParentDashboard from "@/components/ParentDashboard";
import { actions, useLive } from "@/lib/client/api";
import { flushBehaviour, installBehaviourWatchers, reportBehaviour } from "@/lib/client/diagnostics";
import { t } from "@/lib/i18n";
import { DEFAULT_SETTINGS, resolveSettings } from "@/lib/settings";

const HEARTBEAT_MS = 20_000;
/** How many failed check-ins before the kid app says “reconnecting” out loud. */
const RETRY_LIMIT = 5;

/**
 * Chooses what this device shows:
 *   guest  → sign up / sign in screen
 *   parent → parent dashboard (any device the parent signs in on)
 *   kid    → the child's app, locked to that profile until a parent signs out
 *
 * It also keeps the child signed in: a dropped connection or a server that is
 * still waking up is retried (and logged), and only a clear “this device is no
 * longer linked” answer returns the child to the sign-in screen.
 */
export default function AppShell() {
  const live = useLive();
  const role = live.snapshot?.role ?? null;
  const refresh = live.refresh;
  const setNotice = live.setNotice;
  // A recovery code handed out at sign-up or after a password reset. It is kept
  // in memory only, long enough for the parent to save it.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const failures = useRef(0);
  const previousKids = useRef<number | null>(null);
  const previousRole = useRef<string | null>(null);
  // Remembered so a surprise sign-out can name the child in the behavioural log
  // even after the snapshot has already turned back to “guest”.
  const lastKidName = useRef<string | null>(null);

  const settings = resolveSettings(
    live.snapshot && live.snapshot.role !== "guest" ? live.snapshot.settings : DEFAULT_SETTINGS,
  );

  // Everything a browser notices (offline, refused cookies, crashed request) goes
  // into the same behavioural log the server writes to.
  useEffect(() => {
    const stop = installBehaviourWatchers();
    return () => {
      stop();
      void flushBehaviour(true);
    };
  }, []);

  /**
   * Checks in with the server. Only a clear “no longer linked” answer signs the
   * child out; anything else is retried, because a false sign-out was one of the
   * loudest complaints in the behavioural log.
   */
  const beat = useCallback(
    async (expectedRole: string | null) => {
      const result = await actions.heartbeat();
      if (result.ok && result.data.linked) {
        if (failures.current >= RETRY_LIMIT) {
          reportBehaviour("kid.session.recovered_after_error", { failures: failures.current, kidId: result.data.kidId });
        }
        if (result.data.restored) {
          reportBehaviour("kid.session.restored", { reason: "the server rebuilt the link from this device's cookie" });
        }
        failures.current = 0;
        setReconnecting(false);
        return;
      }

      if (!result.ok && result.status === 401) {
        // The server answered clearly: this device is not linked any more.
        failures.current = 0;
        setReconnecting(false);
        setNotice(
          "This device is no longer linked to a child profile. Ask a parent to link it again from the parent dashboard.",
        );
        reportBehaviour("kid.session.heartbeat_unlinked", { reason: "server answered 401" });
        await refresh();
        return;
      }

      // A network drop, a cold start or a 5xx: keep the child signed in.
      failures.current += 1;
      reportBehaviour("kid.session.heartbeat_failed", {
        error: result.ok ? "unexpected reply" : result.error,
        attempt: failures.current,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      });
      if (failures.current >= RETRY_LIMIT) setReconnecting(true);
      if (expectedRole === "kid") {
        // A quick extra try, then leave the normal interval to keep trying.
        setTimeout(() => {
          if (failures.current > 0) void refresh();
        }, 4_000);
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

  // “The child information disappeared”: notice a parent's child list emptying
  // out (and coming back), and write both to the log.
  useEffect(() => {
    const snapshot = live.snapshot;
    if (!snapshot) return;
    if (snapshot.role === "parent") {
      const count = snapshot.kids.length;
      if (previousKids.current !== null && previousKids.current > 0 && count === 0) {
        reportBehaviour("kid.info.vanished_from_dashboard", {
          previous: previousKids.current,
          parentId: snapshot.parent.id,
          reason: "the server answered with no children",
        });
      } else if (previousKids.current === 0 && count > 0) {
        reportBehaviour("kid.info.restored", { count });
      }
      previousKids.current = count;
    }
    if (snapshot.role === "kid") lastKidName.current = snapshot.kid.name;
    if (previousRole.current === "kid" && snapshot.role === "guest" && !live.notice) {
      // No notice means nobody (parent or app) expected this: a surprise sign-out.
      reportBehaviour("kid.session.lost", {
        kidName: lastKidName.current ?? undefined,
        reason: "the app returned to the sign-in screen without a parent signing out",
        cookiePresent: true,
        deviceFound: false,
        kidFound: false,
      });
      setNotice("Reconnecting… you are still signed in. If this keeps happening, a parent can link this device again.");
    }
    previousRole.current = snapshot.role;
  }, [live.snapshot, live.notice, setNotice]);

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
        settings={settings}
        onSettingsSaved={() => void live.refresh()}
        recoveryCode={recoveryCode}
        onRecoveryCodeSaved={() => setRecoveryCode(null)}
        storageNotice={snapshot.storage?.notice ?? null}
        live={live}
      />
    );
  }

  if (snapshot && snapshot.role === "kid") {
    return (
      <>
        {reconnecting && <p className="banner warn reconnect-banner">{t(settings.locale, "kid.reconnecting")}</p>}
        <KidApp kid={snapshot.kid} parent={snapshot.parent} settings={settings} live={live} />
      </>
    );
  }

  return (
    <AuthGateway
      hasAccounts={snapshot?.role === "guest" ? snapshot.hasAccounts : true}
      notice={live.notice}
      storageNotice={snapshot?.storage?.notice ?? null}
      settings={settings}
      onRecoveryCode={setRecoveryCode}
      onDone={() => {
        live.setNotice(null);
        void live.refresh();
      }}
    />
  );
}
