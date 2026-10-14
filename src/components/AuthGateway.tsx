"use client";

import { useState } from "react";
import ParentAuth, { type ParentAuthMode } from "@/components/ParentAuth";
import KidDeviceLink from "@/components/KidDeviceLink";

type View = "choose" | "parent" | "kid";

/** First screen on any device: parents sign up or sign in, kids link their device. */
export default function AuthGateway({
  hasAccounts,
  onDone,
  notice,
}: {
  hasAccounts: boolean;
  onDone: () => void;
  notice?: string | null;
}) {
  const [view, setView] = useState<View>("choose");
  const [mode, setMode] = useState<ParentAuthMode>(hasAccounts ? "login" : "signup");

  return (
    <main className="gateway">
      <header className="gateway-brand">
        <div className="logo">🧠</div>
        <h1>BrainyKids</h1>
        <p className="muted">Challenge Mode — quizzes kids love, progress parents can see live.</p>
      </header>

      <section className="card gateway-card">
        {notice && <p className="banner info">{notice}</p>}

        {view === "choose" && (
          <>
            <div className="choice-grid">
              <button className="choice" onClick={() => setView("parent")}>
                <span className="choice-emoji">👨‍👩‍👧</span>
                <strong>{hasAccounts ? "Parent sign in" : "Parent sign up"}</strong>
                <small>See progress, link devices, approve screen time</small>
              </button>
              <button className="choice" onClick={() => setView("kid")}>
                <span className="choice-emoji">🧒</span>
                <strong>Kid sign in</strong>
                <small>Scan the code on the kid device, or use username + PIN</small>
              </button>
            </div>
            <p className="muted small">
              Parents create the account first, add each child, then link the child&apos;s device with a QR code.
            </p>
          </>
        )}

        {view === "parent" && (
          <ParentAuth
            mode={mode}
            onModeChange={setMode}
            onSuccess={onDone}
            onBack={() => setView("choose")}
          />
        )}

        {view === "kid" && (
          <KidDeviceLink
            parentExists={hasAccounts}
            onLinked={onDone}
            onParentInstead={() => setView("parent")}
          />
        )}
      </section>
    </main>
  );
}
