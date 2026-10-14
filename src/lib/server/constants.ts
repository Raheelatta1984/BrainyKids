export const MAX_ACTIVITY = 40;
/** How long a pairing code stays valid. */
export const PAIRING_TTL_MS = 15 * 60 * 1000;
/** How often a linked kid device reports that it is still open. */
export const HEARTBEAT_MS = 20_000;
/** Kid device cookie lifetime. The device stays signed in until a parent signs it out. */
export const DEVICE_DAYS = 180;
export const PARENT_SESSION_DAYS = 30;
