/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesIn) */
/**
 * scan5/kitAimed.ts — fact12 D30: the ENEMY CC KIT's `(aimed at you|them N×,
 * never landed)` counts presses, not miss rows.
 *
 * Truth = the kit unit's own SPELL_MISSED rows of a failed control
 * (`CONTROL_FAILED_MISS_TYPES`, a lookup) from that enemy or one of its
 * summons, under the entry's English name, inside the round. One press can
 * log its failure twice — under the cast id and under its control effect's
 * id, in one millisecond (ee79ddb7 r0 0:45: Intimidation 474421 + 24394, both
 * IMMUNE under a Cyclone) — or as two effects each refused its own way
 * (GH #205: Holy Word: Chastise's stun IMMUNE and its damage MISS, 1 ms
 * apart). Which rows are one press is the producer's own rule, imported
 * (`isTwinMissRow`), not a second grouping here: the two used to disagree.
 * What this check owns is the row set — whose rows, which miss types, which
 * name, inside the round.
 *
 * Check `kitAimedCount`, kinds:
 *  - `rowsCounted`: N is more than the presses;
 *  - `pressesMissed`: N is fewer.
 */
import {
  CONTROL_FAILED_MISS_TYPES,
  isTwinMissRow,
} from "@gladlog/analysis/src/utils/castMissRows";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["kitAimedCount"] as const;

const KIT = /^ENEMY CC KIT \(threats to (?:your healer (\d+)\S* at|you\b)/;
const ENEMY = /^(.+?) \((\S+)\): (.+)$/;
const AIMED =
  /(?:^|, )([^,[(]+?)(?: \[[^\]]+\])? \(aimed at (?:you|them) (\d+)×, never landed\)/g;

export function run(ctx: IRoundCtx): void {
  const line = [...ctx.lines, ...ctx.menu.split("\n")].find((l) => KIT.test(l));
  if (!line) return;
  const pid = KIT.exec(line)![1];
  const unit = pid ? ctx.unitOfPid(pid) : ctx.owner;
  if (!unit) return;
  const list = line.slice(line.indexOf("): ") + 3);
  for (const part of list.split("; ")) {
    const e = ENEMY.exec(part);
    if (!e) continue;
    const enemy = ctx.byName.get(e[2]!);
    if (!enemy) continue;
    for (const a of e[3]!.matchAll(AIMED)) {
      const spellName = a[1]!.trim();
      const printed = Number(a[2]);
      ctx.bump("kitAimedCount");
      const rows = ((unit.missesIn ?? []) as any[])
        .filter(
          (m) =>
            !!m.spellId &&
            CONTROL_FAILED_MISS_TYPES.has(m.missType) &&
            m.timestamp >= ctx.start &&
            m.timestamp <= ctx.roundEndAt &&
            (m.srcUnitId === enemy.id ||
              ctx.units.find((u: any) => u.id === m.srcUnitId)?.ownerId ===
                enemy.id) &&
            nameOf(m.spellId, m.spellName ?? "") === spellName,
        )
        .sort((x, y) => x.timestamp - y.timestamp);
      // the producer's own press rule: a row that is the twin of one already
      // counted is that press
      const counted: any[] = [];
      for (const m of rows)
        if (!counted.some((r) => isTwinMissRow(r, m, ctx.start)))
          counted.push(m);
      const presses = counted.length;
      if (presses === 0 || printed === presses) continue;
      ctx.violate(
        "kitAimedCount",
        printed > presses ? "rowsCounted" : "pressesMissed",
        rows[0]!.timestamp,
        `${e[2]}|${spellName}`,
        `printed ${printed}×, presses ${presses} (rows ${rows.length})`,
        line,
      );
    }
  }
}
