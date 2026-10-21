import assert from "node:assert/strict";
import { ID_EPOCH_MS, next_id } from "../src/lib/server/ids";
import { imageShardFor, parseImageMachineMap, resolveImageMachine } from "../src/lib/server/image-shards";

const first = next_id(ID_EPOCH_MS + 1000);
const second = next_id(ID_EPOCH_MS + 1000);
const third = next_id(ID_EPOCH_MS + 1001);
assert.match(first, /^[0-9a-f]{16}$/);
assert.ok(BigInt(`0x${first}`) < BigInt(`0x${second}`));
assert.ok(BigInt(`0x${second}`) < BigInt(`0x${third}`));

const key = "family-abc/profile/avatar.png";
const shardRef = imageShardFor(key);
const map = parseImageMachineMap(JSON.stringify([
  { id: "machine-a", baseUrl: "https://images-a.example/", shardRefs: [shardRef] },
]));
const resolved = resolveImageMachine(key, map);
assert.equal(resolved.shardRef, shardRef);
assert.equal(resolved.machine.id, "machine-a");
assert.equal(resolved.url, `https://images-a.example/${shardRef}/family-abc/profile/avatar.png`);
assert.throws(() => parseImageMachineMap(JSON.stringify([
  { id: "a", baseUrl: "https://a.example", shardRefs: [1] },
  { id: "b", baseUrl: "https://b.example", shardRefs: [1] },
])), /assigned more than once/);
console.log("Scaling utilities self-test passed.");
