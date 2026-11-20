/* eslint-disable @typescript-eslint/no-explicit-any -- the round's units are the untyped legacy parse objects */
/**
 * scan5/t191.ts — pipeline T191 (GH #173 item 45, #221): Improved
 * Spellsteal's delayed re-steal. The press applies 1270828 "Spellsteal"
 * (DEBUFF) on the target — on the mage himself when the target reflects it —
 * and as it ends ~4 s later a SPELL_STOLEN of Spellsteal from the mage lands
 * at the same ms. That steal is the earlier press's effect, never a press of
 * its own, and #221 reads it `(passive)`.
 *
 * Re-steals are found from the raw rows alone: a SPELL_DISPEL / SPELL_STOLEN
 * of the round whose source's SPELL_AURA_REMOVED of a
 * `DELAYED_REPEAT_DEBUFF_IDS` debuff of the same name lands within
 * `DISPEL_RIDES_PRESS_MS` (on any unit). Each is then read with the
 * producer's own index (`buildCastMatchIndex` over the round's units) and
 * predicates:
 *  - `restealReadAsPress`: `classifyDispel` calls it deliberate — a press
 *    (7686e97d r3 2:24: matched by name to the mage's next Spellsteal 0.67 s
 *    later; [MISSED PURGE] then said that press took the re-steal's Renew);
 *  - `restealSideEffect`: `dispelRodeOwnPress` makes the [MINOR DISPELS] fold
 *    call it a side effect of a cast (b81efd46 r2 0:48) instead of #221's
 *    `(passive)`;
 *  - `restealShape` (inventory, not in the total): every re-steal by where
 *    its debuff ended (target / caster / another unit) and source flags
 *    (resolved / unresolved).
 * Rows of one source, spell and millisecond count once.
 */
import {
  buildCastMatchIndex,
  classifyDispel,
  DELAYED_REPEAT_DEBUFF_IDS,
  DISPEL_RIDES_PRESS_MS,
  dispelRodeOwnPress,
  isUnresolvedSourceFlags,
} from "@gladlog/analysis/src/utils/dispelKind";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import { type IRoundCtx } from "./ctx";

export const CHECKS = [
  "restealReadAsPress",
  "restealSideEffect",
  "restealShape",
] as const;

const SIDES = ["on the target", "on the caster", "on another unit"] as const;
const FLAGS = ["resolved", "unresolved"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  SIDES.flatMap((s) => FLAGS.map((f) => `restealShape|${s} | ${f}`)),
);

interface IEnd {
  ms: number;
  src: string;
  dest: string;
  name: string;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const ends: IEnd[] = [];
  const removals: Array<{
    ms: number;
    src: string;
    dest: string;
    flags: number;
    spellId: string;
    spellName: string;
  }> = [];
  for (const l of ctx.rawLines) {
    const isEnd = l.includes("SPELL_AURA_REMOVED");
    if (!isEnd && !l.includes("SPELL_STOLEN") && !l.includes("SPELL_DISPEL"))
      continue;
    const parts = splitRawLine(l);
    if (!parts) continue;
    const ms = parseRawTimestamp(parts.datePart);
    if (ms === null || ms < ctx.start || ms > ctx.roundEndAt + 1000) continue;
    const p = parts.params;
    const name = (p[9] ?? "").replace(/^"|"$/g, "");
    if (parts.eventName === "SPELL_AURA_REMOVED") {
      if (DELAYED_REPEAT_DEBUFF_IDS.has(p[8] ?? ""))
        ends.push({ ms, src: p[0] ?? "", dest: p[4] ?? "", name });
    } else if (
      parts.eventName === "SPELL_STOLEN" ||
      parts.eventName === "SPELL_DISPEL"
    )
      removals.push({
        ms,
        src: p[0] ?? "",
        dest: p[4] ?? "",
        flags: Number.parseInt(p[2] ?? "0", 16),
        spellId: p[8] ?? "",
        spellName: name,
      });
  }
  if (ends.length === 0) return;
  const index = buildCastMatchIndex(ctx.units as any[]);
  const seen = new Set<string>();
  for (const r of removals) {
    if (r.ms > ctx.roundEndAt) continue;
    const end = ends.find(
      (e) =>
        e.src === r.src &&
        e.name === r.spellName &&
        Math.abs(e.ms - r.ms) <= DISPEL_RIDES_PRESS_MS,
    );
    if (!end) continue;
    const key = `${r.src}|${r.spellId}|${r.ms}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const side =
      end.dest === r.dest ? SIDES[0] : end.dest === r.src ? SIDES[1] : SIDES[2];
    const flags = isUnresolvedSourceFlags(r.flags) ? FLAGS[1] : FLAGS[0];
    const d = {
      srcUnitId: r.src,
      spellId: r.spellId,
      spellName: r.spellName,
      timestamp: r.ms,
      srcFlags: r.flags,
    };
    const at = `${r.spellName} at +${((r.ms - ctx.start) / 1000).toFixed(3)} s, debuff ended ${side} ${end.ms - r.ms} ms`;
    const fact = `${ctx.roundKey}|${key}`;
    const kind = `${side} | ${flags}`;
    ctx.bump("restealShape");
    ctx.violate("restealShape", kind, r.ms, fact, at);
    const pressed = classifyDispel(index, d) === "deliberate";
    ctx.bump("restealReadAsPress");
    if (pressed) ctx.violate("restealReadAsPress", kind, r.ms, fact, at);
    ctx.bump("restealSideEffect");
    if (!pressed && dispelRodeOwnPress(index, d))
      ctx.violate("restealSideEffect", kind, r.ms, fact, at);
  }
}
