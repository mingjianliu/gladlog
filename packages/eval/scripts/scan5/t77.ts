/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t77.ts — pipeline T77: counts for the research items of GH #124 /
 * #143 / #167 / #173 that the log's own rows answer. Each round once; a
 * "violation" here is an OCCASION of the item's trigger, counted so the item
 * can be fixed or closed with a number — not a rendered line shown false.
 *
 *  - `ascendanceProcAsPress` (GH #124 item 9): every press the ledger's
 *    aura fallback claims for Restoration Ascendance 114052
 *    (`auraOnlyActivationSeconds`, the producer's own list). Kind
 *    `proc-length` when that aura's logged run is at most `PROC_MAX_S` (the
 *    Deeply Rooted Elements proc's 6 s; a press runs 15 s), `full-length`
 *    otherwise, `no-end` when the log shows no REMOVED.
 *  - `iceBarrierNoPress` (GH #167 item 12): Ice Barrier 11426 APPLIED by a
 *    mage on itself with no press that puts it up (`ownShieldPressCastIds`,
 *    the producer's link table) in the `NO_PRESS_BEFORE_MS` before. Kind
 *    `resync` when the log is listing the unit's auras again
 *    (`isResyncBatchAt`), `unexplained` otherwise; `-pressed-span` when the
 *    product still reads a pressed shield there (`ownPressedShieldSpansMs`),
 *    `-no-span` when it does not.
 *  - `stealthAllowedPress` (GH #173 item 36): a self-applied Prowl 5215 /
 *    102547 or Shadowmeld 58984 with no later REMOVED that the product ends
 *    (`holderFirstOwnActionAfterMs`) at a press allowed while stealthed
 *    (DB2, `ALLOWED_WHILE_STEALTHED_SPELL_IDS`).
 *  - `stealthVisibleRunPress` (the measurement behind item 36, fact7
 *    `unseenEndOpener`'s method on Prowl / Shadowmeld): on a run whose
 *    REMOVED is logged, the holder's FIRST press after it went up — kind
 *    `allowed-kept` / `other-kept` when the run went on more than
 *    `RUN_END_MS` after the press, `allowed-ended` / `other-ended` when it
 *    ended within `RUN_END_MS` of it. Checked = those first presses.
 *  - `divineHammerParry` (GH #173 item 39): Divine Hammer 198034 / 198137
 *    SPELL_MISSED rows that say PARRY, over every damage / miss row of it;
 *    `divineHammerMissTypes` lists its miss rows by type.
 *  - `multiBoltAbsorbId` (GH #173 item 43): SPELL_ABSORBED rows whose attack
 *    is a multi-bolt spell (`MULTI_BOLT_IDS`) with no damage or miss row of
 *    that id anywhere in the round.
 *  - `mergedCcNoCast` (GH #143 item 6): a control REMOVED and APPLIED again
 *    on one unit from one source within 5 ms with no cast of it by that
 *    source in the 3 s before; kind `press-after` when the holder's PvP
 *    trinket goes out within 8 s (the case the "ended on its own" reading
 *    could get wrong), `no-press` otherwise.
 */
import { ownShieldPressCastIds } from "@gladlog/analysis/src/data/ownShieldLinks";
import { ALLOWED_WHILE_STEALTHED_SPELL_IDS } from "@gladlog/analysis/src/data/spellStateAttrsGenerated";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { auraOnlyActivationSeconds } from "@gladlog/analysis/src/utils/cooldowns";
import {
  holderFirstOwnActionAfterMs,
  ownPressedShieldSpansMs,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { pvpTrinketUses } from "@gladlog/analysis/src/utils/pvpTrinketUses";
import { isResyncBatchAt } from "@gladlog/analysis/src/utils/resyncBatch";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "ascendanceProcAsPress",
  "iceBarrierNoPress",
  "stealthAllowedPress",
  "stealthVisibleRunPress",
  "divineHammerParry",
  "divineHammerMissTypes",
  "multiBoltAbsorbId",
  "mergedCcNoCast",
] as const;

const ASCENDANCE_RESTO = "114052";
const PROC_MAX_S = 8;
const NO_PRESS_BEFORE_MS = 2000;
const ICE_BARRIER = "11426";
const STEALTH_BROKEN_BY_ACTION = new Set(["5215", "102547", "58984"]);
const RUN_END_MS = 100;
const OWN_PRESS_ROW_MS = 150;
const MULTI_BOLT_IDS = new Set([
  "257045", // Rapid Fire
  "198030", // Eye Beam
  "47666", // Penance
  "1232571", // Penance
  "198590", // Drain Soul
  "234153", // Drain Life
  "7268", // Arcane Missiles
  "15407", // Mind Flay
]);
const DIVINE_HAMMER = /,(198034|198137),"/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const at = (ms: number) => fmtS((ms - ctx.start) / 1000);
  const iceBarrierPresses = ownShieldPressCastIds(ICE_BARRIER);
  for (const u of ctx.players) {
    const casts = successesOf(u);
    const auras: any[] = u.auraEvents ?? [];
    // ── the ledger's aura-read Ascendance presses ──
    for (const sec of auraOnlyActivationSeconds(
      u,
      ASCENDANCE_RESTO,
      ctx.start,
      // the ledger's own bound: a cast row kept from after the round is no
      // cast of it (codex 85-tk-F-T77-1 #5)
      ctx.end,
    )) {
      const t = ctx.start + sec * 1000;
      if (t < ctx.start) continue;
      ctx.bump("ascendanceProcAsPress");
      const end = auras.find(
        (b) =>
          b.spellId === ASCENDANCE_RESTO && ev(b) === REMOVED && tsOf(b) > t,
      );
      const runS = end ? (tsOf(end) - t) / 1000 : undefined;
      ctx.violate(
        "ascendanceProcAsPress",
        runS === undefined
          ? "no-end"
          : runS <= PROC_MAX_S
            ? "proc-length"
            : "full-length",
        t,
        `${u.id}:${Math.round(t)}`,
        `the ledger reads a press of Ascendance 114052 at ${at(t)} from its aura alone; that aura ran ${runS === undefined ? "with no REMOVED" : `${runS.toFixed(1)}s`}`,
      );
    }
    // ── Ice Barrier with no press ──
    for (const a of auras) {
      if (
        a.spellId !== ICE_BARRIER ||
        ev(a) !== APPLIED ||
        a.srcUnitId !== u.id
      )
        continue;
      ctx.bump("iceBarrierNoPress");
      const t = tsOf(a);
      if (
        casts.some(
          (c) =>
            iceBarrierPresses.has(c.spellId) &&
            tsOf(c) >= t - NO_PRESS_BEFORE_MS &&
            tsOf(c) <= t + OWN_PRESS_ROW_MS,
        )
      )
        continue;
      const pressed =
        ownPressedShieldSpansMs(u, ICE_BARRIER, t, t + 1).length > 0;
      ctx.violate(
        "iceBarrierNoPress",
        `${isResyncBatchAt(u, t) ? "resync" : "unexplained"}-${pressed ? "pressed-span" : "no-span"}`,
        t,
        `${u.id}:${t}`,
        `Ice Barrier applied at ${at(t)} with no press that puts it up in the ${NO_PRESS_BEFORE_MS / 1000} s before`,
      );
    }
    // ── a stealth with no REMOVED, then an allowed-while-stealthed press ──
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (
        !STEALTH_BROKEN_BY_ACTION.has(a.spellId) ||
        ev(a) !== APPLIED ||
        a.srcUnitId !== u.id
      )
        continue;
      if (
        auras
          .slice(i + 1)
          .some((b) => b.spellId === a.spellId && ev(b) === REMOVED)
      )
        continue;
      const t = tsOf(a);
      const endMs = holderFirstOwnActionAfterMs(u, t, a.spellId, ctx.units);
      if (!Number.isFinite(endMs)) continue;
      ctx.bump("stealthAllowedPress");
      const first = casts.find(
        (c) =>
          tsOf(c) === endMs && ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(c.spellId),
      );
      if (first)
        ctx.violate(
          "stealthAllowedPress",
          a.spellId === "58984" ? "shadowmeld" : "prowl",
          t,
          `${u.id}:${t}`,
          `${nameOf(a.spellId)} at ${at(t)} never REMOVED; the product ends it ${((endMs - t) / 1000).toFixed(2)}s later at ${nameOf(first.spellId, first.spellName ?? "")} ${first.spellId}, a press allowed while stealthed`,
        );
    }
    // ── presses inside a stealth run whose end the log shows ──
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (
        !STEALTH_BROKEN_BY_ACTION.has(a.spellId) ||
        ev(a) !== APPLIED ||
        a.srcUnitId !== u.id
      )
        continue;
      const end = auras
        .slice(i + 1)
        .find((b) => b.spellId === a.spellId && ev(b) === REMOVED);
      if (!end) continue;
      const from = tsOf(a);
      const to = tsOf(end);
      for (const c of casts) {
        const t = tsOf(c);
        if (t <= from) continue;
        if (c.spellId === a.spellId && t <= from + OWN_PRESS_ROW_MS) continue;
        if (t > to + RUN_END_MS) break;
        ctx.bump("stealthVisibleRunPress");
        const allowed = ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(c.spellId);
        const kept = t < to - RUN_END_MS;
        ctx.violate(
          "stealthVisibleRunPress",
          `${a.spellId === "58984" ? "shadowmeld" : "prowl"}-${allowed ? "allowed" : "other"}-${kept ? "kept" : "ended"}`,
          t,
          `${u.id}:${from}:${t}`,
          `${nameOf(c.spellId, c.spellName ?? "")} ${c.spellId} first press ${((t - from) / 1000).toFixed(2)}s into ${nameOf(a.spellId)} ${a.spellId}, which ended ${((to - t) / 1000).toFixed(2)}s after the press`,
        );
        break;
      }
    }
    // ── a control re-applied in the REMOVED's own instant, no cast behind it ──
    const lastRemoved = new Map<string, number>();
    for (const a of auras) {
      if (!a.spellId || !ccSpellIds.has(a.spellId)) continue;
      const key = `${a.spellId}|${a.srcUnitId ?? ""}`;
      const t = tsOf(a);
      if (ev(a) === REMOVED) {
        lastRemoved.set(key, t);
        continue;
      }
      if (ev(a) !== APPLIED) continue;
      const r = lastRemoved.get(key);
      if (r === undefined || t - r < 0 || t - r > 5) continue;
      ctx.bump("mergedCcNoCast");
      const src = ctx.units.find((x: any) => x.id === a.srcUnitId);
      const castBehind = src
        ? successesOf(src).some(
            (c) =>
              c.spellId === a.spellId && tsOf(c) <= t && tsOf(c) >= t - 3000,
          )
        : false;
      if (castBehind) continue;
      const press = pvpTrinketUses(u).some(
        (p: any) => p.atMs >= t - 100 && p.atMs <= t + 8000,
      );
      ctx.violate(
        "mergedCcNoCast",
        press ? "press-after" : "no-press",
        t,
        `${u.id}:${key}:${t}`,
        `${nameOf(a.spellId, a.spellName ?? "")} ${a.spellId} REMOVED and APPLIED again within ${t - r} ms at ${at(t)} with no cast of it by its source in the 3 s before`,
      );
    }
  }
  // ── Divine Hammer parries, and multi-bolt absorbed hits ──
  const hitIds = new Set<string>();
  const absorbedBolts: Array<{ id: string; head: string }> = [];
  for (const line of ctx.rawLines) {
    const body = line.slice(line.indexOf("  ") + 2);
    const f = body.split(",");
    const e = f[0];
    if (
      e === "SPELL_DAMAGE" ||
      e === "SPELL_PERIODIC_DAMAGE" ||
      e === "RANGE_DAMAGE" ||
      e === "SPELL_MISSED" ||
      e === "SPELL_PERIODIC_MISSED"
    )
      hitIds.add(f[9]);
    // the spell form of SPELL_ABSORBED carries the attack's id in field 9
    else if (e === "SPELL_ABSORBED" && MULTI_BOLT_IDS.has(f[9]))
      absorbedBolts.push({ id: f[9], head: line.slice(0, 24) });
    if (!DIVINE_HAMMER.test(line)) continue;
    if (e !== "SPELL_DAMAGE" && e !== "SPELL_MISSED") continue;
    ctx.bump("divineHammerParry");
    if (e !== "SPELL_MISSED") continue;
    const missType =
      body.match(
        /,(ABSORB|BLOCK|DEFLECT|DODGE|EVADE|IMMUNE|MISS|PARRY|REFLECT|RESIST),/,
      )?.[1] ?? "other";
    ctx.bump("divineHammerMissTypes");
    ctx.violate(
      "divineHammerMissTypes",
      missType,
      ctx.start,
      `${ctx.roundKey}:${line.slice(0, 24)}:${f[5]}`,
      `a Divine Hammer SPELL_MISSED row says ${missType}`,
    );
    if (missType === "PARRY")
      ctx.violate(
        "divineHammerParry",
        "parry",
        ctx.start,
        `${ctx.roundKey}:${line.slice(0, 24)}:${f[5]}`,
        "a Divine Hammer SPELL_MISSED row says PARRY",
      );
  }
  for (const b of absorbedBolts) {
    ctx.bump("multiBoltAbsorbId");
    if (!hitIds.has(b.id))
      ctx.violate(
        "multiBoltAbsorbId",
        "no-hit-row-of-id",
        ctx.start,
        `${ctx.roundKey}:${b.head}:${b.id}`,
        `an absorbed ${nameOf(b.id)} ${b.id} hit has no damage or miss row of that id in the round`,
      );
  }
}
