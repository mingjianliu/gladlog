/**
 * The setup of buildMatchTimeline — the params destructure (with its defaults),
 * the derived maps (summon owners, unit names, roster sides, Grounding absorbs,
 * …) and the closure helpers every section uses: player / enemy ids and labels,
 * target resolution, the CC / DR / immune / empower tags, the deferred-snapshot
 * placeholder counter, mana and Grounding notes. Everything later code reads is
 * returned; the helpers keep closing over the same state (e.g. the placeholder
 * counter, the consumed-miss sets) inside this function.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * `params` now arrives through `ctx`, and the declarations come back to the
 * caller. Output is pinned by the 605-file acceptanceCapture context hash.
 */
import {
  CombatUnitReaction,
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { CYCLONE_SPELL_ID } from "../../analysis/candidates/massDispel";
import { castAndEffectIds } from "../../data/castEffectAuras";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { ccSpellIds } from "../../data/spellTags";
import { buffFullDurationForCaster } from "../../utils/buffDuration";
import {
  EMPOWER_PRESS_MATCH_MS,
  empowerSpans,
} from "../../utils/castCommitSpans";
import {
  CC_AVOIDANCE_BUFF_SPELLS,
  GROUNDING_TOTEM_SPELL_ID,
  GROUNDING_TOTEM_WINDOW_S,
} from "../../utils/ccTrinketAnalysis";
import {
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  hpAtPress,
  isTeamHealCD,
  specToString,
} from "../../utils/cooldowns";
import {
  AOE_CC_DELAYED_CAST_IDS,
  AOE_CC_SPELL_IDS,
  getDRCategory,
  getDRLevel,
  OWNER_AOE_CC_NO_PLAYER_TAG,
} from "../../utils/drAnalysis";
import { sumIncomingPressure } from "../../utils/incomingPressure";
import { toRenderSecond } from "../../utils/renderGrid";
import { resourceDeltaPct } from "../../utils/resourceAt";
import { buildRosterSides } from "../../utils/rosterSide";
import { buildResourceSnapshot } from "../resourceSnapshot";
import { ownerResUtilityCds } from "../resUtilityCds";
import {
  buildSummonOwnerNames,
  CRITICAL_NON_PLAYER_NPC_NAMES,
  extractEnemyMajorBuffIntervals,
  getNpcIdFromGuid,
  GROUNDING_TOTEM_NPC_ID,
  MANA_COOLDOWN_SPELL_IDS,
  resolveSummonOwner,
  summonKindOf,
} from "../timelineHelpers";
import { abbrevSpec } from "../unitLabel";
import type { DeferredSnapshot } from "./ctx";
import type { TimelineCtx } from "./ctx";

export function prepareTimelineSetup(ctx: Pick<TimelineCtx, "params">) {
  const { params } = ctx;

  const {
    owner,
    ownerSpec,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    dispelSummary,
    enemyDispelSummary,
    enemyCCSummaries,
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    healingGaps,
    friends,
    enemies,
    allUnits,
    matchStartMs,
    matchEndMs,
    isHealer,
    playerIdMap,
    enemyIdMap,
    outgoingCCChains,
    bracket,
    stasisEvents = [],
    shapeshiftIntervals = [],
    spiritOfRedemptionIntervals = [],
    criticalWindowSeconds: criticalWindowSet,
    crisisAnchorSeconds,
    counterfactualOf,
    burstWindows,
    cdPriorEpisodes,
    cdPriorCohort,
    stackedDefensives,
    rawStreams,
  } = params;
  // friends + enemies (dampening, rot pressure, and setup closures below)
  const allPlayers = friends.concat(enemies ?? []);
  const manaFallback = { rawStreams, matchStartMs };

  const matchDurationS = (matchEndMs - matchStartMs) / 1000;
  const enemyBuffIntervals = extractEnemyMajorBuffIntervals(
    enemies ?? [],
    matchStartMs,
    matchEndMs,
  );

  const _allUnits = allUnits ?? [...friends, ...(enemies ?? [])];
  // summon GUID → owner name: damage-source labels name a pet / guardian
  // through its owner (reliability round 3, f4da).
  const summonOwners = buildSummonOwnerNames(_allUnits);
  // unit GUID → roster side: "same team" is a roster fact, not the event's
  // reaction flags, which flip while someone is charmed (death-kill F-T1)
  const rosterSides = buildRosterSides(_allUnits);
  const unitNames = new Map(_allUnits.map((u) => [u.id, u.name]));

  // criticalWindowSet is built by the caller (buildMatchContext) via
  // buildCriticalWindowSet and passed in — deliberately not built here, or the
  // [CD] / death blocks would not share the same set.

  // F143: Pre-calculate Grounding Totem absorbs.
  // A SPELL_ABSORBED event's own spellId is the SHIELD (Grounding Totem
  // itself); the note used to print that, so once it rendered at all it read
  // `[ABSORBED: Grounding Totem]` on 277 of 298 lines (GH #100). The eaten
  // spell is the ATTACKER's, which the parser materialises as
  // `attackSpellId/Name` since 2026-09-20 (user: "even if we don't use it, we
  // should know what the totem ate"). Documents stored before that do not
  // carry it — the archive slimmer had cleared those params — so the note
  // falls back to naming the caster only. A totem killed by direct damage is a
  // different fact with its own `[UNIT DESTROYED]` line: a final blow is NOT
  // an eaten spell.
  const groundingAbsorbs: Array<{
    timeSeconds: number;
    attackerId: string;
    /** English name of the eaten spell; undefined on pre-2026-09-20 documents */
    spellName?: string;
    totemOwnerId: string;
  }> = [];
  if (allUnits) {
    for (const unit of allUnits) {
      const npcId = getNpcIdFromGuid(unit.id);
      if (
        (npcId === GROUNDING_TOTEM_NPC_ID ||
          unit.name.toLowerCase().includes("grounding totem")) &&
        unit.ownerId
      ) {
        for (const absorb of unit.absorbsIn) {
          if (!absorb.attackerId) continue;
          let spellName: string | undefined;
          if (absorb.attackSpellId) {
            const raw = getEnglishSpellName(
              absorb.attackSpellId,
              absorb.attackSpellName?.trim() || null,
            );
            spellName =
              raw.trim() ||
              absorb.attackSpellName?.trim() ||
              absorb.attackSpellId;
          } else if (absorb.attackSpellName?.trim()) {
            spellName = absorb.attackSpellName.trim();
          }
          groundingAbsorbs.push({
            timeSeconds: (absorb.timestamp - matchStartMs) / 1000,
            attackerId: absorb.attackerId,
            ...(spellName ? { spellName } : {}),
            totemOwnerId: unit.ownerId,
          });
        }
      }
    }
  }

  /**
   * A mana cooldown is answered with resource, not throughput. Innervate sat in
   * HEALING_AMPLIFIER_SPELL_IDS until 2026-08-23 and got the HPS/overheal
   * block, whose cast ranking (`overhealPct*1000 - maxBucketHps`) surfaced the
   * WORST-scoring cast — teaching the model that low HPS during Innervate is
   * the mistake, when low HPS is exactly when a healer drinks. Measured on 200
   * archive files: it ticks mana back (SPELL_PERIODIC_ENERGIZE, 258 hits) and
   * the target's mana rises in 55 of 58 windows (0 fell, median +9.5pp).
   *
   * Shared by BOTH emitters of `[YOU] [CD]`: the ownerCDs ledger loop and the
   * B38 promotion path further down. Innervate is normally ABSENT from
   * `extractMajorCooldowns`, so production renders it through the promotion
   * path — wiring only the ledger loop produced a line that passed its unit
   * test and never once appeared on a real match.
   */
  function manaCooldownNote(
    spellId: string,
    timeSeconds: number,
    targetName: string | undefined,
  ): string | null {
    if (!MANA_COOLDOWN_SPELL_IDS.has(spellId)) return null;
    // Caster-aware: the owner cast it, so their talents price its length.
    const duration = buffFullDurationForCaster(spellId, owner);
    if (!duration) return null;
    const target =
      (targetName
        ? allPlayers.find((u) => u.name === targetName)
        : undefined) ?? owner;
    const fromMs = matchStartMs + timeSeconds * 1000;
    const delta = resourceDeltaPct(
      target,
      fromMs,
      fromMs + duration * 1000,
      manaFallback,
    );
    const who = target.id === owner.id ? "self" : pid(target.name);
    return delta
      ? `      [MANA]       ${who}: ${delta.fromPct}% -> ${delta.toPct}% mana (${delta.deltaPct >= 0 ? "+" : ""}${delta.deltaPct}pp over ${duration}s)`
      : `      [MANA]       ${who}: no resource reading in this window`;
  }

  const groundingAbsorbNote = (
    spellId: string,
    spellName: string,
    totemOwnerId: string,
    castSeconds: number,
  ): string => {
    if (spellId !== GROUNDING_TOTEM_SPELL_ID && spellName !== "Grounding Totem")
      return "";
    const eaten = groundingAbsorbs.filter(
      (a) =>
        a.totemOwnerId === totemOwnerId &&
        a.timeSeconds >= castSeconds &&
        a.timeSeconds <= castSeconds + GROUNDING_TOTEM_WINDOW_S,
    );
    if (eaten.length === 0) return "";
    const ownerIsFriendly = friends.some((f) => f.id === totemOwnerId);
    const casterOf = (attackerId: string): string => {
      const attacker = allUnits?.find((u) => u.id === attackerId);
      return attacker
        ? actorLabel(
            attacker.name,
            ownerIsFriendly ? "enemy" : "friendly",
            attacker.id,
          )
        : "unknown";
    };
    // Every eaten spell is known → name them; otherwise (an older stored
    // document) say only who cast them. Never a mix that reads as complete.
    if (eaten.every((a) => Boolean(a.spellName?.trim())))
      return ` [ABSORBED: ${Array.from(
        new Set(eaten.map((a) => `${a.spellName} (${casterOf(a.attackerId)})`)),
      ).join(", ")}]`;
    return ` [ABSORBED spells from: ${Array.from(
      new Set(eaten.map((a) => casterOf(a.attackerId))),
    ).join(", ")}]`;
  };

  // A/B cycle-1 accuracy regression fix: bare numeric ids forced the responder
  // to map unit identity itself across thousands of tokens; blind review showed
  // fine-grained misattribution (pets / unit HP / dispel direction crossed).
  // Inline a compact spec tag at every reference; same-spec twins are still
  // disambiguated by id. abbrevSpec is shared with observedConsequences.ts.
  const nameSpecTag = new Map<string, string>(
    [...friends, ...(enemies ?? [])].map((u) => [
      u.name,
      abbrevSpec(specToString(u.spec)),
    ]),
  );
  function tagFor(name: string): string {
    const tag = nameSpecTag.get(name);
    return tag ? `(${tag})` : "";
  }

  /**
   * Returns the short numeric ID for a friendly player name, or the raw name
   * if no mapping exists.  Enemy names must be resolved via enemyPid() to avoid
   * ID collision when a friendly and enemy share a display name.
   */
  function pid(name: string): string {
    if (!playerIdMap) return name.split("-")[0];
    const id = playerIdMap.get(name) ?? playerIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /** GH #103 A6: who provided the avoidance aura on a `[CC AVOIDED?]` line —
   * `(own)` for the CC'd player's own, `(from <pid>)` for a teammate's (the
   * responder wrote "your Grounding" for a totem the other shaman dropped).
   * Empty when unknown (mobility avoidance, aura up at log start). */
  function avoidanceSourceTag(
    sourceName: string | undefined,
    targetName: string,
  ): string {
    if (!sourceName) return "";
    return sourceName === targetName ? " (own)" : ` (from ${pid(sourceName)})`;
  }

  /** Returns the short numeric ID for an *enemy* player name, falling back to name. */
  /** crisis-external F-T1: the friendly player's pid, or undefined for a name
   * that is no friendly player (a pet, an NPC, an enemy) — `pid` falls back
   * to the raw name and cannot tell. `playerIdMap` holds the friendly
   * players, owner included. */
  function friendlyPid(name: string): string | undefined {
    if (!playerIdMap) return undefined;
    const id = playerIdMap.get(name) ?? playerIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : undefined;
  }

  function enemyPid(name: string): string {
    if (!enemyIdMap) return name.split("-")[0];
    const id = enemyIdMap.get(name) ?? enemyIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /**
   * Caster label (used by the "(by X)" part of CC lines): player → pid/enemyPid;
   * pet → owner's label + "'s pet"; a localized name with no resolvable owner
   * (CJK pet names etc.) → "[pet]".
   * Same rule as resolveKicker on [KICK] lines — 2026-07-17 thousand-match fuzz:
   * hunter pet Intimidation leaked a CJK pet name in "(by …)" ×72.
   */
  function actorLabel(
    name: string,
    side: "friendly" | "enemy",
    sourceId?: string,
  ): string {
    const primary = side === "friendly" ? pid(name) : enemyPid(name);
    if (/^\d/.test(primary)) return primary; // hit the player map (player names never start with a digit)
    // GH #99: resolve the summon by the event's OWN source GUID. Matching on
    // the NAME collided whenever both teams fielded a same-named summon (two
    // shamans → two units called "Capacitor Totem"): `find` returned whichever
    // one the unit table held first, so 48 lines of the 2026-09-15 baseline
    // credited the wrong side — including `3(EShaman) ← Capacitor Totem (by
    // 3(EShaman)'s pet)`, a teammate rendered as stunning his own team. The id
    // is ground truth, so the owner it resolves to wins over the caller's
    // `side`; `side` now only narrows the name fallback used by documents that
    // carry no source id.
    const ownerUnit = resolveSummonOwner({
      allUnits,
      friends,
      enemies,
      name,
      sourceId,
      side,
    });
    if (ownerUnit) {
      const label = friends.some((f) => f.id === ownerUnit.id)
        ? pid(ownerUnit.name)
        : enemyPid(ownerUnit.name);
      // FT-T14: the summon's kind is read off the log — a Capacitor Totem
      // is the shaman's totem, not a pet the round never had
      const src = sourceId
        ? allUnits?.find((u) => u.id === sourceId)
        : allUnits?.find((u) => u.name === name && u.ownerId === ownerUnit.id);
      return `${label}'s ${summonKindOf(src?.id ?? sourceId, src)}`;
    }
    const short = name.split("-")[0];
    return [...short].some((c) => c.charCodeAt(0) > 127) ? "[pet]" : short;
  }

  /**
   * Resolves a cast's destUnitName to a display label for [YOU] [CAST] entries.
   * Returns "self" for self-casts, a numeric ID for known players, or the raw name.
   * Returns "" when destUnitName is empty (AoE spells with no specific log target).
   */
  function resolveTarget(destUnitName: string | null | undefined): string {
    if (!destUnitName || destUnitName === "nil") return "";
    const cleanDest = destUnitName.split("-")[0];
    const cleanOwner = owner.name.split("-")[0];
    if (destUnitName === owner.name || cleanDest === cleanOwner) return "self";
    if (playerIdMap) {
      const id = playerIdMap.get(destUnitName) ?? playerIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    if (enemyIdMap) {
      const id = enemyIdMap.get(destUnitName) ?? enemyIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    // Unmapped target = totem/pet/NPC (not one of the arena players, who are all
    // pid-mapped above). Its name comes from the log in the client's locale — do
    // not leak a localized (e.g. Chinese) unit name into an English prompt. Cast
    // lines tag [totem/pet] separately, so suppress the name here; ASCII names
    // (rare English-locale NPCs) still pass through unchanged.
    const isLocalized = [...cleanDest].some((ch) => ch.charCodeAt(0) > 127);
    if (isLocalized) return "";
    return cleanDest;
  }

  /**
   * DR state of a CC the player cast, **at the moment it lands**, rendered as
   * `[DR: category level]` — exactly the same format as [CC ON TEAM] (class F:
   * previously only received CC carried DR, outgoing CC did not).
   *
   * DR itself is not recomputed: read the drInfo already annotated by
   * analyzeOutgoingCCChains, so no second DR judgement exists (single-source
   * predicate). Matching is by spellId + landing second, compared on the render
   * grid (atSeconds in the chain is fractional, and so is cast.timeSeconds, so
   * floor both before comparing).
   */
  function enemyCcDrTag(
    targetName: string,
    spellId: string,
    atSeconds: number,
    sourceId: string | undefined,
    sourceName: string,
  ): string {
    const src = friends.find((f) => f.id === sourceId);
    const unit = src ?? allUnits?.find((u) => u.id === sourceId);
    const ownerOf = unit?.ownerId
      ? friends.find((f) => f.id === unit.ownerId)
      : undefined;
    const caster = src?.name ?? ownerOf?.name ?? sourceName;
    const t = toRenderSecond(atSeconds);
    for (const chain of outgoingCCChains ?? []) {
      if (chain.targetName !== targetName) continue;
      for (const app of chain.applications)
        if (
          app.spellId === spellId &&
          app.casterName === caster &&
          app.drInfo &&
          toRenderSecond(app.atSeconds) === t
        )
          return ` [DR: ${app.drInfo.category} ${app.drInfo.level}]`;
    }
    return "";
  }

  function outgoingDrTag(
    spellId: string,
    cast: { timeSeconds: number },
  ): string {
    // cc-dr F-AO1: every application of this spell by the OWNER at the
    // line's render second (an AoE lands on several enemies at different DR
    // levels; any caster's same spell used to match). One level → as before;
    // several → per target, labelled with `enemyPid` (the chain's targets are
    // enemies — codex c2 10-02).
    const t = toRenderSecond(cast.timeSeconds);
    const hits: Array<{ target: string; category: string; level: string }> = [];
    for (const chain of outgoingCCChains ?? []) {
      for (const app of chain.applications) {
        if (app.spellId !== spellId) continue;
        if (toRenderSecond(app.atSeconds) !== t) continue;
        if (!app.drInfo || app.casterName !== owner.name) continue;
        hits.push({
          target: chain.targetName,
          category: app.drInfo.category,
          level: app.drInfo.level,
        });
      }
    }
    if (hits.length === 0) return "";
    if (new Set(hits.map((h) => h.level)).size === 1)
      return ` [DR: ${hits[0]!.category} ${hits[0]!.level}]`;
    return ` [DR: ${hits[0]!.category} — ${hits.map((h) => `${enemyPid(h.target)} ${h.level}`).join(", ")}]`;
  }

  /**
   * `[IMMUNE]` tag for the owner's CC casts that the game rejected outright —
   * `SPELL_MISSED` with `missType === "IMMUNE"` (readable since 2026-08-23; the
   * field was parsed away before). Without it a whiffed CC renders exactly like
   * a landed one: the cast line appears, no DR tag follows, and the model has
   * no way to tell "you opened with Fear" from "you threw Fear into Divine
   * Shield". S2 corpus: 4,602 immune CC casts / 1,200 rounds, 82% of rounds
   * carry at least one.
   *
   * The immunity's NAME is attached only when a listed CC-immunity aura
   * (CC_AVOIDANCE_BUFF_SPELLS — completeness-checked against these very IMMUNE
   * events, see immuneCcScan.ts) covered the target at impact. No known aura →
   * bare `[IMMUNE]`, never a guess.
   *
   * Matching: same spellId, miss at [cast, cast+2.5s] (instant CC misses on the
   * same instant; a Polymorph projectile lands up to ~1.5s later). Each miss
   * event is consumed once so chain-cast spam cannot re-attach one miss to
   * several cast lines.
   */
  // The owner's own SPELL_CAST_SUCCESS times per spell, for attributing a miss
  // to the cast that produced it (codex astra 2026-09-25: with only a window,
  // a Polymorph reflected at 31.55 s tagged the landed 30.0 s cast and left
  // the reflected 31.5 s cast bare).
  // Per CASTER (codex review of batch 3, 2026-09-26: a teammate's tag must
  // read the teammate's casts, not the owner's — otherwise the owner's
  // Polymorph at 31.52 s suppressed the teammate's 31.5 s tag and vice versa).
  const castMsBySpellByUnit = new Map<string, Map<string, number[]>>();
  function castMsBySpellOf(unit: ICombatUnit): Map<string, number[]> {
    let m = castMsBySpellByUnit.get(unit.id);
    if (m) return m;
    m = new Map<string, number[]>();
    for (const e of unit.spellCastEvents ?? []) {
      if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
        continue;
      const list = m.get(e.spellId) ?? [];
      list.push(e.timestamp);
      m.set(e.spellId, list);
    }
    castMsBySpellByUnit.set(unit.id, m);
    return m;
  }
  /** The miss falls in the cast's window AND no later cast of the same spell
   * by the same caster happened at or before it — it belongs to the latest
   * cast before it. */
  function missBelongsToCast(
    unit: ICombatUnit,
    spellId: string,
    castMs: number,
    missMs: number,
  ): boolean {
    if (missMs < castMs - 100 || missMs > castMs + 2500) return false;
    return !(castMsBySpellOf(unit).get(spellId) ?? []).some(
      (t) => t > castMs + 5 && t <= missMs + 100,
    );
  }

  const consumedImmuneMisses = new Set<unknown>();
  function ownerCcImmuneTag(
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ): string {
    return ccImmuneTagFor(owner, spellId, castTimeSeconds, named);
  }
  // Reliability round 3 N10 (483f): a teammate's Storm Bolt the game rejected
  // as IMMUNE rendered as a plain [TEAM] [CC] cast — same predicate as the
  // owner's tag, read from that unit's own SPELL_MISSED stream.
  //
  // Triage 2026-09-29 G3:
  //  - enemy-def F-E25b: a miss is the cast's when its id is the cast's own or
  //    one of the cast's effect auras (`castAndEffectIds`, the one cast→effect
  //    table): Storm Bolt's IMMUNE is logged under its stun 132169, Freezing
  //    Trap's under 3355 / 203337, Maim's under 203123.
  //  - enemy-def F-E26: `named` = the unit names the line names (its target,
  //    plus an AoE fold's landed targets). On such a line a miss on a named
  //    target is the line's own `[IMMUNE]`; a miss on a PLAYER the line does
  //    not name is said with that player's label (`[IMMUNE: 6(UDKnight)]` —
  //    d692582c's Leg Sweep landed on the named priest and was immune only on
  //    the Death Knight); a miss on anything else says nothing (its
  //    Intimidating Shout was immune only on summons and a pet). Without
  //    `named` (a line that names no one) the rule is as before.
  function ccImmuneTagFor(
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
    named?: ReadonlySet<string>,
  ): string {
    const misses = unit.missesOut;
    if (!misses || misses.length === 0) return "";
    const castMs = matchStartMs + castTimeSeconds * 1000;
    // Whose immunity counts: a player's, or the unit the cast itself was
    // aimed at. An AoE CC (Psychic Scream, Leg Sweep) logs an IMMUNE miss for
    // every immune pet / totem it sweeps — ghouls, Army of the Dead, totems —
    // while the line names only the player targets; 2026-09-30 corpus
    // (605 files): 818 Psychic Scream lines carried a bare [IMMUNE] that way,
    // e.g. 5dc8b136 0:53 "[DR: Disorient Full] [IMMUNE]" with all three
    // player targets feared.
    const aimedAt = (unit.spellCastEvents ?? []).find(
      (e) =>
        e.logLine?.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId &&
        Math.abs(e.timestamp - castMs) <= 100,
    )?.destUnitId;
    const counts = (destId: string | undefined) =>
      !!destId &&
      (destId === aimedAt || allPlayers.some((p) => p.id === destId));
    const family = castAndEffectIds(spellId);
    const candidates = misses.filter(
      (m) =>
        m.missType === "IMMUNE" &&
        m.spellId !== undefined &&
        family.has(m.spellId) &&
        counts(m.destUnitId) &&
        !consumedImmuneMisses.has(m) &&
        missBelongsToCast(unit, spellId, castMs, m.timestamp),
    );
    let miss: (typeof candidates)[number] | undefined = candidates[0];
    let unnamedLabel = "";
    if (miss && named && named.size > 0) {
      // `named` holds the line's unit names and/or ids: a miss's dest name
      // need not spell the roster's (realm suffix), its id does
      const onNamed = candidates.find(
        (m) =>
          (!!m.destUnitName && named.has(m.destUnitName)) ||
          (!!m.destUnitId && named.has(m.destUnitId)),
      );
      const onPlayer = candidates.find((m) =>
        allPlayers.some((p) => p.id === m.destUnitId),
      );
      miss = onNamed ?? onPlayer;
      if (!onNamed && onPlayer) {
        // the roster label, resolved by id on the player's own side (a bare
        // character name never prints — 605: `[IMMUNE: Mashiyyds]`)
        const pl = allPlayers.find((p) => p.id === onPlayer.destUnitId)!;
        unnamedLabel =
          pl.reaction === CombatUnitReaction.Friendly
            ? pid(pl.name)
            : enemyPid(pl.name);
      }
    }
    if (!miss) return "";
    consumedImmuneMisses.add(miss);

    // Which listed immunity was up on the target at impact.
    let immunityName = "";
    const target =
      allUnits?.find((u) => u.id === miss.destUnitId) ??
      allPlayers.find((u) => u.id === miss.destUnitId);
    if (target) {
      const active = new Map<string, string>();
      for (const a of target.auraEvents) {
        if (a.timestamp > miss.timestamp) break;
        if (!a.spellId || !CC_AVOIDANCE_BUFF_SPELLS.has(a.spellId)) continue;
        const ev = a.logLine.event;
        if (
          ev === LogEvent.SPELL_AURA_APPLIED ||
          ev === LogEvent.SPELL_AURA_REFRESH
        ) {
          active.set(
            a.spellId,
            CC_AVOIDANCE_BUFF_SPELLS.get(a.spellId) ?? a.spellName,
          );
        } else if (ev === LogEvent.SPELL_AURA_REMOVED) {
          active.delete(a.spellId);
        }
      }
      immunityName = [...active.values()][0] ?? "";
    }
    const word = unnamedLabel ? `IMMUNE: ${unnamedLabel}` : "IMMUNE";
    if (immunityName) return ` [${word} — ${immunityName} was up]`;
    // B-tier B17a (user ruling 2026-10-06, "三种都写；找不到原因不加注"): the
    // two other reasons the log can show, after the immunity aura above —
    // our own team's Cyclone on the target, then diminishing returns.
    const why = target
      ? (ccImmuneByOwnCyclone(target, miss.timestamp) ??
        ccImmuneByDr(target, miss.spellId!, miss.timestamp))
      : undefined;
    return why ? ` [${word} — ${why}]` : ` [${word}]`;
  }

  /** B17a: a friendly Druid's Cyclone was on the target at the miss — a
   * cycloned unit is immune to everything, our own control included. */
  function ccImmuneByOwnCyclone(
    target: ICombatUnit,
    missMs: number,
  ): string | undefined {
    const friendIds = new Set(friends.map((f) => f.id));
    let by: string | undefined;
    for (const a of target.auraEvents ?? []) {
      if (a.timestamp > missMs) break;
      if (a.spellId !== CYCLONE_SPELL_ID) continue;
      const ev = a.logLine.event;
      if (
        ev === LogEvent.SPELL_AURA_APPLIED ||
        ev === LogEvent.SPELL_AURA_REFRESH
      )
        by = friendIds.has(a.srcUnitId) ? a.srcUnitId : undefined;
      else if (ev === LogEvent.SPELL_AURA_REMOVED) by = undefined;
    }
    if (!by) return undefined;
    const druid = friends.find((f) => f.id === by)!;
    return `${pid(druid.name)}'s Cyclone was on the target`;
  }

  /** B17a: the target's diminishing returns for this control's family were
   * already at immune — the DR engine's own chain walk (`getDRLevel`) over
   * the applications `outgoingCCChains` holds for that target and family
   * (ba8c0510 0:22: Freezing Trap after two Saps). Nothing is said for a
   * family the DR table does not know. */
  function ccImmuneByDr(
    target: ICombatUnit,
    missSpellId: string,
    missMs: number,
  ): string | undefined {
    const category = getDRCategory(missSpellId);
    if (category.startsWith("spell:") || category === "Unknown")
      return undefined;
    const history = (outgoingCCChains ?? [])
      .filter((chain) => chain.targetName === target.name)
      .flatMap((chain) => chain.applications)
      .filter((app) => app.drInfo?.category === category)
      .map((app) => ({
        applyMs: matchStartMs + app.atSeconds * 1000,
        removeMs: matchStartMs + (app.atSeconds + app.durationSeconds) * 1000,
        spellId: app.spellId,
      }))
      .sort((a, b) => a.applyMs - b.applyMs);
    return getDRLevel(history, missMs).level === "Immune"
      ? `DR: ${category} Immune`
      : undefined;
  }

  /**
   * The other ways an owner CC fails to land on a unit (2026-09-25): the game
   * reports MISS, REFLECT, PARRY, DODGE, EVADE or DEFLECT in the same
   * `SPELL_MISSED` stream as IMMUNE, and without a tag the cast line reads
   * exactly like a landed CC — "Intimidating Shout → 5(HPaladin)" when the
   * Shout missed the paladin (MISS, AOE), next to a [CC BOOKMARK] saying the
   * healer was not CC'd. Season sample (1 file in 60): MISS 397, REFLECT 60,
   * PARRY/DODGE 17 against IMMUNE 1,866. ABSORB alone does not establish a
   * failed control (it reports the CC's damage part) and is ignored.
   * Each miss names its unit — an AoE CC can miss one target and land on
   * another — and is consumed once. Attributed like the IMMUNE tag
   * (`missBelongsToCast`). Ground truth, same sample: after a MISS / REFLECT /
   * PARRY / DODGE the caster's CC aura appeared on that target within 0.5 s
   * 0 / 474 times; after an ABSORB, 957 / 1,072 (89 %).
   */
  const OWNER_CC_MISS_WORD: Record<string, string> = {
    MISS: "MISSED",
    REFLECT: "REFLECTED by",
    PARRY: "PARRIED by",
    DODGE: "DODGED by",
    EVADE: "EVADED by",
    DEFLECT: "DEFLECTED by",
  };
  const consumedCcMisses = new Set<unknown>();
  function ownerCcMissTag(spellId: string, castTimeSeconds: number): string {
    return ccMissTagFor(owner, spellId, castTimeSeconds);
  }
  // cc-dr F-NE1 (codex 35-CD-07: one helper for both owner-CC emitters —
  // the cooldown ledger (ownerCd) and the cast gap-filler): the owner and
  // the owner's summons (a Hunter's pet applies
  // Intimidation's stun) — whose aura on the target counts as the cast's
  const ownCcSources = new Set<string>([
    owner.id,
    ...(allUnits ?? []).filter((u) => u.ownerId === owner.id).map((u) => u.id),
  ]);
  function ownerNoCcAuraTag(spellId: string, castTimeSeconds: number): string {
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const ev = owner.spellCastEvents.find(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId &&
        Math.abs(e.logLine.timestamp - castMs) <= 1,
    );
    if (!ev) return "";
    const dest = (enemies ?? []).find((u) => u.id === ev.destUnitId);
    const t0 = ev.logLine.timestamp;
    const inWindow = (ms: number) => ms >= t0 - 100 && ms <= t0 + 2500;
    const own = castAndEffectIds(spellId);
    const landedOn = (u: ICombatUnit) =>
      (u.auraEvents ?? []).some(
        (x) =>
          ownCcSources.has(x.srcUnitId) &&
          x.spellId !== undefined &&
          (ccSpellIds.has(x.spellId) || own.has(x.spellId)) &&
          (x.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
            x.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
          inWindow(x.timestamp),
      );
    const missedOn = (u: ICombatUnit) =>
      (owner.missesOut ?? []).some(
        (m) => m.destUnitId === u.id && inWindow(m.timestamp),
      );
    if (!dest) {
      // FT-T14: an un-aimed area control (the `AOE_CC_SPELL_IDS` the cast
      // line lists landings for) that put its aura on NO enemy player and
      // logged no miss on one says so. The line used to be bare, the same
      // text as a landing nobody listed — 5677ba13 1:09 Psychic Scream:
      // the log has two IMMUNE misses, a Death Knight's ghoul and his Lord
      // of the Dead, and no player. Same window and aura test as the aimed
      // case below; a pet's IMMUNE stays unsaid (the 2026-09-30 rule in
      // `ccImmuneTagFor`). Any other un-aimed cast has no unit to read.
      // A listed area control (its own id or one of its effect auras —
      // Shockwave 46968 stuns with 132168) whose control lands with the
      // cast. Sigil of Misery arms for about 2 s, too close to the window's
      // end to call an absence: `AOE_CC_DELAYED_CAST_IDS` keep a bare line.
      if (
        AOE_CC_DELAYED_CAST_IDS.has(spellId) ||
        ![...own].some((id) => AOE_CC_SPELL_IDS.has(id))
      )
        return "";
      const players = enemies ?? [];
      if (players.length === 0) return "";
      // Only THIS cast's own aura / miss ids count here (the aimed case
      // below accepts any control aura and any miss on its one target): a
      // Fear landing a second later, or a DoT tick a shield absorbed (a
      // SPELL_MISSED too), on one of three enemies is not this cast's
      // landing — 36 of the 101 such lines of the 605-file capture stayed
      // bare that way.
      const ownIn = (id: string | undefined, ms: number) =>
        id !== undefined && own.has(id) && inWindow(ms);
      const touched = players.some(
        (u) =>
          (u.auraEvents ?? []).some(
            (x) =>
              ownCcSources.has(x.srcUnitId) &&
              (x.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
                x.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
              ownIn(x.spellId, x.timestamp),
          ) ||
          (owner.missesOut ?? []).some(
            (m) => m.destUnitId === u.id && ownIn(m.spellId, m.timestamp),
          ),
      );
      return touched ? "" : ` ${OWNER_AOE_CC_NO_PLAYER_TAG}`;
    }
    // an aimed cast at an enemy player
    if (landedOn(dest)) return "";
    return missedOn(dest) ? "" : " [no CC aura logged]";
  }

  // cc-dr F-TM1 (ruling A53, 2026-09-30): the same tag on a teammate's
  // `[TEAM] [CC]` line, from that unit's own SPELL_MISSED stream, with the
  // cause looked up for that caster. A miss's id is the cast's own or one of
  // its effect auras (F-E25b: Maim's MISS logged under its stun 203123).
  // IMMUNE never comes here — `ccImmuneTagFor` owns it.
  function ccMissTagFor(
    unit: ICombatUnit,
    spellId: string,
    castTimeSeconds: number,
  ): string {
    const misses = unit.missesOut;
    if (!misses || misses.length === 0) return "";
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const family = castAndEffectIds(spellId);
    const parts: string[] = [];
    for (const m of misses) {
      const word = m.missType ? OWNER_CC_MISS_WORD[m.missType] : undefined;
      if (
        !word ||
        m.spellId === undefined ||
        !family.has(m.spellId) ||
        consumedCcMisses.has(m) ||
        !missBelongsToCast(unit, spellId, castMs, m.timestamp)
      )
        continue;
      consumedCcMisses.add(m);
      // By GUID: a pet target renders as "X's pet" / "[pet]", never its raw
      // (possibly localized) name (codex astra: `[MISSED on 恶魔卫士]`).
      const who = actorLabel(m.destUnitName, "enemy", m.destUnitId);
      // The cause, when the shared avoidance sweep found one for THIS cast
      // (the enemy summary's ccAvoidedInstances — the predicate behind
      // [CC AVOIDED?]): same caster, same spell, same cast time. 105 of 204
      // tags on the 605-file slice were Holy Priests (Phase Shift).
      const avoided = enemyCCSummaries
        ?.find((x) => x.playerName === m.destUnitName)
        ?.ccAvoidedInstances?.find(
          (a) =>
            a.sourceName === unit.name &&
            a.spellId === spellId &&
            Math.abs(a.atSeconds - castTimeSeconds) < 0.01,
        );
      const cause = avoided ? ` — ${avoided.avoidanceSpellName} was up` : "";
      parts.push(
        word === "MISSED"
          ? ` [MISSED on ${who}${cause}]`
          : ` [${word} ${who}${cause}]`,
      );
    }
    // one cast can log the same failure twice — under its cast id and its
    // effect id (95127ab4: Maim 22570 and its stun 203123, 4 ms apart): say
    // it once
    return [...new Set(parts)].join("");
  }

  /**
   * `[EMPOWER L?]` on the owner's empowered casts (Evoker). The release level
   * is the whole difference between a tap and a full charge — Dream Breath in
   * the S2 archive releases at L1 87% of the time (774 L1 / 20 L2 / 104 L3) —
   * and without this tag every release renders identically, so the model
   * cannot connect "the big AoE heal did nothing" to "it was tapped at L1".
   * The tag states the fact only; whether L1 was right (Flameshaper tap-spam
   * is a real style) is the model's call, not an accusation baked in here.
   *
   * The END is matched to the press by spellId within ±1.5s, each END
   * consumed once. KNOWN GAP (docs/predicate-index.md "Not yet unified"): the
   * press's SPELL_CAST_SUCCESS is logged when the hold STARTS, the END when it
   * is released, so this window reaches a tap and misses a full charge held
   * longer than 1.5 s.
   *
   * `[EMPOWER not released — cut short after Ns]` (triage other F-O6): a hold
   * that ended in SPELL_EMPOWER_INTERRUPT released nothing, yet its
   * SPELL_CAST_SUCCESS — the press, logged at SPELL_EMPOWER_START — rendered
   * exactly like a release. The tag does NOT say "interrupted": the log writes
   * that event for every hold that did not release, and on the 60-file library
   * only 20 of 35 coincide with an enemy CC or kick (the rest: moved, or let
   * go before the first rank). The cause, when there is one, is on the
   * timeline's own [CC ON TEAM] / kick line at that second.
   * Read from `empowerSpans` (the predicate occupancyWithin counts
   * the hold with), matched on the START instant and checked BEFORE the END
   * lookup: an interrupted press followed by a quick re-press must not take
   * the second press's END.
   */
  const consumedEmpowerEnds = new Set<unknown>();
  const ownerInterruptedEmpowers = (empowerSpans(owner) ?? []).filter(
    (s) => s.interrupted,
  );
  const consumedEmpowerInterrupts = new Set<unknown>();
  function ownerEmpowerTag(spellId: string, castTimeSeconds: number): string {
    const ends = owner.empowerEnds;
    const castMs = matchStartMs + castTimeSeconds * 1000;
    const cut = ownerInterruptedEmpowers.find(
      (s) =>
        s.spellId === spellId &&
        !consumedEmpowerInterrupts.has(s) &&
        Math.abs(s.startMs - castMs) <= EMPOWER_PRESS_MATCH_MS,
    );
    if (cut) {
      consumedEmpowerInterrupts.add(cut);
      return ` [EMPOWER not released — cut short after ${((cut.endMs - cut.startMs) / 1000).toFixed(1)}s]`;
    }
    if (!ends || ends.length === 0) return "";
    const end = ends.find(
      (e) =>
        e.spellId === spellId &&
        !consumedEmpowerEnds.has(e) &&
        Math.abs(e.timestamp - castMs) <= 1500,
    );
    if (!end) return "";
    consumedEmpowerEnds.add(end);
    return ` [EMPOWER L${end.level}]`;
  }

  function getCDTargetAndVelocityPart(
    spellId: string,
    rawTimeSeconds: number,
    targetName: string | undefined,
    forceSelf = false,
  ): string {
    // HP on a press line is the HP AT THE PRESS (`hpAtPress`), just before the
    // press's own heal — user ruling 2026-09-30 (triage A21, hp-state F-R8),
    // the signed exception to the whole-second grid: the `[STATE]` tick of the
    // displayed second can read differently, the legend says so and the gate
    // exempts `PRESS_HP_LINE_TAGS`. Every number this helper prints (HP,
    // velocity, the 2 s DPS window) is anchored on that one instant, so a line
    // never mixes two.
    const castMs = matchStartMs + Math.round(rawTimeSeconds * 1000);
    const press = { spellId, srcUnitId: owner.id };
    // B112/B127: self-only defensives (Obsidian Scales, Divine Shield, Ice Block, …) log whatever
    // unit the caster was targeting — often an enemy — as their "target". forceSelf overrides that so
    // the line renders (self) with the caster's own HP, never "→ <enemy>" with that enemy's HP.
    const isSelf =
      forceSelf ||
      !targetName ||
      targetName === "nil" ||
      targetName === owner.name ||
      targetName.split("-")[0] === owner.name.split("-")[0];
    // F139: no owner fallback — it printed the CASTER's own HP as if it were the target's
    // whenever the dest unit wasn't found by exact name.
    const targetUnit = isSelf
      ? owner
      : _allUnits.find((u) => u.name === targetName);

    // H9: the HP-velocity / incoming-DPS trajectory is defensive context (was this ally
    // dying?). It is meaningless — and misleading — for an offensive CD cast on an enemy
    // (e.g. Maim, which is not in ccSpellIds), so skip it when the target is hostile.
    const targetIsEnemy =
      !isSelf && targetUnit?.reaction === CombatUnitReaction.Hostile;

    let velocityStr = "";
    if (targetUnit && !targetIsEnemy && !ccSpellIds.has(spellId)) {
      const hpNow = hpAtPress(targetUnit, castMs, press);
      const hpBefore = getUnitHpAtTimestamp(
        targetUnit,
        castMs - 2000,
        HP_SAMPLE_RADIUS_MS,
      );

      // Preceding 2-second lookback window for incoming DPS
      const fromMs = castMs - 2000;
      const toMs = castMs;
      const incomingDpsK = Math.round(
        sumIncomingPressure(targetUnit, fromMs, toMs, rosterSides) / 2 / 1000,
      );

      if (hpNow !== null && hpBefore !== null) {
        const perSec = (hpNow - hpBefore) / 2;
        const sign = perSec > 0 ? "+" : "";
        velocityStr = `, ${sign}${perSec.toFixed(0)}%/s, ${incomingDpsK}k DPS`;
      } else {
        velocityStr = `, ${incomingDpsK}k DPS`;
      }
    }

    let targetPart = "";
    if (isTeamHealCD(spellId) && (isSelf || targetIsEnemy)) {
      // B136: team-wide healing CDs (Divine Hymn, Restoral, Rewind, Tranquility, …) have no single
      // target, so this line would otherwise render the CASTER's own HP — usually ~100%, which the
      // model reads as a "premature" cast. Show the lowest-HP ally at cast time instead: that is the
      // context these CDs are judged on.
      let lowUnit: ICombatUnit | undefined;
      let lowHp = Infinity;
      for (const u of _allUnits) {
        if (
          u.type !== CombatUnitType.Player ||
          u.reaction !== CombatUnitReaction.Friendly
        )
          continue;
        const hp = hpAtPress(u, castMs, press);
        if (hp !== null && hp < lowHp) {
          lowHp = hp;
          lowUnit = u;
        }
      }
      if (lowUnit) {
        targetPart = ` (team; lowest ally ${lowHp.toFixed(0)}% HP on ${pid(lowUnit.name)})`;
      } else {
        const hpNow = hpAtPress(owner, castMs, press);
        if (hpNow !== null)
          targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    } else if (!isSelf && targetName !== undefined) {
      // F139: resolve by the target's actual reaction — pid() only knows friendlies, so an
      // offensive CD/CC target (an enemy) rendered as a raw name, or as the WRONG friendly id
      // when both teams had a player with the same display name.
      const shortTarget = targetName.split("-")[0];
      const resolved = targetUnit
        ? targetUnit.reaction === CombatUnitReaction.Hostile
          ? enemyPid(targetName)
          : pid(targetName)
        : shortTarget;
      // Totem/pet/NPC targets resolve through the pid fallback to their log
      // name, which is client-localized (localized Grounding Totem leak, locale audit). Known
      // critical NPCs get their English name via npcId; anything else
      // non-ASCII is suppressed. ASCII English names still pass through.
      const npcEnglish = targetUnit
        ? CRITICAL_NON_PLAYER_NPC_NAMES[getNpcIdFromGuid(targetUnit.id) ?? ""]
        : undefined;
      const targetLabel = [...resolved].some((c) => c.charCodeAt(0) > 127)
        ? (npcEnglish ?? "[pet/NPC]")
        : resolved;
      targetPart = ` → ${targetLabel}`;
      const hpPct = targetUnit
        ? hpAtPress(targetUnit, castMs, press)?.toFixed(0)
        : undefined;
      if (hpPct !== undefined || velocityStr !== "") {
        targetPart += ` (${hpPct ?? "?"}% HP${velocityStr})`;
      }
    } else if (velocityStr !== "") {
      const hpNow = hpAtPress(owner, castMs, press);
      if (hpNow !== null) {
        targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    }
    return targetPart;
  }

  const snapshotFn = buildResourceSnapshot;
  // [RES] only (user ruling 2026-09-26, round 3 N14): the owner's kick (own
  // or pet) and Death Grip sit under MIN_CD_SECONDS and never entered the
  // ledger; they join the [RES] line and nothing else (resUtilityCds.ts).
  const resOwnerCDs = [...ownerCDs, ...ownerResUtilityCds(owner, matchStartMs)];

  const matchEndSeconds = (matchEndMs - matchStartMs) / 1000;
  // GH #119: the round the aura-evidenced bursts are read over (the same
  // bounds reconstructEnemyCDTimeline uses)
  const roundBounds = { startTime: matchStartMs, endTime: matchEndMs };

  let nextPlaceholderId = 0;
  function requestSnapshotPlaceholder(
    timeSeconds: number,
    forceFull = false,
    bypassDebounce = false,
    deathOfUnitId?: string,
    keepFollowing = false,
  ): DeferredSnapshot {
    return {
      type: "resource_snapshot",
      timeSeconds,
      forceFull,
      bypassDebounce,
      ...(deathOfUnitId ? { deathOfUnitId } : {}),
      ...(keepFollowing ? { keepFollowing } : {}),
      id: nextPlaceholderId++,
    };
  }

  // exported: returned to the caller (GH #116)
  return {
    owner,
    ownerSpec,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    dispelSummary,
    enemyDispelSummary,
    enemyCCSummaries,
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    healingGaps,
    friends,
    enemies,
    allUnits,
    matchStartMs,
    matchEndMs,
    isHealer,
    playerIdMap,
    enemyIdMap,
    outgoingCCChains,
    bracket,
    stasisEvents,
    shapeshiftIntervals,
    spiritOfRedemptionIntervals,
    criticalWindowSet,
    crisisAnchorSeconds,
    counterfactualOf,
    burstWindows,
    cdPriorEpisodes,
    cdPriorCohort,
    stackedDefensives,
    rawStreams,
    allPlayers,
    manaFallback,
    matchDurationS,
    enemyBuffIntervals,
    _allUnits,
    summonOwners,
    rosterSides,
    unitNames,
    manaCooldownNote,
    groundingAbsorbNote,
    pid,
    avoidanceSourceTag,
    friendlyPid,
    enemyPid,
    actorLabel,
    resolveTarget,
    enemyCcDrTag,
    outgoingDrTag,
    ownerCcImmuneTag,
    ccImmuneTagFor,
    ownerCcMissTag,
    ownerNoCcAuraTag,
    ccMissTagFor,
    ownerEmpowerTag,
    getCDTargetAndVelocityPart,
    snapshotFn,
    resOwnerCDs,
    matchEndSeconds,
    roundBounds,
    requestSnapshotPlaceholder,
  };
}
