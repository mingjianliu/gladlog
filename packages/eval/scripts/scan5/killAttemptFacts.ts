/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (damageOut, spellCastEvents) */
/**
 * scan5/killAttemptFacts.ts — the KILL ATTEMPTS single items of the round-7
 * audit (fact7 F21, class 14), against the rows.
 *
 *  - `killAnchorSkippedOpener` (D4): `[a–b] on T — X burst (no stun)` naming a
 *    press later than the bracket's opening second while an untargeted press
 *    of a friendly's self-buff opened it. 96fb4d42 1:25: Avenging Wrath at
 *    1:25.276, the line named Ultimate Penitence at 1:30.855.
 *  - `killOwnAreaSaveUncredited` (D10): a FAILED clause that does not name an
 *    area save the target pressed on itself inside the bracket, with the
 *    save's aura on the target. 07367f6e 1:13: Rallying Cry,
 *    `FAILED: not enough damage`.
 *  - `killFocusOverSpan` (D67): `team focus P%` against the team's landed +
 *    absorbed damage on enemy players over the printed bracket + 5 s.
 *    6ac699c9 2:05–2:12: 50 % printed, 71 % over that span.
 */
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ENEMY_AREA_SAVE_IDS } from "@gladlog/analysis/src/data/spellIdLists";

import { deathMs, ev, type IRoundCtx, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "killAnchorSkippedOpener",
  "killOwnAreaSaveUncredited",
  "killFocusOverSpan",
] as const;

/** a bracket the death did not cut: the printed floor of both ends is too
 * coarse for a short bracket's share, so it is shown and not counted */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "killFocusOverSpan|open",
]);

const LINE =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S.*?) — (.+?)(?: opener \([^)]*\), \d+ stuns?| burst \(no stun\)) \| .*team focus (\d+)% .*\| (.*)$/;
const NIL = "0000000000000000";

function run1(ctx: IRoundCtx, line: string): void {
  const m = LINE.exec(line);
  if (!m) return;
  const fromSec = secOf(`${m[1]}:${m[2]}`);
  const toSec = secOf(`${m[3]}:${m[4]}`);
  const target = ctx.byName.get(m[5]!);
  if (!target) return;
  const name = m[6]!;
  const burst = line.includes(" burst (no stun) ");
  const focus = +m[7]!;
  const tail = m[8]!;
  const fromMs = ctx.start + fromSec * 1000;
  const toMs = ctx.start + (toSec + 1) * 1000;
  const friends = ctx.units.filter(
    (u) => u.reaction !== target.reaction && u.info,
  );

  if (burst) {
    ctx.bump("killAnchorSkippedOpener");
    const named = friends
      .flatMap((f) => successesOf(f))
      .filter(
        (c) =>
          getEnglishSpellName(c.spellId, c.spellName ?? "") === name &&
          tsOf(c) >= fromMs &&
          tsOf(c) < toMs,
      )
      .map(tsOf);
    const opensAt = Math.min(Infinity, ...named);
    if (opensAt >= fromMs + 2000) {
      for (const f of friends)
        for (const c of successesOf(f)) {
          if (tsOf(c) < fromMs || tsOf(c) >= fromMs + 1000) continue;
          const dest = c.destUnitId;
          if (dest && dest !== NIL && dest !== f.id) continue;
          // the self-copy of a press aimed at a teammate (Power Infusion
          // writes two SUCCESS rows, 25 ms apart): the press went there
          if (
            successesOf(f).some(
              (o) =>
                o !== c &&
                String(o.spellId) === String(c.spellId) &&
                Math.abs(tsOf(o) - tsOf(c)) <= 100 &&
                o.destUnitId !== f.id,
            )
          )
            continue;
          const ids = new Set([
            String(c.spellId),
            ...effectAurasOfCast(c.spellId),
          ]);
          const selfBuff = (f.auraEvents ?? []).some(
            (a: any) =>
              ids.has(String(a.spellId)) &&
              a.destUnitId === f.id &&
              a.auraType === "BUFF" &&
              ev(a) === "SPELL_AURA_APPLIED" &&
              Math.abs(tsOf(a) - tsOf(c)) <= 300,
          );
          const hitTarget = (f.damageOut ?? []).some(
            (d: any) =>
              d.destUnitId === target.id &&
              d.logLine.timestamp >= fromMs &&
              d.logLine.timestamp < toMs,
          );
          if (selfBuff && hitTarget)
            ctx.violate(
              "killAnchorSkippedOpener",
              "selfBuffOpener",
              fromMs,
              `${m[1]}:${m[2]}`,
              `opened by ${getEnglishSpellName(c.spellId, c.spellName ?? "")}, named ${name}`,
              line,
            );
        }
    }
  }

  ctx.bump("killFocusOverSpan");
  const dead = deathMs(target);
  // the printed ends are floored: the share over either end of those seconds
  const shareTo = (endMs: number, startMs: number) => {
    let on = 0;
    let all = 0;
    const enemyIds = new Set(
      ctx.players
        .filter((u) => u.reaction === target.reaction)
        .map((u) => u.id),
    );
    for (const f of friends)
      for (const d of f.damageOut ?? []) {
        const t = d.logLine.timestamp;
        if (t < startMs || t > endMs || !enemyIds.has(d.destUnitId)) continue;
        const v = Math.abs(d.effectiveAmount ?? 0);
        all += v;
        if (d.destUnitId === target.id) on += v;
      }
    return all > 0 ? (100 * on) / all : 0;
  };
  const inside = dead >= fromMs && dead < toMs;
  const ends = inside
    ? [dead + 5000]
    : [ctx.start + toSec * 1000 + 5000, toMs + 5000];
  const shares = ends.flatMap((e) => [
    shareTo(e, fromMs),
    shareTo(e, fromMs + 999),
  ]);
  const lo = Math.min(...shares) - 3;
  const hi = Math.max(...shares) + 3;
  if (focus < lo || focus > hi)
    ctx.violate(
      "killFocusOverSpan",
      inside ? "bracketCutAtDeath" : "open",
      fromMs,
      `${m[5]}|${m[1]}:${m[2]}`,
      `printed ${focus}%, rows ${shares.map((s) => s.toFixed(0)).join("/")}%`,
      line,
    );

  if (!tail.startsWith("FAILED")) return;
  for (const c of successesOf(target)) {
    const id = String(c.spellId);
    if (!ENEMY_AREA_SAVE_IDS.has(id)) continue;
    if (tsOf(c) < fromMs || tsOf(c) >= toMs) continue;
    const effects = new Set(effectAurasOfCast(id));
    const onIt = (target.auraEvents ?? []).some(
      (a: any) =>
        effects.has(String(a.spellId)) &&
        a.destUnitId === target.id &&
        Math.abs(tsOf(a) - tsOf(c)) <= 1000,
    );
    if (!onIt) continue;
    ctx.bump("killOwnAreaSaveUncredited");
    const saveName = getEnglishSpellName(id, c.spellName ?? "");
    if (!tail.includes(saveName))
      ctx.violate(
        "killOwnAreaSaveUncredited",
        tail.includes("not enough damage") ? "readAsPressure" : "other",
        tsOf(c),
        `${m[5]}|${id}|${tsOf(c)}`,
        `${saveName} pressed ${((tsOf(c) - ctx.start) / 1000).toFixed(1)}s, clause: ${tail.slice(0, 60)}`,
        line,
      );
  }
}

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) run1(ctx, line);
}
