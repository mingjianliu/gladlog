/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t60.ts — pipeline T60 (GH #202 item 1): the Holy Priest's Power
 * Word: Shield is aura 1246768, applied by a proc (Prayer of Mending), and
 * its Renew 139 by a talent — neither has a cast row. A reader keyed on the
 * pressed shield's id 17, or on a cast row, sees nothing of them.
 *
 * Check `holyShieldRenewCastRow` (the log fact itself): counted per Holy
 * Priest (spec 257) and round; a violation when that priest logged a
 * SPELL_CAST_SUCCESS of 17, 1246768 or 139.
 *
 * Check `deathAuditShield`, one kind per shield id of the pressed shield's
 * DB2 family (`OWN_SHIELD_RULING_FAMILY_IDS`: 17, the proc 1246768, Void
 * Shield 1253593, Unfolding Vision's copies): a player's death inside the
 * round, on the owner's side (the audit is a friendly death's), whose
 * victim wore the shield in the audit's window
 * (`COUNTERFACTUAL_WINDOW_S` before the death's instant; an aura the
 * opposing side applied is not its mitigation) — the death block prints one
 * `Mitigation audit: <shield's name> active …` row for the name, whatever
 * the number of runs (several applications of one off-table aura are one
 * row). Counted per run; a violation for each run whose name the block has
 * no row of, and (kind `more than one row`) for a name printed twice. The pressed
 * shield 17 was the one id on the audit's whitelist: its kind is the
 * control.
 *
 * Check `purgeTierShield` (measurement, kinds out of the total): the runs of
 * each family id an enemy of the log owner wore, by whether
 * `SPELL_CATEGORIES` registers the id — the missed-purge family asks only
 * of a registered id.
 */
import { OWN_SHIELD_RULING_FAMILY_IDS } from "@gladlog/analysis/src/data/ownShieldLinks";
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { COUNTERFACTUAL_WINDOW_S } from "@gladlog/analysis/src/utils/deathOutcomeAnalysis";

import { fmtS, type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "holyShieldRenewCastRow",
  "deathAuditShield",
  "purgeTierShield",
] as const;

const PRESSED_SHIELD = "17";
const PROC_SHIELD = "1246768";
const RENEW = "139";
const HOLY_PRIEST = "257";
/** the pressed shield first: of two ids of one name, the block's rows it
 * explains are its own */
const FAMILY = [
  PRESSED_SHIELD,
  ...[...OWN_SHIELD_RULING_FAMILY_IDS].filter((id) => id !== PRESSED_SHIELD),
];

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  FAMILY.flatMap((id) => [
    `purgeTierShield|${id} registered`,
    `purgeTierShield|${id} unregistered`,
  ]),
);

export function run(ctx: IRoundCtx): void {
  castRows(ctx);
  deathAudit(ctx);
  purgeTier(ctx);
}

function castRows(ctx: IRoundCtx): void {
  for (const u of ctx.players as any[]) {
    if (String(u.spec) !== HOLY_PRIEST) continue;
    ctx.bump("holyShieldRenewCastRow");
    const rows = successesOf(u).filter((c) =>
      [PRESSED_SHIELD, PROC_SHIELD, RENEW].includes(String(c.spellId)),
    );
    if (rows.length === 0) continue;
    ctx.violate(
      "holyShieldRenewCastRow",
      `cast row of ${String(rows[0].spellId)}`,
      tsOf(rows[0]),
      `${u.name}:${String(rows[0].spellId)}`,
      `${u.name}: ${rows.length} cast row(s) of ${[...new Set(rows.map((c) => String(c.spellId)))].join(" / ")}`,
      "",
    );
  }
}

const DEATH_LINE = /^(\d+:\d\d)\s+\[DEATH\]\s+(\d+)\(/;
const TIMED_LINE = /^(\d+:\d\d)\s/;

function deathAudit(ctx: IRoundCtx): void {
  const names = [...new Set(FAMILY.map((id) => nameOf(id)))];
  for (const victim of ctx.players as any[]) {
    // the audit is printed under a friendly death (`counterfactualOf`)
    if (!ctx.owner || victim.reaction !== ctx.owner.reaction) continue;
    const pid = ctx.pidOf(victim.name);
    if (!pid) continue;
    // every death the block is printed for, not the first alone (codex
    // 85-tk-H-T60-1 #3: a second death of one player went unread)
    const deaths = [
      ...new Set(
        ((victim.deathRecords ?? []) as any[]).map((d) => Number(d.timestamp)),
      ),
    ].filter((ms) => Number.isFinite(ms) && ms <= ctx.roundEndAt);
    for (const diedMs of deaths) deathAuditOf(ctx, victim, pid, diedMs, names);
  }
}

function deathAuditOf(
  ctx: IRoundCtx,
  victim: any,
  pid: string,
  diedMs: number,
  names: string[],
): void {
  const combat = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: ctx.legacy.units,
  };
  {
    const deathS = (diedMs - ctx.start) / 1000;
    const at = ctx.lines.findIndex((l) => {
      const m = DEATH_LINE.exec(l);
      return !!m && m[2] === pid && secOf(m[1]!) === Math.floor(deathS);
    });
    if (at < 0) return;
    // the block's audit rows, by the shield name each prints
    const rowsOfName = new Map<string, number>();
    for (let i = at + 1; i < ctx.lines.length; i++) {
      const l = ctx.lines[i]!;
      // the block's indented lines follow the death line and the other
      // lines of its own second (`[ROSTER]`); the next second ends it
      const t = TIMED_LINE.exec(l);
      if (t) {
        if (secOf(t[1]!) !== Math.floor(deathS) || DEATH_LINE.test(l)) break;
        continue;
      }
      const name = names.find((n) =>
        l.includes(`Mitigation audit: ${n} active `),
      );
      if (name) rowsOfName.set(name, (rowsOfName.get(name) ?? 0) + 1);
    }
    const fromS = Math.max(0, deathS - COUNTERFACTUAL_WINDOW_S);
    const opposing = new Set(
      (ctx.players as any[])
        .filter((u) => u.reaction !== victim.reaction)
        .map((u) => u.name),
    );
    const intervals = buildAuraIntervals(victim, combat as any);
    for (const [name, n] of rowsOfName)
      if (n > 1)
        ctx.violate(
          "deathAuditShield",
          "more than one row",
          diedMs,
          `${victim.name}:${name}`,
          `${victim.name} died at ${fmtS(deathS)}: ${n} rows of ${name} in one block`,
          ctx.lines[at]!.trim().slice(0, 160),
        );
    for (const id of FAMILY) {
      const name = nameOf(id);
      const runs = intervals.filter(
        (iv) =>
          iv.spellId === id &&
          !opposing.has(iv.srcUnitName) &&
          Math.min(iv.toS, deathS) > Math.max(iv.fromS, fromS),
      ).length;
      for (let k = 0; k < runs; k++) {
        ctx.bump("deathAuditShield");
        if ((rowsOfName.get(name) ?? 0) > 0) continue;
        ctx.violate(
          "deathAuditShield",
          `${id} ${name}`,
          diedMs,
          `${victim.name}:${id}:${k}`,
          `${victim.name} died at ${fmtS(deathS)} wearing ${id} in the final ${COUNTERFACTUAL_WINDOW_S}s (${runs} run(s)); the block has ${rowsOfName.get(name) ?? 0} row(s) of ${name}`,
          ctx.lines[at]!.trim().slice(0, 160),
        );
      }
    }
  }
}

function purgeTier(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const combat = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: ctx.legacy.units,
  };
  for (const u of ctx.players as any[]) {
    if (u.reaction === ctx.owner.reaction) continue;
    for (const iv of buildAuraIntervals(u, combat as any)) {
      if (!OWN_SHIELD_RULING_FAMILY_IDS.has(iv.spellId)) continue;
      ctx.bump("purgeTierShield");
      const registered = SPELL_CATEGORIES[iv.spellId] !== undefined;
      ctx.violate(
        "purgeTierShield",
        `${iv.spellId} ${registered ? "registered" : "unregistered"}`,
        ctx.start + iv.fromS * 1000,
        `${u.name}:${iv.spellId}:${iv.fromS.toFixed(3)}`,
        `${u.name} wore ${iv.spellId} ${fmtS(iv.fromS)}–${fmtS(iv.toS)}`,
        "",
      );
    }
  }
}
