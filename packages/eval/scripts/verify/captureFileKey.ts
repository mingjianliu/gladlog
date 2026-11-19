/**
 * verify/captureFileKey.ts — which owner's prompt a capture file is, whatever
 * shard it was written in.
 *
 * A capture lays its files out `s<k>/{context,findings}/<fileNo>-<round>-<n>.txt`
 * and both numbers outside the round are shard-local: the same owner's file
 * is `s0/…/12-3-80.txt` in a three-shard capture and `s1/…/4-3-27.txt` in an
 * eight-shard one. What does not move is what the file says of itself — its
 * first two lines (the archive, the owner) — and the round its name carries.
 *
 * T208 / GH #218 10.10: `captureFamilyDiff` paired the two captures' files by
 * `<shard>/<sub>/<name>`, so across two shard counts a file's duplicate lines
 * were compared with another owner's and reported as new `dup` flags.
 */

/** the archive's own name: captures of one manifest can sit under two roots */
const baseName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** `<sub>/<archive name>#<round>#<owner>`, or `undefined` for a file that is
 * not a capture file (no two header lines, or a name with no round). */
export function captureFileKey(
  sub: string,
  fileName: string,
  text: string,
): string | undefined {
  const round = /^\d+-(\d+)-\d+\.txt$/.exec(fileName)?.[1];
  const nl = text.indexOf("\n");
  const nl2 = nl < 0 ? -1 : text.indexOf("\n", nl + 1);
  if (round === undefined || nl2 < 0) return undefined;
  const archive = text.slice(0, nl).trim();
  const owner = text.slice(nl + 1, nl2).trim();
  if (!archive || !owner) return undefined;
  return `${sub}/${baseName(archive)}#${round}#${owner}`;
}
