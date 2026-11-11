/**
 * scan5/t49.ts — ticket T49 (r12b N8): one aura, one reading of whether it
 * was pressed. The `[ENEMY DEF]` line marks an aura no press put up
 * `[no press logged]` (`enemyDefensiveEvents`' `noPressLogged`: a copy a
 * talent or proc put up, a rider shield); the BURST LEDGER's line for the
 * same aura must not say it was pressed.
 *
 *  - `ledgerPressedNoPress`: a ledger line `<Wall> active ON THE TARGET …
 *    (pressed Zs after the burst opened)` while the same context's
 *    `[ENEMY DEF]` line for that wall on that unit, at the second the ledger
 *    places it (burst start + Z, both printed floored: ± 1 s), carries
 *    `[no press logged]`. Kind = the wall's name.
 */
import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["ledgerPressedNoPress"] as const;

const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d{2})/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_PRESSED =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \(pressed (<?[\d.]+)s after the burst opened\)/;
const ENEMY_DEF_NO_PRESS =
  /^(\d+:\d{2})\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?)(?: \+ \d+% copy)?(?: → (\d+)\([^)]*\))? \(.*\[no press logged\]/;

export function run(ctx: IRoundCtx): void {
  const C = "ledgerPressedNoPress";
  const noPress: Array<{ at: number; holder: string; wall: string }> = [];
  for (const l of ctx.lines) {
    const m = ENEMY_DEF_NO_PRESS.exec(l);
    if (!m) continue;
    const holder = ctx.unitOfPid(m[4] ?? m[2]);
    if (holder)
      noPress.push({ at: secOf(m[1]!), holder: holder.name, wall: m[3]! });
  }
  let head: number | undefined;
  let target: string | undefined;
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      head = secOf(h[1]!);
      target = undefined;
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t) {
      target = t[1];
      continue;
    }
    const p = BURST_PRESSED.exec(l);
    if (!p || head === undefined || target === undefined) continue;
    ctx.bump(C);
    const at = head + Number(p[2]!.replace("<", ""));
    const hit = noPress.find(
      (n) =>
        n.wall === p[1] &&
        n.holder === target &&
        n.at >= at - 1.05 &&
        n.at <= at + 1.05,
    );
    if (!hit) continue;
    ctx.violate(
      C,
      p[1]!,
      ctx.start + at * 1000,
      `${target}#${p[1]}#${hit.at}`,
      `the ledger says ${p[1]} was pressed ${p[2]}s into the burst; its [ENEMY DEF] line at ${hit.at}s says [no press logged]`,
      l.trim().slice(0, 300),
    );
  }
}
