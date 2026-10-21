/**
 * Snowflake-style 64-bit ID layout (most-significant bit first):
 *   41 bits milliseconds since 2020-01-01, 13 bits machine/shard reference,
 *   10 bits monotonically increasing sequence within that millisecond.
 *
 * IDs are returned as 16-character hexadecimal strings so they remain exact in
 * JavaScript and sort lexicographically by creation time. In a multi-instance
 * deployment every concurrently active writer MUST have a distinct
 * BRAINYKIDS_SHARD_ID (0..8191).
 */
export const ID_EPOCH_MS = Date.UTC(2020, 0, 1);
export const ID_TIMESTAMP_BITS = 41;
export const ID_SHARD_BITS = 13;
export const ID_COUNTER_BITS = 10;
export const ID_MAX_SHARD = (1 << ID_SHARD_BITS) - 1;
export const ID_MAX_COUNTER = (1 << ID_COUNTER_BITS) - 1;

const shardEnv = process.env.BRAINYKIDS_SHARD_ID;
const shardId = shardEnv === undefined || shardEnv.trim() === ""
  ? 0
  : Number(shardEnv);
if (!Number.isInteger(shardId) || shardId < 0 || shardId > ID_MAX_SHARD) {
  throw new Error(`BRAINYKIDS_SHARD_ID must be an integer from 0 to ${ID_MAX_SHARD}.`);
}

let lastTimestamp = -1;
let counter = 0;

/** Generate a globally unique (when shard references are unique) sortable ID. */
export function next_id(now = Date.now()): string {
  let timestamp = Math.max(0, Math.floor(now) - ID_EPOCH_MS);
  if (timestamp < lastTimestamp) timestamp = lastTimestamp;

  if (timestamp === lastTimestamp) {
    counter += 1;
    // Preserve monotonic order if a single process emits >1024 IDs in one ms.
    if (counter > ID_MAX_COUNTER) {
      timestamp = lastTimestamp + 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }

  const maxTimestamp = (1n << BigInt(ID_TIMESTAMP_BITS)) - 1n;
  if (BigInt(timestamp) > maxTimestamp) {
    throw new Error("The 64-bit ID timestamp range has been exhausted.");
  }
  lastTimestamp = timestamp;

  const id = (BigInt(timestamp) << BigInt(ID_SHARD_BITS + ID_COUNTER_BITS)) |
    (BigInt(shardId) << BigInt(ID_COUNTER_BITS)) |
    BigInt(counter);
  return id.toString(16).padStart(16, "0");
}

