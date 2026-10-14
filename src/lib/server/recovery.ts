// Password recovery codes.
//
// BrainyKids has no mail server, so “Forgot password?” works the way a family
// app should: the parent keeps a one-time recovery code (shown when the account
// is created and re-issuable from the dashboard) and uses it to set a new
// password. The code is stored only as a salted scrypt hash, exactly like the
// password itself.

import crypto from "node:crypto";

/** 32 characters, minus the ones that are easy to misread (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 12 characters from a 31-letter alphabet is about 59 bits of entropy. */
export const RECOVERY_CODE_LENGTH = 12;

/** How many wrong codes are tolerated before the reset form is locked. */
export const MAX_RECOVERY_ATTEMPTS = 5;

/** How long the lock lasts. */
export const RECOVERY_LOCK_MS = 15 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 8;

export function newRecoveryCode(): string {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** `ABCD2EFG3HJK` → `ABCD-2EFG-3HJK`, so it is easy to copy from a screen. */
export function formatRecoveryCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** Accepts what a parent typed, dashes, spaces and case included. */
export function normaliseRecoveryCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isValidRecoveryCode(input: string): boolean {
  return normaliseRecoveryCode(input).length === RECOVERY_CODE_LENGTH;
}

export function isValidPassword(input: string): boolean {
  return input.length >= PASSWORD_MIN_LENGTH;
}
