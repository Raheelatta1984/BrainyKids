import { createHash } from "node:crypto";

/** 13-bit logical image shard space, independent of the machines hosting it. */
export const IMAGE_SHARD_COUNT = 1 << 13;

export type ImageMachine = {
  id: string;
  baseUrl: string;
  /** Logical shard references assigned to this machine. */
  shardRefs: number[];
};

/** Stable, evenly distributed logical shard assignment for an image/object key. */
export function imageShardFor(objectKey: string): number {
  if (!objectKey.trim() || objectKey.includes("\\") || objectKey.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Image object keys must be non-empty safe path segments.");
  }
  const digest = createHash("sha256").update(objectKey).digest();
  return digest.readUInt16BE(0) % IMAGE_SHARD_COUNT;
}

/**
 * Parse BRAINYKIDS_IMAGE_MACHINE_MAP, e.g.
 * [{"id":"images-a","baseUrl":"https://img-a.example","shardRefs":[0,1]}].
 * Entries are validated at use time so deployments can build without this
 * optional image-storage infrastructure configured.
 */
export function parseImageMachineMap(raw = process.env.BRAINYKIDS_IMAGE_MACHINE_MAP): ImageMachine[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("BRAINYKIDS_IMAGE_MACHINE_MAP must be valid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("Image machine map must be a JSON array.");

  const seenShards = new Set<number>();
  return value.map((entry: unknown, index): ImageMachine => {
    if (!entry || typeof entry !== "object") throw new Error(`Image machine ${index} must be an object.`);
    const machine = entry as Record<string, unknown>;
    const id = typeof machine.id === "string" ? machine.id.trim() : "";
    const baseUrl = typeof machine.baseUrl === "string" ? machine.baseUrl.trim() : "";
    const shardRefs = machine.shardRefs;
    if (!id || !Array.isArray(shardRefs) || shardRefs.length === 0) {
      throw new Error(`Image machine ${index} requires an id and at least one shard reference.`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new Error(`Image machine ${id} must have a valid baseUrl.`);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error(`Image machine ${id} baseUrl must use HTTP or HTTPS.`);
    }
    const refs = shardRefs.map((ref: unknown) => {
      if (!Number.isInteger(ref) || (ref as number) < 0 || (ref as number) >= IMAGE_SHARD_COUNT) {
        throw new Error(`Image machine ${id} has a shard reference outside 0..${IMAGE_SHARD_COUNT - 1}.`);
      }
      if (seenShards.has(ref as number)) throw new Error(`Image shard ${ref} is assigned more than once.`);
      seenShards.add(ref as number);
      return ref as number;
    });
    return { id, baseUrl: parsedUrl.toString().replace(/\/$/, ""), shardRefs: refs };
  });
}

/** Resolve an image to its logical shard and current machine assignment. */
export function resolveImageMachine(objectKey: string, machines = parseImageMachineMap()): {
  shardRef: number;
  machine: ImageMachine;
  url: string;
} {
  const shardRef = imageShardFor(objectKey);
  const machine = machines.find((candidate) => candidate.shardRefs.includes(shardRef));
  if (!machine) throw new Error(`No image machine is mapped for logical shard ${shardRef}.`);
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return { shardRef, machine, url: `${machine.baseUrl}/${shardRef}/${encodedKey}` };
}
