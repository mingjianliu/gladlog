/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, damageOut) */
/**
 * scan5/t132.ts — ticket T132 (user ruling 2026-11-17, wave-4 A10): Divine
 * Hammer cannot be parried. DB2 reads its hit row 198137 as parryable
 * (DefenseType 2, No Active Defense clear, Speed 0), so `ABILITIES INTO
 * IMMUNITY/DR` counted it with the casts a parry stops — e20c35b2 r5 0:24:
 * `Blade of Justice + Divine Hammer + Blade of Justice into …'s Die by the
 * Sword`, the 2-cast line of the parry reading.
 *
 *  - `divineHammerParryReading`: an `ABILITIES INTO IMMUNITY/DR` line that
 *    lists Divine Hammer on a wall whose verdict for what a parry stops
 *    differs from its verdict for the rest (Die by the Sword, Evasion), and
 *    that is the parry reading's line. The two readings never share a line,
 *    so the line's reading is its other spells': kind `beside <spell>` when
 *    another listed spell is one a parry stops (a PARRY row of it this round,
 *    else DB2's tables — never `parryStopsAttack`, the predicate under
 *    audit); kind `no line for the rest` when the wall prints no line for
 *    what a parry cannot stop (`never` / `unresolved`); kind `alone, under
 *    the door` when Divine Hammer is the line's only spell and its count is
 *    below the other reading's door. Kind `alone, at the door` (out of the
 *    total) is a Divine Hammer-only line either reading could have printed.
 *    Checked = every such line on a two-reading wall.
 */
import {
  mitigationVerdictOf,
  nonMeleeMitigationVerdictOf,
} from "@gladlog/analysis/src/data/mitigationVerdicts";
import { PARRYABLE_SPELL_IDS } from "@gladlog/analysis/src/data/spellParryGenerated";
import { withoutDeferralTag } from "@gladlog/analysis/src/utils/offensiveWasteAnalysis";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["divineHammerParryReading"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "divineHammerParryReading|alone, at the door",
]);

const DIVINE_HAMMER = "Divine Hammer";
const INTO_LINE =
  /^\s*\[(\d+):(\d\d)\] [^(]+\((\S+)\): (.+) into (\S+)'s (.+)$/;
const PARRY_ROW =
  /\bSPELL_MISSED,([^,]+),.*?,(\d+),"([^"]*)",0x[0-9a-fA-F]+,PARRY\b/;
/** the section's doors, by verdict (the verdict table, as data) */
const doorOf = (v: unknown): number => (v === "unconditional" ? 2 : 3);

/** `A ×2 + B + A` → spell → listed count */
function listedCounts(list: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of list.split(" + ")) {
    const m = /^(.+?)(?: ×(\d+))?$/.exec(part.trim())!;
    out.set(m[1]!, (out.get(m[1]!) ?? 0) + (m[2] ? Number(m[2]) : 1));
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  let parried: Set<string> | undefined;
  for (const line of ctx.lines) {
    const m = INTO_LINE.exec(line);
    if (!m) continue;
    const listed = listedCounts(m[4]!);
    if (!listed.has(DIVINE_HAMMER)) continue;
    const friend = ctx.byName.get(m[3]!);
    const target = ctx.byName.get(m[5]!);
    if (!friend || !target) continue;
    const lo = ctx.start + (+m[1]! * 60 + +m[2]!) * 1000;
    const up = ((target.auraEvents ?? []) as any[]).find(
      (a) =>
        nameOf(a.spellId, a.spellName) === withoutDeferralTag(m[6]!) &&
        ev(a) === APPLIED &&
        tsOf(a) >= lo - 1000 &&
        tsOf(a) < lo + 1000,
    );
    if (!up) continue;
    const wallKey = String(up.spellId);
    const melee = mitigationVerdictOf(wallKey);
    const rest = nonMeleeMitigationVerdictOf(wallKey);
    if (rest === melee) continue;
    ctx.bump("divineHammerParryReading");
    const factId = `${ctx.roundKey}:${friend.id}:${target.id}:${m[1]}:${m[2]}`;
    const violate = (kind: string, detail: string) =>
      ctx.violate(
        "divineHammerParryReading",
        kind,
        lo,
        factId,
        detail,
        line.trim().slice(0, 240),
      );
    if (rest !== "unconditional" && rest !== "kill-live-gated") {
      violate(
        "no line for the rest",
        `${m[6]} prints no line for what a parry cannot stop, and this one lists Divine Hammer`,
      );
      continue;
    }
    if (!parried) {
      parried = new Set<string>();
      for (const l of ctx.rawLines) {
        const p = PARRY_ROW.exec(l);
        if (!p) continue;
        const owner = ctx.units.find((u) => u.id === p[1])?.ownerId;
        const caster = owner && !/^0+$/.test(owner) ? owner : p[1]!;
        parried.add(`${caster}|${nameOf(p[2]!, p[3]!)}`);
      }
    }
    // the ids a spell of the friend's is logged under: presses and rows
    const idsOf = (spell: string): Set<string> => {
      const ids = new Set<string>();
      for (const c of successesOf(friend))
        if (nameOf(c.spellId, c.spellName) === spell)
          ids.add(String(c.spellId));
      for (const d of (friend.damageOut ?? []) as any[]) {
        const id = ev(d) === ABSORBED ? d.attackSpellId : d.spellId;
        const n =
          ev(d) === ABSORBED
            ? nameOf(d.attackSpellId, d.attackSpellName)
            : nameOf(d.spellId, d.spellName);
        if (id && n === spell) ids.add(String(id));
      }
      return ids;
    };
    const others = [...listed.keys()].filter((s) => s !== DIVINE_HAMMER);
    const stopped = others.find(
      (s) =>
        parried!.has(`${friend.id}|${s}`) ||
        [...idsOf(s)].some((id) => PARRYABLE_SPELL_IDS.has(id)),
    );
    if (stopped)
      violate(
        `beside ${stopped}`,
        `Divine Hammer is listed with ${stopped}, which a parry stops: the line is ${m[6]}'s parry reading`,
      );
    else if (others.length === 0)
      violate(
        listed.get(DIVINE_HAMMER)! < doorOf(rest)
          ? "alone, under the door"
          : "alone, at the door",
        `Divine Hammer ×${listed.get(DIVINE_HAMMER)} alone into ${m[6]} (the door for what a parry cannot stop is ${doorOf(rest)})`,
      );
  }
}
