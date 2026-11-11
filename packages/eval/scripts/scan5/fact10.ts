/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact10 (F25) class checks.
 *
 *  - pressInsideLockNotEntered (class 1, D2–D4 D31): a `missed-sync-window`
 *    menu row ("none entered the window") whose lock — from 2 s before its
 *    start (the row's own "a press up to 2 s before the lock counts as
 *    entering") to the end of its last second — holds a press, by a player
 *    of the owner's side, of a major offensive button the roster filed as a
 *    press fact only (070c4933 2:06: Breath of Eons pressed at 2:09.572
 *    inside the Sleep Walk → Terror of the Skies lock). The id list is the
 *    check's own, so it keeps counting what the product's table no longer
 *    holds. Kinds are the spell names; only the ids the user ruled on
 *    2026-11-04 (Breath of Eons, Frostwyrm's Fury) count in the total, the
 *    rest of GH #184's ≥ 60 s buttons are measured beside it.
 *  - troughPastRoundEnd (class 8, D30): a displayed-seconds low — the burst
 *    ledger's `Target: … (low N% at M:SS)`, `[DMG SPIKE] … low N% @M:SS` —
 *    of a window the round ended inside (`roundEndMs`, a Solo Shuffle
 *    round's first death) sits below every reading of its unit the round
 *    holds: its live HP lines from the window's start to the round's end and
 *    the window's own `[STATE]` ticks (6a545d58 `Burst #4 — 3:08–3:15 …
 *    low 40% at 3:15`: the hits after the 3:15 round-ending death; the round
 *    itself bottomed at 67 %). Counted: every such low of a window the round
 *    ended inside.
 *  - trinketAfterAllyImmunity (class 6, D8): a `[CC ON TEAM] … broke this
 *    CC` line whose control the log ended with another unit's control
 *    immunity (`CC_AVOIDANCE_BUFF_SPELLS`) applied on the holder in the
 *    control's own REMOVED millisecond (11890839 0:17: Psychic Scream off at
 *    the ms of Aezryl's Berserker Shout, the trinket 26 ms later). Counted:
 *    every "broke this CC" line.
 *  - effectSpanSideAuraEnd (class 4, D11 D27): a burst-ledger span of a press
 *    that ends at the root its press applied, while a non-root aura of the
 *    same press on the same unit (applied within 1 s of it) ran on for 1 s
 *    or more (11890839 Burst #6 `1:34–1:36 | Predator's Wake`: the root
 *    370970 off at 1:36, the damage aura 1246168 at 1:41). The other aura is
 *    one of the press's family — named as the root or as the press — and
 *    both ends stop at the round's end. Counted: every ledger span of a
 *    press that applied a root beside another aura of its family.
 *  - talentedSaveUnseen (class 7, D13): a player whose COMBATANT_INFO PvP
 *    talents hold a defensive the roster files (Burrow 409293) and whose
 *    `<cooldowns>` line lacks it. Counted: every such talented player.
 *  - mobilityAsDefensive (class 7, D12): a cd-hoarded row whose readyCds
 *    names Spirit Walk (user ruling 2026-11-04: off the ready set). Counted:
 *    every cd-hoarded row.
 *  - jukeBarSuperseded (class 5, D22 D5): a `[KICK] … JUKED by fake X` line
 *    whose faked bar the target had left — another own press or cast bar of
 *    a different spell more than 0.5 s (`STOPPED_JUST_BEFORE_S`) before the
 *    kick, not one castable while channelling off the GCD — or that ended
 *    with a player's death (733ef717 0:45: Smite begun 41.415, Void Shield
 *    43.190, Penance 44.416, kick 45.309; 070c4933 2:25: Benediction begun
 *    144.495, its target dead 145.415). Counted: every juke line.
 *  - pressImpactCountedTwice (class 2, D28): an ABILITIES INTO IMMUNITY/DR
 *    line that counts a name more times than its caster's presses of it at
 *    that target inside the defensive (its APPLIED…REMOVED on the target),
 *    a charge press's impact row (`PRESS_TRIGGERED_CAST_IDS`, DB2 Effect
 *    96 / 149) standing in for its press, not beside it (915f90ae 2:48
 *    `The Hunt ×2`: 1246167 at the press, 1246169 at the impact). Counted:
 *    every (line, name) whose window holds an impact row.
 *  - unseenOrbMissing (class 6, D23): an enemy's own Freezing Rain 270232
 *    (talent 270233: "Frozen Orb makes Blizzard instant cast") put up fresh
 *    with no own Frozen Orb row (84714 / 198149) in the 2 s before it, and no
 *    `[ENEMY CD] … Frozen Orb` line at its second (733ef717 0:09: the orb
 *    pressed while the mage was unseen, the buff in the 9.816 re-statement
 *    batch; the line read `cast 1 of 2` from 0:43). The pairing is the
 *    check's own, not `PRESS_PROOF_AURA_IDS`. Counted: every such fresh
 *    Freezing Rain with no orb row before it.
 *  - resHastedLeftUnclosed (class 3, D20): a `[RES]` enemy entry
 *    `Name/Spec(Ns left)` of a press whose length moves with haste (DB2
 *    SpellMisc Attributes_8 bit 17; not a channel, which its caster stops
 *    at will — codex 20-F25-03 #1) and whose own aura the
 *    round never closes, reading past the press + the longest run of that
 *    aura the same unit completed in the round, + 1 s for the rendering
 *    (46eb2199 1:21 `Bladestorm/Arms Warrior(5s left)`: pressed 1:19.85, its
 *    REMOVED 0.2 s past the round's end; the round's first Bladestorm ran
 *    5.07 s, so 4 s were left). Counted: every such entry with a completed
 *    run to compare.
 *  - channelLastTickDropped (class 4, D29): a burst-ledger entry holding an
 *    own channel press (`CHANNELED_SPELL_IDS`) whose own aura's REMOVED is
 *    followed within 100 ms by a damage row of the same-named spell (its
 *    last tick), and whose printed `your damage X.XXM` on its Target is the
 *    sum up to the REMOVED, not the sum with the tick (1cbbdcb3 Burst #3
 *    `Boomstick`: 1261193 off at 2:01.766, the 4th volley 1261215 1 ms
 *    later, printed 0.23M / 0.30M with it). Sums: the owner's damageOut (pets
 *    merged) on the Target from the first own press of the header's opening
 *    second. Counted: every entry with such a trailing tick.
 *  - summonDiedBeforePulse (class 6, D10): a `[CC AVOIDED?] … did not
 *    land` line of a press whose summon (SPELL_SUMMON within the press's
 *    instant, owned by the caster) died (`nonPlayerUnitKill`) before any row
 *    of its own — a cast success, an aura it put on anyone, a miss — so the
 *    control never went off (11890839 1:35: a Capacitor Totem killed 1.644 s
 *    after its summon). Counted: every such line of a summon-placed press.
 *  - reflectedHealerCcNoConseq (class 6, D21): a healer's own control
 *    reflected back onto it (a control DEBUFF whose source is the holder)
 *    for HEALER_CC_MIN_S or more, the round's end cutting it, with a
 *    teammate's death inside it, and no `[CONSEQ]` line at its second
 *    naming the control (46eb2199 1:18: the Restoration Shaman's Hex sent
 *    back by Nether Ward, 5.4 s, Ponycopter dead inside it). Counted: every
 *    such reflected control with a teammate death inside it.
 *  - killAttemptTrinketOutMissed (class 6, D24): a `KILL ATTEMPTS` line
 *    `[a–b] on T` whose target's `[ENEMY TRINKET] … used PvP trinket out of
 *    X` sits in (a, b + 5) with X's aura on T up inside [a + 1, b + 1) (the
 *    bracket's first second may start before the attempt's own ms), and
 *    whose FAILED cause is not `target trinketed out` (733ef717
 *    [0:09–0:14]: the Medallion at 0:16 took off the Strangulate layered into
 *    the Hammer of Justice, the attempt read "not enough damage"). X is a
 *    silence, a disarm or a root — not a hard control (`ccSpellIds`), which
 *    the CC binder's own checks cover. Counted: every such attempt.
 *  - drResetBandLength (class 6, D9): a `[CC ON ENEMY]` / `[CC ON TEAM]`
 *    line `… ← Spell (by …) … [DR: Cat Level]` whose control landed 20.0 –
 *    20.4 s after the unit's previous control of the family ended (the 12.1
 *    20 s reset lands on a server tick: cover set, every landing under
 *    20.0 s read 50 %, 20.0 – 20.36 mixed, 20.37 – 20.50 all Full) and whose
 *    printed level is not the one its logged length says — within 0.15 s of
 *    half its full length is 50 %, of the full length Full (11890839 0:52:
 *    Storm Bolt 20.012 s after Void Nova, 1.52 s of 3 s, printed Full).
 *    Counted: every such landing in the band with a length that says one.
 */
import { HEALER_CC_MIN_S } from "@gladlog/analysis/src/context/observedConsequences";
import {
  CHANNELED_SPELL_IDS,
  HASTE_DURATION_SPELL_IDS,
} from "@gladlog/analysis/src/data/channeledGenerated";
import { ROOT_AURA_SPELL_IDS } from "@gladlog/analysis/src/data/rootAuraGenerated";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ccSpellIds,
  disarmSpellIds,
  rootSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { staleMaxHpRows } from "@gladlog/analysis/src/utils/advancedActions";
import { isSilenceOnlyAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { CAST_QUEUE_TOLERANCE_MS } from "@gladlog/analysis/src/utils/castBarOutcomes";
import {
  pressRidesAlong,
  rowIsPressEndingCast,
} from "@gladlog/analysis/src/utils/castCommitSpans";
import { PRESS_TRIGGERED_CAST_IDS } from "@gladlog/analysis/src/utils/castMissRows";
import { STOPPED_JUST_BEFORE_S } from "@gladlog/analysis/src/utils/castStopEvidence";
import { ccFullDurationForCaster } from "@gladlog/analysis/src/utils/ccDuration";
import { CC_AVOIDANCE_BUFF_SPELLS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  effectEvidenceCastSeconds,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  DR_CATEGORY_MAP,
  DR_RESET_MS_121,
  DR_RESET_TICK_MS,
  isDiminishedLength,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { PASSIVE_ABSORB_PROC_AURAS } from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  DEFERRAL_SHIELD_DAMAGE_IDS,
  isDeferralDamageRow,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { extractKillAttempts } from "@gladlog/analysis/src/utils/killAttempts";
import { withoutDeferralTag } from "@gladlog/analysis/src/utils/offensiveWasteAnalysis";
import { pvpTrinketUses } from "@gladlog/analysis/src/utils/pvpTrinketUses";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import {
  nonPlayerUnitKill,
  summonedAtMs,
} from "@gladlog/analysis/src/utils/summonLife";

import {
  APPLIED,
  deathMs,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  SUCCESS,
  successesOf,
  tsOf,
} from "./ctx";
import { resRows } from "./singles2";

export const CHECKS = [
  "pressInsideLockNotEntered",
  "troughPastRoundEnd",
  "trinketAfterAllyImmunity",
  "effectSpanSideAuraEnd",
  "talentedSaveUnseen",
  "mobilityAsDefensive",
  "jukeBarSuperseded",
  "pressImpactCountedTwice",
  "unseenOrbMissing",
  "resHastedLeftUnclosed",
  "channelLastTickDropped",
  "drResetBandLength",
  "drBandForcedEnd",
  "summonDiedBeforePulse",
  "reflectedHealerCcNoConseq",
  "killAttemptTrinketOutMissed",
  "unusedOwnAuraOnAlly",
  "staleMaxTickRescaled",
  "deferralFiledAsWall",
  "passiveAbsorbProcUnlisted",
  "trinketTookSeveralRoots",
  "evidencePressOnRestatedAura",
] as const;

/** fact10 class 1: ruled into the roster 2026-11-04; Ravager and Execution
 * Sentence 2026-11-05 (GH #184); the five 45 s buttons 2026-11-10 (R19,
 * pipeline T72) */
const RULED = new Set([
  "403631",
  "442204",
  "279302",
  "228920", // Ravager
  "343527", // Execution Sentence
  "385059", // Odyn's Fury
  "153561", // Meteor
  "439843", // Reaper's Mark
  "426591", // Goremaw's Bite
  "375901", // Mindgames
]);
/** GH #184: the other press-fact-only offensive buttons of 45 s or more */
const OPEN = new Set([
  "357210", // Deep Breath
  "433874", // Deep Breath (Scalecommander)
  "375576", // Divine Toll
  "370553", // Tip the Scales
  "391528", // Convoke the Spirits
  "322109", // Touch of Death
]);
/** a healer's press of these is a heal (Holy Paladin, Restoration Druid,
 * Preservation Evoker), not a burst */
const HEALER_SPEC_PRESS = new Set(["375576", "391528", "370553"]);

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [...OPEN].map((id) => `pressInsideLockNotEntered|${nameOf(id)}`),
);

const SYNC_ROW =
  /id=missed-sync-window:\S+ type=missed-sync-window t=(\d+)s [^\n]*?facts=\{t=(\d+), windowEndT=(\d+),/g;

export function run(ctx: IRoundCtx): void {
  troughPastRoundEnd(ctx);
  trinketAfterAllyImmunity(ctx);
  effectSpanSideAuraEnd(ctx);
  talentedSaveUnseen(ctx);
  mobilityAsDefensive(ctx);
  jukeBarSuperseded(ctx);
  pressImpactCountedTwice(ctx);
  unseenOrbMissing(ctx);
  resHastedLeftUnclosed(ctx);
  channelLastTickDropped(ctx);
  drResetBandLength(ctx);
  summonDiedBeforePulse(ctx);
  reflectedHealerCcNoConseq(ctx);
  killAttemptTrinketOutMissed(ctx);
  unusedOwnAuraOnAlly(ctx);
  staleMaxTickRescaled(ctx);
  deferralFiledAsWall(ctx);
  passiveAbsorbProcUnlisted(ctx);
  trinketTookSeveralRoots(ctx);
  evidencePressOnRestatedAura(ctx);
  if (!ctx.owner) return;
  const side = ctx.players.filter((u) => u.reaction === ctx.owner.reaction);
  for (const m of ctx.menu.matchAll(SYNC_ROW)) {
    ctx.bump("pressInsideLockNotEntered");
    const from = ctx.start + (+m[2]! - 2) * 1000;
    const to = ctx.start + (+m[3]! + 1) * 1000;
    const seen = new Set<string>();
    for (const u of side) {
      const healer = isHealerSpec(u.spec);
      for (const c of (u.spellCastEvents ?? []) as any[]) {
        if (ev(c) !== SUCCESS) continue;
        const id = String(c.spellId);
        if (!RULED.has(id) && !OPEN.has(id)) continue;
        if (HEALER_SPEC_PRESS.has(id) && healer) continue;
        const t = tsOf(c);
        if (t < from || t >= to) continue;
        const name = nameOf(id, c.spellName);
        if (seen.has(name)) continue;
        seen.add(name);
        ctx.violate(
          "pressInsideLockNotEntered",
          name,
          t,
          `${m[2]}`,
          `${u.name} pressed ${name} at +${((t - ctx.start) / 1000).toFixed(1)}s inside the ${m[2]}–${m[3]} lock`,
          m[0].slice(0, 160),
        );
      }
    }
  }
}

const mss = (m: string, ss: string) => +m * 60 + +ss;
const BURST_HEAD = /^\s*Burst #\d+ — (\d+):(\d{2})–(\d+):(\d{2}) \|/;
const BURST_TARGET =
  /^\s*Target: (\S+) \d+% → \d+% \(low (\d+)% at (\d+):(\d{2})\)/;
const SPIKE =
  /^(\d+):(\d{2})–(\d+):(\d{2})\s+\[DMG SPIKE\]\s+(\d+)\(.*low (\d+)% @(\d+):(\d{2})/;
const STATE = /^(\d+):(\d{2})\s+\[STATE\]\s+(.*)$/;

/** live HP of `u` (whole percent, a living 0 % counts) in [fromMs, toMs] */
function liveMin(u: any, fromMs: number, toMs: number): number | null {
  let best: number | null = null;
  for (const a of (u.advancedActions ?? []) as any[]) {
    const ts = a.logLine.timestamp;
    if (ts < fromMs || ts > toMs) continue;
    if (a.advancedActorId !== u.id || !(a.advancedActorMaxHp > 0)) continue;
    if (!(a.advancedActorCurrentHp > 0)) continue;
    const pct = Math.min(
      Math.round((a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100),
      100,
    );
    if (best === null || pct < best) best = pct;
  }
  return best;
}

function troughPastRoundEnd(ctx: IRoundCtx): void {
  const endAt = roundEndMs(ctx.legacy);
  // [STATE] ticks: second → pid → number
  const ticks = new Map<number, Map<string, number>>();
  for (const l of ctx.lines) {
    const m = STATE.exec(l);
    if (!m) continue;
    const row = new Map<string, number>();
    for (const t of m[3]!.matchAll(/(\d+)\([^)]*\):(\d+)/g))
      row.set(t[1]!, +t[2]!);
    ticks.set(mss(m[1]!, m[2]!), row);
  }
  const judge = (
    unit: any,
    from: number,
    to: number,
    printed: number,
    kind: string,
    line: string,
  ) => {
    if (!unit) return;
    const winEnd = ctx.start + (to + 1) * 1000;
    if (!(endAt < winEnd) || endAt < ctx.start + from * 1000) return;
    ctx.bump("troughPastRoundEnd");
    const pid = ctx.pidOf(unit.name);
    let low = liveMin(unit, ctx.start + from * 1000, endAt);
    for (let s = from; s <= to; s++) {
      const v = pid ? ticks.get(s)?.get(pid) : undefined;
      if (v !== undefined && (low === null || v < low)) low = v;
    }
    if (low !== null && printed < low)
      ctx.violate(
        "troughPastRoundEnd",
        kind,
        endAt,
        `${from}`,
        `${unit.name}: printed low ${printed}%, the round's lowest reading ${low}% (round ended +${((endAt - ctx.start) / 1000).toFixed(3)}s)`,
        line.slice(0, 160),
      );
  };
  let burst: { from: number; to: number } | null = null;
  for (const l of ctx.text.split("\n")) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      burst = { from: mss(h[1]!, h[2]!), to: mss(h[3]!, h[4]!) };
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t && burst) {
      judge(
        ctx.byName.get(t[1]!),
        burst.from,
        burst.to,
        +t[2]!,
        "burst ledger",
        l,
      );
      burst = null;
    }
  }
  for (const l of ctx.lines) {
    const m = SPIKE.exec(l);
    if (!m) continue;
    judge(
      ctx.unitOfPid(m[5]),
      mss(m[1]!, m[2]!),
      mss(m[3]!, m[4]!),
      +m[6]!,
      "[DMG SPIKE]",
      l,
    );
  }
}

const CC_ON_TEAM_BROKE =
  /^(\d+):(\d{2})\s+\[CC ON TEAM\]\s+(\d+)\([^)]*\) ← (.+?) \(by [^\n]*broke this CC/;

function trinketAfterAllyImmunity(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = CC_ON_TEAM_BROKE.exec(l);
    if (!m) continue;
    ctx.bump("trinketAfterAllyImmunity");
    const holder = ctx.unitOfPid(m[3]);
    if (!holder) continue;
    const fromMs = ctx.start + mss(m[1]!, m[2]!) * 1000;
    const auras = (holder.auraEvents ?? []) as any[];
    const rem = auras.find(
      (a) =>
        ev(a) === REMOVED &&
        a.destUnitId === holder.id &&
        tsOf(a) >= fromMs &&
        nameOf(a.spellId, a.spellName) === m[4],
    );
    if (!rem) continue;
    const at = tsOf(rem);
    const imm = auras.find(
      (a) =>
        ev(a) === APPLIED &&
        a.destUnitId === holder.id &&
        tsOf(a) === at &&
        a.srcUnitId !== holder.id &&
        CC_AVOIDANCE_BUFF_SPELLS.has(String(a.spellId)),
    );
    if (!imm) continue;
    ctx.violate(
      "trinketAfterAllyImmunity",
      nameOf(imm.spellId, imm.spellName),
      at,
      `${m[1]}:${m[2]}`,
      `${holder.name}: ${m[4]} removed +${((at - ctx.start) / 1000).toFixed(3)}s in the ms ${ctx.byName.get(ctx.units.find((u: any) => u.id === imm.srcUnitId)?.name)?.name ?? imm.srcUnitId}'s ${nameOf(imm.spellId, imm.spellName)} went up`,
      l.slice(0, 160),
    );
  }
}

/** `name start–end` spans of each burst-ledger header (a single-press
 * header's own range for its one name) */
function ledgerSpans(
  text: string,
): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  for (const l of text.split("\n")) {
    const h = /^\s*Burst #\d+ — (\d+):(\d{2})–(\d+):(\d{2}) \| (.+)$/.exec(l);
    if (!h) continue;
    const parts = h[5]!.split(" + ");
    for (const part of parts) {
      const p = /^(.+?) (\d+):(\d{2})–(\d+):(\d{2})$/.exec(part.trim());
      if (p)
        out.push({
          name: p[1]!,
          from: mss(p[2]!, p[3]!),
          to: mss(p[4]!, p[5]!),
        });
      else if (parts.length === 1)
        out.push({
          name: part.trim(),
          from: mss(h[1]!, h[2]!),
          to: mss(h[3]!, h[4]!),
        });
    }
  }
  return out;
}

function effectSpanSideAuraEnd(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const spans = ledgerSpans(ctx.text);
  if (spans.length === 0) return;
  const side = ctx.players.filter((u) => u.reaction === ctx.owner.reaction);
  const enemies = ctx.units.filter(
    (u: any) => u.reaction !== ctx.owner.reaction,
  );
  for (const caster of side) {
    for (const c of (caster.spellCastEvents ?? []) as any[]) {
      if (ev(c) !== SUCCESS) continue;
      const t = tsOf(c);
      const sec = Math.floor((t - ctx.start) / 1000);
      const name = nameOf(c.spellId, c.spellName);
      const span = spans.find((x) => x.name === name && x.from === sec);
      if (!span) continue;
      // per holder: the press's own auras (applied by the caster in [t, t+1s])
      let rootEnd = -Infinity;
      let sideEnd = -Infinity;
      for (const e of enemies) {
        const auras = ((e.auraEvents ?? []) as any[]).filter(
          (a) => a.destUnitId === e.id && a.srcUnitId === caster.id,
        );
        const applied = auras.filter(
          (a) => ev(a) === APPLIED && tsOf(a) >= t && tsOf(a) <= t + 1000,
        );
        const roots = applied.filter((a) =>
          ROOT_AURA_SPELL_IDS.has(String(a.spellId)),
        );
        // the press's own family: an aura named as the root or as the press
        // (The Hunt's root and damage aura are both "The Hunt"), not another
        // aura the caster happened to apply in that second
        const family = new Set([
          name,
          ...roots.map((r) => nameOf(r.spellId, r.spellName)),
        ]);
        const others = applied.filter(
          (a) =>
            !ROOT_AURA_SPELL_IDS.has(String(a.spellId)) &&
            family.has(nameOf(a.spellId, a.spellName)),
        );
        if (roots.length === 0 || others.length === 0) continue;
        const endOf = (a: any) =>
          tsOf(
            auras.find(
              (r) =>
                ev(r) === REMOVED &&
                r.spellId === a.spellId &&
                tsOf(r) >= tsOf(a),
            ) ?? { timestamp: tsOf(a) },
          );
        for (const r of roots) rootEnd = Math.max(rootEnd, endOf(r));
        for (const o of others) sideEnd = Math.max(sideEnd, endOf(o));
      }
      if (!Number.isFinite(rootEnd) || !Number.isFinite(sideEnd)) continue;
      // nothing past the round's end is the span's
      const endAt = roundEndMs(ctx.legacy);
      rootEnd = Math.min(rootEnd, endAt);
      sideEnd = Math.min(sideEnd, endAt);
      ctx.bump("effectSpanSideAuraEnd");
      const rootSec = Math.floor((rootEnd - ctx.start) / 1000);
      const sideSec = Math.floor((sideEnd - ctx.start) / 1000);
      if (sideEnd - rootEnd >= 1000 && span.to <= rootSec && span.to < sideSec)
        ctx.violate(
          "effectSpanSideAuraEnd",
          name,
          t,
          `${sec}`,
          `${caster.name} ${name} +${((t - ctx.start) / 1000).toFixed(3)}s: ledger span ends ${span.to}s at the root (${rootSec}s), its other aura ran to ${sideSec}s`,
        );
    }
  }
}

/** PvP talents granting a defensive the roster files */
const PVP_TALENT_DEFENSIVES = new Map([["409293", "Burrow"]]);

function talentedSaveUnseen(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const u of ctx.players) {
    if (u.reaction !== ctx.owner.reaction) continue;
    const pvp = new Set<string>((u.info?.pvpTalents ?? []).map(String));
    for (const [id, name] of PVP_TALENT_DEFENSIVES) {
      if (!pvp.has(id)) continue;
      ctx.bump("talentedSaveUnseen");
      const pid = ctx.pidOf(u.name);
      const at = ctx.text.indexOf(`<unit id="${pid}" `);
      const cds =
        at >= 0
          ? /<cooldowns>([^<]*)<\/cooldowns>/.exec(ctx.text.slice(at))?.[1]
          : undefined;
      if (cds !== undefined && !cds.includes(`${name} [`))
        ctx.violate(
          "talentedSaveUnseen",
          name,
          ctx.start,
          u.name,
          `${u.name} has ${name} ${id} talented; its <cooldowns> line lacks it`,
        );
    }
  }
}

function mobilityAsDefensive(ctx: IRoundCtx): void {
  for (const m of ctx.menu.matchAll(
    /type=cd-hoarded t=(\d+)s [^\n]*?readyCds=([^,}]*(?:, [A-Z][^,=}]*)*)/g,
  )) {
    ctx.bump("mobilityAsDefensive");
    if (/\bSpirit Walk\b/.test(m[2]!))
      ctx.violate(
        "mobilityAsDefensive",
        "Spirit Walk",
        ctx.start + +m[1]! * 1000,
        m[1]!,
        `cd-hoarded readyCds=${m[2]}`,
        m[0].slice(0, 160),
      );
  }
}

const JUKE =
  /^(\d+):(\d{2})\s+\[KICK\]\s+your (.+?) on (\d+)\([^)]*\) — JUKED by fake (.+)$/;

function jukeBarSuperseded(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const l of ctx.lines) {
    const m = JUKE.exec(l);
    if (!m) continue;
    ctx.bump("jukeBarSuperseded");
    const target = ctx.unitOfPid(m[4]);
    if (!target) continue;
    const sec = mss(m[1]!, m[2]!);
    const kick = ((ctx.owner.spellCastEvents ?? []) as any[]).find(
      (c) =>
        ev(c) === SUCCESS &&
        nameOf(c.spellId, c.spellName) === m[3] &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
    );
    if (!kick) continue;
    const kickMs = tsOf(kick);
    const starts = ((target.castStartEvents ?? []) as any[]).filter(
      (c) => tsOf(c) <= kickMs && tsOf(c) >= kickMs - 4000,
    );
    const bar = starts
      .filter((c) => nameOf(c.spellId, c.spellName) === m[5])
      .at(-1);
    if (!bar) continue;
    const startMs = tsOf(bar);
    const prevBar = ((target.castStartEvents ?? []) as any[])
      .filter((c) => tsOf(c) < startMs)
      .at(-1);
    // A SUCCESS ends a bar only when it is a button's press
    // (`rowIsPressEndingCast`, the product's one reading: DB2 SpellCooldowns
    // has its row, no copy / tick row — fact11 D2): a passive trigger or a
    // pet command has none (codex 20-F25-01); an off-GCD Counterspell out of
    // a Frostbolt ends it (20-F25-02). A SUCCESS of the previous bar's spell inside
    // CAST_QUEUE_TOLERANCE_MS is that bar's queued completion.
    const other = [
      ...((target.spellCastEvents ?? []) as any[]).filter(
        (c, _: number, rows: any[]) =>
          ev(c) === SUCCESS && rowIsPressEndingCast(c, rows),
      ),
      ...((target.castStartEvents ?? []) as any[]),
    ].find(
      (c) =>
        tsOf(c) > startMs &&
        tsOf(c) < kickMs - STOPPED_JUST_BEFORE_S * 1000 &&
        String(c.spellId) !== String(bar.spellId) &&
        !pressRidesAlong(String(c.spellId)) &&
        !(
          prevBar &&
          String(c.spellId) === String(prevBar.spellId) &&
          tsOf(c) <= startMs + CAST_QUEUE_TOLERANCE_MS
        ),
    );
    const died = ctx.players.find(
      (u) =>
        u.id !== target.id &&
        ((u.deathRecords ?? []) as any[]).some(
          (d) => d.timestamp >= startMs && d.timestamp <= kickMs,
        ),
    );
    if (other || died)
      ctx.violate(
        "jukeBarSuperseded",
        other ? "superseded" : "a player died",
        kickMs,
        `${m[1]}:${m[2]}`,
        other
          ? `${m[5]} begun +${((startMs - ctx.start) / 1000).toFixed(3)}s, ${nameOf(other.spellId, other.spellName)} +${((tsOf(other) - ctx.start) / 1000).toFixed(3)}s, kick +${((kickMs - ctx.start) / 1000).toFixed(3)}s`
          : `${m[5]} begun +${((startMs - ctx.start) / 1000).toFixed(3)}s, ${died.name} died before the kick +${((kickMs - ctx.start) / 1000).toFixed(3)}s`,
        l.slice(0, 160),
      );
  }
}

const INTO = /^\s*\[(\d+):(\d{2})\] [^(]+\(([^)]+)\): (.+) into (.+?)'s (.+)$/;
const IMPACT_IDS = new Set([...PRESS_TRIGGERED_CAST_IDS.values()].flat());

function pressImpactCountedTwice(ctx: IRoundCtx): void {
  for (const l of ctx.text.split("\n")) {
    const m = INTO.exec(l);
    if (!m) continue;
    const caster = ctx.byName.get(m[3]!);
    const target = ctx.byName.get(m[5]!);
    if (!caster || !target) continue;
    const counts = new Map<string, number>();
    for (const part of m[4]!.split(" + ")) {
      const p = /^(.+?)(?: ×(\d+))?$/.exec(part.trim())!;
      counts.set(p[1]!, (counts.get(p[1]!) ?? 0) + Number(p[2] ?? 1));
    }
    const fromMs = ctx.start + mss(m[1]!, m[2]!) * 1000;
    const wall = ((target.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        a.destUnitId === target.id &&
        nameOf(a.spellId, a.spellName) === withoutDeferralTag(m[6]!) &&
        tsOf(a) >= fromMs &&
        tsOf(a) < fromMs + 1000,
    );
    if (!wall) continue;
    const endMs =
      tsOf(
        ((target.auraEvents ?? []) as any[]).find(
          (a) =>
            ev(a) === REMOVED &&
            a.destUnitId === target.id &&
            String(a.spellId) === String(wall.spellId) &&
            tsOf(a) > tsOf(wall),
        ) ?? { timestamp: Infinity },
      ) ?? Infinity;
    const rows = ((caster.spellCastEvents ?? []) as any[]).filter(
      (c) => ev(c) === SUCCESS && c.destUnitId === target.id,
    );
    for (const [name, k] of counts) {
      const inside = rows.filter(
        (c) =>
          nameOf(c.spellId, c.spellName) === name &&
          tsOf(c) >= tsOf(wall) &&
          tsOf(c) <= endMs,
      );
      const impacts = inside.filter((c) => IMPACT_IDS.has(String(c.spellId)));
      if (impacts.length === 0) continue;
      ctx.bump("pressImpactCountedTwice");
      // one per press: an impact whose press row (an id that triggers it,
      // within 2.5 s before, same target) is inside the window is that press
      const paired = impacts.filter((i) =>
        inside.some(
          (p) =>
            p !== i &&
            PRESS_TRIGGERED_CAST_IDS.get(String(p.spellId))?.includes(
              String(i.spellId),
            ) &&
            tsOf(p) < tsOf(i) &&
            tsOf(p) >= tsOf(i) - 2500,
        ),
      ).length;
      const presses = inside.length - paired;
      if (k > presses)
        ctx.violate(
          "pressImpactCountedTwice",
          name,
          tsOf(wall),
          `${m[1]}:${m[2]}`,
          `${m[3]} ${name} ×${k} into ${m[6]}: ${inside.length} rows, ${paired} the impact of a press beside it`,
          l.slice(0, 160),
        );
    }
  }
}

const FREEZING_RAIN = "270232";
const ORB_IDS = new Set(["84714", "198149"]);
const ORB_LINE =
  /^(\d+):(\d{2})\s+\[ENEMY CD\]\s+(\d+)\([^)]*\)[^:]*: Frozen Orb\b/;

function unseenOrbMissing(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const orbLines = new Map<string, number[]>();
  for (const l of ctx.lines) {
    const m = ORB_LINE.exec(l);
    if (m)
      orbLines.set(m[3]!, [...(orbLines.get(m[3]!) ?? []), mss(m[1]!, m[2]!)]);
  }
  for (const u of ctx.players) {
    if (u.reaction === ctx.owner.reaction) continue;
    const orbs = ((u.spellCastEvents ?? []) as any[])
      .filter((c) => ev(c) === SUCCESS && ORB_IDS.has(String(c.spellId)))
      .map(tsOf);
    let up = false;
    const rows = ((u.auraEvents ?? []) as any[])
      .filter(
        (a) => String(a.spellId) === FREEZING_RAIN && a.destUnitId === u.id,
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    for (const a of rows) {
      const t = tsOf(a);
      if (ev(a) === REMOVED) up = false;
      if (ev(a) !== APPLIED) continue;
      const fresh = !up;
      up = true;
      if (!fresh || t < ctx.start || t > ctx.end) continue;
      if (orbs.some((o) => o <= t && o >= t - 2000)) continue;
      ctx.bump("unseenOrbMissing");
      const pid = ctx.pidOf(u.name);
      const sec = Math.floor((t - ctx.start) / 1000);
      if ((orbLines.get(pid ?? "") ?? []).some((x) => Math.abs(x - sec) <= 1))
        continue;
      ctx.violate(
        "unseenOrbMissing",
        "Frozen Orb",
        t,
        u.name,
        `${u.name} Freezing Rain up at +${((t - ctx.start) / 1000).toFixed(3)}s with no orb row before it and no [ENEMY CD] Frozen Orb line`,
      );
    }
  }
}

function resHastedLeftUnclosed(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const enemies = ctx.players.filter((u) => u.reaction !== ctx.owner.reaction);
  for (const row of resRows(ctx))
    for (const e of row.entries) {
      const t = ctx.start + (row.s + 1) * 1000;
      for (const u of enemies) {
        const press = ((u.spellCastEvents ?? []) as any[])
          .filter(
            (c) =>
              ev(c) === SUCCESS &&
              tsOf(c) < t &&
              nameOf(c.spellId, c.spellName) === e.name &&
              // a channel ends when its caster stops it: a completed run
              // says nothing of the next one (codex 20-F25-03 #1)
              HASTE_DURATION_SPELL_IDS.has(String(c.spellId)),
          )
          .at(-1);
        if (!press) continue;
        const id = String(press.spellId);
        const rows = ((u.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              String(a.spellId) === id &&
              a.srcUnitId === u.id &&
              a.destUnitId === u.id,
          )
          .sort((a, b) => tsOf(a) - tsOf(b));
        const p = tsOf(press);
        const mine = rows.find(
          (a) => ev(a) === APPLIED && Math.abs(tsOf(a) - p) <= 50,
        );
        if (!mine) continue;
        const roundEnd = roundEndMs(ctx.legacy);
        if (
          rows.some(
            (a) =>
              ev(a) === REMOVED && tsOf(a) > tsOf(mine) && tsOf(a) <= roundEnd,
          )
        )
          continue;
        let open: number | null = null;
        let longest = 0;
        for (const a of rows) {
          if (tsOf(a) >= tsOf(mine)) break;
          if (ev(a) === APPLIED) open = tsOf(a);
          else if (ev(a) === REMOVED && open !== null) {
            longest = Math.max(longest, tsOf(a) - open);
            open = null;
          } else open = null;
        }
        if (longest <= 0) continue;
        ctx.bump("resHastedLeftUnclosed");
        const end = (p + longest - ctx.start) / 1000;
        if (row.s + e.left > end + 1)
          ctx.violate(
            "resHastedLeftUnclosed",
            e.name,
            ctx.start + row.s * 1000,
            `${u.name}:${Math.floor((p - ctx.start) / 1000)}`,
            `${fmtS(row.s)} ${e.name} ${e.left}s left; pressed +${((p - ctx.start) / 1000).toFixed(2)}s, no REMOVED in the round, longest own run ${(longest / 1000).toFixed(2)}s → ends ${end.toFixed(2)}`,
            row.line.slice(0, 160),
          );
        break;
      }
    }
}

const BURST_DAMAGE = /^\s*Target: (\S+) \d+% → \d+%.*?\| your damage ([\d.]+)M/;

function channelLastTickDropped(ctx: IRoundCtx): void {
  const o = ctx.owner;
  if (!o) return;
  const succ = ((o.spellCastEvents ?? []) as any[]).filter(
    (c) => ev(c) === SUCCESS,
  );
  const auras = ((o.auraEvents ?? []) as any[]).filter(
    (a) => a.srcUnitId === o.id && a.destUnitId === o.id,
  );
  let head: { from: number; to: number; opener: string } | null = null;
  for (const l of ctx.text.split("\n")) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      head = {
        from: mss(h[1]!, h[2]!),
        to: mss(h[3]!, h[4]!),
        opener:
          /\| ([^|]+?)(?: \d+:\d{2}–\d+:\d{2})?(?: \+ |$)/
            .exec(l)?.[1]
            ?.trim() ?? "",
      };
      continue;
    }
    const m = BURST_DAMAGE.exec(l);
    if (!m || !head) continue;
    const { from, to } = head;
    const target = ctx.byName.get(m[1]!);
    if (!target) continue;
    const lo = ctx.start + from * 1000;
    const hi = ctx.start + (to + 1) * 1000;
    const opener = head.opener;
    const first = succ
      .filter(
        (c) =>
          tsOf(c) >= lo &&
          tsOf(c) < lo + 1000 &&
          nameOf(c.spellId, c.spellName) === opener,
      )
      .map(tsOf);
    head = null;
    if (first.length === 0) continue;
    const fromMs = Math.min(...first);
    let tickEnd: number | null = null;
    let removedAt = 0;
    for (const c of succ) {
      const id = String(c.spellId);
      if (!CHANNELED_SPELL_IDS.has(id) || tsOf(c) < fromMs || tsOf(c) >= hi)
        continue;
      const rem = auras.find(
        (a) =>
          String(a.spellId) === id && ev(a) === REMOVED && tsOf(a) > tsOf(c),
      );
      if (!rem) continue;
      const name = nameOf(id, c.spellName);
      const tick = ((o.damageOut ?? []) as any[]).filter(
        (d) =>
          tsOf(d) > tsOf(rem) &&
          tsOf(d) <= tsOf(rem) + 100 &&
          nameOf(d.spellId, d.spellName) === name,
      );
      if (tick.length === 0) continue;
      tickEnd = Math.max(...tick.map(tsOf));
      removedAt = tsOf(rem);
    }
    if (tickEnd === null) continue;
    ctx.bump("channelLastTickDropped");
    const sum = (until: number) =>
      ((o.damageOut ?? []) as any[])
        .filter(
          (d) =>
            d.destUnitId === target.id &&
            tsOf(d) >= fromMs &&
            tsOf(d) <= until &&
            !isDeferralDamageRow(d),
        )
        .reduce((a, d) => a + Math.abs(d.effectiveAmount ?? 0), 0) / 1e6;
    const printed = +m[2]!;
    const cut = sum(removedAt);
    const full = sum(tickEnd);
    if (Math.abs(full - printed) > 0.006 && Math.abs(cut - printed) <= 0.006)
      ctx.violate(
        "channelLastTickDropped",
        "burst ledger",
        removedAt,
        `${from}`,
        `${fmtS(from)} printed ${printed}M = to the REMOVED (${cut.toFixed(3)}M); with the tick ${(tickEnd - removedAt) | 0} ms later ${full.toFixed(3)}M`,
        l.slice(0, 160),
      );
  }
}

const DR_LINE =
  /^(\d+):(\d{2})\s+\[CC ON (?:ENEMY|TEAM)\]\s+(\d+)\([^)]*\) ← (.+?) \(by [^)]*\)\)?.*\[DR: \S+ (Full|50%|Immune)\]/;

function drResetBandLength(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = DR_LINE.exec(l);
    if (!m) continue;
    // a length something cut (a dispel, a break, an immunity, a press) is
    // no reading of the DR (cover set 31-2 r2 1:39: Blessing of Sanctuary):
    // in the band it resets — drBandForcedEnd (codex 20-F25-04 #2); so is
    // one the holder's death or the round's end cut (F25b 605: Cheap Shot
    // 2.04 s of 4 in a death cascade, Psychic Scream removed after the
    // round's deciding death)
    const forced =
      /ended by|dispelled by|broke this|broken by|cut short|ended at their death|its target died|when the round ended/.test(
        l,
      );
    const u = ctx.unitOfPid(m[3]);
    if (!u) continue;
    const sec = mss(m[1]!, m[2]!);
    const name = m[4]!;
    const rows = ((u.auraEvents ?? []) as any[])
      .filter(
        (a) => a.destUnitId === u.id && DR_CATEGORY_MAP[String(a.spellId)],
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    const land = rows.find(
      (a) =>
        ev(a) === APPLIED &&
        nameOf(a.spellId, a.spellName) === name &&
        Math.floor((tsOf(a) - ctx.start) / 1000) === sec,
    );
    if (!land) continue;
    const id = String(land.spellId);
    const cat = DR_CATEGORY_MAP[id];
    const end = rows.find(
      (a) =>
        ev(a) === REMOVED &&
        String(a.spellId) === id &&
        a.srcUnitId === land.srcUnitId &&
        tsOf(a) > tsOf(land),
    );
    if (!end) continue;
    // the family's previous control on the unit: its last REMOVED before the landing
    let prevEnd = -Infinity;
    for (const a of rows)
      if (
        ev(a) === REMOVED &&
        DR_CATEGORY_MAP[String(a.spellId)] === cat &&
        tsOf(a) <= tsOf(land)
      )
        prevEnd = Math.max(prevEnd, tsOf(a));
    const gap = tsOf(land) - prevEnd;
    // the analysis' own band and length reading (shared predicate)
    if (!(gap >= DR_RESET_MS_121 && gap < DR_RESET_MS_121 + DR_RESET_TICK_MS))
      continue;
    const caster = ctx.units.find((x) => x.id === land.srcUnitId);
    const full = ccFullDurationForCaster(id, caster);
    if (!full) continue;
    const len = (tsOf(end) - tsOf(land)) / 1000;
    const diminished = isDiminishedLength(len * 1000, full * 1000);
    if (forced) {
      if (diminished !== true) continue;
      ctx.bump("drBandForcedEnd");
      if (m[5] !== "Full")
        ctx.violate(
          "drBandForcedEnd",
          name,
          tsOf(land),
          `${u.name}:${sec}`,
          `${fmtS(sec)} ${name} on ${u.name}: ${(gap / 1000).toFixed(3)} s after the family's last control ended, cut at ${len.toFixed(2)} s of ${full} s, printed ${m[5]}`,
          l.slice(0, 160),
        );
      continue;
    }
    const says =
      diminished === true ? "50%" : diminished === false ? "Full" : null;
    if (!says) continue;
    ctx.bump("drResetBandLength");
    if (says !== m[5])
      ctx.violate(
        "drResetBandLength",
        name,
        tsOf(land),
        `${u.name}:${sec}`,
        `${fmtS(sec)} ${name} on ${u.name}: ${(gap / 1000).toFixed(3)} s after the family's last control ended, ran ${len.toFixed(2)} s of ${full} s (${says}), printed ${m[5]}`,
        l.slice(0, 160),
      );
  }
}

/** `[CC AVOIDED?] <unit>: <control> (by <pid>(<label>)) did not land …` */
const AVOIDED_NOT_LANDED =
  /^(\d+):(\d{2})\s+\[CC AVOIDED\?\]\s+[^:]+: (.+?) \(by (\d+)\([^)]*\)\) did not land/;

function summonDiedBeforePulse(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = AVOIDED_NOT_LANDED.exec(l);
    if (!m) continue;
    const caster = ctx.unitOfPid(m[4]);
    if (!caster) continue;
    const sec = mss(m[1]!, m[2]!);
    const name = m[3]!;
    for (const c of successesOf(caster)) {
      if (nameOf(c.spellId, c.spellName) !== name) continue;
      if (Math.floor((tsOf(c) - ctx.start) / 1000) !== sec) continue;
      const summon = ctx.units.find((u) => {
        if (u.ownerId !== caster.id) return false;
        const at = summonedAtMs(u as any);
        return at !== null && at >= tsOf(c) - 100 && at <= tsOf(c) + 500;
      });
      if (!summon) continue;
      ctx.bump("summonDiedBeforePulse");
      const kill = nonPlayerUnitKill(summon as any);
      if (!kill) continue;
      const by = (r: any) =>
        r.srcUnitId === summon.id && tsOf(r) <= kill.timestamp;
      const wentOff =
        [
          ...((caster.petSpellCastEvents ?? []) as any[]),
          ...((summon.spellCastEvents ?? []) as any[]),
        ].some((e) => ev(e) === SUCCESS && by(e)) ||
        ctx.units.some(
          (u) =>
            ((u.auraEvents ?? []) as any[]).some(
              (a) => ev(a) === APPLIED && by(a),
            ) || ((u.missesIn ?? []) as any[]).some(by),
        );
      if (wentOff) continue;
      ctx.violate(
        "summonDiedBeforePulse",
        name,
        tsOf(c),
        `${caster.name}:${sec}`,
        `${fmtS(sec)} ${name} by ${caster.name}: its summon died ${((kill.timestamp - tsOf(c)) / 1000).toFixed(2)} s after the press with no row of its own, printed "did not land"`,
        l.slice(0, 160),
      );
    }
  }
}

function reflectedHealerCcNoConseq(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const endAt = roundEndMs(ctx.legacy);
  for (const h of ctx.players) {
    if (!isHealerSpec(h.spec)) continue;
    const rows = ((h.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.destUnitId === h.id &&
          a.srcUnitId === h.id &&
          ccSpellIds.has(String(a.spellId)),
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    for (const app of rows) {
      if (ev(app) !== APPLIED || app.auraType !== "DEBUFF") continue;
      const rem = rows.find(
        (a) =>
          ev(a) === REMOVED &&
          String(a.spellId) === String(app.spellId) &&
          tsOf(a) > tsOf(app),
      );
      const to = Math.min(rem ? tsOf(rem) : endAt, endAt);
      if ((to - tsOf(app)) / 1000 < HEALER_CC_MIN_S) continue;
      const mates = ctx.players.filter(
        (u) => u.reaction === h.reaction && u.id !== h.id,
      );
      if (!mates.some((u) => deathMs(u) >= tsOf(app) && deathMs(u) <= to))
        continue;
      ctx.bump("reflectedHealerCcNoConseq");
      const name = nameOf(app.spellId, app.spellName);
      const sec = Math.floor((tsOf(app) - ctx.start) / 1000);
      const has = ctx.lines.some(
        (l) =>
          l.startsWith(`${fmtS(sec)}  [CONSEQ]`) && l.includes(` in ${name}`),
      );
      if (!has)
        ctx.violate(
          "reflectedHealerCcNoConseq",
          name,
          tsOf(app),
          `${h.name}:${sec}`,
          `${fmtS(sec)} ${h.name}'s own ${name} reflected onto it for ${((to - tsOf(app)) / 1000).toFixed(1)} s, a teammate died inside it, no [CONSEQ] line`,
        );
    }
  }
}

const KILL_ATTEMPT_LINE =
  /^ {2}\[(\d+):(\d{2})–(\d+):(\d{2})\] on (\S+) — .*\| (FAILED: .+|KILL)$/;
const ENEMY_TRINKET_OUT =
  /^(\d+):(\d{2})\s+\[ENEMY TRINKET\]\s+(\d+)\([^)]*\) used PvP trinket out of (.+?) \(by /;

function killAttemptTrinketOutMissed(ctx: IRoundCtx): void {
  const outs: Array<{ sec: number; unit: any; name: string }> = [];
  for (const l of ctx.lines) {
    const m = ENEMY_TRINKET_OUT.exec(l);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (unit) outs.push({ sec: mss(m[1]!, m[2]!), unit, name: m[4]! });
  }
  // …and every root or disarm a Medallion press took off, from the log
  // itself: the `[ENEMY TRINKET]` line names the binder's one (codex
  // 20-F25-05 #2: two roots off, the named one outside the attempt). The
  // product's control sets (`rootSpellIds` / `disarmSpellIds`): Charge's
  // 1 s root is not one (605 192-2 0:25)
  for (const u of ctx.players)
    for (const use of pvpTrinketUses(u)) {
      if (use.atMs < ctx.start || use.atMs > ctx.end) continue;
      for (const a of (u.auraEvents ?? []) as any[]) {
        const id = String(a.spellId);
        if (
          a.destUnitId === u.id &&
          ev(a) === REMOVED &&
          !ccSpellIds.has(id) &&
          (rootSpellIds.has(id) || disarmSpellIds.has(id)) &&
          Math.abs(tsOf(a) - use.atMs) <= 300
        )
          outs.push({
            sec: Math.floor((use.atMs - ctx.start) / 1000),
            unit: u,
            name: nameOf(a.spellId, a.spellName),
          });
      }
    }
  if (!outs.length || !ctx.owner) return;
  // The attempt's own milliseconds, as the product brackets it
  // (`attributeFailure`'s `ofThisAttempt`: a control applied by `toMs` and
  // still on at `fromMs`). The rendered seconds alone were wider: a Disarm
  // landing 0.77 s after the anchoring stun came off, in the bracket's last
  // rendered second, read as one of the attempt's (GH #191). Bounds only —
  // which controls the press removed is still read from the log here.
  let attempts: ReturnType<typeof extractKillAttempts> | undefined;
  const attemptOf = (targetName: string, a: number, b: number) => {
    attempts ??= extractKillAttempts(
      ctx.players.filter((u) => u.reaction === ctx.owner.reaction),
      ctx.players.filter((u) => u.reaction !== ctx.owner.reaction),
      ctx.legacy,
    );
    return attempts.find(
      (x) =>
        x.targetName === targetName &&
        Math.floor(x.fromSeconds) === a &&
        Math.floor(x.toSeconds) === b,
    );
  };
  for (const l of ctx.lines) {
    const m = KILL_ATTEMPT_LINE.exec(l);
    if (!m || m[6] === "KILL") continue;
    const a = mss(m[1]!, m[2]!);
    const b = mss(m[3]!, m[4]!);
    const target = ctx.byName.get(m[5]!);
    if (!target) continue;
    for (const o of outs) {
      // whole seconds only: a press in the bracket's first second, or in
      // the last one of the credit span, may sit outside the attempt's own
      // milliseconds
      if (o.unit.id !== target.id || o.sec <= a || o.sec >= b + 5) continue;
      const attempt = attemptOf(m[5]!, a, b);
      if (!attempt) continue;
      const lo = ctx.start + attempt.fromSeconds * 1000;
      const hi = ctx.start + attempt.toSeconds * 1000;
      const rows = ((target.auraEvents ?? []) as any[])
        .filter(
          (x) =>
            x.destUnitId === target.id &&
            nameOf(x.spellId, x.spellName) === o.name,
        )
        .sort((x, y) => tsOf(x) - tsOf(y));
      const overlaps = rows.some((app) => {
        if (ev(app) !== APPLIED) return false;
        // a hard control is the CC binder's (F15 R3 / F16 idx 37): the class
        // is the rest a Medallion removes — silence, disarm, root
        const id = String(app.spellId);
        if (ccSpellIds.has(id)) return false;
        // …and by id, not by name alone: a same-name aura that is no
        // control (Binding Shot's tether 117405, Snowdrift's slow) is
        // nothing a Medallion answers (605 164-2 3:04, 4-1 1:21: the stun
        // landed after the attempt ended)
        if (
          !rootSpellIds.has(id) &&
          !disarmSpellIds.has(id) &&
          !isSilenceOnlyAura(id)
        )
          return false;
        const rem = rows.find(
          (x) =>
            ev(x) === REMOVED &&
            String(x.spellId) === id &&
            tsOf(x) >= tsOf(app),
        );
        const to = rem ? tsOf(rem) : ctx.end;
        return tsOf(app) <= hi && to >= lo;
      });
      if (!overlaps) continue;
      ctx.bump("killAttemptTrinketOutMissed");
      if (!m[6]!.includes("target trinketed out"))
        ctx.violate(
          "killAttemptTrinketOutMissed",
          o.name,
          lo,
          `${target.name}:${a}`,
          `[${fmtS(a)}–${fmtS(b)}] on ${target.name}: trinket out of ${o.name} at ${fmtS(o.sec)}, printed ${m[6]}`,
          l.slice(0, 160),
        );
      break;
    }
  }
}

/**
 * unusedOwnAuraOnAlly (class 7, D19): a `<cooldowns>` entry `Name [..]
 * [UNUSED]` whose unit put an aura of that name on another unit inside the
 * round with no cast row of the name — the press was out of the recorder's
 * sight (46eb2199 r0: a prowling Balance Druid's Stampeding Roar 77764 on
 * two allies at 0:03.256, the kit read `[UNUSED]`). Counted: every kit entry
 * with such an aura and no cast row.
 */
function unusedOwnAuraOnAlly(ctx: IRoundCtx): void {
  const end = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    const pid = ctx.pidOf(u.name);
    const at = ctx.text.indexOf(`<unit id="${pid}" `);
    if (at < 0) continue;
    const cds = /<cooldowns>([^<]*)<\/cooldowns>/.exec(ctx.text.slice(at))?.[1];
    if (!cds) continue;
    const cast = new Set(
      successesOf(u)
        .filter((c) => tsOf(c) >= ctx.start && tsOf(c) <= end)
        .map((c) => nameOf(c.spellId, c.spellName)),
    );
    const onOthers = new Map<string, number>();
    for (const x of ctx.units)
      for (const a of (x.auraEvents ?? []) as any[]) {
        if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
        if (a.destUnitId === u.id) continue;
        const t = tsOf(a);
        if (t < ctx.start || t > end) continue;
        const name = nameOf(a.spellId, a.spellName);
        if (!onOthers.has(name)) onOthers.set(name, t);
      }
    for (const m of cds.matchAll(
      /(?:^|, )([^,[]+?) \[[^\]]*\]( \[UNUSED\])?(?=,|$| \[)/g,
    )) {
      const name = m[1]!;
      const t = onOthers.get(name);
      if (t === undefined || cast.has(name)) continue;
      ctx.bump("unusedOwnAuraOnAlly");
      if (m[2])
        ctx.violate(
          "unusedOwnAuraOnAlly",
          name,
          t,
          `${u.name}:${name}`,
          `${u.name}: ${name} on another unit at ${fmtS((t - ctx.start) / 1000)} with no cast row; kit reads [UNUSED]`,
        );
    }
  }
}

/**
 * staleMaxTickRescaled (class 8, D18 / D33): a `[STATE]` tick whose unit's
 * last HP row at or before the tick is a stale-max row (`staleMaxHpRows`: the
 * current already on a max-HP step's new scale, the max still the old one)
 * prints that row's current over the step's NEW max — the max of the first
 * later row with another one, smaller for a step down, larger for a step up
 * (T09 attempt 2) (461265d4 r0 1:55: Fortifying Brew off, 907k
 * over the new 1,057,720 = 86, printed the pre-step 88; 6e0b8761 r0 0:14:
 * Fortitude dispelled, 1,073,314 / 1,158,460 = 93, printed 95). Counted:
 * every such tick.
 */
function staleMaxTickRescaled(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = STATE.exec(l);
    if (!m) continue;
    const tMs = ctx.start + mss(m[1]!, m[2]!) * 1000;
    for (const x of m[3]!.matchAll(/(\d+)\([^)]*\):(\d+)/g)) {
      const unit = ctx.unitOfPid(x[1]);
      if (!unit) continue;
      const rows = ((unit.advancedActions ?? []) as any[])
        .filter(
          (a) => a.advancedActorId === unit.id && a.advancedActorMaxHp > 0,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      let k = -1;
      for (let i = 0; i < rows.length && tsOf(rows[i]) <= tMs; i++) k = i;
      if (k < 0 || tMs - tsOf(rows[k]) > 3000) continue;
      const last = rows[k];
      if (!staleMaxHpRows(unit).has(last)) continue;
      // the step is the first later row of another max — a step down's
      // smaller one or (T09) a step up's larger one; "the first smaller"
      // took a Fortifying Brew's grant row over the max of the brew's end
      const step = rows
        .slice(k + 1)
        .find((a) => a.advancedActorMaxHp !== last.advancedActorMaxHp);
      if (!step) continue;
      ctx.bump("staleMaxTickRescaled");
      const want = Math.min(
        100,
        Math.round(
          (100 * last.advancedActorCurrentHp) / step.advancedActorMaxHp,
        ),
      );
      if (Math.abs(want - +x[2]!) > 1)
        ctx.violate(
          "staleMaxTickRescaled",
          "tick",
          tMs,
          `${unit.name}#${m[1]}:${m[2]}`,
          `[STATE] ${m[1]}:${m[2]} ${unit.name} printed ${x[2]}, last row ${last.advancedActorCurrentHp} over the new max ${step.advancedActorMaxHp} = ${want}`,
          l.slice(0, 160),
        );
    }
  }
}

/**
 * deferralFiledAsWall (class 7, D26): an ABILITIES INTO IMMUNITY/DR line into
 * a deferral shield (`DEFERRAL_SHIELD_DAMAGE_IDS`: Time Dilation) that does
 * not say it is one — the section's legend files every other line as an
 * immunity or a damage-reduction wall, and a deferral reduces nothing
 * (915f90ae r0 1:13: three lines `… into …'s Time Dilation`). Counted: every
 * line into a deferral shield.
 */
function deferralFiledAsWall(ctx: IRoundCtx): void {
  const names = new Set(
    Object.keys(DEFERRAL_SHIELD_DAMAGE_IDS).map((id) => nameOf(id)),
  );
  for (const l of ctx.lines) {
    const m = INTO.exec(l);
    if (!m) continue;
    const name = withoutDeferralTag(m[6]!);
    if (!names.has(name)) continue;
    ctx.bump("deferralFiledAsWall");
    if (name === m[6])
      ctx.violate(
        "deferralFiledAsWall",
        name,
        ctx.start + mss(m[1]!, m[2]!) * 1000,
        `${m[5]}:${m[1]}:${m[2]}`,
        `into ${m[5]}'s ${name} with no deferral mark`,
        l.slice(0, 160),
      );
  }
}

/**
 * passiveAbsorbProcUnlisted (class 7, D25): an enemy's passive absorb proc
 * (`PASSIVE_ABSORB_PROC_AURAS`: Angelic Bulwark) that went up on itself
 * inside the round has an `[ENEMY DEF]` line naming it at that second
 * (733ef717 r0 0:22: a 500k Angelic Bulwark under the priest, no line).
 * Counted: every such application.
 */
function passiveAbsorbProcUnlisted(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const end = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    if (u.reaction === ctx.owner.reaction) continue;
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED || a.destUnitId !== u.id || a.srcUnitId !== u.id)
        continue;
      const name = PASSIVE_ABSORB_PROC_AURAS.get(String(a.spellId));
      if (!name) continue;
      const t = tsOf(a);
      if (t < ctx.start || t > end) continue;
      ctx.bump("passiveAbsorbProcUnlisted");
      const sec = Math.floor((t - ctx.start) / 1000);
      const listed = ctx.lines.some((l) => {
        const m = /^(\d+):(\d{2})\s+\[ENEMY DEF\]\s+(\d+)\(/.exec(l);
        return (
          !!m &&
          m[3] === pid &&
          mss(m[1]!, m[2]!) === sec &&
          l.includes(`: ${name} (`)
        );
      });
      if (!listed)
        ctx.violate(
          "passiveAbsorbProcUnlisted",
          name,
          t,
          `${u.name}:${sec}`,
          `${fmtS(sec)} ${u.name}: ${name} went up with no [ENEMY DEF] line`,
        );
    }
  }
}

/**
 * trinketTookSeveralRoots (codex 20-F25-05 #2, exposure): a PvP trinket
 * press that took off two or more roots or disarms (no hard control) at
 * once — the control sets the product reads (`rootSpellIds` /
 * `disarmSpellIds`: a gap-closer's 1 s root such as Charge's is no control
 * response, predicate index "Not yet unified"). The kill attempt's D24 reading binds one of them
 * (`findBrokenRoot` / `findBrokenDisarm`), so the other is not asked
 * whether it was of the attempt. Counted: every press that took off one;
 * a violation is a press that took off more than one.
 */
function trinketTookSeveralRoots(ctx: IRoundCtx): void {
  for (const u of ctx.players) {
    for (const use of pvpTrinketUses(u)) {
      if (use.atMs < ctx.start || use.atMs > ctx.end) continue;
      const off = ((u.auraEvents ?? []) as any[]).filter((a) => {
        const id = String(a.spellId);
        return (
          a.destUnitId === u.id &&
          ev(a) === REMOVED &&
          !ccSpellIds.has(id) &&
          (rootSpellIds.has(id) || disarmSpellIds.has(id)) &&
          Math.abs(tsOf(a) - use.atMs) <= 300
        );
      });
      if (off.length === 0) continue;
      ctx.bump("trinketTookSeveralRoots");
      if (off.length > 1)
        ctx.violate(
          "trinketTookSeveralRoots",
          "several",
          use.atMs,
          `${u.name}:${use.atMs}`,
          `${u.name} trinket at ${fmtS((use.atMs - ctx.start) / 1000)}: took off ${off.map((a) => nameOf(a.spellId, a.spellName)).join(" + ")}`,
          "",
        );
    }
  }
}

/**
 * evidencePressOnRestatedAura (codex 20-F25-05 #1, exposure): a unit's own
 * cooldown id APPLIED on other units with no cast row of it in the round
 * (D19's press evidence). The presses are the producer's own
 * (`effectEvidenceCastSeconds`: its effect auras, its span, an anchor that
 * moves only on an accepted press — codex 20-F25-06 #3, 20-F25-07: a
 * re-walk of the raw id alone missed Bestial Wrath's self effect 186254
 * moving the anchor). A violation is an accepted press, after the first,
 * whose rows at its millisecond are all re-statements: each recipient
 * still held that unit's aura of the id (no REMOVED since its APPLIED).
 * Counted: every accepted press after a unit's first of the id.
 */
function evidencePressOnRestatedAura(ctx: IRoundCtx): void {
  const allAuras = ctx.units.flatMap((x: any) => x.auraEvents ?? []) as any[];
  for (const u of ctx.players) {
    const cast = new Set(
      successesOf(u)
        .filter((c) => tsOf(c) >= ctx.start && tsOf(c) <= ctx.end)
        .map((c) => String(c.spellId)),
    );
    const own = allAuras
      .filter((a) => a.srcUnitId === u.id && tsOf(a) >= ctx.start)
      .sort((a, b) => tsOf(a) - tsOf(b));
    const ids = new Set(
      own
        .filter(
          (a) =>
            a.destUnitId !== u.id &&
            ev(a) === APPLIED &&
            !cast.has(String(a.spellId)) &&
            (spellEffectData[String(a.spellId)]?.cooldownSeconds ?? 0) >= 20 &&
            tsOf(a) <= ctx.end,
        )
        .map((a) => String(a.spellId)),
    );
    for (const id of ids) {
      const presses = effectEvidenceCastSeconds(
        u,
        id,
        spellEffectData[id]!.cooldownSeconds!,
        ctx.legacy,
      ).map((sec) => ctx.start + sec * 1000);
      for (const at of presses.slice(1)) {
        if (at > ctx.end) break;
        ctx.bump("evidencePressOnRestatedAura");
        const rows = own.filter((a) => ev(a) === APPLIED && tsOf(a) === at);
        const restated = (row: any): number | undefined => {
          const key = (a: any) => `${a.destUnitId}|${a.spellId}`;
          let since: number | undefined;
          for (const a of own) {
            if (tsOf(a) >= at) break;
            if (key(a) !== key(row)) continue;
            if (ev(a) === REMOVED) since = undefined;
            else if (ev(a) === APPLIED && since === undefined) since = tsOf(a);
          }
          return since;
        };
        const held = rows.map(restated);
        if (!rows.length || held.some((h) => h === undefined)) continue;
        ctx.violate(
          "evidencePressOnRestatedAura",
          nameOf(id),
          at,
          `${u.name}:${id}:${at}`,
          `${nameOf(id)} by ${u.name}: read as a press at ${fmtS((at - ctx.start) / 1000)}, every aura it applied then (${rows.map((r) => `${nameOf(r.spellId, r.spellName)} on ${r.destUnitName}`).join(", ")}) already up, no REMOVED between, no cast row`,
          "",
        );
      }
    }
  }
}
