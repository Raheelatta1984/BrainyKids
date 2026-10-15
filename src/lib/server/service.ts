import { newToken, tokenHash } from "./auth";
import { HEARTBEAT_MS } from "./constants";
import { recordBehaviour } from "./diagnostics";
import { appendChat, appendReward, newId, pushEvent, type ChatRecord, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord } from "./store";
import { addActivity, earnedSums, MAX_CHAT_CHARS, markChatSeen, settingsForKid } from "./views";
import type { Gender, Level, LevelAction, Theme } from "@/lib/types";
import { answerScorePercent, levelProgress, levelQuestionCount, matchesAnswer } from "@/lib/quiz-logic";
import { generateQuestion } from "@/lib/question-engine";
import { resolveSettings } from "@/lib/settings";
import { correctAnswerRewardMinor, difficultyForQuestion, earningAllowedAt, formatReward, timeLimitSeconds, wrongAnswerDeductionMinor } from "@/lib/rewards";

export type CreateKidInput = {
  name: string;
  age: number;
  gender: Gender;
  theme: Theme;
  username: string;
  pinHash: string;
};

export function findKidByUsername(doc: DbDoc, username: string): KidRecord | null {
  const wanted = username.trim().toLowerCase();
  return doc.kids.find((k) => k.username === wanted) ?? null;
}

export function createKidRecord(doc: DbDoc, parentId: string, input: CreateKidInput): KidRecord {
  const kid: KidRecord = {
    id: newId(),
    parentId,
    name: input.name,
    username: input.username,
    pinHash: input.pinHash,
    age: input.age,
    gender: input.gender,
    curriculumCountry: null,
    educationStage: null,
    theme: input.theme,
    level: 1,
    unlockedLevel: 1,
    usedByLevel: {},
    askedQuestionIds: [],
    nextQuestionSequence: 0,
    activeQuestionsByLevel: {},
    points: 0,
    attempted: 0,
    correct: 0,
    requestedMinutes: 0,
    approvedMinutes: 0,
    walletBalanceMinor: 0,
    requestedRewardMinor: 0,
    lifetimeEarnedMinor: 0,
    totalRealisedMinor: 0,
    createdAt: Date.now(),
    lastSeenAt: null,
    activity: [],
  };
  doc.kids.push(kid);
  return kid;
}

export function parentOfKid(doc: DbDoc, kid: KidRecord): ParentRecord | undefined {
  return doc.parents.find((p) => p.id === kid.parentId);
}

/**
 * Links a kid profile to the device making the request and returns its cookie
 * token. A caller that already made a token (the fingerprint sign-in path, which
 * has to prepare the cookie before the mutation runs) can pass it in.
 */
export function linkDevice(
  doc: DbDoc,
  kid: KidRecord,
  label: string,
  token: string = newToken(),
): { device: DeviceRecord; token: string } {
  const device: DeviceRecord = {
    id: newId(),
    parentId: kid.parentId,
    kidId: kid.id,
    tokenHash: tokenHash(token),
    label,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  doc.devices.push(device);
  kid.lastSeenAt = Date.now();
  addActivity(kid, { kind: "device", text: `${label} signed in as ${kid.name}` });
  return { device, token };
}

export function touchKid(kid: KidRecord, force = false): boolean {
  const now = Date.now();
  if (!force && kid.lastSeenAt && now - kid.lastSeenAt < HEARTBEAT_MS - 2_000) return false;
  kid.lastSeenAt = now;
  return true;
}

export type AnswerResult = {
  correct: boolean;
  questionId: string;
  answer: string;
  explain: string;
  topic: string;
  points: number;
  unlockedLevel: Level;
  levelFinished: boolean;
  duplicate: boolean;
  /** How close the answer was (0–100) and the real-money/Robux reward it earned. */
  scorePercent: number;
  earnedMinor: number;
  walletBalanceMinor: number;
  rewardKind: "money" | "robux";
  currency: string;
  timedOut: boolean;
  /** Why a near answer earned nothing, when it otherwise would have. */
  rewardBlocked: "timeout" | "schedule" | "daily-limit" | "weekly-limit" | null;
};

/** Earned-so-far sums from the ledger, in the family's time zone (today + this Mon–Sun week). */
function earnedSumsFromLedger(doc: DbDoc, kid: KidRecord): { today: number; week: number } {
  const sums = earnedSums(doc, kid);
  return { today: sums.today, week: sums.week };
}

/**
 * Issue the active question for one level, or create a fresh one. Issuing is
 * persisted before it is returned, so refreshes, level jumps and retries all
 * resume that exact item instead of showing a question again later.
 */
export function issueNextQuestion(doc: DbDoc, kid: KidRecord, level: Level) {
  if (!Number.isInteger(level) || level < 1 || level > 999) return null;
  const key = String(level);
  const active = kid.activeQuestionsByLevel?.[key];
  if (active) return active;

  const progress = levelQuestionCount(kid, level);
  if (progress.done >= progress.total) return null;

  const settings = settingsForKid(doc, kid);
  const profile = {
    age: kid.age,
    gender: kid.gender,
    name: kid.name,
    curriculumCountry: settings.curriculumCountry,
    educationStage: settings.educationStage,
  };
  let sequence = kid.nextQuestionSequence ?? kid.askedQuestionIds.length;
  let question = generateQuestion(sequence, level, profile);
  while (kid.askedQuestionIds.includes(question.id)) {
    sequence += 1;
    question = generateQuestion(sequence, level, profile);
  }
  kid.nextQuestionSequence = sequence + 1;
  kid.askedQuestionIds.push(question.id);
  kid.activeQuestionsByLevel = { ...kid.activeQuestionsByLevel, [key]: question };
  return question;
}

/**
 * Records an answer. The server only accepts the question it has issued to the
 * child's current level, and decides correctness, timing and rewards itself.
 */
export function recordAnswer(
  doc: DbDoc,
  kid: KidRecord,
  questionId: string,
  picked: string,
  level: Level,
  options: { elapsedSeconds?: number } = {},
): AnswerResult | null {
  const key = String(level);
  const question = kid.activeQuestionsByLevel?.[key];
  if (!question || question.id !== questionId || !kid.askedQuestionIds.includes(questionId)) return null;
  const settings = resolveSettings(doc.settings?.[kid.parentId]);
  const used = kid.usedByLevel[key] ?? [];
  const duplicate = used.includes(questionId);
  // A previously answered item can never be replayed, even after its level is
  // restarted. A restart clears progress, not the child's lifetime question history.
  if (duplicate) return null;

  const limitSeconds = timeLimitSeconds(settings, difficultyForQuestion(question));
  // Elapsed is measured on the kid device at the moment of answering, so no
  // network grace is needed — only a small allowance for the timer tick.
  const timedOut = typeof options.elapsedSeconds === "number" && options.elapsedSeconds >= limitSeconds - 0.5;
  const scorePercent = duplicate || timedOut ? 0 : answerScorePercent(picked, question.answer);
  const isListedChoice = question.choices.includes(picked.trim());
  const correct = !timedOut && (isListedChoice ? picked.trim() === question.answer : matchesAnswer(picked, question.answer));

  let earnedMinor = 0;
  let rewardBlocked: AnswerResult["rewardBlocked"] = null;
  if (!duplicate) {
    kid.usedByLevel = { ...kid.usedByLevel, [key]: [...used, questionId] };
    const activeQuestions = { ...kid.activeQuestionsByLevel };
    delete activeQuestions[key];
    kid.activeQuestionsByLevel = activeQuestions;
    kid.attempted += 1;
    kid.correct += correct ? 1 : 0;
    kid.points += correct ? 1 : 0;
    addActivity(kid, {
      kind: "answer",
      correct,
      text: timedOut ? `Time up · ${question.topic}` : correct ? `Correct · ${question.topic}` : `Tried · ${question.topic}`,
    });

    // Flat reward: every correct answer earns the same amount (A$0.05 by default).
    // Only correct answers earn; a wrong or timed-out answer takes money off below.
    const maxRewardMinor = settings.maxRewardPerQuestionMinor;
    if (correct) {
      earnedMinor = correctAnswerRewardMinor(maxRewardMinor);
      if (earnedMinor > 0) {
        if (!earningAllowedAt(settings)) {
          rewardBlocked = "schedule";
          earnedMinor = 0;
        } else {
          const sums = earnedSumsFromLedger(doc, kid);
          if (settings.dailyEarnLimitMinor > 0) {
            const remaining = settings.dailyEarnLimitMinor - sums.today;
            if (remaining <= 0) rewardBlocked = "daily-limit";
            earnedMinor = Math.min(earnedMinor, Math.max(0, remaining));
          }
          if (earnedMinor > 0 && settings.weeklyEarnLimitMinor > 0) {
            const remaining = settings.weeklyEarnLimitMinor - sums.week;
            if (remaining <= 0) rewardBlocked = "weekly-limit";
            earnedMinor = Math.min(earnedMinor, Math.max(0, remaining));
          }
        }
      }
    } else if (timedOut) {
      rewardBlocked = "timeout";
    }
    if (earnedMinor > 0) {
      kid.walletBalanceMinor = (kid.walletBalanceMinor ?? 0) + earnedMinor;
      kid.lifetimeEarnedMinor = (kid.lifetimeEarnedMinor ?? 0) + earnedMinor;
      appendReward(doc, {
        id: newId(),
        parentId: kid.parentId,
        kidId: kid.id,
        at: Date.now(),
        type: "earned",
        amountMinor: earnedMinor,
        kind: settings.rewardKind,
        currency: settings.currency,
        balanceAfterMinor: kid.walletBalanceMinor,
        questionId,
        topic: question.topic,
        level,
        scorePercent,
      });
      addActivity(kid, {
        kind: "reward",
        correct: true,
        text: `Earned ${formatReward(earnedMinor, settings.rewardKind, settings.currency)} · ${question.topic} (${scorePercent}%)`,
      });
      pushEvent(doc, {
        type: "reward.earned",
        parentId: kid.parentId,
        kidId: kid.id,
        payload: { kidName: kid.name, amountMinor: earnedMinor, scorePercent, topic: question.topic, balanceMinor: kid.walletBalanceMinor },
      });
    } else if (rewardBlocked) {
      recordBehaviour(
        doc,
        {
          code: rewardBlocked === "timeout" ? "quiz.timed_out" : "reward.blocked",
          parentId: kid.parentId,
          kidId: kid.id,
          kidName: kid.name,
          vars: { kidName: kid.name, kidId: kid.id, questionId, level, reason: rewardBlocked, scorePercent },
          context: { reason: rewardBlocked, scorePercent },
        },
        { throttleKey: `${kid.id}:${rewardBlocked}` },
      );
    }
    // Wrong or timed-out answer: 50% of the per-question amount comes off the
    // wallet (2c of 5c), never taking it below zero. Logged like every other wallet move.
    if (!correct) {
      const deductMinor = wrongAnswerDeductionMinor(maxRewardMinor);
      const before = kid.walletBalanceMinor ?? 0;
      const taken = Math.min(deductMinor, before);
      if (taken > 0) {
        kid.walletBalanceMinor = before - taken;
        appendReward(doc, {
          id: newId(),
          parentId: kid.parentId,
          kidId: kid.id,
          at: Date.now(),
          type: "deducted",
          amountMinor: taken,
          kind: settings.rewardKind,
          currency: settings.currency,
          balanceAfterMinor: kid.walletBalanceMinor,
          questionId,
          topic: question.topic,
          level,
          scorePercent,
          note: timedOut ? "Time up — half the reward is taken off" : "Wrong answer — half the reward is taken off",
        });
        addActivity(kid, {
          kind: "reward",
          correct: false,
          text: `Deducted ${formatReward(taken, settings.rewardKind, settings.currency)} · ${question.topic} (${scorePercent}%)`,
        });
      }
    }
  }
  touchKid(kid, true);

  let unlockedLevel = kid.unlockedLevel;
  let levelFinished = false;
  let bestAdvanced = false;
  if (!duplicate) {
    const { total, done } = levelQuestionCount(kid, level);
    if (total > 0 && done >= total) {
      levelFinished = true;
      // Levels never stop. Finishing any level moves the child's best level on
      // (4, 5, … 8+), whichever order the levels were played in — but it never
      // locks anything, so an unfinished earlier level is always still there.
      if (kid.unlockedLevel <= level) {
        kid.unlockedLevel = level + 1;
        unlockedLevel = kid.unlockedLevel;
        bestAdvanced = true;
        addActivity(kid, { kind: "level", text: `Finished level ${level} — best level is now ${kid.unlockedLevel}` });
      }
    }
  }

  pushEvent(doc, {
    type: "answer.recorded",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: {
      kidName: kid.name,
      questionId,
      topic: question.topic,
      correct,
      points: kid.points,
      attempted: kid.attempted,
      accuracy: kid.attempted ? Math.round((kid.correct / kid.attempted) * 100) : 0,
    },
  });
  if (levelFinished && bestAdvanced) {
    pushEvent(doc, {
      type: "level.unlocked",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, level: unlockedLevel },
    });
  }

  return {
    correct,
    questionId,
    answer: question.answer,
    explain: question.explain,
    topic: question.topic,
    points: kid.points,
    unlockedLevel,
    levelFinished,
    duplicate,
    scorePercent: duplicate ? 0 : scorePercent,
    earnedMinor,
    walletBalanceMinor: kid.walletBalanceMinor ?? 0,
    rewardKind: settings.rewardKind,
    currency: settings.currency,
    timedOut,
    rewardBlocked,
  };
}

// ---------------------------------------------------------------------------
// Realise requests: a child asks to cash out the wallet; only a parent's
// approval resets the balance to zero. Every step is written to the ledger.
// ---------------------------------------------------------------------------

export function requestRealisation(doc: DbDoc, kid: KidRecord): number {
  const balance = kid.walletBalanceMinor ?? 0;
  if (balance <= 0 || (kid.requestedRewardMinor ?? 0) > 0) return 0;
  const settings = resolveSettings(doc.settings?.[kid.parentId]);
  kid.requestedRewardMinor = balance;
  appendReward(doc, {
    id: newId(),
    parentId: kid.parentId,
    kidId: kid.id,
    at: Date.now(),
    type: "realise_requested",
    amountMinor: balance,
    kind: settings.rewardKind,
    currency: settings.currency,
    balanceAfterMinor: balance,
    note: "Waiting for a parent to approve",
  });
  addActivity(kid, { kind: "reward", text: `Asked to realise ${formatReward(balance, settings.rewardKind, settings.currency)}` });
  pushEvent(doc, {
    type: "reward.requested",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: { kidName: kid.name, amountMinor: balance },
  });
  recordBehaviour(
    doc,
    {
      code: "reward.realise_requested",
      parentId: kid.parentId,
      kidId: kid.id,
      kidName: kid.name,
      vars: { kidName: kid.name, kidId: kid.id, amount: formatReward(balance, settings.rewardKind, settings.currency) },
      context: { amountMinor: balance },
    },
    { force: true },
  );
  return balance;
}

export function resolveRealisation(doc: DbDoc, kid: KidRecord, action: "approve" | "decline"): number {
  const amount = kid.requestedRewardMinor ?? 0;
  if (amount <= 0) return 0;
  const settings = resolveSettings(doc.settings?.[kid.parentId]);
  kid.requestedRewardMinor = 0;
  if (action === "approve") {
    // Approval is the moment the wallet resets: the money is now the child's.
    kid.walletBalanceMinor = Math.max(0, (kid.walletBalanceMinor ?? 0) - amount);
    kid.totalRealisedMinor = (kid.totalRealisedMinor ?? 0) + amount;
    appendReward(doc, {
      id: newId(),
      parentId: kid.parentId,
      kidId: kid.id,
      at: Date.now(),
      type: "realise_approved",
      amountMinor: amount,
      kind: settings.rewardKind,
      currency: settings.currency,
      balanceAfterMinor: kid.walletBalanceMinor,
      note: "Approved by a parent — wallet reset",
    });
    addActivity(kid, { kind: "reward", text: `Realised ${formatReward(amount, settings.rewardKind, settings.currency)} — wallet reset` });
  } else {
    appendReward(doc, {
      id: newId(),
      parentId: kid.parentId,
      kidId: kid.id,
      at: Date.now(),
      type: "realise_declined",
      amountMinor: amount,
      kind: settings.rewardKind,
      currency: settings.currency,
      balanceAfterMinor: kid.walletBalanceMinor ?? 0,
      note: "Sent back by a parent — balance kept",
    });
    addActivity(kid, { kind: "reward", text: `Realise request for ${formatReward(amount, settings.rewardKind, settings.currency)} sent back` });
  }
  pushEvent(doc, {
    type: action === "approve" ? "reward.approved" : "reward.declined",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: { kidName: kid.name, amountMinor: amount, balanceMinor: kid.walletBalanceMinor ?? 0 },
  });
  recordBehaviour(
    doc,
    {
      code: action === "approve" ? "reward.realise_approved" : "reward.realise_declined",
      parentId: kid.parentId,
      kidId: kid.id,
      kidName: kid.name,
      vars: { kidName: kid.name, kidId: kid.id, amount: formatReward(amount, settings.rewardKind, settings.currency) },
      context: { amountMinor: amount },
    },
    { force: true },
  );
  return amount;
}

export function requestScreenTime(doc: DbDoc, kid: KidRecord): number {
  const minutes = kid.points;
  if (minutes <= 0 || kid.requestedMinutes > 0) return 0;
  // Keep the points until a parent approves. Sending the request back simply
  // clears the pending amount, so the kid's original points are still there.
  kid.requestedMinutes = minutes;
  addActivity(kid, { kind: "screen-time", text: `Asked for ${minutes} min of screen time` });
  pushEvent(doc, {
    type: "screen_time.requested",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: { kidName: kid.name, minutes: kid.requestedMinutes },
  });
  return minutes;
}

export function resolveScreenTime(doc: DbDoc, kid: KidRecord, action: "approve" | "decline" | "grant", minutes?: number): number {
  let amount = 0;
  if (action === "approve") {
    amount = Math.min(kid.requestedMinutes, kid.points);
    kid.points = Math.max(0, kid.points - amount);
    kid.approvedMinutes += amount;
    kid.requestedMinutes = 0;
    if (amount > 0) addActivity(kid, { kind: "screen-time", text: `Screen time approved: ${amount} min` });
    pushEvent(doc, {
      type: "screen_time.approved",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, minutes: amount, approvedMinutes: kid.approvedMinutes },
    });
  } else if (action === "decline") {
    amount = kid.requestedMinutes;
    kid.requestedMinutes = 0;
    // Points were never taken out of the wallet. The child can submit the same
    // amount again (or use any additional points earned while it was pending).
    addActivity(kid, { kind: "screen-time", text: `Screen time request sent back: ${amount} min remain in points` });
    pushEvent(doc, {
      type: "screen_time.declined",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, minutes: amount, pointsAvailable: kid.points },
    });
  } else {
    amount = Math.max(0, Math.min(120, Math.round(minutes ?? 0)));
    kid.approvedMinutes += amount;
    if (amount > 0) addActivity(kid, { kind: "screen-time", text: `Bonus screen time: ${amount} min` });
    pushEvent(doc, {
      type: "screen_time.granted",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, minutes: amount, approvedMinutes: kid.approvedMinutes },
    });
  }
  return amount;
}

// ---------------------------------------------------------------------------
// Levels: every level is open, in any order, for as long as the child likes.
// ---------------------------------------------------------------------------

export type LevelOutcome = {
  /** The level the child is on now. */
  level: Level;
  /** What they asked for. */
  action: LevelAction;
  total: number;
  done: number;
  /** Answers cleared by a restart (0 for a plain open). */
  cleared: number;
  /** True when this level already had every question answered. */
  wasComplete: boolean;
  unlockedLevel: Level;
};

/**
 * Opens a level for a child.
 *
 * `start` (the default) simply moves the child to that level and keeps every
 * answer already given there, so an unfinished level carries on from where it
 * stopped — that is the “resume” a child gets by tapping a level again.
 *
 * `restart` clears the answered progress for that one level and discards its
 * active item; lifetime question history is kept so the new run gets fresh
 * questions. Points, screen time and the wallet are untouched, and a note goes
 * into the behavioural log so a parent can see a level was started over.
 *
 * Nothing here can be refused for being “too high” — that is the point.
 */
export function openLevel(doc: DbDoc, kid: KidRecord, level: Level, action: LevelAction = "start"): LevelOutcome {
  const before = levelProgress(kid, level);
  const key = String(level);
  let cleared = 0;
  if (action === "restart") {
    cleared = (kid.usedByLevel[key] ?? []).length;
    kid.usedByLevel = { ...kid.usedByLevel, [key]: [] };
    // The active item has already been shown, so discard it but keep its ID in
    // lifetime history. The next request will generate a different question.
    const activeQuestions = { ...kid.activeQuestionsByLevel };
    delete activeQuestions[key];
    kid.activeQuestionsByLevel = activeQuestions;
  }
  kid.level = level;
  touchKid(kid, true);

  const after = levelProgress(kid, level);
  if (action === "restart") {
    addActivity(kid, {
      kind: "level",
      text: `Started level ${level} again from the first question${
        before.status === "complete" ? " (it had been finished)" : ""
      }`,
    });
    recordBehaviour(
      doc,
      {
        code: "quiz.level_restarted",
        parentId: kid.parentId,
        kidId: kid.id,
        kidName: kid.name,
        vars: {
          kidName: kid.name,
          kidId: kid.id,
          level,
          cleared,
          total: after.total,
          kidLevel: level,
          wasComplete: before.status === "complete" ? "yes" : "no",
        },
        context: { level, cleared, total: after.total, wasComplete: before.status === "complete" },
      },
      { throttleKey: `${kid.id}:${level}:restart` },
    );
  }

  pushEvent(doc, {
    type: "kid.updated",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: { kidName: kid.name, level, done: after.done, total: after.total, action },
  });

  return {
    level,
    action,
    total: after.total,
    done: after.done,
    cleared,
    wasComplete: before.status === "complete",
    unlockedLevel: kid.unlockedLevel,
  };
}

export type SendChatResult = { ok: true; message: ChatRecord } | { ok: false; error: string };

/**
 * Sends one chat message between a parent and a child. A “voice note” is the
 * same text, dictated on the sender's device by speaking (kind: "voice"), so the
 * other side can read it and have it read out loud — no audio files to store.
 */
export function sendChatMessage(
  doc: DbDoc,
  kid: KidRecord,
  from: "parent" | "kid",
  text: string,
  kind: "text" | "voice" = "text",
): SendChatResult {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "Type or say something first." };
  if (clean.length > MAX_CHAT_CHARS) return { ok: false, error: `Messages can be up to ${MAX_CHAT_CHARS} characters.` };
  const message: ChatRecord = {
    id: newId(),
    parentId: kid.parentId,
    kidId: kid.id,
    from,
    text: clean,
    kind,
    at: Date.now(),
    seen: false,
  };
  appendChat(doc, message);
  kid.lastSeenAt = from === "kid" ? message.at : kid.lastSeenAt;
  addActivity(kid, {
    kind: "cheer",
    text: from === "parent" ? `You sent: “${clean}”` : `${kid.name} said: “${clean}”`,
  });
  pushEvent(doc, {
    type: "chat.message",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: {
      kidName: kid.name,
      messageId: message.id,
      from,
      text: clean,
      kind,
      at: message.at,
    },
  });
  return { ok: true, message };
}

/** Marks the other side's messages as seen when a chat panel is open. */
export function markChatRead(doc: DbDoc, kid: KidRecord, viewer: "parent" | "kid"): number {
  const changed = markChatSeen(doc, kid.id, viewer);
  if (changed > 0) {
    pushEvent(doc, {
      type: "chat.message",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, seenBy: viewer, count: changed },
    });
  }
  return changed;
}

export function sendCheer(doc: DbDoc, kid: KidRecord, message: string) {
  addActivity(kid, { kind: "cheer", text: `Parent sent: “${message}”` });
  pushEvent(doc, {
    type: "cheer.sent",
    parentId: kid.parentId,
    kidId: kid.id,
    payload: { kidName: kid.name, message },
  });
}

export function unlinkDevice(doc: DbDoc, device: DeviceRecord) {
  doc.devices = doc.devices.filter((d) => d.id !== device.id);
  const kid = doc.kids.find((k) => k.id === device.kidId);
  if (kid) {
    addActivity(kid, { kind: "device", text: `${device.label} signed out` });
    pushEvent(doc, {
      type: "device.unlinked",
      parentId: device.parentId,
      kidId: device.kidId,
      payload: { kidName: kid.name, deviceId: device.id, label: device.label },
    });
  }
}
