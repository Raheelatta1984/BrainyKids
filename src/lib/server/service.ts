import { newToken, tokenHash } from "./auth";
import { HEARTBEAT_MS } from "./constants";
import { appendChat, newId, pushEvent, type ChatRecord, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord } from "./store";
import { addActivity, MAX_CHAT_CHARS, markChatSeen } from "./views";
import type { Gender, Level, Theme } from "@/lib/types";
import { QUESTIONS } from "@/lib/quiz-data";
import { levelQuestionCount, matchesAnswer, tracksForAge } from "@/lib/quiz-logic";

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
    theme: input.theme,
    level: 1,
    unlockedLevel: 1,
    usedByLevel: {},
    points: 0,
    attempted: 0,
    correct: 0,
    requestedMinutes: 0,
    approvedMinutes: 0,
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
};

/**
 * Records an answer. Correctness is decided on the server from the question
 * bank so a device cannot simply claim points.
 */
export function recordAnswer(doc: DbDoc, kid: KidRecord, questionId: string, picked: string, level: Level): AnswerResult | null {
  const question = QUESTIONS.find((q) => q.id === questionId);
  if (!question) return null;
  if (question.level !== level) return null;
  // Levels still locked for this child cannot be answered, so points cannot be farmed early.
  if (level > kid.unlockedLevel) return null;
  if (!tracksForAge(kid.age).includes(question.track)) return null;
  const key = String(level);
  const used = kid.usedByLevel[key] ?? [];
  const duplicate = used.includes(questionId);
  const correct = matchesAnswer(picked, question.answer) || picked.trim() === question.answer;

  if (!duplicate) {
    kid.usedByLevel = { ...kid.usedByLevel, [key]: [...used, questionId] };
    kid.attempted += 1;
    kid.correct += correct ? 1 : 0;
    kid.points += correct ? 1 : 0;
    addActivity(kid, {
      kind: "answer",
      correct,
      text: correct ? `Correct · ${question.topic}` : `Tried · ${question.topic}`,
    });
  }
  touchKid(kid, true);

  let unlockedLevel = kid.unlockedLevel;
  let levelFinished = false;
  if (!duplicate) {
    const { total, done } = levelQuestionCount(kid, level);
    if (done >= total) {
      levelFinished = true;
      if (level < 3 && kid.unlockedLevel <= level) {
        kid.unlockedLevel = (level + 1) as Level;
        unlockedLevel = kid.unlockedLevel;
        addActivity(kid, { kind: "level", text: `Finished level ${level} and unlocked level ${kid.unlockedLevel}` });
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
  if (levelFinished && unlockedLevel !== level) {
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
  };
}

export function requestScreenTime(doc: DbDoc, kid: KidRecord): number {
  const minutes = kid.points;
  if (minutes <= 0) return 0;
  kid.requestedMinutes += minutes;
  kid.points = 0;
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
    amount = kid.requestedMinutes;
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
    addActivity(kid, { kind: "screen-time", text: "Screen time request sent back" });
    pushEvent(doc, {
      type: "screen_time.declined",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, minutes: amount },
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
