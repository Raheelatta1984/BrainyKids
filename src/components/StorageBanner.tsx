"use client";

import { useState } from "react";
import { actions } from "@/lib/client/api";

/**
 * Shown when the server is running on a read-only / serverless filesystem
 * without a Postgres database attached yet (or when a configured database could
 * not be reached). Gives one-click instructions for attaching Neon on Vercel
 * and a button to test the database connection live.
 */
export default function StorageBanner({
  notice,
  onChecked,
}: {
  notice: string | null | undefined;
  onChecked?: () => void;
}) {
  const [showGuide, setShowGuide] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; durable: boolean; message: string } | null>(null);

  if (!notice && (!checkResult || checkResult.durable)) return null;

  async function verifyConnection() {
    setChecking(true);
    const res = await actions.storageStatus();
    setChecking(false);
    if (!res.ok) {
      setCheckResult({ ok: false, durable: false, message: res.error });
      return;
    }
    setCheckResult({
      ok: res.data.ok,
      durable: res.data.storage.durable,
      message: res.data.message,
    });
    onChecked?.();
  }

  return (
    <div className="storage-banner" role="region" aria-label="Database storage notice">
      {notice && <p className="storage-banner-text">💾 {notice}</p>}

      <div className="row gap wrap storage-banner-actions">
        <button type="button" className="link" onClick={() => setShowGuide((v) => !v)}>
          {showGuide ? "Hide Neon / Vercel setup steps" : "How to attach Neon on Vercel →"}
        </button>
        <button type="button" className="ghost storage-check-btn" disabled={checking} onClick={() => void verifyConnection()}>
          {checking ? "Checking database…" : "Check database connection"}
        </button>
      </div>

      {checkResult && (
        <p className={`banner ${checkResult.durable ? "good" : checkResult.ok ? "info" : "error"}`}>
          {checkResult.message}
        </p>
      )}

      {showGuide && (
        <div className="storage-guide">
          <strong>Connect Neon (Serverless Postgres) on Vercel in 3 steps:</strong>
          <ol className="steps">
            <li>
              <strong>Attach in Vercel Storage (easiest):</strong> Open your project in the Vercel dashboard →{" "}
              <strong>Storage</strong> tab → <strong>Create Database</strong> → choose{" "}
              <strong>Neon (Serverless Postgres)</strong> and click <strong>Connect</strong>. Vercel adds{" "}
              <code>DATABASE_URL</code> / <code>POSTGRES_URL</code> automatically.
            </li>
            <li>
              <strong>Or paste a Neon URL manually:</strong> In the Neon Console copy your{" "}
              <code>postgresql://…</code> connection string, then in Vercel go to{" "}
              <strong>Settings → Environment Variables</strong> and add it as <code>DATABASE_URL</code> (BrainyKids also
              recognises <code>POSTGRES_URL</code> and <code>NEON_DATABASE_URL</code>).
            </li>
            <li>
              <strong>Redeploy once:</strong> In Vercel go to <strong>Deployments → ⋯ → Redeploy</strong> so the new
              environment variable is loaded, then click <strong>Check database connection</strong> above.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
