/**
 * GH #176 (user ruling 2026-11-02): `[PRESS]` — a press of a button with an
 * official cooldown of 45 s or more that no hand list names, printed when no
 * other line of the timeline already states it (`lineStatesPress`, the
 * predicate `listGapPress` counts a missing line by). The numbers come from
 * the shared cooldown model (`extractOffListPresses`).
 *
 * Runs after every other emitter, so the lines it checks against are all in.
 */
import { getEnglishSpellName } from "../../data/spellEffectData";
import { specToString } from "../../utils/cooldowns";
import {
  type IOffListPress,
  lineStatesPress,
  PRESS_LINE_NEAR_S,
} from "../../utils/offListPress";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export const OFF_LIST_PRESS_TAG = "[PRESS]";

export const OFF_LIST_PRESS_LEGEND = [
  "  [PRESS] = a player pressed a button with a cooldown of 45 s or more that no other line names (a movement,",
  "    utility or throughput button: Divine Steed, Shadowmeld, Gladiator's Badge, Holy Word: Serenity …). `Ns cd` =",
  "    that player's cooldown with their talents; `back m:ss` = when it was ready again, every reduction and reset",
  "    included; `a charge left` = they still held one; `reset, ready again` = a talent reset it at that press;",
  "    `2 equipped … another in hand` = two of the item worn, a cooldown each, the other one ready;",
  "    `free press` = a talent or an ally's Time Spiral let them press it without spending the cooldown",
  "    (`back` is then the cooldown it stands on); `lasts Ns` = how long its effect runs. A fact, not a verdict.",
];

const TIME_PREFIX = /^\s*\d+:\d\d\s+/;
const leadingNumber = (label: string): string | undefined =>
  /^(\d+)\(/.exec(label)?.[1];

function seconds(s: number): string {
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

/** Render and add the `[PRESS]` lines; returns whether any was added. */
export function emitOffListPressEntries(
  ctx: Pick<
    TimelineCtx,
    "owner" | "friends" | "pid" | "enemyPid" | "addEntry" | "entries"
  > & { presses: readonly IOffListPress[] },
): boolean {
  const { owner, friends, pid, enemyPid, addEntry, entries, presses } = ctx;
  const friendly = new Set(friends.map((f) => f.id));
  const ownerNumber = leadingNumber(pid(owner.name));
  // the lines already in, by whole second
  const bySecond = new Map<number, string[]>();
  for (const e of entries)
    for (const l of e.lines) {
      if (typeof l !== "string") continue;
      const s = Math.floor(e.timeSeconds);
      const list = bySecond.get(s) ?? [];
      list.push(l.replace(TIME_PREFIX, ""));
      bySecond.set(s, list);
    }
  let added = false;
  for (const p of presses) {
    const label = friendly.has(p.unit.id)
      ? pid(p.unit.name)
      : enemyPid(p.unit.name);
    const number = p.unit.id === owner.id ? ownerNumber : leadingNumber(label);
    const name = getEnglishSpellName(p.spellId, "");
    if (!name) continue;
    const sec = Math.floor(p.timeSeconds);
    let stated = false;
    for (let s = sec - PRESS_LINE_NEAR_S; s <= sec + PRESS_LINE_NEAR_S; s++)
      if (
        (bySecond.get(s) ?? []).some((text) =>
          lineStatesPress(text, name, number, ownerNumber),
        )
      )
        stated = true;
    if (stated) continue;
    const parts: string[] = [];
    if (p.durationSeconds !== undefined)
      parts.push(`lasts ${seconds(Math.round(p.durationSeconds * 10) / 10)}`);
    const cd = Math.round(p.cooldownSeconds * 10) / 10;
    parts.push(
      p.equipped
        ? `${p.equipped} equipped, ${seconds(cd)} cd each`
        : p.charges > 1
          ? `${p.charges} charges, ${seconds(cd)} cd`
          : `${seconds(cd)} cd`,
    );
    if (p.free) parts.push("free press");
    if (p.readyAgainAtSeconds !== null)
      parts.push(
        Math.floor(p.readyAgainAtSeconds) > sec
          ? `back ${fmtTime(p.readyAgainAtSeconds)}`
          : p.equipped
            ? "another in hand"
            : p.charges > 1
              ? "a charge left"
              : p.free
                ? "ready again"
                : "reset, ready again",
      );
    const what = `${name} (${parts.join(", ")})`;
    const line =
      p.unit.id === owner.id
        ? `${fmtTime(p.timeSeconds)}  [YOU] ${OFF_LIST_PRESS_TAG}   ${what}`
        : `${fmtTime(p.timeSeconds)}  ${OFF_LIST_PRESS_TAG}   ${label} (${specToString(p.unit.spec)}): ${what}`;
    if (addEntry(p.timeSeconds, line)) added = true;
  }
  return added;
}
