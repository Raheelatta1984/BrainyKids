// Exercises the two rules this app promises families:
//
//   1. No level is ever locked. A child can open any level, in any order, carry
//      on an unfinished level where they stopped, and start one again — without
//      losing points, screen time or money.
//   2. Rewards are real money in any currency in the world, or Robux (Roblox's
//      own currency). Cryptocurrency is never offered and never accepted.
//
// Run it with `npm run levels-selftest`. It touches no files and no database.

import { MAX_LEVEL, levelProgress, levelToResume, unfinishedLevels } from "../src/lib/quiz-logic";
import { CRYPTO_CODES, currencyOptions, formatReward, isCurrencyCode, isCryptoCode, sanitiseCurrency, currencyInfo } from "../src/lib/rewards";
import { resolveSettings } from "../src/lib/settings";
import { createKidRecord, issueNextQuestion, openLevel, recordAnswer, type CreateKidInput } from "../src/lib/server/service";
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

console.log("\nLevels: every level is open, in any order");

{
  const doc = emptyDoc();
  doc.settings = {} as DbDoc["settings"];
  const kid = child(doc);

  // A brand-new child (best level 1) can answer Level 40 straight away.
  const far = 40;
  const question = issueNextQuestion(doc, kid, far);
  const answered = question ? recordAnswer(doc, kid, question.id, kid.activeQuestionsByLevel[String(far)]?.answer ?? "", far, { elapsedSeconds: 0 }) : null;
  check("a level far above the child's best level can be answered", answered !== null && answered.correct);
  check("nothing was refused for being 'locked'", doc.behaviour.every((line) => line.code !== "quiz.answer_rejected"));
  check("the answer counted against that level only", (kid.usedByLevel[String(far)] ?? []).length === 1);
  check("the best level only moves when a level is finished", kid.unlockedLevel === 1);
  check("finishing that level moves the best level to 41", (() => {
    let done = false;
    let guard = 0;
    while (!done && guard++ < 50) {
      const next = issueNextQuestion(doc, kid, far);
      if (!next) break;
      recordAnswer(doc, kid, next.id, kid.activeQuestionsByLevel[String(far)]?.answer ?? "", far, { elapsedSeconds: 0 });
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
  const first = issueNextQuestion(doc, kid, level);
  if (first) recordAnswer(doc, kid, first.id, "definitely wrong", level, { elapsedSeconds: 0 });
  const resumed = issueNextQuestion(doc, kid, level);

  const progress = levelProgress(kid, level);
  check("the level reads as in progress", progress.status === "in-progress" && progress.done === 1);
  check("the shown question is not reused when resuming", first !== null && resumed !== null && first.id !== resumed.id);
  const resume = levelToResume(kid);
  check("the picker offers exactly that level to carry on", resume !== null && resume.level === level && resume.done === 1);
  check("the unfinished level is listed for the parent", unfinishedLevels(kid).some((entry) => entry.level === level));

  check("answered progress is tracked separately from the one active fresh question", (kid.usedByLevel[String(level)] ?? []).length === 1 && resumed !== null && (kid.activeQuestionsByLevel[String(level)]?.id ?? "") === resumed.id);
}

console.log("\nRestart: one level starts again, nothing else is touched");

{
  const doc = emptyDoc();
  const kid = child(doc);
  const level = 1;
  const question = issueNextQuestion(doc, kid, level);
  if (question) recordAnswer(doc, kid, question.id, kid.activeQuestionsByLevel[String(level)]?.answer ?? "", level, { elapsedSeconds: 0 });
  const pointsBefore = kid.points;
  const walletBefore = kid.walletBalanceMinor ?? 0;

  const outcome = openLevel(doc, kid, level, "restart");
  const freshQuestion = issueNextQuestion(doc, kid, level);
  check("the restart reports what it cleared", outcome.cleared === 1);
  check("the level has no answers left", (kid.usedByLevel[String(level)] ?? []).length === 0);
  check("the restarted level receives a fresh question, never the old one", question !== null && freshQuestion !== null && question.id !== freshQuestion.id);
  check("the global question history remains intact", kid.askedQuestionIds.length === 2);
  check("points are kept", kid.points === pointsBefore);
  check("money is kept", (kid.walletBalanceMinor ?? 0) === walletBefore);
  check("the restart is written to the behavioural log", doc.behaviour.some((line) => line.code === "quiz.level_restarted"));
  check("the wallet ledger was not touched", doc.rewards.length === 0 || doc.rewards.every((entry) => entry.type !== "realise_approved"));
}

console.log("\nYoung children: every level still has age-appropriate questions");

{
  const doc = emptyDoc();
  const young = child(doc, 4);
  const question = issueNextQuestion(doc, young, 9);
  check("Level 9 generates an early-years question for a four-year-old", question !== null && question.track === "early");
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
