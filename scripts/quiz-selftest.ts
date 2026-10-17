// Focused checks for fresh questions, curriculum targeting, Hindi translation,
// and approval requests returning to their original kid-owned balances.

import { localiseQuestion } from "../src/lib/quiz-i18n";
import { generateQuestion } from "../src/lib/question-engine";
import { educationStagesForCountry, resolveEducationStage } from "../src/lib/curriculum";
import { resolveSettings } from "../src/lib/settings";
import {
  createKidRecord,
  issueNextQuestion,
  openLevel,
  recordAnswer,
  requestRealisation,
  requestScreenTime,
  resolveRealisation,
  resolveScreenTime,
  type CreateKidInput,
} from "../src/lib/server/service";
import { emptyDoc, newId, type DbDoc, type KidRecord } from "../src/lib/server/store";

let failures = 0;
function check(label: string, pass: boolean): void {
  console.log(`${pass ? "  ✓" : "  ✗"} ${label}`);
  if (!pass) failures += 1;
}

function child(doc: DbDoc, parentId: string, age = 10, gender: CreateKidInput["gender"] = "prefer-not-to-say"): KidRecord {
  const input: CreateKidInput = {
    name: "Sam",
    age,
    gender,
    theme: "space",
    username: `kid${newId().slice(0, 6)}`,
    pinHash: "test",
  };
  return createKidRecord(doc, parentId, input);
}

const parentId = newId();
const doc = emptyDoc();
doc.settings[parentId] = resolveSettings({ curriculumCountry: "PK", educationStage: "o-level" });
const kid = child(doc, parentId, 14);

console.log("\nFresh questions never repeat across levels or restarts");
const first = issueNextQuestion(doc, kid, 1);
const retry = issueNextQuestion(doc, kid, 1);
check("a retry resumes the already-issued question", first !== null && retry?.id === first.id);
if (first) recordAnswer(doc, kid, first.id, kid.activeQuestionsByLevel["1"]?.answer ?? "", 1, { elapsedSeconds: 0 });
const acrossLevels = issueNextQuestion(doc, kid, 2);
check("a higher level gets a different question ID", first !== null && acrossLevels !== null && first.id !== acrossLevels.id);
check("a higher level gets different question wording", first !== null && acrossLevels !== null && first.question !== acrossLevels.question);
if (acrossLevels) recordAnswer(doc, kid, acrossLevels.id, kid.activeQuestionsByLevel["2"]?.answer ?? "", 2, { elapsedSeconds: 0 });
const countBeforeRestart = kid.askedQuestionIds.length;
openLevel(doc, kid, 2, "restart");
const afterRestart = issueNextQuestion(doc, kid, 2);
check("restart never replays a previously shown question", afterRestart !== null && !kid.askedQuestionIds.slice(0, countBeforeRestart).includes(afterRestart.id));
check("all generated question prompts so far are unique", new Set([first?.question, retry?.question, acrossLevels?.question, afterRestart?.question].filter(Boolean)).size === 3);

console.log("\nCountry, stage, age, gender and Hindi language fit");
const oLevelDoc = emptyDoc();
const oLevelParent = newId();
oLevelDoc.settings[oLevelParent] = resolveSettings({ curriculumCountry: "PK", educationStage: "o-level" });
const oLevelKid = child(oLevelDoc, oLevelParent, 14);
const oLevel = issueNextQuestion(oLevelDoc, oLevelKid, 1);
check("Pakistan master curriculum produces O-Level exam content", oLevel !== null && oLevel.track === "selective" && oLevel.topic === "Algebra");
check("raising the progression level raises question difficulty", generateQuestion(0, 1, {
  age: 14,
  gender: "prefer-not-to-say",
  name: "Sam",
  curriculumCountry: "PK",
  educationStage: "o-level",
}).question !== generateQuestion(0, 20, {
  age: 14,
  gender: "prefer-not-to-say",
  name: "Sam",
  curriculumCountry: "PK",
  educationStage: "o-level",
}).question);
const hindi = oLevel ? localiseQuestion(oLevel as any, "hi") : null;
check("generated questions have a Hindi translation", hindi !== null && hindi.translated && hindi.question.startsWith("पहेली"));

const autoDoc = emptyDoc();
const autoParent = newId();
autoDoc.settings[autoParent] = resolveSettings({ curriculumCountry: "IN", educationStage: "auto" });
const preschooler = child(autoDoc, autoParent, 4, "girl");
const early = issueNextQuestion(autoDoc, preschooler, 1);
check("automatic stage selects early-years questions for a four-year-old", early !== null && early.track === "early");
const sameAgeBoy = child(autoDoc, autoParent, 4, "boy");
const girlQuestion = early;
const boyQuestion = issueNextQuestion(autoDoc, sameAgeBoy, 1);
check("gender does not stereotype or change academic difficulty", girlQuestion !== null && boyQuestion !== null && girlQuestion.question === boyQuestion.question);

const middleSettings = resolveSettings({ curriculumCountry: "US", educationStage: "middle-school" });
const spellingProbe = generateQuestion(7, 1, {
  age: 12,
  gender: "prefer-not-to-say",
  name: "Sam",
  curriculumCountry: middleSettings.curriculumCountry,
  educationStage: middleSettings.educationStage,
});
check("US curriculum uses US spelling in language practice", spellingProbe.question.includes("United States English") && spellingProbe.answer === "color");
check("grade choices follow the selected country", [
  educationStagesForCountry("PK").some((stage) => stage.value === "PK-Class-12"),
  educationStagesForCountry("IN").some((stage) => stage.value === "IN-Class-11"),
  educationStagesForCountry("US").some((stage) => stage.value === "US-Grade-8"),
  educationStagesForCountry("AU").some((stage) => stage.value === "AU-Year-6"),
].every(Boolean));
check("a selected US Grade 8 maps to middle-school questions", resolveEducationStage(13, "US-Grade-8", "US") === "middle-school");
check("country-specific grade labels map to expected progression stages", resolveEducationStage(11, "AU-Year-6", "AU") === "primary" && resolveEducationStage(17, "GB-Year-12", "GB") === "a-level");
const overrideDoc = emptyDoc();
const overrideParent = newId();
overrideDoc.settings[overrideParent] = resolveSettings({ curriculumCountry: "PK", educationStage: "o-level" });
const overrideKid = child(overrideDoc, overrideParent, 14);
overrideKid.curriculumCountry = "US";
overrideKid.educationStage = "US-Grade-3";
const overrideQuestion = issueNextQuestion(overrideDoc, overrideKid, 1);
check("a child's US grade override takes precedence over the Pakistan family master setting", overrideQuestion?.topic === "Addition" && overrideQuestion.templateValues?.country === "US");

console.log("\nDeclined approvals return to the child's pre-request state");
kid.points = 5;
const screenRequest = requestScreenTime(doc, kid);
check("a pending screen-time request does not remove points", screenRequest === 5 && kid.points === 5 && kid.requestedMinutes === 5);
resolveScreenTime(doc, kid, "decline");
check("sending back screen time leaves all points available", kid.requestedMinutes === 0 && kid.points === 5);
requestScreenTime(doc, kid);
resolveScreenTime(doc, kid, "approve");
check("approved screen time deducts points only when approved", kid.points === 0 && kid.approvedMinutes === 5);

kid.walletBalanceMinor = 850;
const rewardRequest = requestRealisation(doc, kid);
check("requesting a payout does not change the wallet", rewardRequest === 850 && kid.walletBalanceMinor === 850);
resolveRealisation(doc, kid, "decline");
check("sending back a payout restores the ready-to-request state", kid.requestedRewardMinor === 0 && kid.walletBalanceMinor === 850);
requestRealisation(doc, kid);
resolveRealisation(doc, kid, "approve");
check("wallet balance changes only after approval", kid.walletBalanceMinor === 0 && kid.totalRealisedMinor === 850);

console.log(failures === 0 ? "\nAll quiz and approval checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
