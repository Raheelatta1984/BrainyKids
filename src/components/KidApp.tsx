"use client";

import { useEffect, useRef, useState } from "react";
import { updateState, useAppState, type Kid, type Theme } from "@/lib/store";
import { levelQuestionCount, matchChoice, matchesAnswer, nextQuestion, speak } from "@/lib/quiz-logic";
import type { Question } from "@/lib/quiz-data";

export const THEMES: Record<Theme, { label: string; emoji: string }> = {
  space: { label: "Space Explorers", emoji: "🚀" },
  jungle: { label: "Jungle Adventure", emoji: "🦁" },
  robots: { label: "Robot Lab", emoji: "🤖" },
  dinos: { label: "Dino Dig", emoji: "🦖" },
};

const LEVEL_NAMES = { 1: "Level 1 · Starter", 2: "Level 2 · Explorer", 3: "Level 3 · Champion" } as const;

type Feedback = { correct: boolean; picked: string } | null;

function speechSupported() {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

export default function KidApp() {
  const state = useAppState();
  const [activeKidId, setActiveKidId] = useState<string | null>(null);
  const kid = state.kids.find((k) => k.id === activeKidId) ?? null;

  if (state.kids.length === 0) {
    return (
      <main className="kid-shell">
        <section className="card center">
          <h1>BrainyKids</h1>
          <p>No profiles yet. A parent needs to add a child profile first.</p>
        </section>
      </main>
    );
  }

  if (!kid) {
    return (
      <main className="kid-shell">
        <section className="card">
          <h1>Who is learning today?</h1>
          <div className="profile-grid">
            {state.kids.map((k) => (
              <button key={k.id} className={`profile theme-${k.theme}`} onClick={() => setActiveKidId(k.id)}>
                <span className="profile-emoji">{THEMES[k.theme].emoji}</span>
                <strong>{k.name}</strong>
                <small>Age {k.age}</small>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return <KidSession key={kid.id} kidId={kid.id} onExit={() => setActiveKidId(null)} />;
}

function KidSession({ kidId, onExit }: { kidId: string; onExit: () => void }) {
  const state = useAppState();
  const kid = state.kids.find((k) => k.id === kidId);
  const [level, setLevel] = useState<1 | 2 | 3 | null>(null);

  if (!kid) return null;
  const theme = THEMES[kid.theme];

  return (
    <main className={`kid-shell theme-${kid.theme}`}>
      <header className="kid-header">
        <span>
          {theme.emoji} {theme.label}
        </span>
        <span>
          ⭐ {kid.points} points · ⏱️ {kid.approvedMinutes} min unlocked
        </span>
        <button className="link" onClick={onExit}>
          Switch child
        </button>
      </header>

      {level === null ? (
        <LevelPicker kid={kid} onPick={setLevel} />
      ) : (
        <Quiz kid={kid} level={level} onBack={() => setLevel(null)} />
      )}
    </main>
  );
}

function LevelPicker({ kid, onPick }: { kid: Kid; onPick: (l: 1 | 2 | 3) => void }) {
  const levels: (1 | 2 | 3)[] = [1, 2, 3];
  return (
    <section className="card">
      <h2>Choose your level</h2>
      <p className="muted">
        {kid.age <= 4
          ? "Fun early questions for little learners."
          : "A mix of selective-style and NAPLAN-style questions."}
      </p>
      <div className="level-grid">
        {levels.map((l) => {
          const locked = l > kid.unlockedLevel;
          const { done, total } = levelQuestionCount(kid, l);
          return (
            <button key={l} className="level" disabled={locked} onClick={() => onPick(l)}>
              <strong>{LEVEL_NAMES[l]}</strong>
              <small>{locked ? "🔒 Finish the previous level to unlock" : `${done} of ${total} done`}</small>
            </button>
          );
        })}
      </div>
      <RequestScreenTime kid={kid} />
    </section>
  );
}

function RequestScreenTime({ kid }: { kid: Kid }) {
  return (
    <div className="request">
      <p>
        You have <strong>{kid.points}</strong> points. Each point is 1 minute of screen time.
      </p>
      <button
        className="primary"
        disabled={kid.points === 0}
        onClick={() =>
          updateState((s) => ({
            ...s,
            kids: s.kids.map((k) =>
              k.id === kid.id
                ? { ...k, requestedMinutes: k.requestedMinutes + k.points, points: 0 }
                : k,
            ),
          }))
        }
      >
        Ask a parent for {kid.points} min
      </button>
      {kid.requestedMinutes > 0 && <p className="muted">Waiting for a parent to approve {kid.requestedMinutes} min.</p>}
    </div>
  );
}

function Quiz({ kid, level, onBack }: { kid: Kid; level: 1 | 2 | 3; onBack: () => void }) {
  const [question, setQuestion] = useState<Question | null>(() => nextQuestion(kid));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Read the question aloud whenever a new one appears.
  useEffect(() => {
    if (question) speak(`${question.question} ${question.choices.map((c, i) => `${"ABCD"[i]}, ${c}`).join(". ")}`);
  }, [question]);

  const finished = question === null;

  function answer(choice: string) {
    if (!question || feedback) return;
    const correct = choice === question.answer;
    setFeedback({ correct, picked: choice });
    speak(correct ? `Correct! ${question.explain}` : `Not quite. The answer is ${question.answer}. ${question.explain}`);
    updateState((s) => ({
      ...s,
      kids: s.kids.map((k) => {
        if (k.id !== kid.id) return k;
        const used = [...(k.usedByLevel[String(level)] ?? []), question.id];
        const updated: Kid = {
          ...k,
          usedByLevel: { ...k.usedByLevel, [String(level)]: used },
          attempted: k.attempted + 1,
          correct: k.correct + (correct ? 1 : 0),
          points: k.points + (correct ? 1 : 0),
        };
        // Finishing a level unlocks the next one.
        const { total, done } = levelQuestionCount(updated, level);
        if (done >= total && level < 3 && updated.unlockedLevel <= level) {
          updated.unlockedLevel = (level + 1) as 2 | 3;
        }
        return updated;
      }),
    }));
  }

  function checkTyped(text: string) {
    if (!question || feedback) return;
    const choice = matchChoice(text, question.choices);
    if (choice !== null) {
      answer(choice);
    } else {
      setFeedback({ correct: false, picked: text });
    }
  }

  function startListening() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) => {
      const text = e.results[0][0].transcript;
      setTyped(text);
      checkTyped(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function next() {
    setFeedback(null);
    setTyped("");
    setQuestion(nextQuestion(kid));
  }

  // Reads the latest kid record so the level counter reflects answers given in this session.
  const state = useAppState();
  const current = state.kids.find((k) => k.id === kid.id) ?? kid;
  const { done, total } = levelQuestionCount(current, level);

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
            {question.choices.map((c, i) => {
              const isAnswer = feedback && c === question.answer;
              const isWrongPick = feedback && feedback.picked === c && !feedback.correct;
              return (
                <button
                  key={c}
                  className={`choice ${isAnswer ? "correct" : ""} ${isWrongPick ? "wrong" : ""}`}
                  disabled={!!feedback}
                  onClick={() => answer(c)}
                >
                  <kbd>{"ABCD"[i]}</kbd> {c}
                </button>
              );
            })}
          </div>

          {!feedback && (
            <form
              className="typed"
              onSubmit={(e) => {
                e.preventDefault();
                checkTyped(typed);
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type your answer"
                aria-label="Type your answer"
              />
              <button type="submit">Check</button>
              {speechSupported() && (
                <button type="button" onClick={startListening} disabled={listening}>
                  {listening ? "🎙️ Listening…" : "🎙️ Speak"}
                </button>
              )}
            </form>
          )}

          {feedback && (
            <div className={`feedback ${feedback.correct ? "good" : "bad"}`} role="status">
              <h3>{feedback.correct ? "🌟 Correct! +1 point" : `Not quite. The answer is ${question.answer}.`}</h3>
              <p>{question.explain}</p>
              <button className="link" onClick={() => speak(`${feedback.correct ? "Correct! " : `The answer is ${question.answer}. `}${question.explain}`)}>
                🔊 Read answer
              </button>
              <button className="primary" onClick={next}>
                Next question
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};
