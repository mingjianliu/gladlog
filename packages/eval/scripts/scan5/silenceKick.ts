/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/silenceKick.ts — class 7 of the round-7 audit (fact7 F21, D47 / D48 /
 * D74): a silence filed as an interrupt. Truth = DB2 SpellEffect itself, read
 * from the datagen cache (`$DATAGEN_CACHE`, default ~/.cache/gladlog-datagen,
 * newest 12.1.x table), never the kit's own `silenceOnly`: a spell with an
 * aura-27 silence row and no effect-68 INTERRUPT_CAST row is a silence.
 *
 * Check `silenceFiledAsKick`, kinds:
 *  - `[KICK] miss`: a `[KICK] …'s X on N missed — IMMUNE` line of such a spell;
 *  - `kickersInRange`: a kick-eaten row whose `maxKickRangeYd` is above every
 *    real interrupt of the enemy side and equals a silence's range (the
 *    silence's own range read as a kicker's);
 *  - `[KICK] own audit line`, `enemy interrupts UP`: the readers the user
 *    moved with ruling 2026-10-30, counted like the others;
 *  - `inKit`: a silence still in the interrupt kit.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  INTERRUPT_SPELL_IDS,
  interruptForUnit,
} from "@gladlog/analysis/src/utils/enemyInterrupts";
import { spellRangeForCaster } from "@gladlog/analysis/src/utils/spellRange";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["silenceFiledAsKick"] as const;

let silenceIds: Set<string> | undefined;
function silenceOnlyIds(ctx: IRoundCtx): Set<string> {
  if (silenceIds) return silenceIds;
  const dir =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache/gladlog-datagen");
  const out = new Set<string>();
  const file = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^SpellEffect-12\.1\.5\.\d+\.csv$/.test(f))
        .sort()
        .pop()
    : undefined;
  if (file) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    const cols = lines[0]!.trim().split(",");
    const sp = cols.indexOf("SpellID");
    const ef = cols.indexOf("Effect");
    const au = cols.indexOf("EffectAura");
    const kick = new Set<string>();
    for (const l of lines.slice(1)) {
      const f = l.split(",");
      if (f[ef] === "68") kick.add(f[sp]!);
      if (f[ef] === "6" && f[au] === "27") out.add(f[sp]!);
    }
    for (const id of kick) out.delete(id);
  } else ctx.bump("silenceFiledAsKick: no DB2 cache");
  silenceIds = out;
  return out;
}

/** Keyed on the press row, not the name: Solar Beam's press 78675 has no
 * aura 27 (its aura 81261 does), and DB2 has other "Silence" rows with effect
 * 68. `sec` = the printed second. */
function pressIsSilence(
  ctx: IRoundCtx,
  ids: Set<string>,
  name: string,
  sec: number | undefined,
): boolean {
  const lo = sec === undefined ? -Infinity : ctx.start + sec * 1000 - 1000;
  const hi = sec === undefined ? Infinity : ctx.start + sec * 1000 + 2000;
  return ctx.players.some((u) =>
    successesOf(u).some(
      (c: any) =>
        ids.has(String(c.spellId)) &&
        nameOf(String(c.spellId), c.spellName ?? "") === name &&
        tsOf(c) >= lo &&
        tsOf(c) < hi,
    ),
  );
}

const KICK_MISS = /\[KICK\]\s+.*?'s (.+?) on \d+\([^)]*\) missed — IMMUNE/;
const KICK_OWN = /\[KICK\]\s+your (.+?) (?:on .*)?— (?:hit nothing|missed|\[)/;
const UP = /enemy interrupts UP: ([^|]*)/;

const secOfLine = (line: string): number | undefined => {
  const m = /^\s*(\d+):(\d\d)/.exec(line);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

export function run(ctx: IRoundCtx): void {
  const ids = silenceOnlyIds(ctx);
  ctx.lines.forEach((line, i) => {
    const m = KICK_MISS.exec(line);
    if (m) {
      ctx.bump("silenceFiledAsKick");
      if (pressIsSilence(ctx, ids, m[1]!, secOfLine(line)))
        ctx.violate(
          "silenceFiledAsKick",
          "[KICK] miss",
          ctx.start,
          `${m[1]}#${i}#${line.slice(0, 8)}`,
          `${m[1]} is a silence (DB2: aura 27, no effect 68)`,
          line,
        );
    }
    const o = KICK_OWN.exec(line);
    if (o && pressIsSilence(ctx, ids, o[1]!, secOfLine(line)))
      ctx.violate(
        "silenceFiledAsKick",
        "[KICK] own audit line",
        ctx.start,
        `${o[1]}#${line.slice(0, 8)}`,
        `${o[1]}: the owner's audit line`,
        line,
      );
    const u = UP.exec(line);
    if (u)
      for (const k of u[1]!.split(", ")) {
        const n = k.split("/")[0]!.trim();
        if (pressIsSilence(ctx, ids, n, undefined))
          ctx.violate(
            "silenceFiledAsKick",
            "enemy interrupts UP",
            ctx.start,
            `${n}#${line.slice(0, 8)}`,
            `${n} listed as an interrupt`,
            line,
          );
      }
  });
  const enemies = ctx.players.filter(
    (p) => p.info?.teamId !== ctx.owner.info?.teamId,
  );
  const defs = enemies.flatMap((e) => {
    const d = interruptForUnit(e as never);
    return d ? [{ e, d }] : [];
  });
  for (const id of INTERRUPT_SPELL_IDS)
    if (ids.has(id))
      ctx.violate(
        "silenceFiledAsKick",
        "inKit",
        ctx.start,
        id,
        `${nameOf(id, id)} is in the interrupt kit`,
      );
  const silences = enemies.flatMap((e) =>
    [...new Set(successesOf(e).map((c: any) => String(c.spellId)))]
      .filter((id) => ids.has(id))
      .map((id) => ({ e, id })),
  );
  if (silences.length === 0) return;
  const realMax = Math.max(
    0,
    ...defs
      .filter((x) => !ids.has(x.d.spellId))
      .map((x) => spellRangeForCaster(x.e as never, x.d.spellId) ?? 0),
  );
  for (const row of ctx.menu.split("\n")) {
    if (!/type=kick-eaten/.test(row)) continue;
    const m = /maxKickRangeYd=(\d+)/.exec(row);
    if (!m) continue;
    ctx.bump("silenceFiledAsKick");
    const yd = Number(m[1]);
    const t = /t=([\d.]+)s/.exec(row)?.[1] ?? "?";
    if (
      yd > realMax &&
      silences.some(
        (s) =>
          Math.round(spellRangeForCaster(s.e as never, s.id) ?? 0) === yd,
      )
    )
      ctx.violate(
        "silenceFiledAsKick",
        "kickersInRange",
        ctx.start + Number(t) * 1000,
        `kick-eaten#${t}`,
        `maxKickRangeYd=${yd}: a silence's range; real interrupts reach ${realMax}`,
        row,
      );
  }
}
