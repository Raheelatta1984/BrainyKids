import { QUESTIONS, type Question, type Track } from "./quiz-data";
import type { Level } from "./types";

/** The parts of a kid profile the quiz logic needs. Works for API payloads and local state. */
export type QuizKid = {
  age: number;
  level: Level;
  unlockedLevel: Level;
  usedByLevel: Record<string, string[]>;
};

// Ages 4 and under get only the early track. Older kids get a mix of selective and NAPLAN-style questions.
export function tracksForAge(age: number): Track[] {
  return age <= 4 ? ["early"] : ["selective", "naplan"];
}

// Returns a random question for this kid's level that they have not answered yet, or null when the level is finished.
export function nextQuestion(kid: QuizKid): Question | null {
  const tracks = tracksForAge(kid.age);
  const used = new Set(kid.usedByLevel[String(kid.level)] ?? []);
  const pool = QUESTIONS.filter(
    (q) => q.level === kid.level && tracks.includes(q.track) && !used.has(q.id),
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function levelQuestionCount(kid: QuizKid, level: Level): { total: number; done: number } {
  const tracks = tracksForAge(kid.age);
  const total = QUESTIONS.filter((q) => q.level === level && tracks.includes(q.track)).length;
  const done = (kid.usedByLevel[String(level)] ?? []).length;
  return { total, done: Math.min(done, total) };
}

// Similarity from 0 to 1 based on Levenshtein distance, ignoring case, spaces and punctuation.
function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9°²/.]+/g, "");
}

export function similarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (!x && !y) return 1;
  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n, 1);
}

// Typed or spoken answers count as correct when they are at least 90% similar to the right choice.
export function matchesAnswer(input: string, answer: string): boolean {
  return similarity(input, answer) >= 0.9;
}

// Maps a spoken or typed reply to one of the choices. Accepts the choice text, or a letter (A/B/C/D) or number (1–4).
export function matchChoice(input: string, choices: string[]): string | null {
  const trimmed = input.trim();
  const letter = trimmed.toLowerCase();
  const letterIndex = letter.length === 1 ? "abcd".indexOf(letter) : -1;
  if (letterIndex >= 0 && letterIndex < choices.length) return choices[letterIndex];
  const num = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(num) && String(num) === trimmed && num >= 1 && num <= choices.length) return choices[num - 1];
  let best: { choice: string; score: number } | null = null;
  for (const choice of choices) {
    const score = similarity(trimmed, choice);
    if (!best || score > best.score) best = { choice, score };
  }
  return best && best.score >= 0.8 ? best.choice : null;
}

// Reads text aloud with the browser's built-in speech voice. Does nothing if the browser has no speech support.
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.1;
  utterance.lang = "en-AU";
  window.speechSynthesis.speak(utterance);
}
