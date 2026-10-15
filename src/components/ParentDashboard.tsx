"use client";

import { useCallback, useState } from "react";
import { actions, type Live } from "@/lib/client/api";
import { reportBehaviour } from "@/lib/client/diagnostics";
import { useToasts, type ToastItem } from "@/lib/client/useToasts";
import { Leaderboard, THEMES } from "@/components/KidApp";
import { formatReward } from "@/lib/rewards";
import { MAX_LEVEL, levelTitle, unfinishedLevels } from "@/lib/quiz-logic";
import BehaviourLogCard from "@/components/BehaviourLogCard";
import ChatPanel from "@/components/ChatPanel";
import FamilySettingsCard from "@/components/FamilySettingsCard";
import ParentSecurity, { SaveRecoveryCodeDialog } from "@/components/ParentSecurity";
import StorageBanner from "@/components/StorageBanner";
import { t } from "@/lib/i18n";
import { formatStamp, formatTimeAgo } from "@/lib/settings";
import type {
  FamilySettings,
  Gender,
  KidView,
  LeaderboardEntry,
  LiveEvent,
  PairingView,
  ParentAccount,
  PasskeyView,
  Theme,
} from "@/lib/types";

const CHEERS = ["Great work! 🎉", "Keep going! 💪", "So proud of you! ❤️"];

export default function ParentDashboard({
  parent,
  kids,
  leaderboard = [],
  pairings,
  passkeys,
  settings,
  onSettingsSaved,
  recoveryCode,
  onRecoveryCodeSaved,
  storageNotice,
  live,
}: {
  parent: ParentAccount;
  kids: KidView[];
  leaderboard?: LeaderboardEntry[];
  pairings: PairingView[];
  passkeys: PasskeyView[];
  settings: FamilySettings;
  onSettingsSaved: (next: FamilySettings) => void;
  /** A code issued at sign-up / after a reset that the parent still has to save. */
  recoveryCode?: string | null;
  onRecoveryCodeSaved?: () => void;
  storageNotice?: string | null;
  live: Live;
}) {
  // A code created from the security card below, shown in the same dialog.
  const [newCode, setNewCode] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "settings" | "log">("overview");
  const shownCode = recoveryCode ?? newCode;
  // Alerts about what children are doing, delivered live from the server.
  const toasts = useToasts(live.events, useCallback((event) => toastForParent(event), []), 8000);

  const waiting = kids.reduce((sum, kid) => sum + (kid.requestedMinutes > 0 ? 1 : 0) + (kid.requestedRewardMinor > 0 ? 1 : 0), 0);
  const onlineDevices = kids.reduce((sum, kid) => sum + kid.devices.filter((d) => d.online).length, 0);
  const unreadChat = kids.reduce((sum, kid) => sum + kid.chatUnread, 0);

  return (
    <main className="parent-shell">
      <header className="parent-header">
        <div>
          <h1>Parent dashboard</h1>
          <p className="muted">
            Signed in as {parent.name} · {parent.email}
          </p>
        </div>
        <div className="row gap">
          <span className={`live-chip ${live.connected ? "on" : "off"}`}>
            <span className="pulse" /> {live.connected ? "Live" : "Reconnecting"}
          </span>
          <button
            className="link"
            onClick={async () => {
              await actions.parentLogout();
              await live.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Dashboard sections">
        <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
          Overview
          {unreadChat > 0 && <span className="badge">💬 {unreadChat}</span>}
        </button>
        <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          Settings
        </button>
        <button className={`tab ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>
          Behaviour log
        </button>
      </nav>

      {tab === "settings" ? (
        <>
          <FamilySettingsCard settings={settings} onSaved={onSettingsSaved} />
          <StorageBanner notice={storageNotice} onChecked={() => void live.refresh()} />
          <ParentSecurity passkeys={passkeys} onChanged={() => void live.refresh()} onRecoveryCode={setNewCode} />
        </>
      ) : tab === "log" ? (
        <>
          <BehaviourLogCard settings={settings} />
          <StorageBanner notice={storageNotice} onChecked={() => void live.refresh()} />
        </>
      ) : (
      <>
      <StorageBanner notice={storageNotice} onChecked={() => void live.refresh()} />

      <section className="stat-row">
        <div className="stat">
          <span className="stat-value">{kids.length}</span>
          <span className="stat-label">Children</span>
        </div>
        <div className="stat">
          <span className="stat-value">{onlineDevices}</span>
          <span className="stat-label">Devices online now</span>
        </div>
        <div className="stat">
          <span className="stat-value">{waiting}</span>
          <span className="stat-label">Waiting for approval</span>
        </div>
      </section>

      {leaderboard.length > 0 && (
        <section className="card">
          <Leaderboard entries={leaderboard} settings={settings} />
          <p className="muted small">
            Ranked by best level first. Levels never end and none of them are locked: a child can play any level, in any
            order, and go back to an unfinished one whenever they like.
          </p>
        </section>
      )}

      <LinkDeviceCard kids={kids} pairings={pairings} live={live} settings={settings} />
      <AddChildCard onDone={() => void live.refresh()} />

      {kids.length === 0 && (
        <section className="card">
          <p className="muted">No child profiles yet. Add a child above, then link their device with a QR code.</p>
        </section>
      )}

      {kids.map((kid) => (
        <KidCard key={kid.id} kid={kid} live={live} parentEmail={parent.email} settings={settings} />
      ))}

      <ParentSecurity passkeys={passkeys} onChanged={() => void live.refresh()} onRecoveryCode={setNewCode} />
      </>
      )}

      {shownCode && (
        <SaveRecoveryCodeDialog
          code={shownCode}
          onClose={() => {
            setNewCode(null);
            onRecoveryCodeSaved?.();
          }}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <span className="toast-emoji">{toast.emoji}</span>
            <span>
              <strong>{toast.title}</strong>
              {toast.body && <small>{toast.body}</small>}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

/** Which realtime events deserve an alert on the parent's screen. */
function toastForParent(event: LiveEvent): ToastItem | null {
  const payload = event.payload as {
    kidName?: string;
    minutes?: number;
    label?: string;
    message?: string;
    code?: string;
  };
  switch (event.type) {
    case "reward.requested":
      return {
        id: event.id,
        emoji: "💰",
        title: `${payload.kidName} asked to realise their wallet`,
        body: "Approve or send it back in the child's card below",
      };
    case "screen_time.requested":
      return {
        id: event.id,
        emoji: "⏱️",
        title: `${payload.kidName} asked for ${payload.minutes} min`,
        body: "Approve it in the child's card below",
      };
    case "device.linked":
      return { id: event.id, emoji: "📱", title: `${payload.kidName} is signed in`, body: payload.label };
    case "cheer.sent":
      return { id: event.id, emoji: "💬", title: `Cheer sent to ${payload.kidName}`, body: payload.message };
    case "kid.created":
      return { id: event.id, emoji: "🎈", title: `${payload.kidName} added`, body: "Now link their device" };
    case "pairing.started":
      return {
        id: event.id,
        emoji: "🔗",
        title: `A ${payload.label ?? "kid device"} wants to be linked`,
        body: `Code ${payload.code}`,
      };
    case "behaviour.logged": {
      const behaviour = event.payload as { code?: string; severity?: string; layman?: string };
      return {
        id: event.id,
        emoji: behaviour.severity === "critical" ? "🚨" : "⚠️",
        title: behaviour.layman ?? "Something was logged",
        body: `${behaviour.code ?? ""} · see the Behaviour log tab`,
      };
    }
    default:
      return null;
  }
}

/** Scan/watch for a kid device asking to be linked, and approve it. */
function LinkDeviceCard({
  kids,
  pairings,
  live,
  settings,
}: {
  kids: KidView[];
  pairings: PairingView[];
  live: Live;
  settings: FamilySettings;
}) {
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<{ status: string; label?: string; code?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<Record<string, string>>({});

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError("");
    setLookup(null);
    const result = await actions.pairingLookup(code);
    setChecking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (!result.data.found) {
      setError("That code was not found. Ask your child's device for a new code.");
      return;
    }
    setLookup({ status: result.data.status, label: result.data.label, code: result.data.code });
    if (result.data.status !== "pending") {
      setError(
        result.data.status === "approved"
          ? "That code has already been used."
          : "That code has expired. Ask for a new one on the child's device.",
      );
    }
  }

  async function approve(pairingCode: string, kidId: string) {
    if (!kidId) {
      setError("Choose which child this device belongs to.");
      return;
    }
    const result = await actions.pairingApprove(pairingCode, kidId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setLookup(null);
    setCode("");
    await live.refresh();
  }

  const ready = kids.length > 0;

  return (
    <section className="card">
      <h2>Link a kid device</h2>
      <p className="muted">
        On the child&apos;s device open BrainyKids → <strong>Kid sign in</strong>. Scan the QR code with this phone&apos;s
        camera, or type the 6-character code below. The device signs in the moment you approve it.
      </p>

      {!ready && <p className="banner info">Add a child profile first, then you can link their device.</p>}

      {pairings.filter((p) => p.status === "pending").length > 0 && (
        <div className="pending-list">
          {pairings
            .filter((p) => p.status === "pending")
            .map((pairing) => (
              <PairingRow
                key={pairing.code}
                code={pairing.code}
                label="Waiting to be linked"
                note={`expires ${formatStamp(pairing.expiresAt, settings)}`}
                kids={kids}
                selected={target[pairing.code] ?? kids[0]?.id ?? ""}
                onSelect={(value) => setTarget((prev) => ({ ...prev, [pairing.code]: value }))}
                onApprove={() => void approve(pairing.code, target[pairing.code] ?? kids[0]?.id ?? "")}
                ready={ready}
              />
            ))}
        </div>
      )}

      <form className="code-form" onSubmit={check}>
        <label>
          Code from the child&apos;s device
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
          />
        </label>
        <button type="submit" disabled={checking || code.trim().length < 4}>
          {checking ? "Checking…" : "Check code"}
        </button>
      </form>

      {error && <p className="banner error">{error}</p>}

      {lookup && lookup.status === "pending" && lookup.code && (
        <PairingRow
          code={lookup.code}
          label={lookup.label ?? "Device"}
          note="wants to sign in"
          kids={kids}
          selected={target[lookup.code] ?? kids[0]?.id ?? ""}
          onSelect={(value) => setTarget((prev) => ({ ...prev, [lookup.code as string]: value }))}
          onApprove={() => void approve(lookup.code as string, target[lookup.code as string] ?? kids[0]?.id ?? "")}
          ready={ready}
        />
      )}
    </section>
  );
}

/** One device waiting to be linked: pick a child, then approve. */
function PairingRow({
  code,
  label,
  note,
  kids,
  selected,
  onSelect,
  onApprove,
  ready,
}: {
  code: string;
  label: string;
  note: string;
  kids: KidView[];
  selected: string;
  onSelect: (value: string) => void;
  onApprove: () => void;
  ready: boolean;
}) {
  return (
    <div className="pending">
      <span className="pending-emoji">📲</span>
      <span className="pending-text">
        <strong>{code}</strong>
        <small>
          {label} · {note}
        </small>
      </span>
      <select value={selected} onChange={(event) => onSelect(event.target.value)} aria-label="Child for this device">
        {kids.map((kid) => (
          <option key={kid.id} value={kid.id}>
            {kid.name}
          </option>
        ))}
      </select>
      <button className="primary" disabled={!ready} onClick={onApprove}>
        Link this device
      </button>
    </div>
  );
}

function AddChildCard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState(6);
  const [gender, setGender] = useState<Gender>("prefer-not-to-say");
  const [theme, setTheme] = useState<Theme>("space");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  function suggestUsername(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    const result = await actions.createKid({ name, age, gender, theme, username, pin });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(`${result.data.kid.name} added. Now link their device with the QR code above.`);
    setName("");
    setUsername("");
    setPin("");
    onDone();
  }

  return (
    <section className="card">
      <h2>Add a child</h2>
      <p className="muted">Each child signs in to their own device with this username and PIN — no email needed.</p>
      <form className="add-kid" onSubmit={submit}>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!username) setUsername(suggestUsername(event.target.value));
            }}
            placeholder="Aria"
          />
        </label>
        <label>
          Age
          <input type="number" min={3} max={18} value={age} onChange={(event) => setAge(Number(event.target.value))} />
        </label>
        <label>
          Gender
          <select value={gender} onChange={(event) => setGender(event.target.value as Gender)}>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </label>
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            {(Object.keys(THEMES) as Theme[]).map((value) => (
              <option key={value} value={value}>
                {THEMES[value].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kid username
          <input
            value={username}
            onChange={(event) => setUsername(suggestUsername(event.target.value))}
            placeholder="aria.q"
            autoCapitalize="none"
          />
        </label>
        <label>
          Kid PIN
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="4–6 digits"
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Adding…" : "Add child"}
        </button>
      </form>
      {error && <p className="banner error">{error}</p>}
      {done && <p className="banner good">{done}</p>}
    </section>
  );
}

function KidCard({
  kid,
  live,
  parentEmail,
  settings,
}: {
  kid: KidView;
  live: Live;
  parentEmail: string;
  settings: FamilySettings;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cheer, setCheer] = useState("");
  const [bonus, setBonus] = useState(15);
  const [showChat, setShowChat] = useState(false);
  const [levelDraft, setLevelDraft] = useState(kid.level);
  const theme = THEMES[kid.theme];
  const accuracy = kid.attempted === 0 ? 0 : Math.round((kid.correct / kid.attempted) * 100);
  // Levels a child has started and not finished: any of them can be carried on.
  const unfinished = unfinishedLevels(kid);

  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
    setBusy(true);
    setError("");
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    await live.refresh();
    return true;
  }

  return (
    <section className={`card kid-card ${kid.online ? "is-online" : ""}`}>
      <header className="kid-card-head">
        <span className="avatar">{theme.emoji}</span>
        <div>
          <h2>
            {kid.name} {kid.online && <span className="online-dot" title="Online now" />}
          </h2>
          <p className="muted">
            @{kid.username} · age {kid.age} · {theme.label}
          </p>
        </div>
        <span className="row gap">
          <button className="link chat-button" onClick={() => setShowChat((value) => !value)}>
            💬 {t(settings.locale, "chat.withKid", { name: kid.name })}
            {kid.chatUnread > 0 && <span className="badge">{t(settings.locale, "chat.unread", { count: kid.chatUnread })}</span>}
          </button>
          <button className="link" onClick={() => setEditing((value) => !value)}>
            {editing ? "Close" : "Edit"}
          </button>
        </span>
      </header>

      {showChat && (
        <ChatPanel
          viewer="parent"
          kidName={kid.name}
          messages={kid.chat}
          settings={settings}
          unread={kid.chatUnread}
          onSend={async (text, kind) => {
            const result = await actions.chatSend(kid.id, text, kind);
            if (!result.ok) return { ok: false as const, error: result.error };
            reportBehaviour("chat.message_sent", {
              from: "The parent",
              to: kid.name,
              kidId: kid.id,
              chars: text.length,
              kind,
            });
            await live.refresh();
            return { ok: true as const };
          }}
          onMarkRead={() => {
            void actions.chatRead(kid.id).then(() => live.refresh());
          }}
          onClose={() => setShowChat(false)}
        />
      )}

      <dl className="stats">
        <div>
          <dt>Playing now</dt>
          <dd>
            Level {kid.level} · {levelTitle(kid.level)}
          </dd>
        </div>
        <div>
          <dt>Best level</dt>
          <dd>
            Level {kid.unlockedLevel} · {levelTitle(kid.unlockedLevel)}
          </dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>💰 {formatReward(kid.walletBalanceMinor, settings.rewardKind, settings.currency)}</dd>
        </div>
        <div>
          <dt>Earned today / week</dt>
          <dd>
            {formatReward(kid.earnedTodayMinor, settings.rewardKind, settings.currency)} /{" "}
            {formatReward(kid.earnedThisWeekMinor, settings.rewardKind, settings.currency)}
          </dd>
        </div>
        <div>
          <dt>Lifetime / realised</dt>
          <dd>
            {formatReward(kid.lifetimeEarnedMinor, settings.rewardKind, settings.currency)} /{" "}
            {formatReward(kid.totalRealisedMinor, settings.rewardKind, settings.currency)}
          </dd>
        </div>
        <div>
          <dt>Answered</dt>
          <dd>{kid.attempted}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{accuracy}%</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>⭐ {kid.points}</dd>
        </div>
        <div>
          <dt>Approved minutes</dt>
          <dd>{kid.approvedMinutes}</dd>
        </div>
      </dl>

      <div className="levels-admin">
        <h3>Levels</h3>
        <p className="muted small">
          No level is locked. {kid.name} can carry on an unfinished level, jump to any level, or start one again —
          points, screen time and money are always kept.
        </p>
        {unfinished.length > 0 && (
          <p className="muted small">
            Not finished yet:{" "}
            {unfinished
              .slice(0, 4)
              .map((entry) => `Level ${entry.level} (${entry.done} of ${entry.total})`)
              .join(" · ")}
          </p>
        )}
        <div className="row wrap gap">
          <label className="inline">
            Level
            <input
              type="number"
              min={1}
              max={MAX_LEVEL}
              value={levelDraft}
              onChange={(event) => setLevelDraft(Number(event.target.value))}
              style={{ width: "5rem" }}
            />
          </label>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => void run(() => actions.updateKid(kid.id, { level: levelDraft }))}
          >
            Open Level {levelDraft} (carry on)
          </button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => void run(() => actions.updateKid(kid.id, { restartLevel: levelDraft }))}
          >
            Start Level {levelDraft} again
          </button>
        </div>
      </div>

      <div className="approve">
        <span>
          💰 Realise requested: <strong>{formatReward(kid.requestedRewardMinor, settings.rewardKind, settings.currency)}</strong>
          <span className="muted"> — approving pays it out and resets the wallet to zero; sending it back keeps the balance.</span>
        </span>
        <div className="row gap">
          <button
            className="primary"
            disabled={kid.requestedRewardMinor === 0 || busy}
            onClick={() => void run(() => actions.rewardDecision(kid.id, "approve"))}
          >
            Approve {formatReward(kid.requestedRewardMinor, settings.rewardKind, settings.currency)} &amp; reset wallet
          </button>
          <button
            className="ghost"
            disabled={kid.requestedRewardMinor === 0 || busy}
            onClick={() => void run(() => actions.rewardDecision(kid.id, "decline"))}
          >
            Send back
          </button>
        </div>
      </div>

      {kid.rewardLedger.length > 0 && (
        <div className="activity">
          <h3>💰 Wallet transactions</h3>
          <ul>
            {kid.rewardLedger.slice(0, 10).map((entry) => (
              <li key={entry.id}>
                <span className="activity-icon">{entry.type === "earned" ? "🪙" : entry.type === "realise_approved" ? "✅" : entry.type === "realise_declined" ? "↩️" : "🙋"}</span>
                <span>
                  {entry.type === "earned"
                    ? `Earned ${formatReward(entry.amountMinor, entry.kind, entry.currency)}${entry.topic ? ` · ${entry.topic}` : ""}${typeof entry.scorePercent === "number" ? ` · ${entry.scorePercent}%` : ""}`
                    : entry.type === "realise_requested"
                      ? `Asked to realise ${formatReward(entry.amountMinor, entry.kind, entry.currency)}`
                      : entry.type === "realise_approved"
                        ? `Realised ${formatReward(entry.amountMinor, entry.kind, entry.currency)} — wallet reset`
                        : `Realise of ${formatReward(entry.amountMinor, entry.kind, entry.currency)} sent back`}
                  <small className="muted"> · balance {formatReward(entry.balanceAfterMinor, entry.kind, entry.currency)}</small>
                </span>
                <small className="muted" title={formatStamp(entry.at, settings)}>
                  {formatTimeAgo(entry.at, settings)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="approve">
        <span>
          Screen time requested: <strong>{kid.requestedMinutes} min</strong>
        </span>
        <div className="row gap">
          <button
            className="primary"
            disabled={kid.requestedMinutes === 0 || busy}
            onClick={() => void run(() => actions.screenTime(kid.id, "approve"))}
          >
            Approve {kid.requestedMinutes} min
          </button>
          <button
            className="ghost"
            disabled={kid.requestedMinutes === 0 || busy}
            onClick={() => void run(() => actions.screenTime(kid.id, "decline"))}
          >
            Send back
          </button>
        </div>
        <div className="row gap">
          <label className="inline">
            Bonus
            <input
              type="number"
              min={0}
              max={120}
              value={bonus}
              onChange={(event) => setBonus(Number(event.target.value))}
              style={{ width: "5rem" }}
            />
            min
          </label>
          <button className="ghost" disabled={busy} onClick={() => void run(() => actions.screenTime(kid.id, "grant", bonus))}>
            Give bonus minutes
          </button>
        </div>
      </div>

      <div className="cheer">
        <span className="muted">Send a cheer (pops up on their screen)</span>
        <div className="row wrap gap">
          {CHEERS.map((message) => (
            <button
              key={message}
              className="chip"
              disabled={busy}
              onClick={() => void run(() => actions.cheer(kid.id, message))}
            >
              {message}
            </button>
          ))}
        </div>
        <form
          className="row gap"
          onSubmit={async (event) => {
            event.preventDefault();
            const message = cheer.trim();
            if (!message) return;
            const ok = await run(() => actions.cheer(kid.id, message));
            if (ok) setCheer("");
          }}
        >
          <input value={cheer} onChange={(event) => setCheer(event.target.value)} placeholder="Write your own message" />
          <button type="submit" disabled={busy}>
            Send
          </button>
        </form>
      </div>

      <div className="devices">
        <h3>Devices</h3>
        {kid.devices.length === 0 && <p className="muted">No device linked yet. Use “Link a kid device” above.</p>}
        {kid.devices.map((device) => (
          <div key={device.id} className="device">
            <span className={`online-dot ${device.online ? "" : "off"}`} />
            <span>
              <strong>{device.label}</strong>
              <small className="muted">
                {device.online ? "online now" : `last seen ${formatTimeAgo(device.lastSeenAt, settings)}`}
                {" · "}
                {formatStamp(device.createdAt, settings, { zone: false })}
              </small>
            </span>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => void run(() => actions.unlinkDevice(device.id))}
            >
              Sign out this device
            </button>
          </div>
        ))}
      </div>

      <div className="activity">
        <h3>Recent activity</h3>
        {kid.activity.length === 0 && <p className="muted">Nothing yet. Answers and screen time show up here live.</p>}
        <ul>
          {kid.activity.slice(0, 8).map((entry) => (
            <li key={entry.id} className={entry.kind}>
              <span className="activity-icon">
                {entry.kind === "answer" ? (entry.correct ? "✅" : "➖") : entry.kind === "cheer" ? "💬" : entry.kind === "device" ? "📱" : entry.kind === "level" ? "🏅" : entry.kind === "reward" ? "💰" : "⏱️"}
              </span>
              <span>{entry.text}</span>
              <small className="muted" title={formatStamp(entry.at, settings)}>
                {formatTimeAgo(entry.at, settings)}
              </small>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="banner error">{error}</p>}

      {editing && <EditKid kid={kid} parentEmail={parentEmail} onDone={() => void live.refresh()} />}
      {!editing && kid.lastSeenAt && (
        <p className="muted small">
          {kid.online
            ? `${kid.name} is using BrainyKids now`
            : `Last seen ${formatStamp(kid.lastSeenAt, settings)}`}
        </p>
      )}
    </section>
  );
}

function EditKid({ kid, parentEmail, onDone }: { kid: KidView; parentEmail: string; onDone: () => void }) {
  const [name, setName] = useState(kid.name);
  const [age, setAge] = useState(kid.age);
  const [gender, setGender] = useState<Gender>(kid.gender);
  const [theme, setTheme] = useState<Theme>(kid.theme);
  const [username, setUsername] = useState(kid.username);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = { name, age, gender, theme, username };
    if (pin) payload.pin = pin;
    const result = await actions.updateKid(kid.id, payload);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPin("");
    onDone();
  }

  return (
    <div className="edit-panel">
      <h3>Edit {kid.name}</h3>
      <form className="add-kid" onSubmit={save}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Age
          <input type="number" min={3} max={18} value={age} onChange={(event) => setAge(Number(event.target.value))} />
        </label>
        <label>
          Gender
          <select value={gender} onChange={(event) => setGender(event.target.value as Gender)}>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </label>
        <label>
          Theme
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            {(Object.keys(THEMES) as Theme[]).map((value) => (
              <option key={value} value={value}>
                {THEMES[value].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kid username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" />
        </label>
        <label>
          New kid PIN (optional)
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="Leave blank to keep"
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
      {error && <p className="banner error">{error}</p>}

      <p className="muted small">
        Forgotten password for {parentEmail}? Use <strong>Sign-in &amp; security</strong> below to change it, or the
        recovery code from the sign-in screen if you are locked out. Signing a child out of kid mode needs the parent
        account password.
      </p>

      <div className="danger">
        {confirmDelete ? (
          <>
            <span>Delete {kid.name} and all of their progress?</span>
            <div className="row gap">
              <button
                className="danger-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const result = await actions.deleteKid(kid.id);
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  onDone();
                }}
              >
                Yes, delete
              </button>
              <button className="link" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="link" onClick={() => setConfirmDelete(true)}>
            Delete this child…
          </button>
        )}
      </div>
    </div>
  );
}
