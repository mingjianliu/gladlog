/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t235.ts — ticket T235 (user ruling R98): a kill attempt whose
 * `FAILED:` text is `target trinketed out` or `broke out (X)` names an
 * immunity met beside it and nothing else — an external the target received
 * in the same attempt (`saved by external (Y)` on any other line) is not
 * named.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's. The
 * attempts, their `primary` and the externals each received are the
 * producer's own (`extractKillAttempts` → `attribution`); the printed line
 * is the capture's.
 *
 *  - `breakWithExternalUnnamed`: a FAILED attempt of the owner's side whose
 *    `primary` is the trinket or a break and whose attribution holds at
 *    least one external, and whose printed line does not say `saved by
 *    external (`. Kind = trinketed / broke out. Kind `names other externals`:
 *    the line's clause is there, but the names it lists (each less its
 *    `[up since m:ss]` mark) are not exactly the attempt's externals — one
 *    left out, one added, or a clause where the attempt has none (T300,
 *    codex 80-WSL-BW1-1 #4). Non-zero on a capture taken
 *    before rulings R98 + R115 landed, 0 on one taken with them. Counted: every FAILED
 *    attempt of the owner's side whose `primary` is the trinket or a break.
 *    An external that IS the immunity the line already names (Blessing of
 *    Protection / Spellwarding behind `forced a full immunity`, the
 *    producer's own `immunityNames`) is not printed a second time — an
 *    inventory kind, never a failure.
 *  - `breakWithOwnWallUnnamed`: inventory, never a failure — the same
 *    attempts with a wall of the target's own (`defensivePopped`) that the
 *    break's text does not name either (R98 asked about externals).
 */
import { extractKillAttempts } from "@gladlog/analysis/src/utils/killAttempts";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "breakWithExternalUnnamed",
  "breakWithOwnWallUnnamed",
] as const;
const OWN_WALL = "a wall of the target's own beside the break";
const IS_THE_IMMUNITY = "the external is the immunity the line names";
const NAMES_DIFFER = "names other externals";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `breakWithExternalUnnamed|${IS_THE_IMMUNITY}`,
  `breakWithOwnWallUnnamed|${OWN_WALL}`,
]);

/** The names of a FAILED text's `saved by external (…)` clause, or undefined
 * when it has none. Beside a trinket or a break the clause closes the text
 * and lists plain names joined by `/` (the producer's `externalClause` with
 * `plainNames`), each perhaps marked `[up since m:ss]`. */
export function printedExternalNames(failed: string): string[] | undefined {
  const at = failed.indexOf("saved by external (");
  if (at < 0) return undefined;
  const body = failed.slice(at + "saved by external (".length);
  // the clause's own closing parenthesis: a clause may follow it
  // (`; self-saved (Nature's Guardian)`, codex 85-tk-L2-T300-1 #4)
  let depth = 1;
  let close = -1;
  for (let i = 0; i < body.length && close < 0; i++)
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) close = i;
  return (close < 0 ? body : body.slice(0, close))
    .split("/")
    .map((n) => n.replace(/ \[up since \d+:\d{2}\]$/, "").trim())
    .filter(Boolean);
}

const ATTEMPT =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — .*\| FAILED: (.*)$/;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const players = ctx.players as any[];
  const friends = players.filter((u) => u.reaction === owner.reaction);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  let attempts: ReturnType<typeof extractKillAttempts>;
  try {
    attempts = extractKillAttempts(friends, enemies, ctx.legacy);
  } catch {
    return;
  }
  const printed = ctx.lines
    .map((l) => ({ l, m: ATTEMPT.exec(l) }))
    .filter((x) => x.m !== null)
    .map((x) => ({
      line: x.l.trim(),
      from: secOf(x.m![1]!),
      target: x.m![3]!,
      failed: x.m![4]!,
    }));
  for (const a of attempts) {
    const attr = a.attribution;
    if (a.killed || !attr) continue;
    if (attr.primary !== "trinketed" && attr.primary !== "broke-out") continue;
    ctx.bump("breakWithExternalUnnamed");
    ctx.bump("breakWithOwnWallUnnamed");
    // the block names a target by its character name
    const line = printed.find(
      (p) => p.from === Math.floor(a.fromSeconds) && p.target === a.targetName,
    );
    const fact = `${ctx.roundKey}|${owner.reaction}|${a.targetUnitId}|${Math.round(a.fromSeconds * 1000)}`;
    const received = attr.externalReceived.filter(
      (n) => !(attr.brokeOut ?? []).includes(n),
    );
    // the producer's own set: what made the immunity the line names
    const immunity = attr.immunityBaited ? (attr.immunityNames ?? []) : [];
    const externals = received.filter((n) => !immunity.includes(n));
    const detail = `${a.targetName} ${a.fromSeconds.toFixed(1)}–${a.toSeconds.toFixed(1)}s ${attr.primary}${attr.brokeOut?.length ? ` (${attr.brokeOut.join("/")})` : ""}${attr.immunityBaited ? " + immunity" : ""}; externals ${externals.join("/") || "-"}; own walls ${attr.defensivePopped.join("/") || "-"}`;
    const named = printedExternalNames(line?.failed ?? "");
    // a clause with no name, or one where the attempt has no external
    // left, never matches (codex 85-tk-L2-T300-1 #5)
    const sameNames =
      named !== undefined &&
      named.length > 0 &&
      named.length === externals.length &&
      [...named].sort().join("\n") === [...externals].sort().join("\n");
    if (externals.length > 0 && named === undefined)
      ctx.violate(
        "breakWithExternalUnnamed",
        attr.primary === "trinketed" ? "trinketed out" : "broke out",
        ctx.start + a.fromSeconds * 1000,
        fact,
        detail,
        line?.line,
      );
    else if (named !== undefined && !sameNames)
      ctx.violate(
        "breakWithExternalUnnamed",
        NAMES_DIFFER,
        ctx.start + a.fromSeconds * 1000,
        fact,
        `${detail}; printed ${named.join("/")}`,
        line?.line,
      );
    if (
      externals.length === 0 &&
      received.length > 0 &&
      (line?.failed ?? "").includes("forced a full immunity")
    )
      ctx.violate(
        "breakWithExternalUnnamed",
        IS_THE_IMMUNITY,
        ctx.start + a.fromSeconds * 1000,
        fact,
        `${detail}; immunity from ${immunity.join("/")}`,
        line?.line,
      );
    if (attr.defensivePopped.length > 0)
      ctx.violate(
        "breakWithOwnWallUnnamed",
        OWN_WALL,
        ctx.start + a.fromSeconds * 1000,
        fact,
        detail,
        line?.line,
      );
  }
}
