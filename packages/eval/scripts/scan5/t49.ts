/**
 * scan5/t49.ts — ticket T49 (r12b N8): one aura, one reading of whether it
 * was pressed. The `[ENEMY DEF]` line marks an aura no press put up
 * `[no press logged]` (`enemyDefensiveEvents`' `noPressLogged`: a copy a
 * talent or proc put up, a rider shield); the BURST LEDGER's line for the
 * same aura must not say it was pressed.
 *
 *  - `ledgerPressedNoPress`: a ledger line `<Wall> active ON THE TARGET …
 *    (pressed Zs after|before the burst opened)` while the same context's
 *    `[ENEMY DEF]` line for that wall on that unit, at the second the ledger
 *    places it (burst start + Z, both printed floored: ± 1 s), carries
 *    `[no press logged]`. Kind = the wall's name.
 */
import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["ledgerPressedNoPress"] as const;

const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d{2})/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_PRESSED =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \(pressed (<?[\d.]+)s (after|before) the burst opened\)/;
const ENEMY_DEF_NO_PRESS =
  /^(\d+:\d{2})\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?)(?: \+ \d+% copy)?(?: → (\d+)\([^)]*\))? \(.*\[no press logged\]/;
/** any `[ENEMY DEF]` line of a wall (pressed when it has no no-press tag) */
const ENEMY_DEF_ANY =
  /^(\d+:\d{2})\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?)(?: \+ \d+% copy)?(?: → (\d+)\([^)]*\))? \(/;

export function run(ctx: IRoundCtx): void {
  const C = "ledgerPressedNoPress";
  const noPress: Array<{ at: number; holder: string; wall: string }> = [];
  // the ledger names its target by name alone: a name two units carry
  // identifies neither, and the line is not judged (codex 85-tk-H-T49-1b #1)
  const unitsNamed = (name: string): number =>
    ctx.units.filter((u) => u.name === name).length;
  // T98 (fact13 D5): a copy a press of its own then refreshed is two
  // timeline lines, the copy `[no press logged]` and the press; the ledger's
  // one interval of that aura says "pressed" at the press
  const pressed: Array<{ at: number; holder: string; wall: string }> = [];
  for (const l of ctx.lines) {
    const m = ENEMY_DEF_NO_PRESS.exec(l);
    if (!m) {
      const a = ENEMY_DEF_ANY.exec(l);
      const h = a && ctx.unitOfPid(a[4] ?? a[2]);
      if (a && h) pressed.push({ at: secOf(a[1]!), holder: h.id, wall: a[3]! });
      continue;
    }
    const holder = ctx.unitOfPid(m[4] ?? m[2]);
    if (holder)
      noPress.push({ at: secOf(m[1]!), holder: holder.id, wall: m[3]! });
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
    if (unitsNamed(target) !== 1) continue;
    const targetId = ctx.units.find((u) => u.name === target)!.id;
    ctx.bump(C);
    // T114 (batch review 80-PIPE-94-B82): `before` places the press ahead
    // of the burst's start
    const z = Number(p[2]!.replace("<", ""));
    const at = p[3] === "before" ? head - z : head + z;
    const hit = noPress.find(
      (n) =>
        n.wall === p[1] &&
        n.holder === targetId &&
        n.at >= at - 1.05 &&
        n.at <= at + 1.05,
    );
    if (!hit) continue;
    if (
      pressed.some(
        (n) =>
          n.wall === p[1] &&
          n.holder === targetId &&
          n.at >= hit.at &&
          n.at >= at - 1.05 &&
          n.at <= at + 1.05,
      )
    )
      continue;
    ctx.violate(
      C,
      p[1]!,
      ctx.start + at * 1000,
      `${target}#${p[1]}#${hit.at}`,
      `the ledger says ${p[1]} was pressed ${p[2]}s ${p[3]} the burst opened; its [ENEMY DEF] line at ${hit.at}s says [no press logged]`,
      l.trim().slice(0, 300),
    );
  }
}
