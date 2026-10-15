import { QUESTIONS, type Question, type Track } from "./quiz-data";
import type { Level, QuestionTier } from "./types";

/**
 * The highest level number the app accepts. Levels never end, but the number
 * itself stays sane so a typo cannot ask for Level 100000.
 */
export const MAX_LEVEL = 999;

const ALL_TRACKS: Track[] = ["early", "selective", "naplan"];

function hasQuestions(tier: QuestionTier, tracks: Track[]): boolean {
  return QUESTIONS.some((q) => q.level === tier && tracks.includes(q.track));
}

/**
 * Maps an endless progression level onto the bank's three difficulty tiers.
 * Levels 1–3 are the tiers themselves; every level after that replays the
 * hardest tier (fresh to that level, because answers are tracked per level),
 * so a child on Level 8 is answering hard questions, not Level-1 ones again.
 *
 * A track that stops earlier drops back to the hardest tier it actually has
 * (the early questions for the youngest children stop at tier 2), so every
 * level still has questions for every age instead of opening an empty level.
 */
export function tierForLevel(level: Level, tracks: Track[] = ALL_TRACKS): QuestionTier {
  const wanted: QuestionTier = level <= 1 ? 1 : level === 2 ? 2 : 3;
  for (let tier = wanted; tier > 1; tier--) {
    if (hasQuestions(tier as QuestionTier, tracks)) return tier as QuestionTier;
  }
  return 1;
}

/** Friendly rank names that keep growing past the old Level-3 ceiling. */
export function levelTitle(level: Level): string {
  if (level <= 1) return "Starter";
  if (level === 2) return "Explorer";
  if (level === 3) return "Champion";
  if (level === 4) return "Master";
  if (level === 5) return "Grand Master";
  return `Legend ${level - 5}`;
}

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
  const tier = tierForLevel(kid.level, tracks);
  const pool = QUESTIONS.filter((q) => q.level === tier && tracks.includes(q.track) && !used.has(q.id));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function levelQuestionCount(kid: QuizKid, level: Level): { total: number; done: number } {
  const tracks = tracksForAge(kid.age);
  const tier = tierForLevel(level, tracks);
  const total = QUESTIONS.filter((q) => q.level === tier && tracks.includes(q.track)).length;
  const done = (kid.usedByLevel[String(level)] ?? []).length;
  return { total, done: Math.min(done, total) };
}

/** How far through one level a child is: what the level picker shows on each card. */
export type LevelProgress = {
  level: Level;
  total: number;
  done: number;
  percent: number;
  status: "not-started" | "in-progress" | "complete";
};

export function levelProgress(kid: QuizKid, level: Level): LevelProgress {
  const { total, done } = levelQuestionCount(kid, level);
  const status: LevelProgress["status"] = total === 0 || done === 0 ? "not-started" : done >= total ? "complete" : "in-progress";
  return { level, total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100), status };
}

/**
 * Every level the child has started but not finished, highest first — the
 * levels a “Carry on” button can offer and the levels a parent can see are
 * waiting. Because no level is blocked, a child who wandered off to another
 * level always finds the unfinished one still here.
 */
export function unfinishedLevels(kid: QuizKid): LevelProgress[] {
  const candidates = new Set<number>();
  for (const key of Object.keys(kid.usedByLevel ?? {})) {
    const level = Number(key);
    if (Number.isInteger(level) && level >= 1) candidates.add(level);
  }
  candidates.add(Math.max(1, kid.level));
  return [...candidates]
    .sort((a, b) => b - a)
    .map((level) => levelProgress(kid, level))
    .filter((progress) => progress.status === "in-progress");
}

/** The level worth offering as “Carry on”: where the child was, else the newest unfinished one. */
export function levelToResume(kid: QuizKid): LevelProgress | null {
  const current = levelProgress(kid, kid.level);
  if (current.status === "in-progress") return current;
  return unfinishedLevels(kid)[0] ?? null;
}

/** The window of level numbers the picker shows: around the child, inside 1…MAX_LEVEL. */
export function levelWindow(kid: QuizKid, size = 2): Level[] {
  const centre = Math.max(1, Math.min(MAX_LEVEL, kid.level, kid.unlockedLevel));
  const first = Math.max(1, Math.min(kid.level, centre) - size);
  const last = Math.min(MAX_LEVEL, centre + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
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

function firstNumber(s: string): number | null {
  const match = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * How close an answer is, 0–100. An exact answer is 100; for numeric answers
 * closeness is proportional (40 vs 42 ≈ 95); for words it is the text
 * similarity. This is what turns “almost right” into a smaller real reward
 * (90%+ earns 80% of the maximum — 40c of a 50c question).
 */
export function answerScorePercent(picked: string, answer: string): number {
  if (picked.trim() === answer) return 100;
  const pickedNum = firstNumber(picked);
  const answerNum = firstNumber(answer);
  if (pickedNum !== null && answerNum !== null) {
    if (answerNum === 0) return pickedNum === 0 ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((1 - Math.abs(pickedNum - answerNum) / Math.abs(answerNum)) * 100)));
  }
  return Math.round(similarity(picked, answer) * 100);
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

// Spoken output lives in src/lib/voice.ts (it needs the family's language and
// reports problems to the behavioural log), so this module stays plain logic
// that both the browser and the server can import.

/**
 * Maps what a child said or typed (in their own language) back to the English
 * choice the server marks, so a translated quiz is still marked correctly.
 */
export function canonicalChoiceFor(input: string, localisedChoices: string[], canonicalChoices: string[]): string | null {
  const match = matchChoice(input, localisedChoices);
  if (!match) return null;
  const index = localisedChoices.indexOf(match);
  if (index < 0 || index >= canonicalChoices.length) return null;
  return canonicalChoices[index];
}

/** True when the input looks like the answer at this index (used for free text). */
export function choiceIndexFor(input: string, choices: string[]): number {
  const match = matchChoice(input, choices);
  return match === null ? -1 : choices.indexOf(match);
}
