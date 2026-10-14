import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { noteStorageState } from "@/lib/server/diagnostics";
import { checkStorageHealth, store } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checks whether the storage backend (Neon / Vercel Postgres or local file) is
 * reachable and permanent. Called when a parent clicks "Check database connection"
 * in the storage banner.
 */
export const GET = route(async (req: NextRequest) => {
  void req;
  noteStorageState(store.info());
  const status = await checkStorageHealth();
  return json(status);
});
