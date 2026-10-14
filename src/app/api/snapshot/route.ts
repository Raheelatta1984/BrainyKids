import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { logBehaviour, noteStorageState } from "@/lib/server/diagnostics";
import { COOKIES, requestProtocol } from "@/lib/server/auth";
import { passkeysForParent } from "@/lib/server/passkeys";
import { StorageError, store } from "@/lib/server/store";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { kidView, parentView, pendingPairings, settingsForParent } from "@/lib/server/views";
import type { Snapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A single call that tells the app who is signed in on this device and returns
 * everything that screen needs. Realtime updates arrive from /api/events.
 *
 * It is also the place where “the kid keeps being signed out” and “the child's
 * information disappears” are caught: a valid device cookie with no matching
 * record is logged with the whole picture (storage driver, durability, protocol)
 * so the review has something to work with.
 */
export const GET = route(async (req: NextRequest) => {
  // Fires at most once per process: permanent vs temporary storage is the root
  // cause of most “kept signing out / information disappeared” reports.
  noteStorageState(store.info());
  const storage = store.info();
  let doc;
  try {
    doc = await store.read();
  } catch (cause) {
    if (cause instanceof StorageError) {
      const fallbackSnapshot: Snapshot = {
        role: "guest",
        hasAccounts: false,
        storage: {
          ...storage,
          durable: false,
          notice: cause.userMessage,
        },
      };
      return json(fallbackSnapshot);
    }
    throw cause;
  }

  const now = Date.now();
  const latestStorage = store.info();
  const hasDeviceCookie = Boolean(req.cookies.get(COOKIES.device)?.value);

  const parent = await parentAuth(req, doc);
  if (parent) {
    const kids = doc.kids.filter((k) => k.parentId === parent.parent.id);
    if (hasDeviceCookie) {
      // A device holding both cookies shows the parent screen. Note it, so a
      // “the child was signed out” report has an explanation.
      const device = await deviceAuth(req, doc);
      if (device) {
        void logBehaviour(
          {
            code: "kid.session.both_roles",
            parentId: parent.parent.id,
            kidId: device.kid.id,
            kidName: device.kid.name,
            deviceId: device.device.id,
            vars: { cookieName: COOKIES.device, deviceId: device.device.id, kidId: device.kid.id },
            context: { kidId: device.kid.id, deviceId: device.device.id },
            role: "parent",
          },
          { throttleKey: device.device.id },
        ).catch(() => undefined);
      }
    }
    const snapshot: Snapshot = {
      role: "parent",
      parent: parentView(parent.parent),
      kids: kids.map((k) => kidView(doc, k, now, "parent")),
      pairings: pendingPairings(doc, parent.parent.id, now),
      passkeys: passkeysForParent(doc.passkeys, parent.parent.id, doc.kids),
      settings: settingsForParent(doc, parent.parent.id),
      storage: latestStorage,
    };
    return json(snapshot);
  }

  const device = await deviceAuth(req, doc);
  if (device) {
    if (device.restored) {
      void logBehaviour(
        {
          code: "kid.session.restored",
          parentId: device.kid.parentId,
          kidId: device.kid.id,
          kidName: device.kid.name,
          deviceId: device.device.id,
          role: "kid",
          vars: {
            deviceId: device.device.id,
            kidId: device.kid.id,
            storage: latestStorage.driver,
            durable: latestStorage.durable,
            reason: "storage had lost the device record",
          },
          context: { storage: latestStorage.driver, durable: latestStorage.durable },
        },
        { throttleKey: device.device.id },
      ).catch(() => undefined);
    }
    const owner = doc.parents.find((p) => p.id === device.kid.parentId);
    const snapshot: Snapshot = {
      role: "kid",
      kid: kidView(doc, device.kid, now, "kid"),
      parent: owner ? { name: owner.name, email: owner.email } : { name: "Parent", email: "" },
      settings: settingsForParent(doc, device.kid.parentId),
      storage: latestStorage,
    };
    return json(snapshot);
  }

  if (hasDeviceCookie) {
    const insecure = requestProtocol(req) === "http" && process.env.NODE_ENV === "production";
    void logBehaviour(
      {
        code: insecure ? "kid.session.cookie_missing" : "kid.session.lost",
        role: "kid",
        vars: {
          reason: "no matching device record for the cookie that was sent",
          cookiePresent: true,
          deviceFound: false,
          kidFound: false,
          storage: latestStorage.driver,
          durable: latestStorage.durable,
          location: latestStorage.location,
          cookieName: COOKIES.device,
          protocol: requestProtocol(req),
          secure: insecure,
          url: "/api/snapshot",
          cookiesEnabled: true,
        },
        context: {
          storage: latestStorage.driver,
          durable: latestStorage.durable,
          location: latestStorage.location,
          protocol: requestProtocol(req),
        },
        client: { protocol: requestProtocol(req) },
      },
      { throttleKey: "snapshot-lost" },
    ).catch(() => undefined);
  }

  const snapshot: Snapshot = {
    role: "guest",
    hasAccounts: doc.parents.length > 0,
    unlinked: hasDeviceCookie,
    storage: latestStorage,
  };
  return json(snapshot);
});
