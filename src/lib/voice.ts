"use client";

// Voice over: reading text out loud and listening to a spoken message.
//
// The browser does the work (speech synthesis and speech recognition), so there
// is nothing to upload and no audio files to store: a spoken message becomes
// text the moment it is understood, which is what lets a parent read it and a
// child hear it. Everything that fails here is written to the behavioural log so
// “voice did not work on this device” is never a mystery.

import { localeInfo } from "./settings";
import type { LocaleCode } from "./types";
import { reportBehaviour } from "./client/diagnostics";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

/** The spoken form of a language, for example “ur-PK”. */
export function speechLang(locale: LocaleCode | string | undefined | null): string {
  return localeInfo(locale).speech;
}

/** Reads text out loud in the family's language. Returns false when it cannot. */
export function speakText(text: string, locale: LocaleCode | string | undefined | null, onDone?: () => void): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (!speechSupported()) {
    reportBehaviour("chat.voice_missing", {
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 200),
      platform: typeof navigator === "undefined" ? "" : navigator.platform,
    });
    onDone?.();
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = speechLang(locale);
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    const voice = pickVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    utterance.onend = () => onDone?.();
    utterance.onerror = () => onDone?.();
    window.speechSynthesis.speak(utterance);
    reportBehaviour("chat.voice_played", { locale: utterance.lang, chars: clean.length });
    return true;
  } catch {
    onDone?.();
    return false;
  }
}

/** A voice that actually speaks the chosen language, when the device has one. */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const exact = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase());
    if (exact) return exact;
    const base = lang.split("-")[0].toLowerCase();
    return voices.find((voice) => voice.lang.toLowerCase().startsWith(base)) ?? null;
  } catch {
    return null;
  }
}

export function stopSpeaking() {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to stop */
  }
}

export type ListenHandle = { stop: () => void };

/**
 * Listens once and calls `onText` with what was understood. Returns null when the
 * browser cannot listen (the caller hides the microphone button in that case).
 */
export function listenOnce(options: {
  locale: LocaleCode | string | undefined | null;
  onText: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}): ListenHandle | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    reportBehaviour("chat.listen_missing", {
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 200),
      platform: typeof navigator === "undefined" ? "" : navigator.platform,
      protocol: typeof window === "undefined" ? "" : window.location.protocol.replace(":", ""),
    });
    options.onError?.("This device cannot listen. Type the message instead.");
    return null;
  }

  let finished = false;
  const recognition = new Ctor();
  recognition.lang = speechLang(options.locale);
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    const text = event.results?.[0]?.[0]?.transcript ?? "";
    if (text.trim()) options.onText(text.trim());
    else options.onError?.("Nothing was heard. Try again.");
  };
  recognition.onerror = (event: { error?: string }) => {
    finished = true;
    const error = event?.error ?? "unknown";
    reportBehaviour("chat.dictation_failed", { error, locale: recognition.lang });
    options.onError?.(
      error === "not-allowed" || error === "service-not-allowed"
        ? "The microphone is blocked. Allow it in the browser settings and try again."
        : "That did not come through. Try again.",
    );
    options.onEnd?.();
  };
  recognition.onend = () => {
    if (!finished) options.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    options.onError?.("The microphone could not start.");
    return null;
  }

  return {
    stop: () => {
      finished = true;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  results?: { [index: number]: { [index: number]: { transcript?: string } } };
};
