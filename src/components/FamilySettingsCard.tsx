"use client";

import { useEffect, useMemo, useState } from "react";
import { LOCALES, deviceTimeZone, formatStamp, resolveSettings, timeZoneOptions } from "@/lib/settings";
import { questionsTranslated } from "@/lib/quiz-i18n";
import { actions } from "@/lib/client/api";
import { reportBehaviour } from "@/lib/client/diagnostics";
import type { DateFormat, FamilySettings, TimeFormat } from "@/lib/types";

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "auto", label: "Follow the language" },
  { value: "dmy", label: "Day / month / year (31/12/2026)" },
  { value: "mdy", label: "Month / day / year (12/31/2026)" },
  { value: "ymd", label: "Year-month-day (2026-12-31)" },
];

const TIME_FORMATS: { value: TimeFormat; label: string }[] = [
  { value: "auto", label: "Follow the language" },
  { value: "12", label: "12-hour (7:05 PM)" },
  { value: "24", label: "24-hour (19:05)" },
];

/**
 * The master settings tab.
 *
 * Everything the app shows — dates, times, question wording, the spoken voice
 * and the behavioural log — follows what is chosen here, so a parent can read
 * the app (and the log) the way their family reads a calendar.
 */
export default function FamilySettingsCard({
  settings,
  onSaved,
}: {
  settings: FamilySettings;
  onSaved: (next: FamilySettings) => void;
}) {
  const [draft, setDraft] = useState<FamilySettings>(resolveSettings(settings));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const zones = useMemo(() => timeZoneOptions(), []);
  // A sample stamp, refreshed on a timer: reading the clock while rendering is not
  // allowed, and 30 seconds is plenty for a preview.
  const [sampleAt, setSampleAt] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setSampleAt(Date.now()), 0);
    const tick = setInterval(() => setSampleAt(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, []);
  const preview = useMemo(() => (sampleAt ? formatStamp(sampleAt, draft) : "…"), [sampleAt, draft]);
  const localZone = deviceTimeZone();
  const translated = questionsTranslated(draft.locale);

  function update<K extends keyof FamilySettings>(key: K, value: FamilySettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const result = await actions.updateSettings(draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      reportBehaviour("settings.rejected_value", { field: "settings", value: "save failed", fallback: "kept" });
      return;
    }
    const next = resolveSettings(result.data.settings);
    onSaved(next);
    setMessage(result.data.message ?? "Saved.");
  }

  return (
    <section className="card settings-card">
      <h2>Master settings</h2>
      <p className="muted">
        Date, time, language and voice over for the whole family. The behavioural log, chat and every quiz question
        follow these settings — including the language children are asked questions in.
      </p>

      <form className="settings-form" onSubmit={save}>
        <label>
          Time zone
          <select value={draft.timeZone} onChange={(event) => update("timeZone", event.target.value)}>
            <option value="">Use this device&apos;s time zone ({localZone})</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>

        <label>
          Language
          <select value={draft.locale} onChange={(event) => update("locale", event.target.value as FamilySettings["locale"])}>
            {LOCALES.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.label} · {locale.native}
              </option>
            ))}
          </select>
        </label>

        <label>
          Date format
          <select value={draft.dateFormat} onChange={(event) => update("dateFormat", event.target.value as DateFormat)}>
            {DATE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Time format
          <select value={draft.timeFormat} onChange={(event) => update("timeFormat", event.target.value as TimeFormat)}>
            {TIME_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="inline">
          <input type="checkbox" checked={draft.kidVoiceOver} onChange={(event) => update("kidVoiceOver", event.target.checked)} />
          Read questions, feedback and messages aloud on the kid device
        </label>
        <label className="inline">
          <input type="checkbox" checked={draft.kidDictation} onChange={(event) => update("kidDictation", event.target.checked)} />
          Let a child send a message by speaking (voice note)
        </label>
        <label className="inline">
          <input type="checkbox" checked={draft.parentVoiceOver} onChange={(event) => update("parentVoiceOver", event.target.checked)} />
          Read new chat messages aloud on my device
        </label>

        <div className="settings-preview">
          <span className="muted small">Every log line, message and activity entry will read like this:</span>
          <strong>{preview}</strong>
          {!translated && (
            <span className="banner info small">
              Questions are not translated into this language yet, so children will be asked in English. App wording for
              grown-ups stays in English.
            </span>
          )}
        </div>

        <div className="row gap">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          <span className="muted small">
            {LOCALES.filter((locale) => locale.questions).length} languages are available for questions and tasks.
          </span>
        </div>
      </form>

      {message && <p className="banner good">{message}</p>}
      {error && <p className="banner error">{error}</p>}
    </section>
  );
}
