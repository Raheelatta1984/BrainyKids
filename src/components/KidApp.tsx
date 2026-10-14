"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { actions, type Live } from "@/lib/client/api";
import { useToasts, type ToastItem } from "@/lib/client/useToasts";
import { levelQuestionCount, matchChoice, speak, tracksForAge } from "@/lib/quiz-logic";
import { QUESTIONS, type Question } from "@/lib/quiz-data";
import type { KidView, Level, LiveEvent, Theme } from "@/lib/types";

export const THEMES: Record<Theme, { label: string; emoji: string }> = {
  space: { label: "Space Explorers", emoji: "🚀" },
  jungle: { label: "Jungle Adventure", emoji: "🦁" },
  robots: { label: "Robot Lab", emoji: "🤖" },
  dinos: { label: "Dino Dig", emoji: "🦖" },
};

const LEVEL_NAMES: Record<Level, string> = {
  1: "Level 1 · Starter",
  2: "Level 2 · Explorer",
  3: "Level 3 · Champion",
};

type Feedback = {
  correct: boolean;
  picked: string;
  answer: string;
  explain: string;
  points: number;
  levelFinished: boolean;
};

/**
 * The locked kid experience. This device belongs to one child profile until a
 * parent signs it out, so there is no profile picker and no way into the parent
 * area without the parent password.
 */
export default function KidApp({
  kid,
  parent,
  live,
}: {
  kid: KidView;
  parent: { name: string; email: string };
  live: Live;
}) {
  const theme = THEMES[kid.theme];
  const [level, setLevel] = useState<Level | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const spoken = useRef<Set<number>>(new Set());

  // Cheers, screen-time decisions and good news pop up here the moment a parent
  // sends them, and the device reads them out loud.
  const toasts = useToasts(live.events, useCallback((event) => toastForKid(event, kid.id), [kid.id]), 9000);

  useEffect(() => {
    for (const event of live.events) {
      if (event.kidId !== kid.id || spoken.current.has(event.id)) continue;
      spoken.current.add(event.id);
      const payload = event.payload as { message?: string; minutes?: number };
      if (event.type === "cheer.sent" && payload.message) speak(payload.message);
      else if (event.type === "screen_time.approved") speak(`${payload.minutes ?? 0} minutes of screen time approved.`);
    }
  }, [live.events, kid.id]);

  return (
    <main className={`kid-shell theme-${kid.theme}`}>
      <header className="kid-header">
        <span className="kid-id">
          <span className="avatar">{theme.emoji}</span>
          <span>
            <strong>{kid.name}</strong>
            <small>{theme.label}</small>
          </span>
        </span>
        <span className="kid-stats">
          <span className="pill">⭐ {kid.points} points</span>
          <span className="pill">⏱️ {kid.approvedMinutes} min</span>
        </span>
        <button className="link lock" onClick={() => setShowSignOut(true)}>
          🔒 Parent
        </button>
      </header>

      {level === null ? (
        <LevelPicker kid={kid} onPick={setLevel} live={live} />
      ) : (
        <Quiz key={`${kid.id}-${level}`} kid={kid} level={level} onBack={() => setLevel(null)} live={live} />
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
function toastForKid(event: LiveEvent, kidId: string): ToastItem | null {
  if (event.kidId !== kidId) return null;
  const payload = event.payload as { message?: string; minutes?: number };
  switch (event.type) {
    case "cheer.sent":
      return payload.message
        ? { id: event.id, emoji: "💌", title: payload.message, body: "From your parent" }
        : null;
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

function LevelPicker({ kid, onPick, live }: { kid: KidView; onPick: (level: Level) => void; live: Live }) {
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState("");
  const levels: Level[] = [1, 2, 3];

  async function choose(level: Level) {
    setBusy(true);
    await actions.setLevel(level);
    setBusy(false);
    onPick(level);
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
    await live.refresh();
  }

  return (
    <section className="card">
      <h2>Choose your level</h2>
      <p className="muted">
        {kid.age <= 4
          ? "Fun early questions for little learners."
          : "A mix of selective-style and NAPLAN-style questions."}
      </p>
      <div className="level-grid">
        {levels.map((level) => {
          const locked = level > kid.unlockedLevel;
          const { done, total } = levelQuestionCount(kid, level);
          const percent = total === 0 ? 0 : Math.round((done / total) * 100);
          return (
            <button
              key={level}
              className={`level ${level === kid.level ? "current" : ""}`}
              disabled={locked || busy}
              onClick={() => void choose(level)}
            >
              <strong>{LEVEL_NAMES[level]}</strong>
              <small>{locked ? "🔒 Finish the previous level to unlock" : `${done} of ${total} done`}</small>
              <span className="bar">
                <span style={{ width: `${locked ? 0 : percent}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="request">
        <p>
          You have <strong>{kid.points}</strong> points. Each point is 1 minute of screen time.
        </p>
        <button className="primary" disabled={kid.points === 0 || busy || asked} onClick={() => void askForScreenTime()}>
          {asked ? "Waiting for a parent…" : `Ask a parent for ${kid.points} min`}
        </button>
        {kid.requestedMinutes > 0 && <p className="muted">Waiting for a parent to answer {kid.requestedMinutes} min.</p>}
        {asked && <p className="muted">Your parent has been told. Watch this screen for their answer ⏱️</p>}
        {error && <p className="banner error">{error}</p>}
      </div>
    </section>
  );
}

function Quiz({ kid, level, onBack, live }: { kid: KidView; level: Level; onBack: () => void; live: Live }) {
  const usedHere = useRef<Set<string>>(new Set());
  const [question, setQuestion] = useState<Question | null>(() => pickQuestion(kid, level));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Speech recognition is browser-only, so check it just after mount to keep the
  // server-rendered markup and the first client render identical.
  useEffect(() => {
    const id = setTimeout(() => setCanSpeak("SpeechRecognition" in window || "webkitSpeechRecognition" in window), 0);
    return () => clearTimeout(id);
  }, []);

  // Read the question aloud whenever a new one appears.
  useEffect(() => {
    if (question) speak(`${question.question} ${question.choices.map((c, i) => `${"ABCD"[i]}, ${c}`).join(". ")}`);
  }, [question]);

  const { done, total } = levelQuestionCount(kid, level);
  const finished = question === null;

  async function answer(picked: string) {
    if (!question || feedback || busy) return;
    setBusy(true);
    setError("");
    const result = await actions.answer(question.id, picked, level);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const outcome = result.data.result;
    usedHere.current.add(question.id);
    setFeedback({
      correct: outcome.correct,
      picked,
      answer: outcome.answer,
      explain: outcome.explain,
      points: outcome.points,
      levelFinished: outcome.levelFinished,
    });
    speak(
      outcome.correct
        ? `Correct! ${outcome.explain}`
        : `Not quite. The answer is ${outcome.answer}. ${outcome.explain}`,
    );
    await live.refresh();
  }

  function checkTyped(text: string) {
    if (!question || feedback || busy) return;
    const choice = matchChoice(text, question.choices);
    void answer(choice ?? text);
  }

  function startListening() {
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "en-AU";
    recognition.interimResults = false;
    recognition.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) => {
      const text = e.results[0][0].transcript;
      setTyped(text);
      checkTyped(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function next() {
    setFeedback(null);
    setTyped("");
    const nextOne = pickQuestion(kid, level, usedHere.current);
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
          ← Levels
        </button>
        <span>
          {LEVEL_NAMES[level]} · {done}/{total}
        </span>
      </div>

      {finished ? (
        <div className="center">
          <h2>🎉 Level finished!</h2>
          <p>You have answered every question in this level. The next level is unlocked.</p>
          <button className="primary" onClick={onBack}>
            Back to levels
          </button>
        </div>
      ) : (
        <>
          <div className={`visual ${feedback ? (feedback.correct ? "pop" : "shake") : ""}`} aria-hidden="true">
            {question.visual}
          </div>
          <h2 className="question">{question.question}</h2>
          <button className="link" onClick={() => speak(question.question)}>
            🔊 Read question
          </button>

          <div className="choices">
            {question.choices.map((choice, index) => {
              const isAnswer = feedback && choice === question.answer;
              const isWrongPick = feedback && feedback.picked === choice && !feedback.correct;
              return (
                <button
                  key={choice}
                  className={`option ${isAnswer ? "correct" : ""} ${isWrongPick ? "wrong" : ""}`}
                  disabled={!!feedback || busy}
                  onClick={() => void answer(choice)}
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
                placeholder="Type your answer"
                aria-label="Type your answer"
              />
              <button type="submit" disabled={busy}>
                {busy ? "Checking…" : "Check"}
              </button>
              {canSpeak && (
                <button type="button" onClick={startListening} disabled={listening}>
                  {listening ? "🎙️ Listening…" : "🎙️ Speak"}
                </button>
              )}
            </form>
          )}

          {error && <p className="banner error">{error}</p>}

          {feedback && (
            <div className={`feedback ${feedback.correct ? "good" : "bad"}`} role="status">
              <h3>{feedback.correct ? "🌟 Correct! +1 point" : `Not quite. The answer is ${feedback.answer}.`}</h3>
              <p>{feedback.explain}</p>
              <button
                className="link"
                onClick={() =>
                  speak(
                    `${feedback.correct ? "Correct! " : `The answer is ${feedback.answer}. `}${feedback.explain}`,
                  )
                }
              >
                🔊 Read answer
              </button>
              {feedback.levelFinished ? (
                <>
                  <p className="banner good">
                    You finished this level! {kid.unlockedLevel < 3 ? "The next level is unlocked." : "You are a champion!"}
                  </p>
                  <button className="primary" onClick={onBack}>
                    Back to levels
                  </button>
                </>
              ) : (
                <button className="primary" onClick={next}>
                  Next question
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

/** Picks an unanswered question for this level, avoiding anything done in this session. */
function pickQuestion(kid: KidView, level: Level, extraUsed?: Set<string>): Question | null {
  const tracks = tracksForAge(kid.age);
  const used = new Set([...(kid.usedByLevel[String(level)] ?? []), ...(extraUsed ?? [])]);
  const pool = QUESTIONS.filter((q) => q.level === level && tracks.includes(q.track) && !used.has(q.id));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};
