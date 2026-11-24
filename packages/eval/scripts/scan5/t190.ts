/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, absorbsIn) */
/**
 * scan5/t190.ts — pipeline T190 (fact14 D22; Curated-List forward check): a
 * cheat-death talent that fired has a line. The observable ground truth is
 * the log's own SPELL_ABSORBED row under the talent's id — DB2 gives the
 * talent aura 316 on every school (a hit that would kill is absorbed
 * instead), and the row names it: `…,404195,"Defy Fate",0x1,71177,…`.
 *
 *  - `cheatDeathProcNoLine`: every absorb row of a player under a DB2
 *    passive aura-316 talent (`talentEffectInventoryGenerated.json`: aura
 *    316, activation `passive` — Cheat Death 31230, Cauterize 86949,
 *    Purgatory 114556, Last Resort 209258, Defy Fate 404195, Kill or Be
 *    Killed 1265361; not Spirit of Redemption 20711, whose absorb is the
 *    death into the on-death form), inside the round, one per unit and
 *    talent per `PROC_ROWS_ONE_MS`. Checked against the rendered timeline:
 *    a `<talent's name> (cheat-death proc)` line of that unit — `[YOU] [PROC]` for
 *    the owner, `[TEAM] [PROC] <pid>` for a teammate, `[ENEMY DEF] <pid>` for
 *    an enemy — in the absorb's second or the one beside it. A violation
 *    when there is none (adc4288a 1:08: the owner's Defy Fate ate a
 *    Starsurge and printed nothing). Kind = the talent's name | side. The
 *    hand tables (`CRISIS_PROC_ANSWERS`, `ENEMY_PROC_SAVES`) are not read:
 *    an id they lack is what the check is for.
 */
import INVENTORY from "@gladlog/analysis/src/data/talentEffectInventoryGenerated.json";

import { fmtS, type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["cheatDeathProcNoLine"] as const;

/** Spirit of Redemption: the absorb is the priest dying into the on-death
 * form, which the product reads as the kill (`combatStates.ts`, `:ghost`) —
 * no survival to print (codex 85-tk-L1-T190-1 #7) */
const ON_DEATH_FORM_TALENT_IDS: ReadonlySet<string> = new Set(["20711"]);

/** DB2: the passive talents whose effect is aura 316 (cheat death) */
export const CHEAT_DEATH_TALENT_IDS: ReadonlySet<string> = new Set(
  (
    INVENTORY as unknown as {
      rows: Array<{ spellId: string; aura: number; activation?: string }>;
    }
  ).rows
    .filter(
      (r) =>
        r.aura === 316 &&
        r.activation === "passive" &&
        !ON_DEATH_FORM_TALENT_IDS.has(r.spellId),
    )
    .map((r) => r.spellId),
);

/** one proc's absorb rows (a hit split over rows) stand this close */
const PROC_ROWS_ONE_MS = 1000;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function run(ctx: IRoundCtx): void {
  const C = "cheatDeathProcNoLine";
  if (!ctx.owner) return;
  for (const u of ctx.players as any[]) {
    const rows = ((u.absorbsIn ?? []) as any[])
      .filter((a) => CHEAT_DEATH_TALENT_IDS.has(String(a.spellId ?? "")))
      .map((a) => ({
        id: String(a.spellId),
        ms: (a.logLine?.timestamp ?? a.timestamp) as number,
      }))
      .filter((a) => a.ms >= ctx.start && a.ms <= ctx.roundEndAt)
      .sort((a, b) => a.ms - b.ms);
    const last = new Map<string, number>();
    for (const r of rows) {
      const prev = last.get(r.id);
      last.set(r.id, r.ms);
      if (prev !== undefined && r.ms - prev <= PROC_ROWS_ONE_MS) continue;
      const pid = ctx.pidOf(u.name);
      if (pid === undefined) continue;
      const side =
        u.id === ctx.owner.id
          ? "owner"
          : u.reaction === ctx.owner.reaction
            ? "teammate"
            : "enemy";
      const head =
        side === "owner"
          ? String.raw`\[YOU\] \[PROC\]`
          : side === "teammate"
            ? String.raw`\[TEAM\] \[PROC\]\s+${esc(pid)}\(`
            : String.raw`\[ENEMY DEF\]\s+${esc(pid)}\(`;
      const sec = (r.ms - ctx.start) / 1000;
      const re = new RegExp(
        String.raw`^\s*(?:${[sec - 1, sec, sec + 1]
          .filter((s) => s >= 0)
          .map((s) => esc(fmtS(s)))
          .join(
            "|",
          )})\s+${head}.*${esc(nameOf(r.id, r.id))} \(cheat-death proc\)`,
      );
      ctx.bump(C);
      if (!ctx.lines.some((l) => re.test(l)))
        ctx.violate(
          C,
          `${nameOf(r.id, r.id)} | ${side}`,
          r.ms,
          `${ctx.roundKey}|${u.id}|${r.id}|${r.ms}`,
          `${u.name} ${nameOf(r.id, r.id)} absorbed a killing blow at +${sec.toFixed(3)} s: no (cheat-death proc) line`,
        );
    }
  }
}
