/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t218.ts — pipeline T218 (round-14 D36, 3c8cd2a3 r0 2:49): a
 * shaman's Counterstrike Totem (SPELL_SUMMON 204331, npc 105451) dealt 317k
 * and `[DMG SPIKE]` / the death's top-damage list named the source
 * `4(EShaman)'s guardian — Counterstrike`, while the same prompt's control
 * lines call that shaman's Capacitor Totem a `totem`.
 *
 * Re-derived from the raw rows, then checked against the rendered lines:
 *  - a unit a SPELL_SUMMON row created whose summoning spell's official
 *    English name has the word "Totem" (the word `summonKindWord` reads) is
 *    a totem of the row's source;
 *  - `totemDamageNamedGuardian`: per round, owner and spell that such a
 *    totem dealt damage with (a *_DAMAGE row from its GUID inside the
 *    round): a violation when a rendered line names
 *    `<owner pid>'s guardian — <spell>`. Not judged
 *    (`totemDamageSharedSpell`) when another summon of that owner that is
 *    no totem and no `Pet-` unit dealt the same spell in the round — the
 *    label may be that one's.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import { type IRoundCtx } from "./ctx";

export const CHECKS = [
  "totemDamageNamedGuardian",
  "totemDamageSharedSpell",
] as const;

const TOTEM_NAME = /\bTotem\b/;

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does a line name `<pid>(<Spec>)'s guardian — <spell>` as a whole entry:
 * the entry ends at the line's end, its school tag ` [`, its amount ` (`,
 * or the list's `,` — "Counterstrike Totem" is another spell. `ownerPid` is
 * the roster number (`ctx.pidOf`), the label prints `N(Spec)`.
 */
export function lineNamesGuardianDamage(
  line: string,
  ownerPid: string,
  spell: string,
): boolean {
  return new RegExp(
    String.raw`(?:^|[^\d])${escapeRe(ownerPid)}(?:\([^)]*\))?'s guardian — ${escapeRe(spell)}(?:$| [[(]|,|\))`,
  ).test(line);
}

export function run(ctx: IRoundCtx): void {
  /** summoned GUID → { owner GUID, totem? } */
  const summons = new Map<string, { owner: string; totem: boolean }>();
  const dmg: Array<{ ms: number; src: string; spell: string }> = [];
  for (const l of ctx.rawLines) {
    const isSummon = l.includes("SPELL_SUMMON");
    if (!isSummon && !l.includes("_DAMAGE")) continue;
    const parts = splitRawLine(l);
    if (!parts) continue;
    const p = parts.params;
    if (parts.eventName === "SPELL_SUMMON") {
      const dest = p[4] ?? "";
      if (!dest || dest.startsWith("Pet-")) continue;
      summons.set(dest, {
        owner: p[0] ?? "",
        totem: TOTEM_NAME.test(getEnglishSpellName(p[8] ?? "", p[9] ?? "")),
      });
      continue;
    }
    if (
      parts.eventName !== "SPELL_DAMAGE" &&
      parts.eventName !== "SPELL_PERIODIC_DAMAGE" &&
      parts.eventName !== "RANGE_DAMAGE"
    )
      continue;
    const src = p[0] ?? "";
    if (!src.startsWith("Creature-") && !src.startsWith("Vehicle-")) continue;
    const ms = parseRawTimestamp(parts.datePart);
    if (ms === null || ms < ctx.start || ms > ctx.roundEndAt) continue;
    dmg.push({ ms, src, spell: getEnglishSpellName(p[8] ?? "", p[9] ?? "") });
  }
  if (summons.size === 0 || dmg.length === 0) return;
  const unitByGuid = new Map<string, any>(
    (ctx.units as any[]).map((u) => [u.id, u]),
  );
  // owner|spell → dealt by a totem / by a non-totem summon
  const byTotem = new Map<string, number>();
  const byOther = new Set<string>();
  for (const d of dmg) {
    const s = summons.get(d.src);
    if (!s) continue;
    const key = `${s.owner}|${d.spell}`;
    if (s.totem) {
      if (!byTotem.has(key)) byTotem.set(key, d.ms);
    } else byOther.add(key);
  }
  for (const [key, firstMs] of byTotem) {
    const [owner, spell] = key.split("|") as [string, string];
    const unit = unitByGuid.get(owner);
    const pid = unit ? ctx.pidOf(unit.name) : undefined;
    if (!pid) continue;
    if (byOther.has(key)) {
      ctx.bump("totemDamageSharedSpell");
      continue;
    }
    ctx.bump("totemDamageNamedGuardian");
    const line = ctx.lines.find((l) => lineNamesGuardianDamage(l, pid, spell));
    if (line)
      ctx.violate(
        "totemDamageNamedGuardian",
        spell,
        firstMs,
        `${owner}:${spell}`,
        `${unit.name}'s totem dealt ${spell}; a line names it ${pid}'s guardian — ${spell}`,
        line.trim().slice(0, 240),
      );
  }
}
