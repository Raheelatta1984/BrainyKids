#!/usr/bin/env node
/**
 * Reset a parent password from the command line.
 *
 * This is the escape hatch for someone running their own copy of BrainyKids who
 * has lost both the password and the recovery code (for example the only parent
 * account on a self-hosted server). Anyone who can run this already has access
 * to the server and the data file, so it grants no extra power.
 *
 *     npm run reset-password -- parent@example.com "new password"
 *
 * Works with the JSON file store and with DATABASE_URL (Postgres).
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Same format as hashSecret() in src/lib/server/auth.ts: `salt:hash`. */
function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(value, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error('\nUsage: npm run reset-password -- <email> "<new password>"\n');
  process.exit(1);
}

async function loadFileDoc(dir) {
  const file = path.join(dir, "brainykids.json");
  const raw = await fs.readFile(file, "utf8");
  return { doc: JSON.parse(raw), save: async (next) => fs.writeFile(file, JSON.stringify(next, null, 2), "utf8"), where: file };
}

async function loadPostgresDoc(connectionString) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
  const { rows } = await pool.query("select doc from brainykids_state where id = 1");
  if (!rows[0]?.doc) throw new Error("No BrainyKids data was found in the database yet.");
  return {
    doc: rows[0].doc,
    where: "the database",
    save: async (next) => {
      await pool.query("update brainykids_state set doc = $1, updated_at = now() where id = 1", [JSON.stringify(next)]);
      await pool.end();
    },
  };
}

const [email, password] = process.argv.slice(2);
if (!email || !password) usage();
if (password.length < 8) usage("Use a password with at least 8 characters.");

const normalisedEmail = email.trim().toLowerCase();

const source = process.env.DATABASE_URL
  ? await loadPostgresDoc(process.env.DATABASE_URL)
  : await loadFileDoc(process.env.BRAINYKIDS_DATA_DIR ?? path.join(process.cwd(), ".data"));

const parent = (source.doc.parents ?? []).find((p) => p.email === normalisedEmail);
if (!parent) {
  const known = (source.doc.parents ?? []).map((p) => p.email).join(", ") || "none";
  console.error(`\nNo parent account with the email ${normalisedEmail}. Accounts saved here: ${known}\n`);
  process.exit(1);
}

parent.passwordHash = hashSecret(password);
// A command-line reset is a deliberate act, so the lock from failed attempts goes away.
parent.recoveryFailures = 0;
parent.recoveryLockedUntil = undefined;
source.doc.sessions = (source.doc.sessions ?? []).filter((s) => s.parentId !== parent.id);

await source.save(source.doc);
console.log(`\nPassword updated for ${parent.name} <${parent.email}> in ${source.where}.`);
console.log("Every device signed in as that parent has been signed out. They can sign in with the new password.\n");
