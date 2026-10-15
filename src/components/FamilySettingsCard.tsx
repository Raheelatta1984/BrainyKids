"use client";

import { useEffect, useMemo, useState } from "react";
import { LOCALES, deviceTimeZone, formatStamp, resolveSettings, timeZoneOptions } from "@/lib/settings";
import {
  WEEKDAY_LABELS,
  commonCurrencyOptions,
  currencyExample,
  currencyInfo,
  formatReward,
  otherCurrencyOptions,
} from "@/lib/rewards";
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
  // Every currency in the world (ISO 4217), common ones first. Cryptocurrency is
  // never in this list, and the API refuses a crypto code as well.
  const currencies = useMemo(
    () => ({ common: commonCurrencyOptions(), others: otherCurrencyOptions() }),
    [],
  );
  const currency = currencyInfo(draft.currency);
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

        <fieldset className="settings-group">
          <legend>💰 Rewards — real money in any world currency, or Robux</legend>
          <p className="muted small">
            A perfect (100%) answer earns the full amount below. A 90%+ near answer earns 80% of it — for example{" "}
            {formatReward(draft.maxRewardPerQuestionMinor, draft.rewardKind, draft.currency)} →{" "}
            {formatReward(Math.round(draft.maxRewardPerQuestionMinor * 0.8), draft.rewardKind, draft.currency)}. Money sits in the
            child&apos;s wallet until they ask to realise it and you approve — only then does the wallet reset to zero. Every earn,
            request and approval is written to the child&apos;s transaction log.
          </p>
          <label>
            Children earn
            <select value={draft.rewardKind} onChange={(event) => update("rewardKind", event.target.value as FamilySettings["rewardKind"])}>
              <option value="money">Real money — the family&apos;s own currency</option>
              <option value="robux">Robux — Roblox&apos;s in-game currency</option>
            </select>
          </label>
          {draft.rewardKind === "money" && (
            <>
              <label>
                Currency (all {currencies.common.length + currencies.others.length} world currencies — never cryptocurrency)
                <select value={draft.currency} onChange={(event) => update("currency", event.target.value)}>
                  <optgroup label="Common currencies">
                    {currencies.common.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label} ({c.code} {c.symbol})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Every other currency in the world">
                    {currencies.others.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label} ({c.code} {c.symbol})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <p className="muted small">
                {currency.label} · {currency.symbol} ·{" "}
                {currency.decimals === 0
                  ? "no smaller unit"
                  : `${currency.decimals} decimal place${currency.decimals === 1 ? "" : "s"}`}
                . Amounts below are kept in the smallest unit of the currency, so 50 shows as{" "}
                <strong>{currencyExample(currency.code)}</strong>. Cryptocurrency is never offered, and the server
                refuses a crypto code even if one is sent by hand.
              </p>
            </>
          )}
          {draft.rewardKind === "robux" && (
            <p className="muted small">
              Robux is Roblox&apos;s own currency. A perfect answer earns whole Robux, and the amounts below are
              counted in Robux — the app is the ledger, and a parent pays the child in Robux outside the app.
            </p>
          )}
          <label>
            Reward for a perfect answer — {formatReward(draft.maxRewardPerQuestionMinor, draft.rewardKind, draft.currency)}
            <input
              type="number"
              min={0}
              max={100000}
              value={draft.maxRewardPerQuestionMinor}
              onChange={(event) => update("maxRewardPerQuestionMinor", Number(event.target.value))}
            />
          </label>
          <label>
            Daily earn limit ({draft.rewardKind === "robux" ? "Robux" : `smallest unit of ${currency.code}`}, 0 = no limit)
            <input type="number" min={0} value={draft.dailyEarnLimitMinor} onChange={(event) => update("dailyEarnLimitMinor", Number(event.target.value))} />
          </label>
          <label>
            Weekly earn limit ({draft.rewardKind === "robux" ? "Robux" : `smallest unit of ${currency.code}`}, 0 = no limit)
            <input type="number" min={0} value={draft.weeklyEarnLimitMinor} onChange={(event) => update("weeklyEarnLimitMinor", Number(event.target.value))} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={draft.earnScheduleEnabled} onChange={(event) => update("earnScheduleEnabled", event.target.checked)} />
            Only let children earn on a schedule
          </label>
          {draft.earnScheduleEnabled && (
            <>
              <div className="row wrap gap" role="group" aria-label="Earning days">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label key={label} className="inline">
                    <input
                      type="checkbox"
                      checked={draft.earnDays.includes(day)}
                      onChange={(event) =>
                        update("earnDays", event.target.checked ? [...draft.earnDays, day].sort() : draft.earnDays.filter((d) => d !== day))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label>
                Earn from
                <input type="time" value={draft.earnStartTime} onChange={(event) => update("earnStartTime", event.target.value)} />
              </label>
              <label>
                Earn until
                <input type="time" value={draft.earnEndTime} onChange={(event) => update("earnEndTime", event.target.value)} />
              </label>
            </>
          )}
        </fieldset>

        <fieldset className="settings-group">
          <legend>⏱️ Question timers</legend>
          <p className="muted small">
            Every question counts down. Easy questions get the least time, hard questions the most — never more than 10 minutes
            (600 seconds). Running out of time earns no reward for that question.
          </p>
          <label>
            Easy questions (seconds)
            <input type="number" min={30} max={600} value={draft.timerEasySeconds} onChange={(event) => update("timerEasySeconds", Number(event.target.value))} />
          </label>
          <label>
            Medium questions (seconds)
            <input type="number" min={30} max={600} value={draft.timerMediumSeconds} onChange={(event) => update("timerMediumSeconds", Number(event.target.value))} />
          </label>
          <label>
            Hard questions (seconds)
            <input type="number" min={30} max={600} value={draft.timerHardSeconds} onChange={(event) => update("timerHardSeconds", Number(event.target.value))} />
          </label>
        </fieldset>

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
