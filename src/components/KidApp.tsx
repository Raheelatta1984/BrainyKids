"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actions, type Live } from "@/lib/client/api";
import { reportBehaviour } from "@/lib/client/diagnostics";
import { useToasts, type ToastItem } from "@/lib/client/useToasts";
import {
  MAX_LEVEL,
  canonicalChoiceFor,
  levelProgress,
  levelQuestionCount,
  levelTitle,
  levelToResume,
  levelWindow,
  matchChoice,
  tierForLevel,
  tracksForAge,
} from "@/lib/quiz-logic";
import { difficultyForQuestion, formatCountdown, formatReward, timeLimitSeconds } from "@/lib/rewards";
import { localiseQuestion, type LocalisedQuestion } from "@/lib/quiz-i18n";
import { t } from "@/lib/i18n";
import { isRtl } from "@/lib/settings";
import { listenOnce, recognitionSupported, speakText, speechSupported, stopSpeaking } from "@/lib/voice";
import { QUESTIONS, type Question } from "@/lib/quiz-data";
import ChatPanel from "@/components/ChatPanel";
import type { FamilySettings, KidView, LeaderboardEntry, Level, LevelAction, LiveEvent, Theme } from "@/lib/types";

export const THEMES: Record<Theme, { label: string; emoji: string }> = {
  space: { label: "Space Explorers", emoji: "🚀" },
  jungle: { label: "Jungle Adventure", emoji: "🦁" },
  robots: { label: "Robot Lab", emoji: "🤖" },
  dinos: { label: "Dino Dig", emoji: "🦖" },
};

type Feedback = {
  correct: boolean;
  picked: string;
  answer: string;
  explain: string;
  points: number;
  levelFinished: boolean;
  scorePercent: number;
  earnedMinor: number;
  timedOut: boolean;
  rewardBlocked: string | null;
};

/**
 * The locked kid experience. This device belongs to one child profile until a
 * parent signs it out, so there is no profile picker and no way into the parent
 * area without the parent password.
 *
 * Everything a child reads and hears follows the family's master settings: the
 * language of the questions, the spoken voice, and the chat with their parent.
 */
export default function KidApp({
  kid,
  parent,
  settings,
  live,
  leaderboard = [],
}: {
  kid: KidView;
  parent: { name: string; email: string };
  settings: FamilySettings;
  live: Live;
  leaderboard?: LeaderboardEntry[];
}) {
  const theme = THEMES[kid.theme];
  const locale = settings.locale;
  const [level, setLevel] = useState<Level | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [voiceOn, setVoiceOn] = useState(settings.kidVoiceOver);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const spoken = useRef<Set<number>>(new Set());

  // The parent's master setting is the starting point; a child can turn voice over
  // off on their own device for the rest of the session.
  useEffect(() => {
    const id = setTimeout(() => setVoiceOn(settings.kidVoiceOver), 0);
    return () => clearTimeout(id);
  }, [settings.kidVoiceOver]);

  // Cheers, screen-time decisions, messages and good news pop up here the moment
  // a parent sends them, and the device reads them out loud.
  const toasts = useToasts(live.events, useCallback((event) => toastForKid(event, kid.id, locale), [kid.id, locale]), 9000);

  useEffect(() => {
    for (const event of live.events) {
      if (event.kidId !== kid.id || spoken.current.has(event.id)) continue;
      spoken.current.add(event.id);
      const payload = event.payload as { message?: string; minutes?: number; text?: string; from?: string };
      if (!voiceOn) continue;
      if (event.type === "cheer.sent" && payload.message) speakText(payload.message, locale);
      else if (event.type === "screen_time.approved") speakText(`${payload.minutes ?? 0} minutes of screen time approved.`, locale);
      else if (event.type === "chat.message" && payload.from === "parent" && payload.text && !showChat) {
        speakText(payload.text, locale);
      }
    }
  }, [live.events, kid.id, locale, voiceOn, showChat]);

  const sendChat = useCallback(
    async (text: string, kind: "text" | "voice") => {
      setChatBusy(true);
      setChatError("");
      const result = await actions.kidChatSend(text, kind);
      setChatBusy(false);
      if (!result.ok) {
        setChatError(result.error);
        reportBehaviour("chat.message_failed", { error: result.error, from: "kid", path: "/api/kid-session/chat" });
        return { ok: false as const, error: result.error };
      }
      await live.refresh();
      return { ok: true as const };
    },
    [live],
  );

  const markChatRead = useCallback(() => {
    void actions.kidChatRead().then(() => live.refresh());
  }, [live]);

  const canSpeak = useMemo(() => speechSupported(), []);

  return (
    <main className={`kid-shell theme-${kid.theme}`} dir={isRtl(locale) ? "rtl" : "ltr"} lang={locale}>
      <header className="kid-header">
        <span className="kid-id">
          <span className="avatar">{theme.emoji}</span>
          <span>
            <strong>{kid.name}</strong>
            <small>{theme.label}</small>
          </span>
        </span>
        <span className="kid-stats">
          <span className="pill">
            🏅 {t(locale, "kid.levelName", { n: kid.level })} · {levelTitle(kid.level)}
          </span>
          {kid.unlockedLevel > kid.level && (
            <span className="pill">🔓 {t(locale, "kid.bestLevel", { n: kid.unlockedLevel })}</span>
          )}
          <span className="pill">💰 {formatReward(kid.walletBalanceMinor, settings.rewardKind, settings.currency)}</span>
          <span className="pill">⭐ {kid.points} points</span>
          <span className="pill">⏱️ {kid.approvedMinutes} min</span>
        </span>
        <span className="row gap">
          <button
            className="link chat-button"
            onClick={() => {
              setShowChat((value) => !value);
              setLevel(null);
            }}
          >
            💬 {t(locale, "common.family")}
            {kid.chatUnread > 0 && <span className="badge">{t(locale, "chat.unread", { count: kid.chatUnread })}</span>}
          </button>
          {canSpeak && (
            <button
              className={`chip small ${voiceOn ? "on" : ""}`}
              onClick={() => {
                setVoiceOn((value) => {
                  if (value) stopSpeaking();
                  return !value;
                });
              }}
              title={t(locale, "chat.readAloud")}
            >
              🔈 {t(locale, "kid.voice")}: {t(locale, voiceOn ? "common.on" : "common.off")}
            </button>
          )}
          <button className="link lock" onClick={() => setShowSignOut(true)}>
            {t(locale, "kid.parentButton")}
          </button>
        </span>
      </header>

      {showChat ? (
        <section className="card">
          {chatError && <p className="banner error small">{chatError}</p>}
          <ChatPanel
            viewer="kid"
            kidName={kid.name}
            messages={kid.chat}
            settings={{ ...settings, kidVoiceOver: voiceOn }}
            unread={kid.chatUnread}
            busy={chatBusy}
            onSend={sendChat}
            onMarkRead={markChatRead}
            onClose={() => setShowChat(false)}
          />
        </section>
      ) : level === null ? (
        <LevelPicker kid={kid} onPick={setLevel} live={live} settings={settings} leaderboard={leaderboard} />
      ) : (
        <Quiz
          key={`${kid.id}-${level}-${locale}`}
          kid={kid}
          level={level}
          locale={locale}
          settings={settings}
          voiceOn={voiceOn}
          onBack={() => setLevel(null)}
          onGoToLevel={(wanted) => {
            // Every level is open, so “next level” is simply another level.
            void actions.setLevel(wanted);
            setLevel(wanted);
          }}
          live={live}
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

      {showSignOut && (
        <SignOutDialog
          kidName={kid.name}
          parentName={parent.name}
          onClose={() => setShowSignOut(false)}
          onSignedOut={async () => {
            setShowSignOut(false);
            live.setNotice(
              `${kid.name} is signed out of kid mode on this device. Sign in as a parent, or link this device to a child again.`,
            );
            await live.refresh();
          }}
        />
      )}
    </main>
  );
}

/** Which realtime events should interrupt the kid's screen. */
function toastForKid(event: LiveEvent, kidId: string, locale: FamilySettings["locale"]): ToastItem | null {
  if (event.kidId !== kidId) return null;
  const payload = event.payload as { message?: string; minutes?: number; text?: string; from?: string };
  switch (event.type) {
    case "cheer.sent":
      return payload.message
        ? { id: event.id, emoji: "💌", title: payload.message, body: "From your parent" }
        : null;
    case "chat.message":
      return payload.text && payload.from === "parent"
        ? { id: event.id, emoji: "💬", title: payload.text, body: t(locale, "chat.withParent") }
        : null;
    case "reward.approved":
      return { id: event.id, emoji: "💰", title: "Your money was approved!", body: "Your wallet is reset — ask your parent for your money" };
    case "reward.declined":
      return { id: event.id, emoji: "💬", title: "Your realise request was sent back", body: "Your balance is still saved" };
    case "screen_time.approved":
      return {
        id: event.id,
        emoji: "⏱️",
        title: `${payload.minutes ?? 0} min of screen time approved!`,
        body: "Have fun",
      };
    case "screen_time.granted":
      return { id: event.id, emoji: "🎁", title: `Bonus: ${payload.minutes ?? 0} min`, body: "From your parent" };
    case "screen_time.declined":
      return { id: event.id, emoji: "💬", title: "A parent sent your request back", body: "Try again soon" };
    default:
      return null;
  }
}

/** The family scoreboard: ranked by level, so “I'm on Level 8!” is the competition. */
export function Leaderboard({ entries, highlightKidId, settings }: { entries: LeaderboardEntry[]; highlightKidId?: string; settings: FamilySettings }) {
  if (entries.length === 0) return null;
  return (
    <div className="leaderboard">
      <h3>🏆 Scoreboard</h3>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.kidId} className={entry.kidId === highlightKidId ? "me" : ""}>
            <span>
              {index + 1}. {entry.name} {entry.kidId === highlightKidId ? "(you)" : ""}
            </span>
            <span>
              {t(settings.locale, "kid.bestLevel", { n: entry.unlockedLevel })} · {entry.accuracy}% ·{" "}
              {formatReward(entry.lifetimeEarnedMinor, settings.rewardKind, settings.currency)} earned
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LevelPicker({
  kid,
  onPick,
  live,
  settings,
  leaderboard,
}: {
  kid: KidView;
  onPick: (level: Level) => void;
  live: Live;
  settings: FamilySettings;
  leaderboard: LeaderboardEntry[];
}) {
  const locale = settings.locale;
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [askedRealise, setAskedRealise] = useState(false);
  const [error, setError] = useState("");
  // Which level is asking “start again?” before any answer is cleared.
  const [restartAsk, setRestartAsk] = useState<Level | null>(null);
  const [jump, setJump] = useState("");
  // No level is locked. The list is a window around the child (never an
  // ever-growing wall of buttons) plus a box that jumps to any level number.
  const levels = levelWindow(kid);
  const resume = levelToResume(kid);
  const best = Math.max(1, kid.unlockedLevel);

  /**
   * Opens a level. `start` carries on where the child stopped in it (that is
   * what “resume” is), `restart` begins that one level again from its first
   * question — points and money are untouched, and no level is ever refused.
   */
  async function choose(level: Level, action: LevelAction = "start") {
    setBusy(true);
    setError("");
    const result = await actions.setLevel(level, action);
    setBusy(false);
    setRestartAsk(null);
    if (!result.ok) {
      setError(result.error);
      reportBehaviour("quiz.level_open_failed", { kidId: kid.id, level, action, reason: result.error });
      return;
    }
    await live.refresh();
    onPick(level);
  }

  function jumpToAnyLevel(event: React.FormEvent) {
    event.preventDefault();
    const wanted = Number.parseInt(jump, 10);
    if (!Number.isFinite(wanted)) return;
    setJump("");
    void choose(Math.min(MAX_LEVEL, Math.max(1, wanted)));
  }

  async function askForScreenTime() {
    setBusy(true);
    setError("");
    const result = await actions.requestScreenTime();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAsked(true);
    reportBehaviour("quiz.screen_time_requested", {
      kidName: kid.name,
      minutes: result.data.minutes,
      kidId: kid.id,
      pointsSpent: result.data.minutes,
    });
    await live.refresh();
  }

  async function askToRealise() {
    setBusy(true);
    setError("");
    const result = await actions.requestRealisation();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAskedRealise(true);
    await live.refresh();
  }

  return (
    <section className="card">
      <h2>{t(locale, "kid.chooseLevel")}</h2>
      <p className="muted">{kid.age <= 4 ? t(locale, "kid.earlyNote") : t(locale, "kid.mixedNote")}</p>
      <p className="muted small">
        {t(locale, "kid.anyLevel")}{" "}
        <strong>
          {t(locale, "kid.bestLevel", { n: best })} · {levelTitle(best)}
        </strong>
      </p>

      {/* One tap back into the level the child was in the middle of. */}
      {resume && (
        <div className="resume-banner">
          <span className="resume-emoji" aria-hidden="true">
            ▶️
          </span>
          <span className="resume-text">
            <strong>{t(locale, "kid.resumeTitle")}</strong>
            <small>
              {t(locale, "kid.levelName", { n: resume.level })} · {levelTitle(resume.level)} ·{" "}
              {t(locale, "kid.levelProgress", { done: resume.done, total: resume.total })}
            </small>
          </span>
          <button className="primary" disabled={busy} onClick={() => void choose(resume.level)}>
            {t(locale, "kid.resume")}
          </button>
        </div>
      )}

      <div className="level-grid">
        {levels.map((level) => {
          const progress = levelProgress(kid, level);
          const label =
            progress.status === "complete"
              ? t(locale, "kid.replay")
              : progress.status === "in-progress"
                ? t(locale, "kid.resume")
                : t(locale, "kid.start");
          return (
            <div key={level} className={`level-card ${level === kid.level ? "current" : ""}`}>
              <button className="level" disabled={busy} onClick={() => void choose(level)}>
                <strong>
                  {t(locale, "kid.levelName", { n: level })} · {levelTitle(level)}
                </strong>
                <small>
                  {t(locale, "kid.levelProgress", { done: progress.done, total: progress.total })}
                  {progress.status === "complete" ? ` · ${t(locale, "kid.finishedTag")}` : ""}
                </small>
                <span className="bar">
                  <span style={{ width: `${progress.percent}%` }} />
                </span>
                <em className="level-action">{label}</em>
              </button>
              {progress.done > 0 && (
                <button
                  className="level-restart"
                  disabled={busy}
                  title={t(locale, "kid.restart")}
                  aria-label={`${t(locale, "kid.restart")} · ${t(locale, "kid.levelName", { n: level })}`}
                  onClick={() => setRestartAsk(level)}
                >
                  ↺
                </button>
              )}
              {restartAsk === level && (
                <div className="restart-ask" role="dialog">
                  <p>{t(locale, "kid.restartAsk", { level })}</p>
                  <div className="row wrap gap">
                    <button className="primary" disabled={busy} onClick={() => void choose(level, "restart")}>
                      {t(locale, "kid.restartYes")}
                    </button>
                    <button className="ghost" disabled={busy} onClick={() => setRestartAsk(null)}>
                      {t(locale, "kid.restartNo")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form className="row wrap gap jump" onSubmit={jumpToAnyLevel}>
        <label className="inline">
          {t(locale, "kid.jumpTo")}
          <input
            type="number"
            min={1}
            max={MAX_LEVEL}
            inputMode="numeric"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
          />
        </label>
        <button type="submit" className="ghost" disabled={busy}>
          {t(locale, "kid.go")}
        </button>
      </form>

      <div className="request">
        <p>
          💰 Wallet: <strong>{formatReward(kid.walletBalanceMinor, settings.rewardKind, settings.currency)}</strong>
          <span className="muted">
            {" "}
            · today {formatReward(kid.earnedTodayMinor, settings.rewardKind, settings.currency)}
            {settings.dailyEarnLimitMinor > 0 ? ` of ${formatReward(settings.dailyEarnLimitMinor, settings.rewardKind, settings.currency)}` : ""} · this week{" "}
            {formatReward(kid.earnedThisWeekMinor, settings.rewardKind, settings.currency)} · a perfect answer earns{" "}
            {formatReward(settings.maxRewardPerQuestionMinor, settings.rewardKind, settings.currency)}
          </span>
        </p>
        <button
          className="primary"
          disabled={kid.walletBalanceMinor === 0 || kid.requestedRewardMinor > 0 || busy || askedRealise}
          onClick={() => void askToRealise()}
        >
          {kid.requestedRewardMinor > 0 || askedRealise
            ? t(locale, "kid.waitingParent")
            : `Ask a parent to realise ${formatReward(kid.walletBalanceMinor, settings.rewardKind, settings.currency)}`}
        </button>
        {kid.requestedRewardMinor > 0 && (
          <p className="muted">Waiting for a parent to approve {formatReward(kid.requestedRewardMinor, settings.rewardKind, settings.currency)}. Your wallet resets when they approve.</p>
        )}
      </div>

      <div className="request">
        <p>{t(locale, "kid.points", { points: kid.points })}</p>
        <button className="primary" disabled={kid.points === 0 || busy || asked} onClick={() => void askForScreenTime()}>
          {asked ? t(locale, "kid.waitingParent") : t(locale, "kid.askScreenTime", { points: kid.points })}
        </button>
        {kid.requestedMinutes > 0 && (
          <p className="muted">{t(locale, "kid.waitingAnswer", { minutes: kid.requestedMinutes })}</p>
        )}
        {asked && <p className="muted">{t(locale, "kid.parentTold")}</p>}
        {error && <p className="banner error">{error}</p>}
      </div>

      <Leaderboard entries={leaderboard} highlightKidId={kid.id} settings={settings} />
    </section>
  );
}

function Quiz({
  kid,
  level,
  locale,
  settings,
  voiceOn,
  onBack,
  onGoToLevel,
  live,
}: {
  kid: KidView;
  level: Level;
  locale: FamilySettings["locale"];
  settings: FamilySettings;
  voiceOn: boolean;
  onBack: () => void;
  /** Opens another level straight from the finished screen. */
  onGoToLevel: (level: Level) => void;
  live: Live;
}) {
  const usedHere = useRef<Set<string>>(new Set());
  const [question, setQuestion] = useState<LocalisedQuestion | null>(() => pickQuestion(kid, level, locale));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [error, setError] = useState("");
  const startedAt = useRef<number>(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    question ? timeLimitSeconds(settings, difficultyForQuestion(question)) : 0,
  );
  const answerRef = useRef<(canonical: string, shown: string) => Promise<void>>(async () => undefined);

  // Per-question timer: harder questions get more time (Master settings, max
  // 10 minutes). When it runs out the question is marked as timed out.
  useEffect(() => {
    if (!question) return;
    startedAt.current = Date.now();
    const limit = timeLimitSeconds(settings, difficultyForQuestion(question));
    const kickoff = setTimeout(() => setSecondsLeft(limit), 0);
    const tick = setInterval(() => {
      const left = limit - (Date.now() - startedAt.current) / 1000;
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(tick);
        void answerRef.current("", "");
      }
    }, 250);
    return () => {
      clearTimeout(kickoff);
      clearInterval(tick);
    };
    // Settings are fixed for the mounted quiz; re-arm only for a new question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  // Speech recognition is browser-only, so check it just after mount to keep the
  // server-rendered markup and the first client render identical.
  useEffect(() => {
    const id = setTimeout(() => setCanListen(recognitionSupported()), 0);
    return () => clearTimeout(id);
  }, []);

  // Read the question aloud whenever a new one appears (voice over).
  useEffect(() => {
    if (!question || !voiceOn) return;
    speakText(
      `${question.question} ${question.choices.map((choice, index) => `${"ABCD"[index]}, ${choice}`).join(". ")}`,
      locale,
    );
  }, [question, locale, voiceOn]);

  const { done, total } = levelQuestionCount(kid, level);
  const finished = question === null;

  async function answer(canonical: string, shown: string) {
    if (!question || feedback || busy) return;
    setBusy(true);
    setError("");
    // The chosen wording is what the child taps; the English wording is what the
    // server marks, so a translated quiz is still marked fairly.
    const result = await actions.answer(question.id, canonical, level);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      reportBehaviour("quiz.answer_rejected", {
        questionId: question.id,
        level,
        kidId: kid.id,
        reason: result.error,
      });
      return;
    }
    const outcome = result.data.result;
    usedHere.current.add(question.id);
    setFeedback({
      correct: outcome.correct,
      picked: shown,
      answer: question.choices[question.answerIndex] ?? outcome.answer,
      explain: question.explain,
      points: outcome.points,
      levelFinished: outcome.levelFinished,
      scorePercent: outcome.scorePercent,
      earnedMinor: outcome.earnedMinor,
      timedOut: outcome.timedOut,
      rewardBlocked: outcome.rewardBlocked,
    });
    if (voiceOn) {
      speakText(
        outcome.correct
          ? `${t(locale, "kid.correct")} ${question.explain}`
          : `${t(locale, "kid.notQuite", { answer: question.choices[question.answerIndex] ?? outcome.answer })} ${question.explain}`,
        locale,
      );
    }
    await live.refresh();
  }

  // The timer interval calls the latest copy of `answer` (with fresh guards).
  useEffect(() => {
    answerRef.current = answer;
  });

  function checkTyped(text: string) {
    if (!question || feedback || busy) return;
    const canonical = canonicalChoiceFor(text, question.choices, question.canonicalChoices);
    if (canonical) {
      const index = question.canonicalChoices.indexOf(canonical);
      void answer(canonical, question.choices[index] ?? text);
      return;
    }
    const localMatch = matchChoice(text, question.choices);
    void answer(localMatch ?? text, localMatch ?? text);
  }

  function startListening() {
    setError("");
    const handle = listenOnce({
      locale,
      onText: (text) => {
        setTyped(text);
        checkTyped(text);
      },
      onError: (message) => setError(message),
      onEnd: () => setListening(false),
    });
    if (handle) setListening(true);
  }

  function next() {
    setFeedback(null);
    setTyped("");
    const nextOne = pickQuestion(kid, level, locale, usedHere.current);
    if (!nextOne) {
      setQuestion(null);
      return;
    }
    setQuestion(nextOne);
  }

  return (
    <section className="card quiz">
      <div className="quiz-top">
        <button className="link" onClick={onBack}>
          {t(locale, "kid.levelsBack")}
        </button>
        <span>
          {t(locale, "kid.levelName", { n: level })} · {done}/{total}
        </span>
        {question && !feedback && (
          <span className={`pill timer ${secondsLeft <= 30 ? "low" : ""}`} role="timer" aria-label="Time left for this question">
            ⏱️ {formatCountdown(secondsLeft)} · {difficultyForQuestion(question)} · perfect ={" "}
            {formatReward(settings.maxRewardPerQuestionMinor, settings.rewardKind, settings.currency)}
          </span>
        )}
      </div>
      {question && !feedback && (
        <span className="bar timer-bar">
          <span style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / Math.max(1, timeLimitSeconds(settings, difficultyForQuestion(question)))) * 100))}%` }} />
        </span>
      )}

      {finished ? (
        <div className="center">
          <h2>{t(locale, "kid.levelFinished")}</h2>
          <p>{t(locale, "kid.levelFinishedBody")}</p>
          <div className="row wrap gap center-row">
            <button className="primary" onClick={() => onGoToLevel(level + 1)}>
              {t(locale, "kid.nextLevel")}
            </button>
            <button className="ghost" onClick={onBack}>
              {t(locale, "kid.backToLevels")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={`visual ${feedback ? (feedback.correct ? "pop" : "shake") : ""}`} aria-hidden="true">
            {question.visual}
          </div>
          <h2 className="question">{question.question}</h2>
          <button className="link" onClick={() => speakText(question.question, locale)}>
            🔊 {t(locale, "kid.readQuestion")}
          </button>

          <div className="choices">
            {question.choices.map((choice, index) => {
              const isAnswer = feedback && choice === feedback.answer;
              const isWrongPick = feedback && feedback.picked === choice && !feedback.correct;
              return (
                <button
                  key={`${choice}-${index}`}
                  className={`option ${isAnswer ? "correct" : ""} ${isWrongPick ? "wrong" : ""}`}
                  disabled={!!feedback || busy}
                  onClick={() => void answer(question.canonicalChoices[index] ?? choice, choice)}
                >
                  <kbd>{"ABCD"[index]}</kbd> {choice}
                </button>
              );
            })}
          </div>

          {!feedback && (
            <form
              className="typed"
              onSubmit={(event) => {
                event.preventDefault();
                checkTyped(typed);
              }}
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={t(locale, "kid.typeAnswer")}
                aria-label={t(locale, "kid.typeAnswer")}
              />
              <button type="submit" disabled={busy}>
                {busy ? t(locale, "kid.checking") : t(locale, "kid.check")}
              </button>
              {canListen && (
                <button type="button" onClick={startListening} disabled={listening}>
                  {listening ? t(locale, "kid.listening") : `🎙️ ${t(locale, "kid.speakAnswer")}`}
                </button>
              )}
            </form>
          )}

          {error && <p className="banner error">{error}</p>}

          {feedback && (
            <div className={`feedback ${feedback.correct ? "good" : "bad"}`} role="status">
              <h3>
                {feedback.timedOut
                  ? "⏰ Time's up!"
                  : feedback.correct
                    ? t(locale, "kid.correct")
                    : t(locale, "kid.notQuite", { answer: feedback.answer })}
              </h3>
              {!feedback.timedOut && (
                <p>
                  {feedback.scorePercent}% close
                  {feedback.earnedMinor > 0
                    ? ` · 💰 +${formatReward(feedback.earnedMinor, settings.rewardKind, settings.currency)}`
                    : feedback.rewardBlocked
                      ? ` · no reward this time (${feedback.rewardBlocked.replace("-", " ")})`
                      : ""}
                </p>
              )}
              <p>{feedback.explain}</p>
              <button
                className="link"
                onClick={() =>
                  speakText(
                    `${feedback.correct ? `${t(locale, "kid.correct")} ` : `${t(locale, "kid.notQuite", { answer: feedback.answer })} `}${feedback.explain}`,
                    locale,
                  )
                }
              >
                🔊 {t(locale, "kid.readAnswer")}
              </button>
              {feedback.levelFinished ? (
                <>
                  <p className="banner good">
                    {t(locale, "kid.levelUnlockNote")} {t(locale, "kid.levelName", { n: level + 1 })} · {levelTitle(level + 1)}
                  </p>
                  <div className="row wrap gap">
                    <button className="primary" onClick={() => onGoToLevel(level + 1)}>
                      {t(locale, "kid.nextLevel")}
                    </button>
                    <button className="ghost" onClick={onBack}>
                      {t(locale, "kid.backToLevels")}
                    </button>
                  </div>
                </>
              ) : (
                <button className="primary" onClick={next}>
                  {t(locale, "kid.nextQuestion")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SignOutDialog({
  kidName,
  parentName,
  onClose,
  onSignedOut,
}: {
  kidName: string;
  parentName: string;
  onClose: () => void;
  onSignedOut: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="card modal">
        <h2>This device is in kid mode</h2>
        <p className="muted">
          {kidName} stays signed in on this device until a parent signs out. Enter the parent password for{" "}
          {parentName}&apos;s account to unlock it.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const result = await actions.kidLogout(password);
            setBusy(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setPassword("");
            await onSignedOut();
          }}
        >
          <label>
            Parent password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="banner error">{error}</p>}
          <div className="row gap">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Signing out…" : "Sign out of kid mode"}
            </button>
            <button type="button" className="link" onClick={onClose}>
              Stay in kid mode
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Picks an unanswered question for this level in the family's language. */
function pickQuestion(
  kid: KidView,
  level: Level,
  locale: FamilySettings["locale"],
  extraUsed?: Set<string>,
): LocalisedQuestion | null {
  const tracks = tracksForAge(kid.age);
  const used = new Set([...(kid.usedByLevel[String(level)] ?? []), ...(extraUsed ?? [])]);
  const tier = tierForLevel(level);
  const pool: Question[] = QUESTIONS.filter((q) => q.level === tier && tracks.includes(q.track) && !used.has(q.id));
  if (pool.length === 0) return null;
  return localiseQuestion(pool[Math.floor(Math.random() * pool.length)], locale);
}
