/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t72.ts — pipeline T72 (user ruling R19, 2026-11-10): five 45 s damage
 * buttons with no use condition are major offensive cooldowns — Reaper's
 * Mark, Odyn's Fury, Meteor, Goremaw's Bite, Mindgames. Exactly these five.
 *
 * Two checks, both over every round of the capture:
 *  - `ruledOffensivePress`: every SPELL_CAST_SUCCESS of one of the five by a
 *    player of either side. A violation is a press the producer's own
 *    predicate (`isOffensiveCdFor`, the reader of `OFFENSIVE_CD_SPELL_IDS`)
 *    does not call an offensive cooldown. Kind = the spell.
 *  - `killWindowRuledPressUnnamed`: a press of one of the five by a player
 *    of the owner's side whose rendered second falls inside a rendered
 *    `[KILL WINDOW]` / `[VULNERABLE]` span `a–b` (seconds a … b−1: the
 *    producer's span end is fractional, so the last rendered second is left
 *    out). A violation is a line that does not name the spell — the line
 *    names every team offensive cooldown ready at, back inside or pressed
 *    inside the span (`createKillWindowFactsComputer`).
 *
 * Attempt 2 (2026-11-12, CI visual diff of scene report-synth: a burst-ledger
 * row `0:08–0:08 Meteor [no damage dealt]` beside a recap listing Meteor
 * 122.7k at 0:11):
 *  - `pressOnlyDeliveryOutsideBurst`: every offensive press of the owner
 *    whose effect span is the press instant (no effect aura: Meteor, Soul
 *    Fire …), any spell — counted whatever end the delivery reading gave
 *    it (`endIsDelivery`). Log truth, rows only: the owner's damage rows on
 *    enemy players that carry the press's own spell name (a shield-eaten
 *    row by its attack spell), after the press and
 *    before the same button's next press (at most `DELIVERY_REACH_S`). A
 *    violation is a burst (`analyzeBurstLedger`) that ends before the last
 *    such row. Kind = spell + what each reader then says: `card:no-damage`
 *    (the desktop ledger's tag, no dominant target), `card:total` (a total
 *    without the delivery), and the prompt's `Burst #` block:
 *    `prompt:no-damage`, `prompt:total`, `prompt:silent`, `prompt:absent`.
 *
 * `RULED` is the ruling's own list, not a copy of a producer table: the scan
 * asks the producer about each id.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  analyzeBurstLedger,
  burstCastSpan,
} from "@gladlog/analysis/src/utils/burstLedger";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { isOffensiveCdFor } from "@gladlog/analysis/src/utils/spellDanger";

import { ev, type IRoundCtx, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "ruledOffensivePress",
  "killWindowRuledPressUnnamed",
  "pressOnlyDeliveryOutsideBurst",
] as const;

/** R19: id → the roster name the prompt prints */
export const RULED: Readonly<Record<string, string>> = {
  "439843": "Reaper's Mark",
  "385059": "Odyn's Fury",
  "153561": "Meteor",
  "426591": "Goremaw's Bite",
  "375901": "Mindgames",
};

export const WINDOW_RE =
  /^\s+\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)/;

/** how far after a press its own damage rows are looked for (the scan's
 * reach, not a product constant: the observed delays are in the details) */
const DELIVERY_REACH_S = 20;
const BURST_HEAD = /^\s+Burst #\d+ — (\d+:\d\d)–(\d+:\d\d) \| (.*)$/;

/** the spell a damage row delivers: a shield-eaten row (SPELL_ABSORBED)
 * carries the shield in its spell fields and the attack beside them */
const deliveredName = (d: any): string => {
  const absorbed = ev(d) === "SPELL_ABSORBED";
  const id = absorbed ? d.attackSpellId : d.spellId;
  const name = absorbed ? d.attackSpellName : d.spellName;
  // the English name, as the ledger's `cd.spellName` is: the row's own name
  // is in the recording client's language (codex 81-tk-G-T72-2b #2)
  return id === undefined || id === null
    ? ""
    : getEnglishSpellName(String(id), name ?? "");
};

function deliveryCheck(ctx: IRoundCtx, start: number): void {
  const owner = ctx.owner as any;
  if (!owner) return;
  const combat = ctx.legacy as any;
  const friends = ctx.players.filter((p: any) => p.reaction === owner.reaction);
  const enemies = ctx.players.filter((p: any) => p.reaction !== owner.reaction);
  const enemyIds = new Set(enemies.map((e: any) => e.id));
  const cds =
    reconstructEnemyCDTimeline([owner], combat).players[0]?.offensiveCDs ?? [];
  // a press with no effect aura and no official length, whatever end the
  // delivery reading gave it: one still at the press instant, or one the
  // producer says it ran to its delivery (`endIsDelivery`). Not "its span is
  // still zero" alone — that dropped every press the reading had moved, a
  // partly read one included (codex 81-tk-G-T72-2 #2)
  const pressOnly = cds.filter(
    (cd) =>
      !cd.refusedAtPress &&
      (cd.endIsDelivery === true || burstCastSpan(cd).to <= cd.castTimeSeconds),
  );
  if (pressOnly.length === 0) return;
  const entries = analyzeBurstLedger(owner, friends, enemies, combat);
  for (const cd of pressOnly) {
    ctx.bump("pressOnlyDeliveryOutsideBurst");
    const pressMs = start + cd.castTimeSeconds * 1000;
    const cdName = getEnglishSpellName(cd.spellId, cd.spellName);
    const nextS = cds
      .filter(
        (c) =>
          c.spellId === cd.spellId && c.castTimeSeconds > cd.castTimeSeconds,
      )
      .reduce((m, c) => Math.min(m, c.castTimeSeconds), Infinity);
    // …and inside the round, as the ledger reads it (`roundEndMs`: a Solo
    // Shuffle round ends at its deciding death, any other bracket at the
    // log's end — not `ctx.roundEndAt`, which stops a 3v3 at its first
    // death while the ledger's windows run on; codex 81-tk-G-T72-2b #1). A
    // row after it (s2/1-4-11: the owner dead at 2:25, the Meteor pressed at
    // 2:23 landing 0.9 s later) is no window's to hold
    const untilMs = Math.min(
      roundEndMs(combat),
      start + Math.min(nextS, cd.castTimeSeconds + DELIVERY_REACH_S) * 1000,
    );
    const rows = (owner.damageOut as any[]).filter(
      (d) =>
        enemyIds.has(d.destUnitId) &&
        deliveredName(d) === cdName &&
        tsOf(d) > pressMs &&
        tsOf(d) <= untilMs,
    );
    if (rows.length === 0) continue;
    const entry = entries.find(
      (e) =>
        e.fromSeconds <= cd.castTimeSeconds &&
        e.toSeconds >= cd.castTimeSeconds,
    );
    const lastMs = Math.max(...rows.map(tsOf));
    const firstMs = Math.min(...rows.map(tsOf));
    if (entry && start + entry.toSeconds * 1000 >= lastMs) continue;
    const sum = rows.reduce((a, d) => a + Math.abs(d.effectiveAmount ?? 0), 0);
    const card = !entry
      ? "card:absent"
      : entry.dominantTarget
        ? "card:total"
        : "card:no-damage";
    // the prompt's block for this burst, when the owner's context has one
    let prompt = "prompt:absent";
    if (entry) {
      const fs = Math.floor(entry.fromSeconds);
      for (let i = 0; i < ctx.lines.length; i++) {
        const m = BURST_HEAD.exec(ctx.lines[i]!);
        if (!m || secOf(m[1]!) !== fs || !m[3]!.includes(cd.spellName))
          continue;
        const block: string[] = [];
        for (let j = i + 1; j < ctx.lines.length; j++) {
          if (BURST_HEAD.test(ctx.lines[j]!) || !/^\s{4}/.test(ctx.lines[j]!))
            break;
          block.push(ctx.lines[j]!);
        }
        prompt = block.some((b) => b.includes("No damage dealt"))
          ? "prompt:no-damage"
          : block.some((b) => b.includes("your damage"))
            ? "prompt:total"
            : "prompt:silent";
        break;
      }
    }
    const ids = [
      ...new Set(
        rows.map((d) =>
          ev(d) === "SPELL_ABSORBED"
            ? `absorbed ${d.attackSpellId}`
            : String(d.spellId),
        ),
      ),
    ].join("/");
    // rows of a differently named part of the same button ("Meteor Burn"),
    // told apart only so the count can say how much a name-exact reader
    // leaves out
    const kin = (owner.damageOut as any[]).filter(
      (d) =>
        enemyIds.has(d.destUnitId) &&
        typeof d.spellName === "string" &&
        d.spellName.startsWith(`${cd.spellName} `) &&
        tsOf(d) > pressMs &&
        tsOf(d) <= untilMs,
    );
    const kinNote =
      kin.length === 0
        ? ""
        : `; kin rows (${[...new Set(kin.map((d) => `${d.spellName} ${d.spellId}`))].join("/")}) ${kin.length} to +${((Math.max(...kin.map(tsOf)) - pressMs) / 1000).toFixed(2)}s, ${Math.round(kin.reduce((x, d) => x + Math.abs(d.effectiveAmount ?? 0), 0))} damage`;
    ctx.violate(
      "pressOnlyDeliveryOutsideBurst",
      `${cd.spellName} ${card} ${prompt}`,
      pressMs,
      `${owner.id}|${cd.spellId}|${pressMs}`,
      `${cd.spellName} ${cd.spellId} pressed +${cd.castTimeSeconds.toFixed(1)}s, burst ${entry ? `${entry.fromSeconds.toFixed(1)}–${entry.toSeconds.toFixed(1)}` : "none"}; own rows (${ids}) ${rows.length} from +${((firstMs - pressMs) / 1000).toFixed(2)}s to +${((lastMs - pressMs) / 1000).toFixed(2)}s, ${Math.round(sum)} damage${kinNote}`,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  const start = (ctx.legacy as any).startTime as number;
  deliveryCheck(ctx, start);
  const presses = ctx.players.flatMap((u: any) =>
    successesOf(u)
      .filter((c: any) => String(c.spellId) in RULED)
      .map((c: any) => ({ u, id: String(c.spellId), at: tsOf(c) as number })),
  );
  if (presses.length === 0) return;
  if (ctx.firstOwnerOfRound)
    for (const p of presses) {
      ctx.bump("ruledOffensivePress");
      if (isOffensiveCdFor(p.id, p.u.spec)) continue;
      ctx.violate(
        "ruledOffensivePress",
        RULED[p.id]!,
        p.at,
        `${p.u.id}|${p.id}|${p.at}`,
        `${RULED[p.id]} ${p.id} pressed at +${((p.at - start) / 1000).toFixed(1)}s is not an offensive cooldown to isOffensiveCdFor`,
      );
    }
  if (!ctx.owner) return;
  const own = presses.filter((p) => p.u.reaction === ctx.owner.reaction);
  if (own.length === 0) return;
  for (const l of ctx.lines) {
    const m = WINDOW_RE.exec(l);
    if (!m) continue;
    const from = secOf(m[1]!);
    const to = secOf(m[2]!);
    for (const p of own) {
      const s = Math.floor((p.at - start) / 1000);
      if (s < from || s >= to) continue;
      ctx.bump("killWindowRuledPressUnnamed");
      if (l.includes(RULED[p.id]!)) continue;
      ctx.violate(
        "killWindowRuledPressUnnamed",
        RULED[p.id]!,
        p.at,
        `${ctx.owner.id}|${m[1]}|${p.id}|${p.at}`,
        `${RULED[p.id]} pressed at +${((p.at - start) / 1000).toFixed(1)}s inside the ${m[1]}–${m[2]} window, the line does not name it`,
        l.trim().slice(0, 160),
      );
    }
  }
}
