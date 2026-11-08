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
 * IMMUNE under a Cyclone) — so rows of one enemy and one name less than a
 * second apart are one press: no control is pressed twice by one player
 * inside a second.
 *
 * Check `kitAimedCount`, kinds:
 *  - `rowsCounted`: N is more than the presses;
 *  - `pressesMissed`: N is fewer.
 */
import { CONTROL_FAILED_MISS_TYPES } from "@gladlog/analysis/src/utils/castMissRows";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["kitAimedCount"] as const;

const KIT = /^ENEMY CC KIT \(threats to (?:your healer (\d+)\S* at|you\b)/;
const ENEMY = /^(.+?) \((\S+)\): (.+)$/;
const AIMED =
  /(?:^|, )([^,[(]+?)(?: \[[^\]]+\])? \(aimed at (?:you|them) (\d+)×, never landed\)/g;
/** rows of one press are this close, or closer */
const ONE_PRESS_MS = 1000;

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
        .map((m) => m.timestamp as number)
        .sort((x, y) => x - y);
      let presses = 0;
      let last = -Infinity;
      for (const t of rows) {
        if (t - last >= ONE_PRESS_MS) presses++;
        last = t;
      }
      if (presses === 0 || printed === presses) continue;
      ctx.violate(
        "kitAimedCount",
        printed > presses ? "rowsCounted" : "pressesMissed",
        rows[0]!,
        `${e[2]}|${spellName}`,
        `printed ${printed}×, presses ${presses} (rows ${rows.length})`,
        line,
      );
    }
  }
}
