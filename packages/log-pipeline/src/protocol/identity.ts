import { createHash } from "crypto";

/**
 * Content-based file identity: hash the first line so a recreated file with the
 * same name is detected by checksum change, not just by shrinking size. Returns
 * null until the file has a complete first line — WoW writes whole lines
 * constantly, so this resolves within seconds.
 *
 * Load-bearing assumption: the first line is UNIQUE per log generation. WoW
 * prefixes every line with a millisecond timestamp, so this holds. The whole
 * no-corruption guarantee (same gen8 ⇒ byte-identical source for a given
 * offset range) rests on it — a log format with a constant first line would
 * collide gen8 and could corrupt reconstruction across generations.
 */
export function firstLineChecksum(head: Buffer): string | null {
  const nl = head.indexOf(0x0a); // \n
  if (nl === -1) return null;
  const end = nl > 0 && head[nl - 1] === 0x0d ? nl - 1 : nl; // strip \r for CRLF logs
  return createHash("sha1").update(head.subarray(0, end)).digest("hex");
}

export function gen8Of(checksum: string): string {
  return checksum.slice(0, 8);
}
