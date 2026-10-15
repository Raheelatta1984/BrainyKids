// Exercises the two rules this app promises families:
//
//   1. No level is ever locked. A child can open any level, in any order, carry
//      on an unfinished level where they stopped, and start one again — without
//      losing points, screen time or money.
//   2. Rewards are real money in any currency in the world, or Robux (Roblox's
//      own currency). Cryptocurrency is never offered and never accepted.
//
// Run it with `npm run levels-selftest`. It touches no files and no database.

import { QUESTIONS } from "../src/lib/quiz-data";
import { MAX_LEVEL, levelProgress, levelToResume, tierForLevel, tracksForAge, unfinishedLevels } from "../src/lib/quiz-logic";
import { CRYPTO_CODES, currencyOptions, formatReward, isCurrencyCode, isCryptoCode, sanitiseCurrency, currencyInfo } from "../src/lib/rewards";
import { resolveSettings } from "../src/lib/settings";
import { createKidRecord, openLevel, recordAnswer, type CreateKidInput } from "../src/lib/server/service";
import { emptyDoc, newId, type DbDoc, type KidRecord } from "../src/lib/server/store";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function child(doc: DbDoc, age = 9): KidRecord {
  const input: CreateKidInput = {
    name: "Test Child",
    age,
    gender: "prefer-not-to-say",
    theme: "space",
    username: `test${newId().slice(0, 6)}`,
    pinHash: "x",
  };
  return createKidRecord(doc, newId(), input);
}

function questionFor(kid: KidRecord, level: number) {
  const tracks = tracksForAge(kid.age);
  const tier = tierForLevel(level, tracks);
  return QUESTIONS.find((q) => q.level === tier && tracks.includes(q.track))!;
}

console.log("\nLevels: every level is open, in any order");

{
  const doc = emptyDoc();
  doc.settings = {} as DbDoc["settings"];
  const kid = child(doc);

  // A brand-new child (best level 1) can answer Level 40 straight away.
  const far = 40;
  const question = questionFor(kid, far);
  const answered = recordAnswer(doc, kid, question.id, question.answer, far, { elapsedSeconds: 0 });
  check("a level far above the child's best level can be answered", answered !== null && answered.correct);
  check("nothing was refused for being 'locked'", doc.behaviour.every((line) => line.code !== "quiz.answer_rejected"));
  check("the answer counted against that level only", (kid.usedByLevel[String(far)] ?? []).length === 1);
  check("the best level only moves when a level is finished", kid.unlockedLevel === 1);
  check("finishing that level moves the best level to 41", (() => {
    let done = false;
    let guard = 0;
    while (!done && guard++ < 50) {
      const next = QUESTIONS.find((q) => q.level === 3 && tracksForAge(kid.age).includes(q.track) && !(kid.usedByLevel[String(far)] ?? []).includes(q.id));
      if (!next) break;
      recordAnswer(doc, kid, next.id, next.answer, far, { elapsedSeconds: 0 });
      done = kid.unlockedLevel === far + 1;
    }
    return done;
  })());

  // Going back to an earlier, unfinished level is allowed and keeps what was answered.
  const back = openLevel(doc, kid, 3, "start");
  check("a child can go back to an earlier unfinished level", back.level === 3 && kid.level === 3);
  check("opening a level keeps the answers already given there", back.done === levelProgress(kid, 3).done);
}

console.log("\nResume: an unfinished level carries on where it stopped");

{
  const doc = emptyDoc();
  const kid = child(doc);
  const level = 2;
  const pool = QUESTIONS.filter((q) => q.level === tierForLevel(level, tracksForAge(kid.age)) && tracksForAge(kid.age).includes(q.track));
  recordAnswer(doc, kid, pool[0].id, "definitely wrong", level, { elapsedSeconds: 0 });

  const progress = levelProgress(kid, level);
  check("the level reads as in progress", progress.status === "in-progress" && progress.done === 1);
  const resume = levelToResume(kid);
  check("the picker offers exactly that level to carry on", resume !== null && resume.level === level && resume.done === 1);
  check("the unfinished level is listed for the parent", unfinishedLevels(kid).some((entry) => entry.level === level));

  const nextQuestionIds = pool.filter((q) => !(kid.usedByLevel[String(level)] ?? []).includes(q.id)).map((q) => q.id);
  check("only unanswered questions are left in it", nextQuestionIds.length === pool.length - 1);
}

console.log("\nRestart: one level starts again, nothing else is touched");

{
  const doc = emptyDoc();
  const kid = child(doc);
  const level = 1;
  const question = questionFor(kid, level);
  recordAnswer(doc, kid, question.id, question.answer, level, { elapsedSeconds: 0 });
  const pointsBefore = kid.points;
  const walletBefore = kid.walletBalanceMinor ?? 0;

  const outcome = openLevel(doc, kid, level, "restart");
  check("the restart reports what it cleared", outcome.cleared === 1);
  check("the level has no answers left", (kid.usedByLevel[String(level)] ?? []).length === 0);
  check("the question can be asked again", levelProgress(kid, level).done === 0);
  check("points are kept", kid.points === pointsBefore);
  check("money is kept", (kid.walletBalanceMinor ?? 0) === walletBefore);
  check("the restart is written to the behavioural log", doc.behaviour.some((line) => line.code === "quiz.level_restarted"));
  check("the wallet ledger was not touched", doc.rewards.length === 0 || doc.rewards.every((entry) => entry.type !== "realise_approved"));
}

console.log("\nYoung children: every level still has questions");

{
  const tracks = tracksForAge(4);
  const tier = tierForLevel(9, tracks);
  const hasQuestions = QUESTIONS.some((q) => q.level === tier && tracks.includes(q.track));
  check("Level 9 has questions for a four-year-old", hasQuestions, `tier ${tier}`);
  check("the level number is capped", MAX_LEVEL === 999);
}

console.log("\nRewards: every world currency, or Robux — never cryptocurrency");

{
  const all = currencyOptions();
  const codes = new Set(all.map((c) => c.code));
  const wanted = ["AUD", "USD", "GBP", "EUR", "INR", "PKR", "AED", "JPY", "KWD", "NGN", "BRL", "CNY", "SGD", "ZAR"];
  check(`every currency in the world is offered (${all.length} of them)`, all.length >= 150);
  check("the familiar ones are all there", wanted.every((code) => codes.has(code)));
  check(
    "no cryptocurrency is in the list",
    all.every((c) => !isCryptoCode(c.code)),
  );
  check("no metal or unit-of-account code sneaks in", !codes.has("XAU") && !codes.has("XDR") && !codes.has("XXX"));

  check("a crypto code is refused by the API gate", !isCurrencyCode("BTC") && !isCurrencyCode("USDT") && !isCurrencyCode("ETH"));
  check("a crypto code cannot be stored through a hand-written setting", sanitiseCurrency("BTC") === "AUD");
  check("an unknown currency is refused by the API gate", !isCurrencyCode("ZZZ") && !isCurrencyCode("1234"));
  check("a real currency is accepted", isCurrencyCode("AUD") && isCurrencyCode("jpy"));
  check("the crypto list is documented", CRYPTO_CODES.has("DOGE") && CRYPTO_CODES.has("SOL"));

  // Intl separates a code from its amount with a non-breaking space, which is
  // what a screen should show; the check normalises it.
  const shown = (amountMinor: number, kind: "money" | "robux", code: string) =>
    formatReward(amountMinor, kind, code).replace(/\u00a0/g, " ");

  check("dollars keep cents", shown(50, "money", "AUD") === "A$0.50", shown(50, "money", "AUD"));
  check("yen has no cents", shown(50, "money", "JPY") === "¥50", shown(50, "money", "JPY"));
  check("dinars keep three decimals", shown(50, "money", "KWD") === "KWD 0.050", shown(50, "money", "KWD"));
  check("Robux is Roblox's currency and reads plainly", formatReward(50, "robux", "AUD") === "50 Robux");
  check("currencyInfo knows the smallest unit", currencyInfo("JPY").decimals === 0 && currencyInfo("AUD").decimals === 2);

  const settings = resolveSettings({ currency: "BTC", rewardKind: "robux" });
  check("a stored crypto setting falls back to a real currency", settings.currency === "AUD" && settings.rewardKind === "robux");
  const kept = resolveSettings({ currency: "JPY" });
  check("a stored world currency is kept as it is", kept.currency === "JPY");
}

console.log(
  failures === 0
    ? "\nAll level and currency checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
