/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact11 (F26) class checks.
 *
 *  - channelEndOnOwnRow (D2): a `[YOU] [CD] <channel> (channeled Ns, ended
 *    M:SS)` line whose channel the log ends later — the owner's same-id aura
 *    from that press is REMOVED more than a second after the printed end —
 *    with nothing of another name pressed or begun by the owner in between
 *    (a row of the channel's own name is its tick or a copy: Divine Hymn's
 *    64844). Counted: every such line whose press has its own aura.
 *  - channelSpanUnrun (D39): a BURST LEDGER cooldown span `<channel> a:bb–c:dd`
 *    of a channel (`CHANNELED_SPELL_IDS`) the game refused at its press — a
 *    SPELL_MISSED of the press's id by the owner within 50 ms of the press,
 *    no aura of the id on the owner from it, nothing of its name after the
 *    refusal before the next press of it — printed with a length (c:dd past
 *    a:bb). Counted: every ledger span of a channel.
 *  - doomWindsNoPressReading (D7 / D44): a Doom Winds buff 466772 a player
 *    put on itself with neither a Doom Winds press 384352 nor an Ascendance
 *    114051 (cast or aura) of that player within 1 s. On a log from 12.1.5
 *    on it is a proc: a line of that second naming it as a press — an
 *    `[ENEMY CD]` Doom Winds line without `(no press)` — is a violation; on
 *    an older log it is an unlogged press: a `[YOU] / [TEAM] [PROC] Doom
 *    Winds (no press)` line of that second is. Kinds `proc as press`,
 *    `press as proc`. Counted: every such buff in the round.
 *  - intoImmunityLanded (D20 / D21): an ABILITIES INTO IMMUNITY/DR line into
 *    a wall that stops every hit it covers (pct 100: an immunity or a
 *    deflection) listing a spell more times than the player has casts of it
 *    on that enemy the log does NOT show getting through: a cast whose own
 *    first row on the target inside the wall is a damage row or a miss of
 *    type ABSORB (a shield ate it) landed — Blackout Kick into Cloak of
 *    Shadows, a Chaos Bolt hitting for 220k inside Aspect of the Turtle.
 *    Counted: every (line, spell) into such a wall.
 *  - pressImmuneTagLanded (D10): a `[YOU]` / `[TEAM]` press line tagged
 *    `[IMMUNE …]` for a press that is no control (`ccSpellIds`) whose every
 *    IMMUNE row (the press's ids, `castAndEffectIds`, within 3 s) is on a
 *    unit a damage or heal row of the same press reached in the IMMUNE
 *    row's own instant (`PRESS_LANDED_SAME_INSTANT_MS`) —
 *    one component refused (The Hunt's root into Blessing of Freedom), not
 *    the press. Counted: every IMMUNE-tagged line of a non-control press.
 *  - immuneCauseCannotStopDamage (D32): a `[… — X was up]` IMMUNE cause on a
 *    press line whose IMMUNE row is a spell with no control and no DB2
 *    mechanic (a damage spell), naming an aura X that is no pct-100 wall
 *    stopping that spell's school — a control avoidance (Precognition)
 *    named for a Lava Burst into Ice Block. The cause stands when it stops
 *    one of the press's such rows on that row's unit. Counted: every press
 *    line naming an IMMUNE cause with such a row.
 *  - exposureThreatOnFormHealer (D27): a `[HEALER EXPOSURE]` line listing
 *    any control threat while a healer of the owner's team is in a Spirit of
 *    Redemption form (`auraIsImmunityForm`: immune to control, user ruling
 *    fact2 5 / F20) at the line's second — the log's own aura rows. Counted:
 *    every `[HEALER EXPOSURE]` line.
 *  - allyOverlapPastAura (D24 D30 D41): a BURST LEDGER `Ally CDs
 *    overlapping:` line whose entries of one ally and one cooldown (`X Ns`
 *    and `X (no press) Ns` together) claim more seconds than that ally's own
 *    aura of the name — APPLIED → REMOVED on themselves, by themselves —
 *    covers inside the burst (its printed seconds widened by one on each
 *    side). One aura run credited to a press and to the cast-less
 *    re-application it chained into, or to the press that refreshed it.
 *    Counted: every (burst, ally, cooldown) with two entries or more whose
 *    ally has such an aura covering each entry alone (an effect on another
 *    unit — Predator's Wake's DoT — is not bounded by it).
 *  - savePressRunsOverlap (D33): two press lines of one unit's own save
 *    (`[ENEMY DEF]` / `[YOU] [CD]` / `[TEAM] [CD]`, no `→` target) of one
 *    name, the later one pressed before the earlier one's printed length ran
 *    out by more than the rendering's second — one aura run read for both
 *    presses (Ice Barrier re-pressed 0.74 s in, both lines `absorb 351k,
 *    4.8s`). A re-press ends the earlier run. Counted: every such line
 *    followed by a later line of the same unit and name.
 *  - answeredByOldSummonPulse (D28): a `[BURST ANSWERED]` `P answered with
 *    X on Y in Ns` whose control aura X on Y — APPLIED within a second of
 *    the opener's second + N — came from a summon of P that is no pet (a
 *    totem, a guardian) summoned (its SPELL_SUMMON) before the opener's
 *    second: a pulse of a totem dropped before the burst, no answer to it.
 *    Counted: every such answer whose aura came from a non-pet summon.
 *  - castLineNoButton (D3): a `[YOU] [CAST]` line naming a spell whose every
 *    owner SPELL_CAST_SUCCESS row of the name in that second is no button —
 *    no DB2 SpellCooldowns row (`isButtonPress`): a row a passive writes
 *    (Sanctified Ground 289655 after each Holy Word: Serenity). The forward
 *    check of `PASSIVE_PROC_CAST_IDS`; kind = the spell id. Counted: every
 *    `[YOU] [CAST]` line with an owner row of its name in its second.
 *  - pressedInsideNeverBack (D14): a `team offensive CDs ready at M:SS: …`
 *    clause set listing a cooldown under `pressed inside` that is on none of
 *    its other lists — ready, `may already be back`, `back inside`, `pressed
 *    at start` — a press proves it was back by then. Counted: every
 *    `pressed inside` entry but a healer's own cooldown that is no team
 *    burst (B3iii: on no ready list by rule).
 *  - healMajorAsDefensive (D4): a cd-hoarded menu row's `readyCds` (the
 *    player's "usable major defensive cooldown") naming a healing major —
 *    an `[ENEMY HEAL CD]` id (`ENEMY_HEAL_CD_IDS`, the throughput roster).
 *    Kind = the name (Tree of Life is a ruled defensive, 2026-09-14: read
 *    the kinds, not the total). Counted: every readyCds entry.
 *  - healerRosterAsEnemyBurst (D16): an `[ENEMY CD]` line of an enemy
 *    healer naming a cooldown on that spec's signed save roster
 *    (`healerSaveCdRoster`, user-signed 2026-09-04) that deals no damage
 *    (official profile) — a healer's throughput major filed as an offensive
 *    burst (Holy Paladin Avenging Wrath). Counted: every healer `[ENEMY CD]`
 *    line.
 *  - ownShieldNotPopped (D46): a `KILL ATTEMPTS` line `FAILED: not enough
 *    damage` on a target whose own pressed absorb shield (an aura the target
 *    put on itself, from a button — `isButtonPress` of the aura or a cast it
 *    is the effect of) absorbed ≥ 50k of our team's hits inside the
 *    attempt's rendered seconds. Kind = the shield. Counted: every such
 *    failed attempt line.
 *  - areaCarryInDefenseless (D15): a `[KILL WINDOW] … (defenseless a–b)`
 *    span on a unit that carried, strictly inside it, an aura named as an
 *    area save (`ENEMY_AREA_SAVE_IDS`' casts, by English name — the log can
 *    write the aura with no source: Anti-Magic Zone 145629). Kind = the
 *    save. Counted: every defenseless span.
 *  - ownerGroundedUnstated (D8): the owner's own control whose cast row
 *    names an enemy Grounding Totem (`groundingRedirects` via "cast", a
 *    lookup of the log's own redirect) with neither a `[GROUNDED]` line nor
 *    an `[absorbed: Grounding Totem]` tag in its second. Counted: every
 *    such redirect of the owner's.
 *  - variantSpentButton (D22 D25 D29): on a log from before a dated
 *    override variant's cutover (`OVERRIDE_VARIANT_SHARES_BY_ERA`: Predator's
 *    Wake 1259431 → The Hunt 1246167 before 12.1.5), a `[RES]` `cd:` entry of
 *    the button (`The Hunt(Ns)`) for a unit that pressed no button-id
 *    (`SPELL_CAST_SUCCESS` of the button or a still-shared alias of it, never
 *    the variant) within the button's cooldown before that second — the
 *    variant's press spent it. Counted: every `[RES]` cd entry of such a
 *    button on such a log.
 *  - teamReadyHealerOnlyCd (codex 20-F26-03 #1, B3iii): a `team offensive
 *    CDs ready …: <list>` entry whose every friendly caster this round is a
 *    healer for whom it is no team burst (`countsAsTeamBurst` — only Power
 *    Infusion). Kind = the cooldown. Counted: every entry with a friendly
 *    caster.
 *  - immunityPressNoLine (D34): an enemy's successful press of an immunity
 *    save (`isImmunitySaveAura` of the cast or its effect aura) inside the
 *    round with no `[ENEMY DEF]` line of that unit naming it within a
 *    second. Counted: every such press.
 *  - immunityCopyUnstated (D45): an immunity aura an enemy's press put on a
 *    teammate of theirs and on the caster in one instant (APPLIED, source
 *    the caster, within 50 ms — `immunityAlsoOn`'s) whose recipient the
 *    caster's `[ENEMY DEF]` line of that second does not name. Counted:
 *    every such copy.
 *  - auraOnlyPressNoLine (D42): a player's own aura of a
 *    `NO_CAST_LOG_PRESS_IDS` button that is the `[PRESS]` line's
 *    (`isOffListPressId`), applied with no logged press of it within
 *    `SAVE_CAST_AURA_PAIR_S`, and no line naming it in its second. Counted:
 *    every such aura.
 */
import { countsAsTeamBurst } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { isDamageImmuneControl } from "@gladlog/analysis/src/analysis/candidates/massDispel";
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { isControlSpell } from "@gladlog/analysis/src/context/spellOutcomeLines";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import {
  AURA_ONLY_ACTIVATION_IDS,
  NO_CAST_LOG_PRESS_IDS,
} from "@gladlog/analysis/src/data/auraActivation";
import {
  castAndEffectIds,
  castsOfEffectAura,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { ENEMY_HEAL_CD_IDS } from "@gladlog/analysis/src/data/enemyHealCds";
import { healerSaveCdRoster } from "@gladlog/analysis/src/data/healerSaveCd";
import { OVERRIDE_VARIANTS_GENERATED } from "@gladlog/analysis/src/data/overrideVariantsGenerated";
import { SHARED_CD_RACIAL_SPELL_IDS } from "@gladlog/analysis/src/data/racialAbilities";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ENEMY_AREA_SAVE_IDS } from "@gladlog/analysis/src/data/spellIdLists";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  CHANNEL_AURA_TAIL,
  isButtonPress,
} from "@gladlog/analysis/src/utils/castCommitSpans";
import {
  isControlCast,
  PRESS_LANDED_SAME_INSTANT_MS,
  PRESS_TRIGGERED_CAST_IDS,
} from "@gladlog/analysis/src/utils/castMissRows";
import { COPY_CAST_IDS } from "@gladlog/analysis/src/utils/castPress";
import { CANCEL_CC_NEAR_S } from "@gladlog/analysis/src/utils/castStopEvidence";
import {
  breakAbilityPresses,
  readyTrinketRacialNameAt,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { auraIsImmunityForm } from "@gladlog/analysis/src/utils/combatStates";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  holderFirstOwnActionAfterMs,
  immunityStopsSpellSchool,
  isImmunitySaveAura,
  KW_OWN_ROTATIONAL_ABSORB_AURA_IDS,
  KW_UNTARGETABLE_AURA_IDS,
  SAVE_CAST_AURA_PAIR_S,
  wallStopsEveryHit,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { groundingRedirects } from "@gladlog/analysis/src/utils/groundingRedirects";
import { isOffListPressId } from "@gladlog/analysis/src/utils/offListPress";
import { OVERRIDE_VARIANT_SHARES_BY_ERA } from "@gladlog/analysis/src/utils/overrideVariantEra";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";

import {
  ABSORBED,
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  SUCCESS,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "channelEndOnOwnRow",
  "channelSpanUnrun",
  "doomWindsNoPressReading",
  "intoImmunityLanded",
  "pressImmuneTagLanded",
  "immuneCauseCannotStopDamage",
  "exposureThreatOnFormHealer",
  "variantSpentButton",
  "allyOverlapPastAura",
  "savePressRunsOverlap",
  "answeredByOldSummonPulse",
  "castLineNoButton",
  "pressedInsideNeverBack",
  "healMajorAsDefensive",
  "healerRosterAsEnemyBurst",
  "ownShieldNotPopped",
  "areaCarryInDefenseless",
  "ownerGroundedUnstated",
  "castStopUnderUnloggedSilence",
  "teamReadyHealerOnlyCd",
  "immunityPressNoLine",
  "immunityCopyUnstated",
  "auraOnlyPressNoLine",
  "immunityBaitedSelfBroken",
  "primeRacialReadyUnstated",
  "stealthImmuneThroughHit",
] as const;

export function run(ctx: IRoundCtx): void {
  doomWindsNoPressReading(ctx);
  intoImmunityLanded(ctx);
  pressImmuneTagChecks(ctx);
  exposureThreatOnFormHealer(ctx);
  variantSpentButton(ctx);
  allyOverlapPastAura(ctx);
  savePressRunsOverlap(ctx);
  answeredByOldSummonPulse(ctx);
  pressedInsideNeverBack(ctx);
  healMajorAsDefensive(ctx);
  healerRosterAsEnemyBurst(ctx);
  areaCarryInDefenseless(ctx);
  if (!ctx.owner) return;
  teamReadyHealerOnlyCd(ctx);
  immunityPressNoLine(ctx);
  immunityCopyUnstated(ctx);
  auraOnlyPressNoLine(ctx);
  immunityBaitedSelfBroken(ctx);
  primeRacialReadyUnstated(ctx);
  stealthImmuneThroughHit(ctx);
  ownShieldNotPopped(ctx);
  ownerGroundedUnstated(ctx);
  castStopUnderUnloggedSilence(ctx);
  channelEndOnOwnRow(ctx);
  castLineNoButton(ctx);
  channelSpanUnrun(ctx);
}

const CHANNELED_LINE =
  /^(\d+:\d{2})\s+\[YOU\] \[CD\]\s+(.+?)(?: \[[^\]]*\])? \(channeled ([\d.]+)s, ended (\d+:\d{2})(?:; [^)]*)?\)/;

const castsOf = (u: any): any[] =>
  ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);

function channelEndOnOwnRow(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  for (const l of ctx.lines) {
    const m = CHANNELED_LINE.exec(l);
    if (!m) continue;
    const name = m[2]!;
    const castS = secOf(m[1]!);
    // the press is the same-second row of that name whose own id put an
    // aura on the owner (Divine Hymn's 64843; its 64844 tick rows put none)
    const ownAura = (id: string) =>
      ((owner.auraEvents ?? []) as any[]).filter(
        (a) =>
          String(a.spellId) === id &&
          a.srcUnitId === owner.id &&
          a.destUnitId === owner.id,
      );
    let press: any;
    let applied: any;
    for (const c of castsOf(owner)) {
      if (nameOf(c.spellId, c.spellName) !== name) continue;
      // a copy row is no press: Divine Hymn's 64844 heal-buff rows put a 15 s
      // buff of their own id on the priest, not the channel
      if (COPY_CAST_IDS.has(String(c.spellId))) continue;
      if (Math.floor((tsOf(c) - ctx.start) / 1000) !== castS) continue;
      applied = ownAura(String(c.spellId)).find(
        (a) => ev(a) === APPLIED && Math.abs(tsOf(a) - tsOf(c)) <= 100,
      );
      if (applied) {
        press = c;
        break;
      }
    }
    if (!press) continue;
    const id = String(press.spellId);
    const pressMs = tsOf(press);
    const removed = ownAura(id).find(
      (a) => ev(a) === REMOVED && tsOf(a) > tsOf(applied),
    );
    if (!removed) continue;
    ctx.bump("channelEndOnOwnRow");
    const printedEndS = secOf(m[4]!);
    const trueEndS = (tsOf(removed) - ctx.start) / 1000;
    if (!(trueEndS > printedEndS + 1)) continue;
    // GH #194: the channel is its bolts and the line states the aura's own
    // end beside it — consistent when that end is the REMOVED row's second
    const tail = new RegExp(`; ${CHANNEL_AURA_TAIL} (\\d+:\\d{2})\\)`).exec(l);
    if (tail && Math.abs(secOf(tail[1]!) - Math.floor(trueEndS)) <= 1) continue;
    const otherInside = [
      ...castsOf(owner),
      ...((owner.castStartEvents ?? []) as any[]),
    ].some(
      (c) =>
        tsOf(c) > pressMs &&
        tsOf(c) <= ctx.start + (printedEndS + 1) * 1000 &&
        nameOf(c.spellId, c.spellName) !== name,
    );
    if (otherInside) continue;
    ctx.violate(
      "channelEndOnOwnRow",
      name,
      pressMs,
      `${owner.name}:${id}:${pressMs}`,
      `${name} pressed ${((pressMs - ctx.start) / 1000).toFixed(3)}s, aura removed ${trueEndS.toFixed(3)}s, printed channeled ${m[3]}s ended ${m[4]}; nothing else pressed before`,
      l,
    );
  }
}

const LEDGER_BURST = /^\s+Burst #\d+ — [^|]*\|\s*(.*)$/;
const LEDGER_SPAN = /(.+?) (\d+:\d{2})–(\d+:\d{2})$/;

function channelSpanUnrun(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  const channelNames = new Set<string>();
  for (const c of castsOf(owner))
    if (CHANNELED_SPELL_IDS.has(String(c.spellId)))
      channelNames.add(nameOf(c.spellId, c.spellName));
  if (channelNames.size === 0) return;
  for (const l of ctx.text.split("\n")) {
    const b = LEDGER_BURST.exec(l);
    if (!b) continue;
    for (const part of b[1]!.split(" + ")) {
      const s = LEDGER_SPAN.exec(part.trim());
      if (!s || !channelNames.has(s[1]!)) continue;
      ctx.bump("channelSpanUnrun");
      const fromS = secOf(s[2]!);
      const toS = secOf(s[3]!);
      if (!(toS > fromS)) continue;
      const presses = castsOf(owner).filter(
        (c) => nameOf(c.spellId, c.spellName) === s[1],
      );
      const press = presses.find(
        (c) => Math.floor((tsOf(c) - ctx.start) / 1000) === fromS,
      );
      if (!press) continue;
      const id = String(press.spellId);
      const pressMs = tsOf(press);
      const nextMs = tsOf(
        presses.find((c) => tsOf(c) > pressMs) ?? {
          timestamp: ctx.end,
        },
      );
      const refusal = ((owner.missesOut ?? []) as any[]).find(
        (r) =>
          r.srcUnitId === owner.id &&
          String(r.spellId) === id &&
          Math.abs(tsOf(r) - pressMs) <= 50,
      );
      if (!refusal) continue;
      const aura = ((owner.auraEvents ?? []) as any[]).some(
        (a) =>
          String(a.spellId) === id &&
          a.srcUnitId === owner.id &&
          ev(a) === APPLIED &&
          tsOf(a) >= pressMs - 100 &&
          tsOf(a) < nextMs,
      );
      if (aura) continue;
      const effect = [
        ...((owner.damageOut ?? []) as any[]),
        ...((owner.healOut ?? []) as any[]),
        ...((owner.missesOut ?? []) as any[]),
      ].some(
        (r) =>
          r.srcUnitId === owner.id &&
          tsOf(r) > tsOf(refusal) &&
          tsOf(r) < nextMs &&
          nameOf(r.spellId, r.spellName) === s[1],
      );
      if (effect) continue;
      ctx.violate(
        "channelSpanUnrun",
        s[1]!,
        pressMs,
        `${owner.name}:${id}:${pressMs}`,
        `${s[1]} pressed ${((pressMs - ctx.start) / 1000).toFixed(3)}s, refused ${((tsOf(refusal) - ctx.start) / 1000).toFixed(3)}s, no aura, no effect before the next press; printed ${s[2]}–${s[3]}`,
        l.trim(),
      );
    }
  }
}

function doomWindsNoPressReading(ctx: IRoundCtx): void {
  const since1215 = ctx.start >= PATCH_1215_GOLIVE_EPOCH_MS;
  for (const u of ctx.players) {
    const near = (ms: number, ids: string[]) =>
      [
        ...((u.spellCastEvents ?? []) as any[]).filter(
          (c) => ev(c) === SUCCESS,
        ),
        ...((u.auraEvents ?? []) as any[]).filter(
          (a) => ev(a) === APPLIED && a.srcUnitId === u.id,
        ),
      ].some(
        (e) =>
          ids.includes(String(e.spellId)) && Math.abs(tsOf(e) - ms) <= 1000,
      );
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (String(a.spellId) !== "466772" || ev(a) !== APPLIED) continue;
      if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
      const ms = tsOf(a);
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      if (near(ms, ["384352", "114051"])) continue;
      ctx.bump("doomWindsNoPressReading");
      const s = Math.floor((ms - ctx.start) / 1000);
      const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      const pid = ctx.pidOf(u.name);
      const atSecond = ctx.lines.filter(
        (l) => l.startsWith(`${mmss} `) && /Doom Winds/.test(l),
      );
      const bad = since1215
        ? atSecond.find(
            (l) =>
              /\[ENEMY CD\]/.test(l) &&
              (pid === undefined || l.includes(`${pid}(`)) &&
              !l.includes("Doom Winds (no press)"),
          )
        : atSecond.find(
            (l) =>
              /\[(YOU|TEAM)\] \[PROC\]/.test(l) &&
              l.includes("Doom Winds (no press)") &&
              (/\[YOU\]/.test(l)
                ? u.id === ctx.owner?.id
                : pid === undefined || l.includes(`${pid}(`)),
          );
      if (!bad) continue;
      ctx.violate(
        "doomWindsNoPressReading",
        since1215 ? "proc as press" : "press as proc",
        ms,
        `${u.name}:${ms}`,
        `${u.name} Doom Winds buff ${((ms - ctx.start) / 1000).toFixed(3)}s, no press / Ascendance within 1 s, ${since1215 ? "12.1.5" : "12.1.0"} log`,
        bad,
      );
    }
  }
}

const PERIODIC_DAMAGE = "SPELL_PERIODIC_DAMAGE";
const PERIODIC_MISSED = "SPELL_PERIODIC_MISSED";
const MISSED = "SPELL_MISSED";

const INTO_LINE =
  /^\s+\[(\d+:\d{2})\] [^(]+\((.+?)\): (.+) into (.+)'s (.+?)(?: \(deferral\))?$/;

function intoImmunityLanded(ctx: IRoundCtx): void {
  const at = ctx.text.indexOf("ABILITIES INTO IMMUNITY/DR");
  if (at < 0) return;
  for (const l of ctx.text.slice(at).split("\n").slice(1)) {
    if (l.trim() === "") break;
    const m = INTO_LINE.exec(l);
    if (!m) continue;
    const player = ctx.byName.get(m[2]!);
    const target = ctx.byName.get(m[4]!);
    if (!player || !target) continue;
    const sec = secOf(m[1]!);
    const auras = ((target.auraEvents ?? []) as any[])
      .filter((a) => a.destUnitId === target.id)
      .sort((a, b) => tsOf(a) - tsOf(b));
    const app = auras.find(
      (a) =>
        ev(a) === APPLIED &&
        nameOf(a.spellId, a.spellName) === m[5] &&
        Math.floor((tsOf(a) - ctx.start) / 1000) === sec,
    );
    if (!app || !wallStopsEveryHit(String(app.spellId))) continue;
    const rem = auras.find(
      (a) =>
        ev(a) === REMOVED && a.spellId === app.spellId && tsOf(a) >= tsOf(app),
    );
    const from = tsOf(app);
    const to = rem ? tsOf(rem) : ctx.end;
    const listed = new Map<string, number>();
    for (const n of m[3]!.split(" + ")) listed.set(n, (listed.get(n) ?? 0) + 1);
    for (const [name, k] of listed) {
      ctx.bump("intoImmunityLanded");
      // the target's direct rows of this spell by the player, in order
      const rows = [
        ...((player.damageOut ?? []) as any[]).filter(
          (d) => ev(d) !== ABSORBED && ev(d) !== PERIODIC_DAMAGE,
        ),
        ...((player.missesOut ?? []) as any[]).filter(
          (x) => ev(x) !== PERIODIC_MISSED,
        ),
      ]
        .filter(
          (r) =>
            r.destUnitId === target.id &&
            nameOf(r.spellId, r.spellName) === name,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      const casts = castsOf(player)
        .filter(
          (c) =>
            c.destUnitId === target.id &&
            nameOf(c.spellId, c.spellName) === name &&
            tsOf(c) >= from - 6000 &&
            tsOf(c) <= to,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      let next = 0;
      let notThrough = 0;
      let through = 0;
      for (const c of casts) {
        while (next < rows.length && tsOf(rows[next]) < tsOf(c) - 100) next++;
        const row = rows[next];
        const landsAt = row && tsOf(row) <= tsOf(c) + 3000 ? row : undefined;
        if (landsAt) next++;
        const t = landsAt ? tsOf(landsAt) : tsOf(c);
        if (t < from || t > to) continue;
        const hit =
          !!landsAt &&
          (ev(landsAt) !== MISSED || landsAt.missType === "ABSORB");
        if (hit) through++;
        else notThrough++;
      }
      if (k <= notThrough || through === 0) continue;
      ctx.violate(
        "intoImmunityLanded",
        "landed listed",
        from,
        `${player.name}#${target.name}#${sec}#${name}`,
        `${name} listed ×${k} into ${m[5]} (${(from - ctx.start) / 1000}–${(to - ctx.start) / 1000}s); ${through} of its casts landed through it, ${notThrough} did not`,
        l.trim(),
      );
    }
  }
}

const PRESS_LINE =
  /^(\d+:\d{2})\s+\[(YOU|TEAM)\] \[[A-Z ]+\]\s+(.*?) \[IMMUNE(?:: [^\]—]+)?(?: — (.+?) was up)?\]/;

function pressImmuneTagChecks(ctx: IRoundCtx): void {
  const friends = ctx.owner
    ? ctx.players.filter((p) => p.reaction === ctx.owner.reaction)
    : [];
  for (const l of ctx.lines) {
    const m = PRESS_LINE.exec(l);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const head = m[3]!;
    const actor =
      m[2] === "YOU"
        ? ctx.owner
        : friends.find((f) => {
            const pid = ctx.pidOf(f.name);
            return pid !== undefined && head.includes(`${pid}(`);
          });
    if (!actor) continue;
    const press = castsOf(actor).find(
      (c) =>
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec &&
        head.includes(nameOf(c.spellId, c.spellName)),
    );
    if (!press) continue;
    const id = String(press.spellId);
    const name = nameOf(press.spellId, press.spellName);
    // the press and the cast rows its effect triggers
    // (`PRESS_TRIGGERED_CAST_IDS`: Predator's Wake lands as The Hunt 1246169)
    const ids = [id, ...(PRESS_TRIGGERED_CAST_IDS.get(id) ?? [])];
    const family = new Set(ids.flatMap((i) => [...castAndEffectIds(i)]));
    const names = new Set(ids.map((i) => nameOf(i, i === id ? name : "")));
    const ofPress = (r: any) =>
      family.has(String(r.spellId)) ||
      names.has(nameOf(r.spellId, r.spellName));
    const inWindow = (r: any) =>
      tsOf(r) >= tsOf(press) - 100 && tsOf(r) <= tsOf(press) + 3000;
    const immune = ((actor.missesOut ?? []) as any[]).filter(
      (x) =>
        x.missType === "IMMUNE" &&
        ev(x) !== PERIODIC_MISSED &&
        inWindow(x) &&
        ofPress(x),
    );
    if (immune.length === 0) continue;
    if (!ccSpellIds.has(id)) {
      ctx.bump("pressImmuneTagLanded");
      const hits = [
        ...((actor.damageOut ?? []) as any[]).filter(
          (d) =>
            ev(d) !== ABSORBED || family.has(String(d.attackSpellId ?? "")),
        ),
        ...((actor.healOut ?? []) as any[]),
      ].filter(
        (r) =>
          inWindow(r) &&
          (ofPress(r) ||
            (ev(r) === ABSORBED && family.has(String(r.attackSpellId ?? "")))),
      );
      // landed through the refused component: a hit on that unit in the
      // refusal's own instant (`PRESS_LANDED_SAME_INSTANT_MS`)
      const landedAt = (x: any) =>
        hits.some(
          (r) =>
            r.destUnitId === x.destUnitId &&
            Math.abs(tsOf(r) - tsOf(x)) <= PRESS_LANDED_SAME_INSTANT_MS,
        );
      if (immune.every(landedAt))
        ctx.violate(
          "pressImmuneTagLanded",
          name,
          tsOf(press),
          `${actor.name}:${id}:${tsOf(press)}`,
          `${name} IMMUNE only on ${[...new Set(immune.map((x) => nameOf(x.spellId, x.spellName) + " " + x.spellId))].join(", ")}; the press landed on the same unit(s)`,
          l,
        );
    }
    const cause = m[4];
    if (!cause) continue;
    // the press's damage-spell IMMUNE rows; the cause is right when the
    // named aura stops one of them on its own unit (Divine Toll 375576
    // IMMUNE on the mage in Ice Block and on a second unit in the same ms)
    const rows = immune.filter((x) => {
      const xid = String(x.spellId);
      return (
        !isControlCast(xid) &&
        ccMechanicOf(xid) === undefined &&
        ctx.units.some((u) => u.id === x.destUnitId)
      );
    });
    if (rows.length === 0) continue;
    ctx.bump("immuneCauseCannotStopDamage");
    const stops = (x: any): boolean => {
      const xid = String(x.spellId);
      const target = ctx.units.find((u) => u.id === x.destUnitId)!;
      return ((target.auraEvents ?? []) as any[]).some(
        (a) =>
          a.destUnitId === target.id &&
          nameOf(a.spellId, a.spellName) === cause &&
          tsOf(a) <= tsOf(x) &&
          // a wall stopping its school — or a control the holder takes
          // nothing through, the enemy's Cyclone a heal was refused into
          // (GH #167, user ruling 2026-11-07; `isDamageImmuneControl`)
          ((wallStopsEveryHit(String(a.spellId)) &&
            immunityStopsSpellSchool(String(a.spellId), xid) !== false) ||
            isDamageImmuneControl(String(a.spellId))),
      );
    };
    if (!rows.some(stops)) {
      const x = rows[0]!;
      const xid = String(x.spellId);
      ctx.violate(
        "immuneCauseCannotStopDamage",
        cause,
        tsOf(x),
        `${actor.name}:${xid}:${tsOf(x)}`,
        `${nameOf(x.spellId, x.spellName)} ${xid} IMMUNE (no control, no mechanic) named "${cause} was up" — no pct-100 wall stopping its school`,
        l,
      );
    }
  }
}

function exposureThreatOnFormHealer(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const friends = ctx.players.filter((p) => p.reaction === ctx.owner.reaction);
  for (const l of ctx.lines) {
    if (!/^\d+:\d{2}\s+\[HEALER EXPOSURE\]/.test(l)) continue;
    ctx.bump("exposureThreatOnFormHealer");
    if (!/ Full DR| Half DR| Quarter DR/.test(l)) continue;
    const ms = ctx.start + secOf(l.slice(0, l.indexOf(" "))) * 1000;
    for (const f of friends) {
      const rows = ((f.auraEvents ?? []) as any[])
        .filter(
          (a) => a.destUnitId === f.id && auraIsImmunityForm(String(a.spellId)),
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      const app = [...rows]
        .reverse()
        .find((a) => ev(a) === APPLIED && tsOf(a) <= ms);
      if (!app) continue;
      const rem = rows.find((a) => ev(a) === REMOVED && tsOf(a) > tsOf(app));
      if (rem && tsOf(rem) <= ms + 999) continue;
      ctx.violate(
        "exposureThreatOnFormHealer",
        nameOf(app.spellId, app.spellName),
        ms,
        `${f.name}:${ms}`,
        `${f.name} in ${nameOf(app.spellId, app.spellName)} from ${((tsOf(app) - ctx.start) / 1000).toFixed(3)}s${rem ? ` to ${((tsOf(rem) - ctx.start) / 1000).toFixed(3)}s` : ""}; exposure line lists control threats`,
        l,
      );
      break;
    }
  }
}

function variantSpentButton(ctx: IRoundCtx): void {
  const dated = Object.entries(OVERRIDE_VARIANT_SHARES_BY_ERA).filter(
    ([, d]) => !d.before && ctx.start < d.cutoverEpochMs,
  );
  if (dated.length === 0) return;
  for (const [variant] of dated) {
    const button = OVERRIDE_VARIANTS_GENERATED[variant];
    if (!button) continue;
    const name = nameOf(button);
    const cdS = effectiveCooldownSeconds(button) ?? 0;
    let atS = 0;
    for (const l of ctx.text.split("\n")) {
      const t = /^(\d+:\d{2})\s/.exec(l);
      if (t) atS = secOf(t[1]!);
      const cd = parseResRow(l)?.cd;
      if (!cd) continue;
      for (const entry of splitResList(cd)) {
        const e = /^(?:(\d+):)?(.+?)\((\d+)s\)$/.exec(entry.trim());
        if (!e || e[2] !== name) continue;
        const unit = e[1] === undefined ? ctx.owner : ctx.unitOfPid(e[1]);
        // only a unit that pressed the variant this round (another spec's
        // button can share the name: Havoc's The Hunt 370965)
        if (unit && !castsOf(unit).some((c) => String(c.spellId) === variant))
          continue;
        ctx.bump("variantSpentButton");
        if (!unit) {
          ctx.violate(
            "variantSpentButton",
            "unresolved pid",
            ctx.start + atS * 1000,
            `pid${e[1]}:${atS}`,
            `pid ${e[1]} unresolved`,
            l.trim().slice(0, 160),
          );
          continue;
        }
        // the button's own last press up to this second: the most it can
        // have left is that press's cooldown run from it
        const last = castsOf(unit)
          .filter((c) => {
            const id = String(c.spellId);
            // the button's own id: the press's impact row carries the
            // button's name after either press (The Hunt 1246169)
            return id === button && (tsOf(c) - ctx.start) / 1000 < atS + 1;
          })
          .map((c) => (tsOf(c) - ctx.start) / 1000)
          .sort((a, b) => b - a)[0];
        const leftAtMost = last === undefined ? 0 : last + cdS - atS;
        if (Number(e[3]) <= leftAtMost + 2) continue;
        ctx.violate(
          "variantSpentButton",
          name,
          ctx.start + atS * 1000,
          `${unit.name}:${atS}:${name}`,
          `${unit.name}: ${name}(${e[3]}s) at ${atS}s; its own last press ${last === undefined ? "none" : last.toFixed(1) + "s"} leaves at most ${Math.max(0, leftAtMost).toFixed(0)}s (pre-cutover log: ${nameOf(variant)} ${variant} is its own cooldown)`,
          l.trim().slice(0, 220),
        );
      }
    }
  }
}

const LEDGER_BURST_SPAN = /^\s+Burst #\d+ — (\d+:\d{2})–(\d+:\d{2})\b/;
const ALLY_OVERLAPS = /^\s+Ally CDs overlapping: (.*)$/;
const ALLY_ENTRY = /^(\S+) (.+?) ([\d.]+)s \(/;

function allyOverlapPastAura(ctx: IRoundCtx): void {
  let burst: { fromS: number; toS: number } | null = null;
  for (const l of ctx.text.split("\n")) {
    const b = LEDGER_BURST_SPAN.exec(l);
    if (b) {
      burst = { fromS: secOf(b[1]!), toS: secOf(b[2]!) + 1 };
      continue;
    }
    const o = ALLY_OVERLAPS.exec(l);
    if (!o || !burst) continue;
    const sums = new Map<
      string,
      { ally: string; name: string; s: number; n: number; max: number }
    >();
    for (const part of o[1]!.split("; ")) {
      const e = ALLY_ENTRY.exec(part.trim());
      if (!e) continue;
      const name = e[2]!.replace(/ \(no press\)$/, "");
      const key = `${e[1]}|${name}`;
      const cur = sums.get(key) ?? { ally: e[1]!, name, s: 0, n: 0, max: 0 };
      cur.s += Number(e[3]);
      cur.max = Math.max(cur.max, Number(e[3]));
      cur.n += 1;
      sums.set(key, cur);
    }
    const fromMs = ctx.start + (burst.fromS - 1) * 1000;
    const toMs = ctx.start + (burst.toS + 1) * 1000;
    for (const { ally, name, s, n, max } of sums.values()) {
      // one entry can run past its own aura by design (The Hunt's effect is
      // its DoT on the target, its buff on the caster a fraction of a
      // second); the class is one run under two entries
      if (n < 2) continue;
      const u = ctx.byName.get(ally);
      if (!u) continue;
      // the ally's runs of the name on any unit (GH #196: Colossus Smash and
      // Feral Frenzy run as the debuff / bleed on the target, their own
      // aura on the ally a blip), unioned and clipped to the burst. The
      // parser keeps each aura row on its recipient only, so the rows are
      // every unit's, filtered by the ally as their source
      const rows = (ctx.units as any[])
        .flatMap((x) => (x.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            a.srcUnitId === u.id && nameOf(a.spellId, a.spellName) === name,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      if (!rows.some((a) => ev(a) === APPLIED)) continue;
      ctx.bump("allyOverlapPastAura");
      const runs: Array<[number, number]> = [];
      const openAt = new Map<string, number>();
      for (const a of rows) {
        const k = `${a.destUnitId}|${a.spellId}`;
        if (ev(a) === APPLIED && !openAt.has(k)) openAt.set(k, tsOf(a));
        else if (ev(a) === REMOVED && openAt.has(k)) {
          runs.push([openAt.get(k)!, tsOf(a)]);
          openAt.delete(k);
        }
      }
      for (const t0 of openAt.values())
        runs.push([t0, Math.min(toMs, ctx.end)]);
      runs.sort((a, b) => a[0] - b[0]);
      let covered = 0;
      let longestRunS = 0;
      let cur: [number, number] | null = null;
      const flush = () => {
        if (!cur) return;
        covered += Math.max(
          0,
          Math.min(cur[1], toMs) - Math.max(cur[0], fromMs),
        );
        longestRunS = Math.max(longestRunS, (cur[1] - cur[0]) / 1000);
      };
      for (const r of runs) {
        if (cur && r[0] <= cur[1]) cur[1] = Math.max(cur[1], r[1]);
        else {
          flush();
          cur = [r[0], r[1]];
        }
      }
      flush();
      const coveredS = covered / 1000;
      // an effect that lives on another unit (Predator's Wake's The Hunt DoT
      // on its target) is not this aura's to bound — its own aura on the
      // ally is a blip (The Hunt's buff a fraction of a second). Longer
      // coverage alone proves nothing: three Soul Immolation runs of ~5 s
      // credited 15.5 + 5 + 5 s exceed their 15.0 s by one entry's 0.5 s
      // (codex 20-F26-04 #4)
      if (longestRunS < 1 && max > coveredS + 0.2) continue;
      if (!(s > coveredS + 0.2)) continue;
      ctx.violate(
        "allyOverlapPastAura",
        name,
        fromMs,
        `${ally}:${name}:${burst.fromS}`,
        `${ally} ${name}: entries claim ${s.toFixed(1)}s, own aura covers ${coveredS.toFixed(2)}s of ${fmtS(burst.fromS)}–${fmtS(burst.toS - 1)} (±1 s)`,
        l,
      );
    }
  }
}

const SAVE_PRESS_LINE =
  /^(\d+:\d{2})\s+\[(?:ENEMY DEF|YOU\] \[CD|TEAM\] \[CD)\]\s+(?:(\d+\(\w+\)) \([^)]*\): )?([^(→[]+?) \((?:[^()]*?, )?([\d.]+)s(?:[,—][^)]*)?\)/;

function savePressRunsOverlap(ctx: IRoundCtx): void {
  const last = new Map<string, { atS: number; lenS: number; line: string }>();
  for (const l of ctx.lines) {
    const m = SAVE_PRESS_LINE.exec(l);
    if (!m) continue;
    const who = m[2] ?? (l.includes("[YOU]") ? "you" : "");
    if (!who) continue;
    const key = `${who}|${m[3]!.trim()}`;
    const atS = secOf(m[1]!);
    const prev = last.get(key);
    if (prev) {
      ctx.bump("savePressRunsOverlap");
      // floored seconds: the later press can sit up to 1 s past its second
      if (atS + 1 < prev.atS + prev.lenS)
        ctx.violate(
          "savePressRunsOverlap",
          m[3]!.trim(),
          ctx.start + prev.atS * 1000,
          `${key}:${prev.atS}`,
          `${key}: ${fmtS(prev.atS)} printed ${prev.lenS}s, re-pressed ${fmtS(atS)}`,
          prev.line,
        );
    }
    last.set(key, { atS, lenS: Number(m[4]), line: l });
  }
}

const BURST_ANSWERED = /^(\d+:\d{2})\s+\[BURST ANSWERED\]/;
// `controlTargetClause`: `on A (2s) and B in 4.4s` — each target its pid,
// an optional span (codex 20-F26-04 #3)
const ANSWER_ON =
  /(?:^|; |: )(\d+)\(\w+\) answered with (.+?) on ((?:\d+\(\w+\)(?: \([^)]*\))?(?: and )?)+) in ([\d.]+)s/g;
const ANSWER_TARGET = /(\d+)\(\w+\)(?: \([^)]*\))?/g;

function answeredByOldSummonPulse(ctx: IRoundCtx): void {
  const byId = new Map<string, any>((ctx.units as any[]).map((u) => [u.id, u]));
  for (const l of ctx.lines) {
    const b = BURST_ANSWERED.exec(l);
    if (!b) continue;
    const openS = secOf(b[1]!);
    for (const m of l.matchAll(ANSWER_ON))
      for (const t of m[3]!.matchAll(ANSWER_TARGET)) {
        const answerer = ctx.unitOfPid(m[1]!);
        const holder = ctx.unitOfPid(t[1]!);
        if (!answerer || !holder) continue;
        const name = m[2]!;
        const atMs = ctx.start + (openS + Number(m[4])) * 1000;
        const aura = ((holder.auraEvents ?? []) as any[]).find(
          (a) =>
            ev(a) === APPLIED &&
            nameOf(a.spellId, a.spellName) === name &&
            Math.abs(tsOf(a) - atMs) <= 1000 &&
            a.srcUnitId !== answerer.id,
        );
        if (!aura) continue;
        const summon = byId.get(aura.srcUnitId);
        if (
          !summon ||
          summon.ownerId !== answerer.id ||
          String(aura.srcUnitId).startsWith("Pet-")
        )
          continue;
        ctx.bump("answeredByOldSummonPulse");
        const summonedMs = ((summon.actionIn ?? []) as any[]).find(
          (a) => ev(a) === "SPELL_SUMMON",
        );
        if (!summonedMs || tsOf(summonedMs) >= ctx.start + openS * 1000)
          continue;
        ctx.violate(
          "answeredByOldSummonPulse",
          name,
          tsOf(aura),
          `${answerer.name}:${aura.srcUnitId}:${tsOf(aura)}`,
          `${answerer.name}'s ${summon.name} summoned ${((tsOf(summonedMs) - ctx.start) / 1000).toFixed(3)}s, its ${name} on ${holder.name} ${((tsOf(aura) - ctx.start) / 1000).toFixed(3)}s, burst opened ${fmtS(openS)}`,
          l,
        );
      }
  }
}

// both fold forms, `(x2)` and `(x2 over 2s)` (codex 20-F26-04 #7)
const YOU_CAST_LINE =
  /^(\d+:\d{2})\s+\[YOU\] \[CAST\]\s+(.+?)(?: \(x\d+(?: over \d+s)?\))?(?: →| \[|$)/;

function castLineNoButton(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  for (const l of ctx.lines) {
    const m = YOU_CAST_LINE.exec(l);
    if (!m) continue;
    const name = m[2]!.trim();
    const atS = secOf(m[1]!);
    const rows = castsOf(owner).filter(
      (c) =>
        nameOf(c.spellId, c.spellName) === name &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === atS,
    );
    if (rows.length === 0) continue;
    ctx.bump("castLineNoButton");
    if (rows.some((c) => isButtonPress(String(c.spellId)))) continue;
    const id = String(rows[0].spellId);
    ctx.violate(
      "castLineNoButton",
      `${name} ${id}`,
      tsOf(rows[0]),
      `${owner.name}:${id}:${tsOf(rows[0])}`,
      `${name} ${id} at ${m[1]}: no SpellCooldowns row`,
      l,
    );
  }
}

// the producer ends the sentence with `.` (codex 20-F26-04 #2)
const TEAM_READY =
  /team offensive CDs ready at (\d+:\d{2}): (.*?)(?: \((.*?)\))?\.?(?:;|$)/;
const CD_AT = / \d+:\d{2}$/;

/** Every friendly caster of `name` this round is a healer it is no team
 * burst for (`countsAsTeamBurst`, B3iii): the team-ready lists never carry
 * it, only `pressed inside` does. */
function noTeamBurstPress(ctx: IRoundCtx, name: string): boolean {
  if (!ctx.owner) return false;
  const casts = (ctx.players as any[])
    .filter((u) => u.reaction === ctx.owner.reaction)
    .flatMap((u) =>
      castsOf(u)
        .filter((c) => nameOf(c.spellId, c.spellName ?? "") === name)
        .map((c) => ({ u, id: String(c.spellId) })),
    );
  return (
    casts.length > 0 &&
    casts.every(
      ({ u, id }) => isHealerSpec(u.spec) && !countsAsTeamBurst(u, id),
    )
  );
}

function pressedInsideNeverBack(ctx: IRoundCtx): void {
  for (const l of ctx.text.split("\n")) {
    const m = TEAM_READY.exec(l);
    if (!m || !m[3]) continue;
    const names = (s: string) =>
      s
        .split("、")
        .map((x) =>
          x
            .trim()
            .replace(CD_AT, "")
            .replace(/ ≤\d+s$/, ""),
        )
        .filter((x) => x && x !== "none");
    const ready = new Set(names(m[2]!));
    const clauses = new Map<string, string[]>();
    for (const c of m[3].split("; ")) {
      const i = c.indexOf(": ");
      if (i < 0) continue;
      clauses.set(c.slice(0, i), names(c.slice(i + 2)));
    }
    const known = new Set([
      ...ready,
      ...(clauses.get("may already be back") ?? []),
      ...(clauses.get("back inside") ?? []),
      ...(clauses.get("pressed at start") ?? []),
    ]);
    for (const name of clauses.get("pressed inside") ?? []) {
      // B3iii: a healer's own offensive cooldown that is no team burst
      // (`countsAsTeamBurst`) is pressed, never on a ready / back list
      if (noTeamBurstPress(ctx, name)) continue;
      ctx.bump("pressedInsideNeverBack");
      if (known.has(name)) continue;
      ctx.violate(
        "pressedInsideNeverBack",
        name,
        ctx.start + secOf(m[1]!) * 1000,
        `${m[1]}:${name}:${l.slice(0, 40)}`,
        `${name} pressed inside the window from ${m[1]}, on no ready / back list`,
        l,
      );
    }
  }
}

const HOARDED_READY = /type=cd-hoarded .*?\breadyCds=([^,}]*)/;

function healMajorAsDefensive(ctx: IRoundCtx): void {
  const healNames = new Set(
    [...ENEMY_HEAL_CD_IDS].map((id) => nameOf(id)).filter((n) => n !== ""),
  );
  for (const l of ctx.menu.split("\n")) {
    const m = HOARDED_READY.exec(l);
    if (!m) continue;
    for (const raw of m[1]!.split("、")) {
      const name = raw.trim().replace(/ \([^)]*\)$/, "");
      if (!name) continue;
      ctx.bump("healMajorAsDefensive");
      if (!healNames.has(name)) continue;
      ctx.violate(
        "healMajorAsDefensive",
        name,
        ctx.start,
        `${ctx.ownerName}:${name}:${l.slice(0, 60)}`,
        `cd-hoarded readyCds names ${name}, a healing major`,
        l,
      );
    }
  }
}

const ENEMY_CD_LINE =
  /^(\d+:\d{2})\s+\[ENEMY CD\]\s+\S+ \(([^)]+)\): (.+?)(?: \(|$)/;

function healerRosterAsEnemyBurst(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = ENEMY_CD_LINE.exec(l);
    if (!m) continue;
    const roster = healerSaveCdRoster(m[2]!);
    if (!roster) continue;
    ctx.bump("healerRosterAsEnemyBurst");
    const name = m[3]!.replace(/ \d+(?:st|nd|rd|th) of \d+$/, "").trim();
    const e = [...roster.values()].find(
      (x) => nameOf(x.spellId, x.name) === name,
    );
    if (!e || abilityProfile(e.spellId).dealsDamage) continue;
    // Ultimate Penitence's damage is on its triggered rows (the cast's own
    // profile reads none): a damage ultimate, an [ENEMY CD] by design
    if (e.spellId === "421453") continue;
    ctx.violate(
      "healerRosterAsEnemyBurst",
      `${m[2]}:${name}`,
      ctx.start + secOf(m[1]!) * 1000,
      `${m[2]}:${name}:${m[1]}`,
      `[ENEMY CD] files ${m[2]}'s ${name} (healer save roster) as offensive`,
      l,
    );
  }
}

const FAILED_ATTEMPT_LINE =
  /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — .*\| FAILED: not enough damage/;
const OWN_SHIELD_MIN_ABSORBED = 50_000;

function ownShieldNotPopped(ctx: IRoundCtx): void {
  const ours = new Set(
    ctx.players
      .filter((u: any) => u.reaction === ctx.owner.reaction)
      .map((u: any) => u.id),
  );
  for (const l of ctx.lines) {
    const m = FAILED_ATTEMPT_LINE.exec(l);
    if (!m) continue;
    const target = ctx.byName.get(m[3]!);
    if (!target) continue;
    ctx.bump("ownShieldNotPopped");
    const lo = ctx.start + secOf(m[1]!) * 1000;
    const hi = ctx.start + (secOf(m[2]!) + 1) * 1000;
    const bySpell = new Map<string, number>();
    for (const r of (target.absorbsIn ?? []) as any[]) {
      if (ev(r) !== undefined && ev(r) !== ABSORBED) continue;
      if (r.srcUnitId !== target.id || !ours.has(r.attackerId)) continue;
      const t = tsOf(r);
      if (t < lo || t >= hi) continue;
      const id = String(r.spellId);
      // a rotational shield of the target's own (Power Word: Shield, Void
      // Shield — user ruling 2026-10-21 (1)) is no defensive line
      if (KW_OWN_ROTATIONAL_ABSORB_AURA_IDS.has(id)) continue;
      const pressed =
        isButtonPress(id) ||
        castsOfEffectAura(id).some((c: string) => isButtonPress(c));
      if (!pressed) continue;
      bySpell.set(
        id,
        (bySpell.get(id) ?? 0) + Math.abs(Number(r.absorbedAmount) || 0),
      );
    }
    for (const [id, amt] of bySpell) {
      if (amt < OWN_SHIELD_MIN_ABSORBED) continue;
      const name = nameOf(id, id);
      ctx.violate(
        "ownShieldNotPopped",
        name,
        lo,
        `${m[3]}:${name}:${m[1]}`,
        `${name} absorbed ${Math.round(amt / 1000)}k of our hits, attempt reads not enough damage`,
        l,
      );
    }
  }
}

const KW_DEFENSELESS =
  /^\s+\[KILL WINDOW\] (\d+:\d\d)–(\d+:\d\d) on [^(]+ \(([^()]+(?:\([^()]*\)[^()]*)*)\):.*\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/;

function areaCarryInDefenseless(ctx: IRoundCtx): void {
  const areaNames = new Set(
    [...ENEMY_AREA_SAVE_IDS].map((id) => nameOf(id)).filter((n) => n !== ""),
  );
  for (const l of ctx.lines) {
    const m = KW_DEFENSELESS.exec(l);
    if (!m) continue;
    const u = ctx.byName.get(m[3]!);
    if (!u) continue;
    ctx.bump("areaCarryInDefenseless");
    const lo = ctx.start + (secOf(m[4]!) + 1) * 1000;
    const hi = ctx.start + secOf(m[5]!) * 1000;
    const rows = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === u.id && areaNames.has(nameOf(a.spellId, "")),
    );
    for (const a of rows) {
      if (ev(a) !== APPLIED) continue;
      const on = tsOf(a);
      const off = rows.find(
        (b) =>
          String(b.spellId) === String(a.spellId) &&
          ev(b) === REMOVED &&
          tsOf(b) >= on,
      );
      const offMs = off ? tsOf(off) : on + 1;
      if (offMs <= lo || on >= hi) continue;
      const name = nameOf(a.spellId, "");
      ctx.violate(
        "areaCarryInDefenseless",
        name,
        on,
        `${u.id}:${name}:${m[4]}`,
        `${u.name} carried ${name} ${fmtS((on - ctx.start) / 1000)} inside defenseless ${m[4]}–${m[5]}`,
        l,
      );
      break;
    }
    // D17: Aura Mastery 31821 up on a paladin whose Devotion Aura 465 u
    // carried (no REMOVED of it on u before the wall's start)
    for (const p of ctx.players) {
      if (p.id === u.id) continue;
      const am = ((p.auraEvents ?? []) as any[]).filter(
        (a) =>
          String(a.spellId) === "31821" &&
          a.destUnitId === p.id &&
          a.srcUnitId === p.id,
      );
      for (const a of am) {
        if (ev(a) !== APPLIED) continue;
        const off = am.find((b) => ev(b) === REMOVED && tsOf(b) >= tsOf(a));
        const from = Math.max(tsOf(a), lo);
        const to = Math.min(off ? tsOf(off) : tsOf(a) + 8000, hi);
        if (from >= to) continue;
        // a closing row can carry no source (codex 20-F26-05 #1: the
        // product's shared intervals end the aura there)
        const nilSrc = (id: unknown) => !id || /^0+$/.test(String(id));
        const dev = ((u.auraEvents ?? []) as any[]).filter(
          (x) =>
            String(x.spellId) === "465" &&
            x.destUnitId === u.id &&
            (x.srcUnitId === p.id ||
              (ev(x) === REMOVED && nilSrc(x.srcUnitId))),
        );
        const before = dev.filter((x) => tsOf(x) <= from);
        const last = before[before.length - 1];
        // carried at the wall's start, or picked up while it ran (codex
        // 20-F26-04 #6)
        const carried =
          (!!last && ev(last) !== REMOVED) ||
          dev.some((x) => ev(x) === APPLIED && tsOf(x) > from && tsOf(x) < to);
        if (!carried) continue;
        ctx.violate(
          "areaCarryInDefenseless",
          "Aura Mastery (Devotion Aura)",
          from,
          `${u.id}:AM:${m[4]}`,
          `${u.name} under ${p.name}'s Devotion Aura during Aura Mastery ${fmtS((from - ctx.start) / 1000)} inside defenseless ${m[4]}–${m[5]}`,
          l,
        );
        break;
      }
    }
  }
}

function ownerGroundedUnstated(ctx: IRoundCtx): void {
  for (const g of groundingRedirects(ctx.owner)) {
    if (g.via !== "cast" || !isControlSpell(g.spellId)) continue;
    const sec = Math.floor((g.timestampMs - ctx.start) / 1000);
    // the renderer's own bounds: the round, its start to its end (codex
    // 20-F26-04 #8: a Shuffle log's tail after the round's ending death)
    if (sec < 0 || g.timestampMs > ctx.roundEndAt) continue;
    ctx.bump("ownerGroundedUnstated");
    const at = fmtS(sec);
    const stated = ctx.lines.some(
      (l) =>
        l.startsWith(`${at} `) &&
        (l.includes("[GROUNDED]") || l.includes("[absorbed: Grounding Totem]")),
    );
    if (stated) continue;
    const name = nameOf(g.spellId, g.spellName ?? "");
    ctx.violate(
      "ownerGroundedUnstated",
      name,
      g.timestampMs,
      `${ctx.ownerName}:${name}:${at}`,
      `owner's ${name} into a Grounding Totem at ${at}: no [GROUNDED] line, no absorbed tag`,
    );
  }
}

const UNLOGGED_SILENCE_LINE =
  /^(\d+:\d{2})\s+\[SILENCE\]\s+\S+ ← (.+?) \(by .*\| no aura logged — silenced at /;
const CANCEL_STOP_LINE =
  /^(\d+:\d{2})\s+\[CAST STOPPED\]\s+(.+?) — cast bar stopped after (\d+(?:\.\d)?)s.*no control, silence or knockback landed on you then/;

/** fact11 D6: a `[CAST STOPPED]` line that says no silence landed, its stop
 * within the product's own `CANCEL_CC_NEAR_S` of the silence a `[SILENCE] …
 * no aura logged` line prints — the two readers of one silence disagree.
 * Raw instants (codex 20-F26-04 #1: the stop line prints at the bar's
 * START, the stop is `stopped after N.Ns` later; whole seconds alone pair a
 * stop 1.06 s before a Solar Beam with it): the stop is the owner's
 * CAST_FAILED row N.N s after an instant in the line's second; the silence
 * is its spell's cast row at its line's second. */
function castStopUnderUnloggedSilence(ctx: IRoundCtx): void {
  const secOfMs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
  const allCasts = (ctx.players as any[]).flatMap((u) =>
    ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS),
  );
  const silenceMs = ctx.lines
    .map((l) => UNLOGGED_SILENCE_LINE.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .flatMap((m) => {
      const s = secOf(m[1]!);
      return allCasts
        .filter(
          (c) =>
            nameOf(String(c.spellId), c.spellName ?? "") === m[2] &&
            secOfMs(tsOf(c)) === s,
        )
        .map(tsOf);
    });
  if (silenceMs.length === 0) return;
  // the owner's FAILED rows (the legacy parse keeps no START rows): tSeconds
  // since the round's start
  const failed = ctx
    .rawStreams()
    .castFailed.filter((f) => f.unitGuid === ctx.owner.id);
  for (const l of ctx.lines) {
    const m = CANCEL_STOP_LINE.exec(l);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const after = Number(m[3]!);
    // the bar's end: a FAILED row of the spell N.N s (±0.05, the rendered
    // tenth) after an instant inside the line's second
    const rows = failed.filter((f) => {
      const startS = f.tSeconds - after;
      return (
        nameOf(String(f.spellId), f.spellName ?? "") === m[2] &&
        startS >= sec - 0.05 &&
        startS < sec + 1 + 0.05
      );
    });
    // a refused press of the same spell can sit in the same window (codex
    // 20-F26-05 #2): an interruption row wins; two candidates and no
    // interruption among them is ambiguous and not counted
    const interrupted = rows.filter((f) =>
      /interrupt|打断|中断/i.test(f.reason ?? ""),
    );
    const row =
      interrupted.length === 1
        ? interrupted[0]
        : rows.length === 1
          ? rows[0]
          : undefined;
    const stopMs = row ? ctx.start + row.tSeconds * 1000 : undefined;
    if (stopMs === undefined) continue;
    ctx.bump("castStopUnderUnloggedSilence");
    const at = stopMs;
    if (!silenceMs.some((t) => Math.abs(t - at) <= CANCEL_CC_NEAR_S * 1000))
      continue;
    ctx.violate(
      "castStopUnderUnloggedSilence",
      m[2]!,
      stopMs,
      `${ctx.ownerName}:${m[2]}:${m[1]}`,
      `${m[2]} stop at +${stopMs - ctx.start}ms (bar from ${m[1]}) read as no silence; an aura-less silence was cast within ${CANCEL_CC_NEAR_S} s of it`,
      l,
    );
  }
}

const TEAM_READY_LIST =
  /team offensive CDs ready(?: at \d+:\d{2})?: (.+?)(?: \(|;|\.$|$)/;

function teamReadyHealerOnlyCd(ctx: IRoundCtx): void {
  const ours = (ctx.players as any[]).filter(
    (u) => u.reaction === ctx.owner.reaction,
  );
  for (const l of ctx.lines) {
    const m = TEAM_READY_LIST.exec(l);
    if (!m || m[1] === "none") continue;
    for (const raw of m[1]!.split("、")) {
      const name = raw.replace(/ \[press-only\]$/, "").trim();
      const casts = ours.flatMap((u) =>
        castsOf(u)
          .filter((c) => nameOf(c.spellId, c.spellName ?? "") === name)
          .map((c) => ({ u, id: String(c.spellId) })),
      );
      if (casts.length === 0) continue;
      ctx.bump("teamReadyHealerOnlyCd");
      // a non-healer caster (its cast row can carry another id of the
      // button than the ledger's: Metamorphosis 191427 / 200166) holds it
      if (
        casts.some(
          ({ u, id }) => !isHealerSpec(u.spec) || countsAsTeamBurst(u, id),
        )
      )
        continue;
      ctx.violate(
        "teamReadyHealerOnlyCd",
        name,
        ctx.start,
        `${name}:${l.slice(0, 40)}`,
        `${name} is a ready team offensive CD; only a healer it is no team burst for cast it`,
        l,
      );
    }
  }
}

const ENEMY_DEF_TAG = "[ENEMY DEF]";

const KILL_ATTEMPT_LINE =
  /^\s*\[(\d+:\d\d)–(\d+:\d\d)\] on (\S.*?) — .*\| (?:FAILED: )?(.*)$/;

function primeRacialReadyUnstated(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = KILL_ATTEMPT_LINE.exec(l);
    if (!m) continue;
    const opp = /\| opportunity: PRIME \(([^|]*)\) \|/.exec(l);
    if (!opp) continue;
    const target = ctx.byName.get(m[3]!) as any;
    if (!target) continue;
    const pressed = breakAbilityPresses(target).some((p) =>
      SHARED_CD_RACIAL_SPELL_IDS.has(p.spellId),
    );
    if (!pressed) continue;
    ctx.bump("primeRacialReadyUnstated");
    // the line prints the start's second; production samples its exact
    // instant inside it — ready over the whole second, so at that instant
    // (codex 20-F26-06 #3: a press at 100.2 s, an attempt from 100.8 s)
    const fromMs = ctx.start + secOf(m[1]!) * 1000;
    const racial = readyTrinketRacialNameAt(target, fromMs);
    if (!racial || readyTrinketRacialNameAt(target, fromMs + 999) !== racial)
      continue;
    if (opp[1]!.split("; ").includes(`${racial} ready`)) continue;
    ctx.violate(
      "primeRacialReadyUnstated",
      racial,
      fromMs,
      `${target.name}:${m[1]}`,
      `${target.name} held ${racial} ready at ${m[1]}; the PRIME clause does not say so`,
      l,
    );
  }
}

/** The three stealth-kind immunities of U-KA3 / U-KA3b, by logged aura id. */
const STEALTH_IMMUNE_AURAS: Readonly<Record<string, string>> = {
  "11327": "Vanish",
  "409293": "Burrow",
  "414664": "Mass Invisibility",
};
const SWINGS = new Set([
  "SWING_DAMAGE",
  "SWING_DAMAGE_LANDED",
  "RANGE_DAMAGE",
  "SWING_MISSED",
  "RANGE_MISSED",
]);

/** GH #195 (user ruling 2026-11-07): the first aimed hit on `unit` in
 * (`appliedMs` + 1 s, `untilMs`) — a swing or ranged auto-attack, hit or
 * missed but not IMMUNE, or a spell hit / miss whose source pressed a
 * same-named spell at the unit after `appliedMs`. Read off the log rows. */
function aimedHitAfterMs(
  ctx: IRoundCtx,
  unit: any,
  appliedMs: number,
  untilMs: number,
  /** the closing row's line: a hit logged before it in its ms counts */
  untilLineIndex?: number,
): number | undefined {
  let first: number | undefined;
  const rows = [
    ...((unit.damageIn ?? []) as any[]),
    ...((unit.missesIn ?? []) as any[]).filter((m) => m.missType !== "IMMUNE"),
  ];
  for (const r of rows) {
    const t = tsOf(r);
    const beforeEnd =
      t < untilMs ||
      (t === untilMs &&
        untilLineIndex !== undefined &&
        r.logLine?.lineIndex !== undefined &&
        r.logLine.lineIndex < untilLineIndex);
    if (t <= appliedMs + 1000 || !beforeEnd) continue;
    if (first !== undefined && t >= first) continue;
    const e = ev(r);
    if (SWINGS.has(e)) {
      first = t;
      continue;
    }
    if (e !== "SPELL_DAMAGE" && e !== "SPELL_MISSED") continue;
    const src = (ctx.units as any[]).find((u) => u.id === r.srcUnitId);
    const name = nameOf(r.spellId, r.spellName ?? "");
    if (
      src &&
      successesOf(src).some(
        (c) =>
          c.destUnitId === unit.id &&
          tsOf(c) >= appliedMs &&
          tsOf(c) <= t &&
          nameOf(c.spellId, c.spellName ?? "") === name,
      )
    )
      first = t;
  }
  return first;
}

const STEALTH_IMMUNE_LINE =
  /^(\d+:\d{2})\s+\[ENEMY DEF\]\s+(\d+)\(\w+\) \([^)]*\): (Vanish|Burrow|Mass Invisibility) \(immune, ([\d.]+)s/;

/** GH #195: an `[ENEMY DEF]` stealth-kind immunity printed `(immune, Ns)`
 * past an aimed hit more than 1 s after its aura went up. */
function stealthImmuneThroughHit(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = STEALTH_IMMUNE_LINE.exec(l);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[2]) as any;
    if (!unit) continue;
    const sec = secOf(m[1]!);
    const applied = ((unit.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        a.destUnitId === unit.id &&
        STEALTH_IMMUNE_AURAS[String(a.spellId)] === m[3] &&
        Math.floor((tsOf(a) - ctx.start) / 1000) === sec,
    );
    if (!applied) continue;
    ctx.bump("stealthImmuneThroughHit");
    const printedS = Number(m[4]);
    const hit = aimedHitAfterMs(
      ctx,
      unit,
      tsOf(applied),
      tsOf(applied) + (printedS + 0.05) * 1000,
    );
    if (hit === undefined) continue;
    const hitS = (hit - tsOf(applied)) / 1000;
    if (!(printedS > hitS + 0.05)) continue;
    ctx.violate(
      "stealthImmuneThroughHit",
      m[3]!,
      tsOf(applied),
      `${unit.name}:${m[1]}:${m[3]}`,
      `${unit.name} ${m[3]} at ${m[1]}: aimed hit ${hitS.toFixed(2)}s in, printed immune ${printedS}s`,
      l,
    );
  }
}

function immunityBaitedSelfBroken(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = KILL_ATTEMPT_LINE.exec(l);
    if (!m || !m[4]!.includes("forced a full immunity")) continue;
    if (/forced a full immunity \[up since/.test(m[4]!)) continue;
    const target = ctx.byName.get(m[3]!) as any;
    if (!target) continue;
    const fromMs = ctx.start + secOf(m[1]!) * 1000;
    const toMs = ctx.start + (secOf(m[2]!) + 1) * 1000 + 5000;
    const auras = ((target.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === target.id,
    );
    const ups = auras.filter(
      (a) =>
        ev(a) === APPLIED &&
        isImmunitySaveAura(String(a.spellId)) &&
        tsOf(a) >= fromMs &&
        tsOf(a) < toMs,
    );
    if (ups.length === 0) continue;
    ctx.bump("immunityBaitedSelfBroken");
    const selfBroken = (a: any): boolean => {
      const id = String(a.spellId);
      // GH #195: one an aimed hit ended past its first second did not hold
      if (STEALTH_IMMUNE_AURAS[id]) {
        const removed = auras.find(
          (r) =>
            ev(r) === REMOVED && String(r.spellId) === id && tsOf(r) > tsOf(a),
        );
        const endMs = removed
          ? tsOf(removed)
          : tsOf(a) + (spellEffectData[id]?.durationSeconds ?? 0) * 1000;
        if (
          aimedHitAfterMs(
            ctx,
            target,
            tsOf(a),
            endMs,
            removed?.logLine?.lineIndex,
          ) !== undefined
        )
          return true;
      }
      if (!KW_UNTARGETABLE_AURA_IDS.has(id)) return false;
      const lenMs = (spellEffectData[id]?.durationSeconds ?? 0) * 1000;
      if (
        auras.some(
          (r) =>
            ev(r) === REMOVED &&
            String(r.spellId) === id &&
            tsOf(r) >= tsOf(a) &&
            tsOf(r) <= tsOf(a) + lenMs,
        )
      )
        return false;
      const first = holderFirstOwnActionAfterMs(
        target,
        tsOf(a),
        id,
        ctx.units as any,
      );
      return first < tsOf(a) + lenMs;
    };
    if (!ups.every(selfBroken)) continue;
    ctx.violate(
      "immunityBaitedSelfBroken",
      nameOf(ups[0].spellId, ups[0].spellName ?? ""),
      tsOf(ups[0]),
      `${target.name}:${m[1]}`,
      `${target.name}'s ${nameOf(ups[0].spellId, "")} at ${fmtS((tsOf(ups[0]) - ctx.start) / 1000)} ended at its own action; the attempt reads forced a full immunity`,
      l,
    );
  }
}

function immunityPressNoLine(ctx: IRoundCtx): void {
  for (const u of ctx.players as any[]) {
    if (u.reaction === ctx.owner.reaction) continue;
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    for (const c of castsOf(u)) {
      const id = String(c.spellId);
      if (![id, ...effectAurasOfCast(id)].some(isImmunitySaveAura)) continue;
      const at = tsOf(c);
      if (at < ctx.start || at > ctx.roundEndAt) continue;
      ctx.bump("immunityPressNoLine");
      const sec = Math.floor((at - ctx.start) / 1000);
      const name = nameOf(id, c.spellName ?? "");
      const stated = ctx.lines.some((l) => {
        const m = /^(\d+:\d{2})\s/.exec(l);
        return (
          !!m &&
          Math.abs(secOf(m[1]!) - sec) <= 1 &&
          l.includes(ENEMY_DEF_TAG) &&
          l.includes(`${pid}(`) &&
          l.includes(name)
        );
      });
      if (stated) continue;
      ctx.violate(
        "immunityPressNoLine",
        name,
        at,
        `${u.name}:${id}:${sec}`,
        `${pid} pressed ${name} at ${fmtS(sec)}; no [ENEMY DEF] line names it`,
      );
    }
  }
}

function immunityCopyUnstated(ctx: IRoundCtx): void {
  const enemies = (ctx.players as any[]).filter(
    (u) => u.reaction !== ctx.owner.reaction,
  );
  for (const r of enemies) {
    for (const a of (r.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED || !isImmunitySaveAura(String(a.spellId))) continue;
      if (a.destUnitId !== r.id || a.srcUnitId === r.id) continue;
      const caster = enemies.find((e) => e.id === a.srcUnitId);
      if (!caster) continue;
      const at = tsOf(a);
      if (at < ctx.start || at > ctx.roundEndAt) continue;
      // one press on several of them, the caster among them (an external
      // the caster put on one ally is its own `→ unit` line)
      if (
        !((caster.auraEvents ?? []) as any[]).some(
          (b) =>
            ev(b) === APPLIED &&
            String(b.spellId) === String(a.spellId) &&
            b.destUnitId === caster.id &&
            b.srcUnitId === caster.id &&
            Math.abs(tsOf(b) - at) <= 50,
        )
      )
        continue;
      const cpid = ctx.pidOf(caster.name);
      const rpid = ctx.pidOf(r.name);
      if (!cpid || !rpid) continue;
      ctx.bump("immunityCopyUnstated");
      const at0 = fmtS((at - ctx.start) / 1000);
      // the line prints its event's second: the press's, which can be the
      // second before this copy (28-6 r6: pressed 0:23.98, applied 0:24.015),
      // or the caster's own aura's, up to 50 ms after it (codex 20-F26-06
      // #4: 10.990 / 11.010)
      const sec = Math.floor((at - ctx.start) / 1000);
      const stated = ctx.lines.some(
        (l) =>
          [sec - 1, sec, sec + 1].some((s) => l.startsWith(`${fmtS(s)} `)) &&
          l.includes(ENEMY_DEF_TAG) &&
          l.includes(`${cpid}(`) &&
          l.includes(`also on`) &&
          l.includes(`${rpid}(`),
      );
      if (stated) continue;
      const name = nameOf(a.spellId, a.spellName ?? "");
      ctx.violate(
        "immunityCopyUnstated",
        name,
        at,
        `${caster.name}:${r.name}:${at0}`,
        `${cpid}'s ${name} also went up on ${rpid} at ${at0}; no line says so`,
      );
    }
  }
}

function auraOnlyPressNoLine(ctx: IRoundCtx): void {
  const ids = [...NO_CAST_LOG_PRESS_IDS].filter(isOffListPressId);
  for (const u of ctx.players as any[]) {
    for (const id of ids) {
      const auraIds = AURA_ONLY_ACTIVATION_IDS[id]!;
      for (const a of (u.auraEvents ?? []) as any[]) {
        if (ev(a) !== APPLIED || !auraIds.includes(String(a.spellId))) continue;
        if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
        const at = tsOf(a);
        if (at < ctx.start || at > ctx.roundEndAt) continue;
        if (
          castsOf(u).some(
            (c) =>
              String(c.spellId) === id &&
              Math.abs(tsOf(c) - at) <= SAVE_CAST_AURA_PAIR_S * 1000,
          )
        )
          continue;
        ctx.bump("auraOnlyPressNoLine");
        const at0 = fmtS((at - ctx.start) / 1000);
        const name = nameOf(id, a.spellName ?? "");
        if (ctx.lines.some((l) => l.startsWith(`${at0} `) && l.includes(name)))
          continue;
        ctx.violate(
          "auraOnlyPressNoLine",
          name,
          at,
          `${u.name}:${id}:${at0}`,
          `${u.name}'s ${name} went up at ${at0} with no press row; no line names it`,
        );
      }
    }
  }
}
