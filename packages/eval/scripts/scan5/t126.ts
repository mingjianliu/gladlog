/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t126.ts — pipeline T126 (fact13 D34): a unit whose PvP trinket slot
 * holds Adaptation (passive: it breaks a long control by itself, nothing to
 * press) was printed as holding a pressable trinket — KILL ATTEMPTS
 * `opportunity: trinket up`, the `[CONTESTED]` enemy healer's `trinket
 * available`. The prompt's words for a unit with nothing to press are
 * `no pressable PvP trinket` / `trinket none to press` (fact7 r5, user ruling
 * 2026-10-31).
 *
 * Log truth, per unit: its COMBATANT_INFO trinket slots (12 / 13) hold an
 * Adaptation item (`trinketItemIds.json` adaptationItemIds, a lookup) and no
 * Gladiator's Medallion 336126 press of it inside the round — the producer's
 * `medallionPressedInRound`, its round bound (a press would prove the item
 * list stale).
 *
 *  - `adaptationTrinketWords`: every rendered trinket statement about such a
 *    unit — a KILL ATTEMPTS `opportunity:` of the locked tier (`trinket up` /
 *    `trinket locked by a racial` / `no pressable PvP trinket`), a
 *    `[CONTESTED]` enemy healer's `trinket available` / `on CD` /
 *    `none to press`, a kill-window `Focused:` / `Other:` row's `trinket
 *    available` / `trinket on CD` / `no pressable PvP trinket`. A violation
 *    when the words claim a trinket to press. Kind = the line form.
 */
import trinketItemIdsData from "@gladlog/analysis/src/data/trinketItemIds.json";
import { medallionPressedInRound } from "@gladlog/analysis/src/utils/trinketType";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["adaptationTrinketWords"] as const;

const ADAPTATION_ITEMS = new Set<string>(
  (trinketItemIdsData as { adaptationItemIds: string[] }).adaptationItemIds,
);

const FORMS: Array<{
  kind: string;
  re: RegExp;
  pressable: (word: string) => boolean;
}> = [
  {
    kind: "kill attempts",
    re: /^\s*\[\d+:\d{2}–\d+:\d{2}\] on (\S+?) — .*\| opportunity: (trinket up|trinket locked by a racial|no pressable PvP trinket)\b/,
    pressable: (w) => w !== "no pressable PvP trinket",
  },
  {
    kind: "contested",
    re: /\[CONTESTED\] .* on enemy healer (\S+?) \(DR [^,]+, trinket (available|on CD|none to press)\)/,
    pressable: (w) => w !== "none to press",
  },
  {
    kind: "kill window",
    re: /^\s*(?:Focused|Other):\s+.*? \((\S+?)\) — .*, (trinket available|trinket on CD|no pressable PvP trinket) \[kill-opportunity/,
    pressable: (w) => w !== "no pressable PvP trinket",
  },
];

export function run(ctx: IRoundCtx): void {
  const holders = new Map<string, any>();
  for (const u of ctx.players as any[]) {
    const slots = ((u.info?.equipment ?? []) as any[]).filter(
      (_, i) => i === 12 || i === 13,
    );
    if (!slots.some((e) => ADAPTATION_ITEMS.has(String(e.id)))) continue;
    // the producer's own bound for "pressed in the round" (codex
    // 85-tk-M-T126-1b #1: a 3v3 round runs to the log's end there)
    const pressed = medallionPressedInRound(u, {
      startTime: ctx.start,
      endTime: ctx.end,
      startInfo: ctx.legacy.startInfo,
      units: ctx.legacy.units,
    });
    if (!pressed) holders.set(u.name, u);
  }
  if (holders.size === 0) return;
  ctx.lines.forEach((line, i) => {
    for (const f of FORMS) {
      const m = f.re.exec(line);
      if (!m) continue;
      if (!holders.has(m[1]!)) continue;
      ctx.bump("adaptationTrinketWords");
      if (!f.pressable(m[2]!)) continue;
      ctx.violate(
        "adaptationTrinketWords",
        `${f.kind}: ${m[2]}`,
        ctx.start,
        `${m[1]}:${f.kind}:${i}`,
        `${m[1]} holds Adaptation (no Medallion press logged) yet the line says "${m[2]}"`,
        line.trim().slice(0, 200),
      );
    }
  });
}
