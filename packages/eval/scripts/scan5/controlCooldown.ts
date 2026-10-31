/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/controlCooldown.ts — class 2 of the round-7 audit (fact7 F21, D63 /
 * D64 / D23 / D24): an enemy control read as available while it was on
 * cooldown, because the press had no row of its own (6ab51f91: Intimidation's
 * stun landed at 0:08 with no cast row, and [HEALER EXPOSURE] listed it IN LoS
 * at 0:12 and 0:30) or fell in the window's own second before the window
 * opened (db5b6b6a: Paralysis 0.9 s before Volley).
 *
 * Log truth, rows only, per enemy and control NAME: a use is a
 * SPELL_CAST_SUCCESS of the name by the enemy or a summon of theirs, or a
 * SPELL_AURA_APPLIED of the name from them on a player. A landing within
 * `sameUseMs` after a use is that use: `SAME_USE_S`, or the cast's own landing
 * window where it is longer (a trap walked into 14 s after it was set; Freezing
 * Trap's window outlasts its cooldown and it springs once, so its use is its
 * first landing and `SAME_USE_S` after, a later landing a second use); a
 * summon's row inside that window is the press too (Capacitor Totem's own row
 * 2 s after the shaman's). The cooldown is the context's kit row
 * for the unit (`Name [40s]`, the low end of `[a–Ns]`); a kit row with charges
 * or without a number is skipped.
 *
 * Readers checked: every `IN LoS:` entry of [HEALER EXPOSURE] (kind `exposure:*`)
 * and every `rdy:` entry of an enemy on a [RES] line (kind `res:*`):
 *  - `landingOnly`: spent by a use that has no cast row;
 *  - `pressed`: spent by a use with a cast row, in an earlier second;
 *  - `sameSecond` (exposure only): spent by a use in the printed second, before
 *    the burst opened (the first press of the [OFFENSIVE WINDOW] line's CDs).
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { AOE_CC_LANDING_WINDOW_S } from "@gladlog/analysis/src/utils/drAnalysis";

import { APPLIED, ev, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["controlListedWhileSpent"] as const;

const SAME_USE_S = 5;
const SPRINGS_ONCE_CAST_IDS: ReadonlySet<string> = new Set(["187650"]);
const EXPOSURE =
  /^\s*(\d+):(\d\d)\s+\[HEALER EXPOSURE\].*\| IN LoS: (.*?)(?: \| |$)/;
const ENTRY = /^(.+?) (?:Full|50%|25%|Immune)(?: DR)?$/;
const WINDOW = /^\s*(\d+):(\d\d)\s+\[OFFENSIVE WINDOW\].*\| CDs: (.*)$/;
const TIMED = /^\s*(\d+):(\d\d)\s/;
const RES = /^\s+\[RES\] rdy:(\S.*?)(?:\s+cd:|$)/;

const landingOnlyByAura = new Map<string, number>();

interface IUse {
  ms: number;
  row: boolean;
  auraId?: string;
  castId?: string;
  summon?: boolean;
  firstLandingMs?: number;
}

const sameUseMs = (u: IUse): number =>
  Math.max(SAME_USE_S, AOE_CC_LANDING_WINDOW_S[u.castId ?? ""]?.toS ?? 0) *
  1000;

function usesOf(ctx: IRoundCtx, enemy: any, name: string): IUse[] {
  const own = new Set([
    enemy.id,
    ...ctx.units.filter((u) => u.ownerId === enemy.id).map((u) => u.id),
  ]);
  const rows: IUse[] = [...own].flatMap((id) =>
    successesOf(ctx.units.find((u) => u.id === id) ?? {})
      .filter((c) => nameOf(c.spellId, c.spellName) === name)
      .map((c) => ({
        ms: tsOf(c),
        row: true,
        castId: String(c.spellId),
        summon: id !== enemy.id,
      })),
  );
  const isPressRow = (r: IUse) =>
    !r.summon ||
    !rows.some(
      (p) => !p.summon && r.ms >= p.ms && r.ms - p.ms <= sameUseMs(p),
    );
  const landings: IUse[] = ctx.players
    .flatMap((p) => (p.auraEvents ?? []) as any[])
    .filter(
      (a) =>
        ev(a) === APPLIED &&
        a.auraType === "DEBUFF" &&
        own.has(a.srcUnitId) &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === name,
    )
    .map((a) => ({ ms: tsOf(a), row: false, auraId: String(a.spellId) }));
  const out = rows.filter(isPressRow).sort((a, b) => a.ms - b.ms);
  for (const l of landings.sort((a, b) => a.ms - b.ms)) {
    const use = out.find(
      (u) =>
        l.ms >= u.ms &&
        l.ms - u.ms <= sameUseMs(u) &&
        (!SPRINGS_ONCE_CAST_IDS.has(u.castId ?? "") ||
          u.firstLandingMs === undefined ||
          l.ms - u.firstLandingMs <= SAME_USE_S * 1000),
    );
    if (use) {
      use.firstLandingMs ??= l.ms;
      continue;
    }
    out.push(l);
    out.sort((a, b) => a.ms - b.ms);
  }
  return out;
}

/** the unit's kit: name → low end of its cooldown (no charges) */
function kitsOf(lines: string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  let pid: string | undefined;
  for (const l of lines) {
    const u = /<unit id="(\d+)"/.exec(l);
    if (u) pid = u[1];
    const k = /<cooldowns>(.*)<\/cooldowns>/.exec(l);
    if (!k || !pid) continue;
    const kit = new Map<string, number>();
    for (const m of k[1]!.matchAll(/([^,]+?) \[([^\]]*)\]/g)) {
      const body = m[2]!;
      if (/Charges/.test(body)) continue;
      const cd = /^(?:(\d+)–)?(\d+)s/.exec(body);
      if (cd) kit.set(m[1]!.trim(), Number(cd[1] ?? cd[2]));
    }
    out.set(pid, kit);
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const kits = kitsOf(ctx.lines);
  const enemies = ctx.players.filter((p) => p.reaction !== ctx.owner.reaction);
  const specOf = (u: any): string | undefined => {
    const pid = ctx.pidOf(u.name);
    return pid
      ? new RegExp(`<unit id="${pid}" name="[^"]*" spec="([^"]*)"`).exec(
          ctx.lines.join("\n").slice(0, 40_000),
        )?.[1]
      : undefined;
  };
  const bySpec = new Map<string, any[]>();
  for (const e of enemies) {
    const s = specOf(e);
    if (s) bySpec.set(s, [...(bySpec.get(s) ?? []), e]);
  }
  const judge = (
    reader: "exposure" | "res",
    enemy: any,
    name: string,
    t: number,
    openMs: number | undefined,
    line: string,
  ) => {
    const pid = ctx.pidOf(enemy.name);
    const cd = pid ? kits.get(pid)?.get(name) : undefined;
    if (cd === undefined) return;
    ctx.bump("controlListedWhileSpent");
    const lo = ctx.start + t * 1000;
    const uses = usesOf(ctx, enemy, name);
    const last = uses.filter((u) => u.ms < lo).pop();
    const same = uses.find(
      (u) => u.ms >= lo && openMs !== undefined && u.ms < openMs,
    );
    if (same) {
      ctx.violate(
        "controlListedWhileSpent",
        `${reader}:sameSecond`,
        same.ms,
        `${enemy.name}#${name}#${same.ms}`,
        `${enemy.name} ${name}: used +${same.ms - ctx.start}ms, window opens +${openMs! - ctx.start}ms`,
        line,
      );
      return;
    }
    // the printed second is floored: spent means spent to that second's end
    if (!last || lo + 999 - last.ms >= cd * 1000) return;
    if (!last.row && last.auraId)
      landingOnlyByAura.set(
        last.auraId,
        (landingOnlyByAura.get(last.auraId) ?? 0) + 1,
      );
    ctx.violate(
      "controlListedWhileSpent",
      `${reader}:${last.row ? "pressed" : "landingOnly"}`,
      last.ms,
      `${enemy.name}#${name}#${last.ms}#${t}`,
      `${enemy.name} ${name}: used +${last.ms - ctx.start}ms, ${cd}s cooldown, listed at ${t}s`,
      line,
    );
  };
  let window: { t: number; openMs: number } | undefined;
  let lastT = 0;
  for (const line of ctx.lines) {
    const timed = TIMED.exec(line);
    if (timed) lastT = +timed[1]! * 60 + +timed[2]!;
    const w = WINDOW.exec(line);
    if (w) {
      const t = +w[1]! * 60 + +w[2]!;
      const lo = ctx.start + t * 1000;
      const names = new Set(
        w[3]!.split(" + ").map((c) => c.replace(/@\d+:\d\d.*$/, "").trim()),
      );
      const ms = enemies
        .flatMap(successesOf)
        .filter(
          (c) =>
            tsOf(c) >= lo &&
            tsOf(c) < lo + 1000 &&
            names.has(nameOf(c.spellId, c.spellName)),
        )
        .map(tsOf);
      window = ms.length > 0 ? { t, openMs: Math.min(...ms) } : undefined;
    }
    const x = EXPOSURE.exec(line);
    if (x) {
      const t = +x[1]! * 60 + +x[2]!;
      for (const group of x[3]!.split("; ")) {
        const colon = group.indexOf(": ");
        if (colon < 0) continue;
        const same = bySpec.get(group.slice(0, colon));
        if (same?.length !== 1) continue;
        for (const entry of group.slice(colon + 2).split(", ")) {
          const name = ENTRY.exec(entry.trim())?.[1];
          if (name)
            judge(
              "exposure",
              same[0],
              name,
              t,
              window?.t === t ? window.openMs : undefined,
              line,
            );
        }
      }
    }
    const r = RES.exec(line);
    if (r)
      for (const entry of r[1]!.split(",")) {
        const m = /^(\d+):(.+?)(?:\[.*)?$/.exec(entry.trim());
        if (!m) continue;
        const enemy = ctx.unitOfPid(m[1]);
        if (enemy && enemies.includes(enemy))
          judge("res", enemy, m[2]!, lastT, undefined, line);
      }
  }
}

export function report(): string[] {
  return [
    `controlCooldown inventory — auras whose landing was the only use: ${
      [...landingOnlyByAura]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([id, n]) => `${nameOf(id, id)} ${id} ×${n}`)
        .join(", ") || "none"
    }`,
  ];
}
