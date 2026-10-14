"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { actions, type DiagnosticsResponse } from "@/lib/client/api";
import { AREA_LABEL, SEVERITY_EMOJI, SEVERITY_LABEL } from "@/lib/behaviour";
import { behaviourHeadline } from "@/lib/behaviour-report";
import { formatStamp, formatTimeAgo } from "@/lib/settings";
import type { BehaviourEntry, BehaviourSeverity, FamilySettings } from "@/lib/types";

type Filter = "all" | BehaviourSeverity;

/**
 * The behavioural log as a parent sees it.
 *
 * Every line says the same thing twice (plain words and technical words), what it
 * means and what to do about it — and the whole thing can be downloaded as the
 * Markdown report that is kept in the repository and reviewed after each change.
 */
export default function BehaviourLogCard({ settings }: { settings: FamilySettings }) {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await actions.diagnostics(400);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setData(result.data);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const entries: BehaviourEntry[] = useMemo(() => data?.entries ?? [], [data]);
  const shown = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.severity === filter)),
    [entries, filter],
  );

  const summary = data?.summary;
  const downloadUrl = "/api/diagnostics?format=md&download=1";

  return (
    <section className="card behaviour-card">
      <header className="behaviour-head">
        <div>
          <h2>Behavioural log</h2>
          <p className="muted">
            What the app noticed about itself: sign-ins that dropped, children that went missing from the screen, link
            codes that ran out of time, chat and voice problems. Each line is written twice — plain words first,
            technical detail underneath.
          </p>
        </div>
        <div className="row gap wrap">
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <a className="button primary" href={downloadUrl}>
            ⬇️ Download report
          </a>
        </div>
      </header>

      {summary && <p className="behaviour-headline">{behaviourHeadline(summary)}</p>}

      <div className="stat-row behaviour-stats">
        <div className={`stat ${filter === "critical" ? "active" : ""}`} onClick={() => setFilter(filter === "critical" ? "all" : "critical")}>
          <span className="stat-value">🚨 {summary?.critical ?? 0}</span>
          <span className="stat-label">Fix me</span>
        </div>
        <div className={`stat ${filter === "warning" ? "active" : ""}`} onClick={() => setFilter(filter === "warning" ? "all" : "warning")}>
          <span className="stat-value">⚠️ {summary?.warning ?? 0}</span>
          <span className="stat-label">Needs a look</span>
        </div>
        <div className={`stat ${filter === "info" ? "active" : ""}`} onClick={() => setFilter(filter === "info" ? "all" : "info")}>
          <span className="stat-value">ℹ️ {summary?.info ?? 0}</span>
          <span className="stat-label">Normal activity</span>
        </div>
      </div>

      {error && <p className="banner error">{error}</p>}

      {summary && summary.groups.length > 0 && (
        <div className="behaviour-groups">
          <h3>What to do first</h3>
          <ul>
            {summary.groups
              .filter((group) => group.severity !== "info")
              .slice(0, 6)
              .map((group) => (
                <li key={group.code}>
                  <span className="behaviour-code">
                    {SEVERITY_EMOJI[group.severity]} {group.count}× <code>{group.code}</code> · {AREA_LABEL[group.area]}
                  </span>
                  <span>{group.layman}</span>
                  <span className="muted small">What to do: {group.fix}</span>
                </li>
              ))}
          </ul>
          {summary.groups.every((group) => group.severity === "info") && (
            <p className="muted small">Nothing needs fixing right now — everything logged is normal activity.</p>
          )}
        </div>
      )}

      <div className="behaviour-list">
        {shown.length === 0 && (
          <p className="muted">
            {entries.length === 0
              ? "Nothing has been logged yet. As soon as a session drops, a child disappears from the screen or a code expires, it appears here."
              : "No lines match this filter."}
          </p>
        )}
        {shown.slice(0, 80).map((entry) => {
          const expanded = open === `${entry.id}`;
          return (
            <article key={entry.id} className={`behaviour-entry ${entry.severity}`}>
              <header>
                <span className={`severity ${entry.severity}`} title={SEVERITY_LABEL[entry.severity]}>
                  {SEVERITY_EMOJI[entry.severity]} {SEVERITY_LABEL[entry.severity]}
                </span>
                <span className="muted small">
                  {formatStamp(entry.at, entry.settings ?? settings, { zone: false })} · {formatTimeAgo(entry.at, settings)}
                </span>
                <code className="small">{entry.code}</code>
                <button type="button" className="link small" onClick={() => setOpen(expanded ? null : `${entry.id}`)}>
                  {expanded ? "Hide detail" : "Technical detail"}
                </button>
              </header>
              <p className="layman">{entry.layman}</p>
              {expanded && (
                <div className="behaviour-detail">
                  <p>
                    <strong>Technical:</strong> <code>{entry.technical}</code>
                  </p>
                  <p>
                    <strong>What to do:</strong> {entry.fix}
                  </p>
                  {entry.kidName && (
                    <p className="muted small">
                      Child: {entry.kidName}
                      {entry.deviceId ? ` · device ${entry.deviceId.slice(0, 8)}…` : ""}
                      {entry.source === "client" ? ` · reported by the ${entry.role} device` : " · reported by the server"}
                    </p>
                  )}
                  {Object.keys(entry.context ?? {}).length > 0 && (
                    <p className="muted small">
                      Details: {Object.entries(entry.context).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="row gap wrap">
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                entries
                  .map((entry) => `${new Date(entry.at).toISOString()} [${entry.severity}] ${entry.code} — ${entry.layman} :: ${entry.technical}`)
                  .join("\n"),
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy log lines"}
        </button>
        <span className="muted small">
          Save the downloaded file as <code>logs/behaviour-*.md</code> in the repository, then run{" "}
          <code>npm run behaviour:report</code> so the next review reads it.
        </span>
      </div>
    </section>
  );
}
