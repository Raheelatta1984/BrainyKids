"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { reportBehaviour } from "@/lib/client/diagnostics";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/settings";
import { listenOnce, recognitionSupported, speakText, speechSupported } from "@/lib/voice";
import type { ChatMessage, FamilySettings } from "@/lib/types";

const QUICK_KEYS = ["chat.quick1", "chat.quick2", "chat.quick3"] as const;

/**
 * Two-way chat between a parent and one child, with voice over both ways:
 *   * the microphone turns speech into a message (“voice note”),
 *   * any message can be read out loud, and new ones are read out automatically
 *     when voice over is switched on for that device.
 *
 * A spoken message is stored as text, so it can be read, heard and searched —
 * and nothing has to be uploaded.
 */
export default function ChatPanel({
  viewer,
  kidName,
  messages,
  settings,
  unread,
  busy = false,
  onSend,
  onMarkRead,
  onClose,
}: {
  viewer: "parent" | "kid";
  kidName: string;
  messages: ChatMessage[];
  settings: FamilySettings;
  unread: number;
  busy?: boolean;
  onSend: (text: string, kind: "text" | "voice") => Promise<{ ok: true } | { ok: false; error: string }>;
  onMarkRead: () => void;
  onClose?: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [voiceOn, setVoiceOn] = useState(() => (viewer === "kid" ? settings.kidVoiceOver : settings.parentVoiceOver));
  const spoken = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const locale = settings.locale;

  const canListen = useMemo(() => recognitionSupported() && (viewer === "parent" || settings.kidDictation), [viewer, settings.kidDictation]);
  const canSpeak = useMemo(() => speechSupported(), []);
  const otherSide = viewer === "parent" ? "kid" : "parent";

  // Keep the newest message in view.
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  // Mark the other side's messages as seen while the panel is on screen.
  useEffect(() => {
    if (unread > 0) onMarkRead();
  }, [unread, onMarkRead]);

  // Read new incoming messages out loud (voice over).
  useEffect(() => {
    if (!voiceOn || !canSpeak) return;
    const incoming = messages.filter((message) => message.from === otherSide && !spoken.current.has(message.id));
    if (incoming.length === 0) return;
    for (const message of incoming) spoken.current.add(message.id);
    const latest = incoming[incoming.length - 1];
    speakText(viewer === "kid" ? latest.text : `${kidName}: ${latest.text}`, locale);
  }, [messages, otherSide, voiceOn, canSpeak, locale, viewer, kidName]);

  const working = busy || sending;

  async function send(payload: string, kind: "text" | "voice") {
    const clean = payload.trim();
    if (!clean || working) return;
    setSending(true);
    setError("");
    const result = await onSend(clean, kind);
    setSending(false);
    if (!result.ok) {
      setError(result.error || t(locale, "chat.failed"));
      reportBehaviour("chat.message_failed", {
        error: result.error,
        from: viewer,
        path: viewer === "parent" ? "chat" : "/api/kid-session/chat",
      });
      return;
    }
    setText("");
  }

  function startListening() {
    setError("");
    const handle = listenOnce({
      locale,
      onText: (spoken) => void send(spoken, "voice"),
      onError: (message) => setError(message),
      onEnd: () => setListening(false),
    });
    if (handle) setListening(true);
  }

  return (
    <section className="chat" aria-label={t(locale, viewer === "kid" ? "chat.withParent" : "chat.withKid", { name: kidName })}>
      <header className="chat-head">
        <strong>{t(locale, viewer === "kid" ? "chat.withParent" : "chat.withKid", { name: kidName })}</strong>
        <div className="row gap">
          {canSpeak && (
            <button
              type="button"
              className={`chip small ${voiceOn ? "on" : ""}`}
              onClick={() => setVoiceOn((value) => !value)}
              title={t(locale, "chat.readAloud")}
            >
              🔈 {t(locale, "chat.readAloud")}: {t(locale, voiceOn ? "common.on" : "common.off")}
            </button>
          )}
          {onClose && (
            <button type="button" className="link" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="chat-list" ref={listRef} role="log">
        {messages.length === 0 && <p className="muted small">{t(locale, "chat.empty")}</p>}
        {messages.map((message) => {
          const mine = message.from === viewer;
          return (
            <div key={message.id} className={`chat-bubble ${mine ? "mine" : "theirs"}`}>
              <span className="chat-text">{message.text}</span>
              <span className="chat-meta">
                <small>{formatTime(message.at, settings)}</small>
                {message.kind === "voice" && <small className="chat-tag">🎤 {t(locale, "chat.voiceNote")}</small>}
                {canSpeak && (
                  <button
                    type="button"
                    className="chat-speak"
                    title={t(locale, "chat.speak")}
                    onClick={() => speakText(message.text, locale)}
                  >
                    🔊
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {error && <p className="banner error small">{error}</p>}

      {viewer === "kid" && (
        <div className="row wrap gap chat-quick">
          {QUICK_KEYS.map((key) => (
            <button key={key} type="button" className="chip small" disabled={busy} onClick={() => void send(t(locale, key), "text")}>
              {t(locale, key)}
            </button>
          ))}
        </div>
      )}

      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text, "text");
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t(locale, "chat.placeholder")}
          aria-label={t(locale, "chat.placeholder")}
          maxLength={500}
        />
        {canListen && (
          <button
            type="button"
            className={`ghost ${listening ? "listening" : ""}`}
            onClick={startListening}
            disabled={listening || working}
          >
            {listening ? t(locale, "chat.listening") : `🎙️ ${t(locale, "chat.mic")}`}
          </button>
        )}
        <button type="submit" className="primary" disabled={working || !text.trim()}>
          {working ? t(locale, "chat.sending") : t(locale, "chat.send")}
        </button>
      </form>
      <p className="muted small">{t(locale, "chat.hint")}</p>
    </section>
  );
}
