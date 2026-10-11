/**
 * CC USE — the log owner's control cooldowns over the round (GH #77 part 2).
 *
 * User rulings: 2026-09-19 (whole-match statistics may show actual casts and
 * reviewable windows; a theoretical-count difference is never waste or a
 * missed chance; without a specific evidenced opportunity, never advise "use
 * it more"); 2026-09-24 ("先留下来吧 … 我觉得是有一定价值的") after three
 * codex astra rounds narrowed it to:
 *  - counts for every CC major (SPELL_CAST_SUCCESS — completed casts);
 *  - DPS owners only: at most CC_USE_CAP review bookmarks, instant CCs only,
 *    each naming ONE target and the consequential moment that makes it worth a
 *    look, every condition holding on each counted second (no bridging):
 *      · offense — during the owner's own burst-ledger burst on a known,
 *        non-healer target, an enemy HEALER was CC-able;
 *      · defense — during a [DMG SPIKE] on a TEAMMATE, the enemy who did
 *        >= CC_USE_MIN_SHARE of all the damage that teammate took in it was
 *        CC-able;
 *  - healer owners: counts only (their slack predicate and the defense branch
 *    exclude each other, and "not CC'd" is not spare capacity).
 *  - FT-T16 D15 "2c" (user approval 2026-10-10, on real-match samples): a
 *    control with a cast time says how many cast bars were begun next to how
 *    many casts went off — `Cyclone cast bar started 4×, went off 0×`
 *    (539b6ed0: four Cyclone bars, none finished, and the prompt never said
 *    "Cyclone"). Started = the owner's SPELL_CAST_START rows
 *    (`castBarStartsOf`, the reading `ownerCastCancels` counts hardcasts with
 *    — a kicked bar is one of them); went off = SPELL_CAST_SUCCESS, the same
 *    number `cast N×` prints. The approval's condition: the second number
 *    must not read as "the control landed" (2c6e85ec round 6: 12 Cyclones
 *    went off, 3 MISSED and 2 were IMMUNE) — hence "went off", and the header
 *    says so. A control with no cooldown (Cyclone, Polymorph, Fear …) is on
 *    no cooldown ledger, so it gets its entry here, from its first started
 *    bar. The form is printed only when fewer went off than were started;
 *    otherwise the entry is the plain `cast N×` (one entry per spell, never
 *    both).
 * "CC-able" = `ccSamplerFor(...).stateAt` (shared with PEEL OPTIONS) at Full DR
 * only — an unresolved DR category is not admitted. The two doors
 * (>= CC_USE_MIN_S passing seconds, >= CC_USE_MIN_SHARE) are editorial,
 * chosen to keep volume low — codex r3:
 * they are not to be tuned on outcome data. The removed "room" number
 * (extra casts that would have fit) is not coming back: it was not a lower
 * bound (codex r1 counterexamples).
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { castAndEffectIds } from "../data/castEffectAuras";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import type { IBurstLedgerEntry } from "../utils/burstLedger";
import { castBarStartsOf } from "../utils/castCancels";
import { ccSamplerFor, pvpTrinketReadyAtSecond } from "../utils/ccTargetState";
import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  extractMajorCooldowns,
  type IDamageBucket,
  isHealerSpec,
  isMeleeSpec,
} from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";
import { ccMechanicOf, isInstantCast } from "../utils/spellMechanics";
import { DMG_SPIKE_THRESHOLD } from "./timelineHelpers";

/** A bookmark needs at least this many consecutive passing whole seconds. */
export const CC_USE_MIN_S = 5;
/** Defense bookmarks: the target did at least this share of ALL the damage
 * the teammate took in the [DMG SPIKE]. */
export const CC_USE_MIN_SHARE = 0.6;
/** At most this many bookmarks per round (the longest, shown in time order). */
export const CC_USE_CAP = 2;
/** DB2 SpellMechanic id "disarmed". */
export const DISARM_MECHANIC = 3;

export const CC_USE_SECTION_HEADER =
  "CC USE — your control cooldowns this round. `cast N×` counts completed casts. `cast bar started N×, went off M×` is printed for a control with a cast time when fewer casts went off than cast bars were started (otherwise its entry is the plain `cast N×`): N counts every cast bar you began, a kicked one included, and M the casts that finished (`first m:ss` = the first of them) — `went off` means the cast bar completed and the spell was cast, NOT that the control landed (a cast that went off can still miss or hit an immune target), and the counts do not say why a started bar did not go off. A [CC BOOKMARK] marks a moment worth a look, not a missed cast: on every second of its span the CC was ready and not cast, you were not CC'd or in a casting lockout, and the named enemy was in range, with no detected LoS obstruction, not CC'd, not immune, at Full DR, and with no known ready self-breaker of their own. The distance, DR and trinket state after `at m:ss` are as of the span's first second. Enemy dispels are not considered, and nothing here says whether casting was the better play — or whether you had a free global then: say \"you weren't CC'd\", never \"you were free\". Use a bookmark only to point the player at that moment, in your own words; never say they should have cast it, never count it as a mistake, and never judge the player as passive or aggressive from the counts.";

export interface ICcUseCount {
  spellId: string;
  spellName: string;
  casts: number;
  firstCastS: number | null;
  /** Cast bars begun (SPELL_CAST_START rows of this spell, `castBarStartsOf`)
   * — absent for a control the owner started no cast bar of this round (an
   * instant control never has one). */
  castBarsStarted?: number;
}

export interface ICcUseBookmark {
  kind: "offense" | "defense";
  spellId: string;
  spellName: string;
  targetName: string;
  seconds: number[];
  distanceYards: number;
  dr: string;
  targetTrinketReady: boolean | null;
  burstIndex?: number;
  burstFromS?: number;
  burstToS?: number;
  burstTargetName?: string;
  pressuredName?: string;
  spikeFromS?: number;
  spikeToS?: number;
  share?: number;
}

export interface ICcUseSummary {
  counts: ICcUseCount[];
  bookmarks: ICcUseBookmark[];
}

/** Maximal runs of consecutive seconds, kept when at least CC_USE_MIN_S long. */
function runsOf(seconds: number[]): number[][] {
  const out: number[][] = [];
  for (const s of seconds) {
    const last = out[out.length - 1];
    if (last && s === last[last.length - 1]! + 1) last.push(s);
    else out.push([s]);
  }
  return out.filter((r) => r.length >= CC_USE_MIN_S);
}

export function ccUseSummary(params: {
  combat: AtomicArenaCombat;
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  enemyCC: ReadonlyArray<IPlayerCCTrinketSummary>;
  /** The SAME array the <burst_ledger> block numbers (`Burst #i+1`). */
  burstLedger: ReadonlyArray<IBurstLedgerEntry>;
  /** The SAME array the [DMG SPIKE] lines render from. */
  pressureWindows: ReadonlyArray<IDamageBucket>;
}): ICcUseSummary {
  const { combat, owner, friends, enemies, enemyCC } = params;
  const start = combat.startTime;
  let cds: ReturnType<typeof extractMajorCooldowns> = [];
  try {
    // W1g (reliability round 2, user ruling 2026-09-25): every control
    // cooldown in the owner's kit — the roster's Control tag (disarms, grips,
    // traps, totems included) as well as the hard-CC set.
    cds = extractMajorCooldowns(owner, combat).filter(
      (cd) => cd.tag === "Control" || ccSpellIds.has(cd.spellId),
    );
  } catch {
    return { counts: [], bookmarks: [] };
  }
  const counts: ICcUseCount[] = cds.map((cd) => ({
    spellId: cd.spellId,
    spellName: cd.spellName,
    casts: cd.casts.length,
    firstCastS: cd.casts.length
      ? Math.min(...cd.casts.map((c) => c.timeSeconds))
      : null,
  }));
  // FT-T16 D15 "2c": cast bars begun, per control. Same end clamp as the
  // cooldown ledger's casts above (a Solo Shuffle round's units keep the gap
  // after its end), so both numbers of an entry count one stretch of time.
  const durationS = (combat.endTime - start) / 1000;
  const wentOffS = (englishName: string) =>
    (owner.spellCastEvents ?? [])
      .filter(
        (e) =>
          e.logLine.event === "SPELL_CAST_SUCCESS" &&
          !!e.spellId &&
          getEnglishSpellName(e.spellId, e.spellName) === englishName,
      )
      .map((e) => (e.logLine.timestamp - start) / 1000)
      .filter((t) => t <= durationS);
  for (const s of castBarStartsOf(owner, start)) {
    if (!s.id || s.t > durationS) continue;
    // By English name as well as id: the variants of one spell (Polymorph's
    // skins) are one entry, under the name the line prints.
    const name = getEnglishSpellName(s.id, s.name);
    let entry = counts.find((c) => c.spellId === s.id || c.spellName === name);
    if (!entry) {
      // Not on the cooldown ledger: a control by the hard-CC set, asked of
      // the cast's own id and of its effect auras (a cast id is often not the
      // id of the aura it leaves — data/castEffectAuras.ts).
      if (![...castAndEffectIds(s.id)].some((id) => ccSpellIds.has(id)))
        continue;
      const went = wentOffS(name);
      entry = {
        spellId: s.id,
        spellName: name,
        casts: went.length,
        firstCastS: went.length ? Math.min(...went) : null,
      };
      counts.push(entry);
    }
    entry.castBarsStarted = (entry.castBarsStarted ?? 0) + 1;
  }
  if (isHealerSpec(owner.spec)) return { counts, bookmarks: [] };

  const enemyIds = new Set(enemies.map((u) => u.id));
  const petOwner = new Map<string, string>();
  for (const u of Object.values(combat.units))
    if (u.ownerId && enemyIds.has(u.ownerId)) petOwner.set(u.id, u.ownerId);
  const trinketReadyAt = (name: string, s: number) =>
    pvpTrinketReadyAtSecond(
      enemyCC.find((x) => x.playerName === name),
      s,
    );

  const all: ICcUseBookmark[] = [];
  for (const cd of cds) {
    if (!isInstantCast(cd.spellId)) continue;
    const sampler = ccSamplerFor({
      combat,
      owner,
      cd,
      enemyIds,
      renderedCcOf: (name) =>
        enemyCC.find((x) => x.playerName === name)?.ccInstances ?? [],
    });
    if (!sampler) continue;
    // User ruling 2026-09-25: a disarm is only worth a look against a melee
    // target (official mechanic 3 = disarmed).
    const isDisarm = ccMechanicOf(cd.spellId) === DISARM_MECHANIC;
    const scan = (target: ICombatUnit, fromS: number, toS: number) => {
      if (isDisarm && !isMeleeSpec(target.spec)) return [];
      const secs: number[] = [];
      const facts = new Map<number, { dist: number; dr: string }>();
      for (let s = Math.ceil(fromS); s <= Math.floor(toS); s++) {
        const st = sampler.stateAt(target, s);
        // Full DR only: "n/a" (no category) is unresolved, not "no DR".
        if (!st.ok || st.dr !== "Full") continue;
        secs.push(s);
        facts.set(s, { dist: st.distanceYards, dr: st.dr });
      }
      return runsOf(secs).map((run) => ({ run, first: facts.get(run[0]!)! }));
    };

    // Offense: the owner's own bursts on a known, non-healer target.
    params.burstLedger.forEach((b, i) => {
      const bt = b.dominantTarget
        ? enemies.find((u) => u.id === b.dominantTarget!.unitId)
        : undefined;
      if (!bt || isHealerSpec(bt.spec)) return;
      for (const h of enemies.filter((u) => isHealerSpec(u.spec))) {
        for (const { run, first } of scan(h, b.fromSeconds, b.toSeconds))
          all.push({
            kind: "offense",
            spellId: cd.spellId,
            spellName: cd.spellName,
            targetName: h.name,
            seconds: run,
            distanceYards: first.dist,
            dr: first.dr,
            targetTrinketReady: trinketReadyAt(h.name, run[0]!),
            burstIndex: i + 1,
            burstFromS: b.fromSeconds,
            burstToS: b.toSeconds,
            burstTargetName: bt.name,
          });
      }
    });

    // Defense: a [DMG SPIKE] on a teammate and its dominant attacker.
    for (const w of params.pressureWindows) {
      if (w.totalDamage < DMG_SPIKE_THRESHOLD) continue;
      const mate = friends.find((u) => u.name === w.targetName);
      if (!mate || mate.id === owner.id) continue;
      const dmg = new Map<string, number>();
      let total = 0;
      for (const e of mate.damageIn ?? []) {
        const t = (e.timestamp - start) / 1000;
        if (t < w.fromSeconds || t > w.toSeconds) continue;
        const a = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
        total += a;
        const src = enemyIds.has(e.srcUnitId)
          ? e.srcUnitId
          : petOwner.get(e.srcUnitId);
        if (src) dmg.set(src, (dmg.get(src) ?? 0) + a);
      }
      const top = [...dmg.entries()].sort((x, y) => y[1] - x[1])[0];
      if (!top || total === 0 || top[1] / total < CC_USE_MIN_SHARE) continue;
      const attacker = enemies.find((u) => u.id === top[0]);
      if (!attacker) continue;
      for (const { run, first } of scan(attacker, w.fromSeconds, w.toSeconds))
        all.push({
          kind: "defense",
          spellId: cd.spellId,
          spellName: cd.spellName,
          targetName: attacker.name,
          seconds: run,
          distanceYards: first.dist,
          dr: first.dr,
          targetTrinketReady: trinketReadyAt(attacker.name, run[0]!),
          pressuredName: mate.name,
          spikeFromS: w.fromSeconds,
          spikeToS: w.toSeconds,
          share: top[1] / total,
        });
    }
  }
  const bookmarks = all
    .sort((x, y) => y.seconds.length - x.seconds.length)
    .slice(0, CC_USE_CAP)
    .sort((x, y) => x.seconds[0]! - y.seconds[0]!);
  return { counts, bookmarks };
}

/**
 * One entry of the `Counts:` line. The started form only when fewer casts
 * went off than cast bars were begun: with every bar finished (or more casts
 * than bars — an instant proc of a cast-time spell) the plain form says all
 * there is, so a spell never reads two ways. The gate
 * (`promptQualityCheck.checkCcUseStartedCounts`) re-parses this text.
 */
export function formatCcUseCount(c: ICcUseCount): string {
  const first = c.casts > 0 ? ` (first ${fmtTime(c.firstCastS!)})` : "";
  if ((c.castBarsStarted ?? 0) > c.casts)
    return `${c.spellName} cast bar started ${c.castBarsStarted}×, went off ${c.casts}×${first}`;
  return c.casts === 0
    ? `${c.spellName} not cast`
    : `${c.spellName} cast ${c.casts}×${first}`;
}

export function formatCcUse(
  summary: ICcUseSummary,
  labels: { friendly: (n: string) => string; enemy: (n: string) => string },
): string[] {
  if (summary.counts.length === 0) return [];
  const countStr = summary.counts.map(formatCcUseCount).join(" · ");
  const lines = [CC_USE_SECTION_HEADER, `  Counts: ${countStr}`];
  for (const b of summary.bookmarks) {
    const from = b.seconds[0]!;
    const to = b.seconds[b.seconds.length - 1]!;
    const target = labels.enemy(b.targetName);
    const why =
      b.kind === "offense"
        ? `during your Burst #${b.burstIndex} (${fmtTime(b.burstFromS!)}–${fmtTime(b.burstToS!)}) on ${labels.enemy(b.burstTargetName!)}, their healer was not CC'd`
        : `${target} did ${Math.round(b.share! * 100)}% of ${labels.friendly(b.pressuredName!)}'s damage taken in the [DMG SPIKE] ${fmtTime(b.spikeFromS!)}–${fmtTime(b.spikeToS!)}`;
    const trinket =
      b.targetTrinketReady === null
        ? ""
        : `, ${target} PvP trinket ${b.targetTrinketReady ? "ready" : "on cooldown"}`;
    lines.push(
      `${fmtTime(from)}–${fmtTime(to)}  [CC BOOKMARK]  ${b.spellName} → ${target}: ${why} | at ${fmtTime(from)}: ${b.distanceYards.toFixed(1)}yd, DR ${b.dr}${trinket}`,
    );
  }
  return lines;
}
