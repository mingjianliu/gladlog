import { ICombatUnit } from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "../utils/buffDuration";
import { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  cdAvailableAt,
  cdChargesReadyAt,
  cdIsProcOnly,
  cdLatestRemainingSeconds,
  cdMaybeAvailableAt,
  cdNeverSpent,
  cdSecondsUntilReady,
  IMajorCooldownInfo,
  lockCastsOf,
  pressSpentBy,
  specToString,
} from "../utils/cooldowns";
import { positionalWallReach } from "../utils/deathOutcomeAnalysis";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import { sumIncomingPressure } from "../utils/incomingPressure";
import { toRenderSecond } from "../utils/renderGrid";
import { affordableAt, type ManaFallback } from "../utils/resourceAt";
import type { RosterSides } from "../utils/rosterSide";
import { getPvpToolkit } from "../utils/talentBehaviors";
import { isDeadAt } from "../utils/unitDeath";

// F169: number of friendly units with an active Atonement (194384) at a given time. Disc Priest
// healing scales with Atonement count, so this is a core throughput signal for the spec.
export function countActiveAtonements(
  friends: (ICombatUnit | undefined)[],
  atMs: number,
): number {
  let count = 0;
  for (const f of friends) {
    if (!f) continue;
    let active = false;
    for (const a of f.auraEvents) {
      if (a.timestamp > atMs) break;
      if (a.spellId === "194384") {
        if (
          a.logLine.event === "SPELL_AURA_APPLIED" ||
          a.logLine.event === "SPELL_AURA_REFRESH"
        )
          active = true;
        else if (a.logLine.event === "SPELL_AURA_REMOVED") active = false;
      }
    }
    if (active) count++;
  }
  return count;
}

// ── Timeline prompt builders ───────────────────────────────────────────────

/**
 * Formats the PLAYER LOADOUT section for the raw timeline prompt.
 * Lists all major CDs (≥30s) available to each player; a CD never cast the whole
 * match is tagged [UNUSED] (R2 regression fix — the explicit never-used signal the
 * old pipeline carried as "STATUS: NEVER USED"). Cast timings still live in the timeline.
 *
 * Returns both the formatted text and a playerIdMap (name → numeric ID, 1-based)
 * for use in buildMatchTimeline to compress player names to short IDs.
 */
export function buildPlayerLoadout(
  owner: ICombatUnit,
  ownerSpec: string,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: Array<{
    player: ICombatUnit;
    spec: string;
    cds: IMajorCooldownInfo[];
  }>,
  enemyCDTimeline: IEnemyCDTimeline,
  enemies?: ICombatUnit[],
  /**
   * Enemy kit (same source as the friendly side: `extractMajorCooldowns`,
   * filtered by talents). When supplied, the enemy `<cooldowns>` use the same
   * format and the same `[UNUSED]` semantics as the friendly ones; when
   * omitted (older call sites / fixtures) it falls back to the old behavior of
   * listing only what was actually cast this match.
   */
  enemyCooldowns?: Array<{ player: ICombatUnit; cds: IMajorCooldownInfo[] }>,
  /** The round, in log ms — what "this round" means for a started cast
   * (`[UNUSED — started N×…]`): the units keep lines from after it. */
  roundMs?: { startTime: number; endTime: number },
): {
  text: string;
  playerIdMap: Map<string, number>;
  friendlyIdMap: Map<string, number>;
  enemyIdMap: Map<string, number>;
} {
  const lines: string[] = [];
  lines.push("<player_loadout>");
  // Talent-ownership guard note (issue #8 / BACKLOG #23-1). The kits below are
  // already filtered to spells there is evidence the player HAS this round
  // (extractMajorCooldowns: talent selection / PvP talents / cast evidence),
  // and DEATHS WITH MISSED OPTIONS is gated by the same talentOwnershipOf
  // predicate — but a menu-level gate alone can be bypassed by class theory
  // in the model's own head (bare-fact bypass lesson, 8fba412 precedent), so
  // the semantics are stated in-band where the kit is rendered.
  lines.push(
    "  NOTE: each unit's kit below lists only abilities there is evidence this player actually has THIS round (talent selection, PvP talents, casts, or a defensive every player of that spec owns without a talent). Do not base coaching on class/spec abilities absent from these lists — talents differ per player and, in Solo Shuffle, per round.",
  );

  // Use separate maps to prevent a friendly and enemy sharing a display name from
  // overwriting each other's ID entry.  The combined playerIdMap returned uses a
  // "friendly:name" / "enemy:name" internal key that pid() resolves correctly.
  const friendlyIdMap = new Map<string, number>();
  const enemyIdMap = new Map<string, number>();
  let nextId = 1;

  // R2 (E2E regression fix): tag major cooldowns never used all match with
  // [UNUSED]. The old pipeline had an explicit "STATUS: NEVER USED"
  // (owner-only); the timeline loadout previously listed cooldowns without
  // marking unused ones, leaving the model to infer it implicitly from "the
  // spell never appears in the timeline". This tags owner and teammates
  // uniformly.
  // 没有按键的能力印 `[PASSIVE]` 而不是 `[UNUSED]`(`PROC_ONLY_ACTIVATION_IDS`)。
  // 光把候选门关上不够 —— 2026-08-01 的教训是「门只挡菜单,loadout 里的裸事实照样
  // 诱导模型」:候选层已经不再指控复苏烈焰,但只要这里还写着 [UNUSED],模型完全
  // 可以自己写出「你整局没用复苏烈焰」。实测这一行在归档 120 文件里出现 44 次
  // (治疗/DPS 两侧各 44)。用户 2026-08-23 裁定它是被动技能。
  // GH #103 A5: a Defensive cooldown also states how long its effect lasts
  // (`buffFullDurationForCaster`, the buff-duration single source, talents of
  // the holder included). Without it the responder invented coverage — "Life
  // Cocoon covers exactly the 0:47–0:54 lockout" with no duration anywhere in
  // the prompt. No duration known → nothing rendered.
  const lastsPart = (cd: IMajorCooldownInfo, caster?: ICombatUnit): string => {
    if (cd.tag !== "Defensive") return "";
    const d = buffFullDurationForCaster(cd.spellId, caster);
    return d !== undefined && d > 0
      ? `, lasts ${Math.round(d * 10) / 10}s`
      : "";
  };
  // FT-T06: "never spent" is not "never tried". A cast bar that was started
  // and never finished (kicked, cancelled, CC'd) is in the log —
  // SPELL_CAST_START with no SPELL_CAST_SUCCESS — and the bare [UNUSED] read
  // as "did not think of it" (24b6a229, 3306e8ee, 7d1f14af: Hex started once
  // or twice, kicked). A press the game rejected (SPELL_CAST_FAILED) is not
  // kept per unit by the parser, so an instant that was pressed and refused
  // still reads [UNUSED].
  const triedNote = (cd: IMajorCooldownInfo, caster?: ICombatUnit): string => {
    // inside the round only, as the cooldown ledger's casts are — a Shuffle
    // round's units keep the lines that follow it (codex review: a Hex
    // started and finished after the round read "never finished")
    const starts = (caster?.castStartEvents ?? []).filter(
      (e) =>
        e.spellId === cd.spellId &&
        (roundMs === undefined ||
          (e.logLine.timestamp >= roundMs.startTime &&
            e.logLine.timestamp <= roundMs.endTime)),
    ).length;
    return starts > 0 ? ` — started ${starts}×, never finished` : "";
  };
  const fmtCDLabel = (cd: IMajorCooldownInfo, caster?: ICombatUnit) =>
    // a proc-only entry's "charges" are inferred from how often it procced
    // (Radiant Glory's Avenging Wrath every Wake of Ashes → "2 Charges"), not
    // something the player holds — not printed (GH #106 step 2)
    // FT-T06: an entry with no button (`isProcOnly`: a talent replaced it by
    // a passive, or a registered proc) has no cooldown the player waits for
    // either — `[60s] [PASSIVE]` on an Avenging Wrath that comes with every
    // Wake of Ashes read as a 60 s cooldown. 605-file capture: 1,468 kit
    // entries printed seconds in front of [PASSIVE]; none does now.
    cd.isProcOnly
      ? `${cd.spellName} [PASSIVE]`
      : `${cd.spellName} [${cd.cooldownSeconds}s${(cd.charges ?? 1) > 1 && !cdIsProcOnly(cd) ? `, ${cd.charges} Charges` : ""}${lastsPart(cd, caster)}]${
      cdIsProcOnly(cd)
        ? " [PASSIVE]"
        : cdNeverSpent(cd)
          ? ` [UNUSED${triedNote(cd, caster)}]`
          : ""
    }`;

  const ownerId = nextId++;
  friendlyIdMap.set(owner.name, ownerId);
  friendlyIdMap.set(owner.name.split("-")[0], ownerId);
  const ownerCDStr =
    ownerCDs.length > 0
      ? ownerCDs.map((cd) => fmtCDLabel(cd, owner)).join(", ")
      : "none tracked";

  lines.push(
    `  <unit id="${ownerId}" name="${owner.name}" spec="${ownerSpec}" role="log owner">`,
  );
  lines.push(`    <cooldowns>${ownerCDStr}</cooldowns>`);
  // B139: surface the owner's talent-granted PvP toolkit (CC / immunity / dispel / mobility tools) so the
  // coach can judge usage — a castable tool never used in the match is tagged [UNUSED].
  const ownerCastIds = new Set<string>();
  for (const e of owner.spellCastEvents ?? []) {
    if (e.spellId) ownerCastIds.add(e.spellId);
  }
  const toolkit = getPvpToolkit(owner.info?.pvpTalents, ownerCastIds);
  if (toolkit.length > 0) {
    const toolkitStr = toolkit
      .map((t) => (t.used === false ? `${t.label} [UNUSED]` : t.label))
      .join(", ");
    lines.push(`    <pvp_toolkit>${toolkitStr}</pvp_toolkit>`);
  }
  lines.push("  </unit>");

  for (const { player, spec, cds } of teammateCDs) {
    const cdStr =
      cds.length > 0
        ? cds.map((cd) => fmtCDLabel(cd, player)).join(", ")
        : "none tracked";
    const pid = nextId++;
    friendlyIdMap.set(player.name, pid);
    friendlyIdMap.set(player.name.split("-")[0], pid);
    lines.push(
      `  <unit id="${pid}" name="${player.name}" spec="${spec}" role="teammate">`,
    );
    lines.push(`    <cooldowns>${cdStr}</cooldowns>`);
    lines.push("  </unit>");
  }

  // Prefer extractMajorCooldowns' results for the enemy kit (same source as
  // the friendly side, talent-filtered, carrying [UNUSED]); only fall back to
  // the old "what was cast this match" behavior when nothing is found. See the
  // comment on enemyCooldowns in buildMatchContext.
  const enemyKitByName = new Map<string, IMajorCooldownInfo[]>();
  for (const { player, cds } of enemyCooldowns ?? []) {
    if (cds.length === 0) continue;
    enemyKitByName.set(player.name, cds);
    enemyKitByName.set(player.name.split("-")[0], cds);
  }
  const enemyKitFor = (name: string): IMajorCooldownInfo[] | undefined =>
    enemyKitByName.get(name) ?? enemyKitByName.get(name.split("-")[0]);
  const enemyUnitFor = (name: string): ICombatUnit | undefined =>
    (enemies ?? []).find(
      (e) => e.name === name || e.name.split("-")[0] === name.split("-")[0],
    );

  for (const player of enemyCDTimeline.players) {
    const pid = nextId++;
    enemyIdMap.set(player.playerName, pid);
    enemyIdMap.set(player.playerName.split("-")[0], pid);
    const kit = enemyKitFor(player.playerName);
    // **Union, NOT replacement.** The two paths draw on different catalogs:
    // extractMajorCooldowns goes through classMetadata (talent-filtered,
    // includes never-used), while enemyCDTimeline goes through
    // isOffensiveSpell + spellEffectData (only what was cast this match). What
    // is unique to the former is "cards they never played"; what is unique to
    // the latter is a batch of offensive burst cooldowns (Frozen Orb / Army of
    // the Dead / Shadow Dance / Stormkeeper ...). The first version simply
    // replaced one with the other and measurably lost 1418 entries — precisely
    // the "what burst is coming" half, which matters to a healer's coach just
    // as much as "what has he still got left". On a name collision the kit's
    // value wins (the talent-adjusted cooldown), so the same spell never shows
    // two different cooldown numbers (the lesson of class D, 2026-07-20).
    const kitNames = new Set((kit ?? []).map((c) => c.spellName));
    const observedOnly: string[] = [];
    const seen = new Set<string>();
    for (const cd of player.offensiveCDs) {
      if (kitNames.has(cd.spellName) || seen.has(cd.spellName)) continue;
      seen.add(cd.spellName);
      // an activation of another cooldown's effect has no cooldown of its
      // own to print (Radiant Glory's Avenging Wrath, GH #115)
      // GH #119: a form with neither a press nor a proc source says nothing
      // about a cooldown — "?" rather than claiming a proc
      observedOnly.push(
        cd.availabilityUnknown
          ? `${cd.spellName} [?]`
          : cd.availableAgainAtSeconds === null
            ? `${cd.spellName} [proc]`
            : `${cd.spellName} [${cd.cooldownSeconds}s]`,
      );
    }
    const enemyUnit = enemyUnitFor(player.playerName);
    const parts = [
      ...(kit ?? []).map((cd) => fmtCDLabel(cd, enemyUnit)),
      ...observedOnly,
    ];
    const cdStr = parts.length > 0 ? parts.join(", ") : "none tracked";
    lines.push(
      `  <unit id="${pid}" name="${player.playerName}" spec="${player.specName}" role="enemy">`,
    );
    lines.push(`    <cooldowns>${cdStr}</cooldowns>`);
    lines.push("  </unit>");
  }

  // Assign IDs to any enemy units not already covered by enemyCDTimeline.players
  // (enemies who never cast a tracked offensive CD are absent from the timeline).
  for (const enemy of enemies ?? []) {
    const cleanEnemyName = enemy.name.split("-")[0];
    if (enemyIdMap.has(enemy.name) || enemyIdMap.has(cleanEnemyName)) continue;
    const pid = nextId++;
    enemyIdMap.set(enemy.name, pid);
    enemyIdMap.set(cleanEnemyName, pid);
    const kit = enemyKitFor(enemy.name);
    lines.push(
      `  <unit id="${pid}" name="${enemy.name}" spec="${specToString(enemy.spec)}" role="enemy">`,
    );
    lines.push(
      `    <cooldowns>${kit ? kit.map((cd) => fmtCDLabel(cd, enemy)).join(", ") : "none tracked"}</cooldowns>`,
    );
    lines.push("  </unit>");
  }

  lines.push("</player_loadout>");

  // playerIdMap carries only friendly (owner + teammate) name→ID entries; pid() in
  // buildMatchTimeline / buildResourceSnapshot looks up friendlies here. Enemies are
  // resolved separately via the returned enemyIdMap, so there is no collision risk
  // and enemy entries are deliberately NOT mixed into this map.
  const playerIdMap = new Map<string, number>();
  for (const [name, id] of friendlyIdMap) playerIdMap.set(name, id);

  return { text: lines.join("\n"), playerIdMap, friendlyIdMap, enemyIdMap };
}

// ── buildResourceSnapshot ──────────────────────────────────────────────────

/**
 * Returns the names of all friendly major CDs that are ready (available to cast)
 * at the given timeSeconds. Shared between buildResourceSnapshot and the delta
 * state tracker in buildMatchTimeline.
 */
/**
 * Returns attributed ready CD names: owner CDs as "SpellName", teammate CDs as "pid:SpellName".
 * The `playerLabel` field on each teammateCDs entry supplies the display prefix (numeric pid).
 * B34: attributed names disambiguate same-spec teammates who share spell names.
 */
/**
 * B114: how many charges of a (possibly multi-charge) CD are ready at timeSeconds. A charge is
 * consumed on cast and returns cooldownSeconds later; charges recharge one at a time. Used to show
 * per-charge readiness ([k/N]) so the model does not treat a 2-charge CD as fully spent after one use
 * (Guardian Spirit / Pain Suppression / Grounding Totem / Holy Bulwark) or fully available when a
 * charge is still recharging.
 */
export function chargesReadyCount(
  cd: IMajorCooldownInfo,
  timeSeconds: number,
): number {
  // GH #106 step 3: the talent-resolved charge count and the sequential
  // recharge `cdAvailableAt` runs — the old parallel "last N casts" count on
  // the OBSERVED maximum turned a cooldown combat shortens into fake charges
  // (~21k false [k/2] over 605 files).
  return cdChargesReadyAt(cd, timeSeconds);
}

/**
 * GH #106 step 3: the "(Ns)" of a `cd:` entry. A cooldown combat events
 * shorten (`earliestCooldownSeconds`) is never exactly N s away: it is
 * `(a–Ns)` while even its fastest recast has not come round (certainly on
 * cooldown, a to N s left) and `(≤Ns)` once it has (possibly already back).
 * Everything else keeps the exact `(Ns)`.
 */
function remainingText(cd: IMajorCooldownInfo, timeSeconds: number): string {
  const latest = cdLatestRemainingSeconds(cd, timeSeconds);
  if (cd.earliestCooldownSeconds === undefined) return `${latest}s`;
  if (cdMaybeAvailableAt(cd, timeSeconds)) return `≤${latest}s`;
  const soonest = Math.max(
    1,
    Math.round(
      cdSecondsUntilReady(cd, timeSeconds, cd.earliestCooldownSeconds),
    ),
  );
  return soonest < latest ? `${soonest}–${latest}s` : `${latest}s`;
}

/**
 * B35 delta key of an on-cooldown entry: the name AND the press it is cooling
 * from. With a bare name, a cooldown recast while it sat in the uncertain
 * `(≤Ns)` state stayed "already listed" and the new, longer interval was never
 * printed (codex astra review, GH #106 step 3: Avatar recast at 150 s left the
 * reader on the old "back by 170 s").
 */
function onCdKey(
  displayName: string,
  cd: IMajorCooldownInfo,
  timeSeconds: number,
): string {
  const last = lockCastsOf(cd)
    .filter((c) => pressSpentBy(c.timeSeconds, timeSeconds))
    .reduce((m, c) => Math.max(m, c.timeSeconds), Number.NEGATIVE_INFINITY);
  return `${displayName}@${Math.round(last * 10) / 10}`;
}

/**
 * One cooldown's state on a [RES] line, through the shared predicate
 * (`cdAvailableAt`, GH #106 step 3 — the ledger used to run its own parallel
 * "last N casts" arithmetic on the observed charge maximum). Never pressed →
 * ready, except in the first 5 s (nothing to report yet).
 */
function resStateOf(
  cd: IMajorCooldownInfo,
  timeSeconds: number,
): "ready" | "onCd" | "skip" {
  // A shared-pool press (Spellwarding for Blessing of Protection) counts:
  // the cooldown is running even though X itself was never pressed.
  const pressed = lockCastsOf(cd).some((c) =>
    pressSpentBy(c.timeSeconds, timeSeconds),
  );
  if (!pressed) return timeSeconds > 5 ? "ready" : "skip";
  return cdAvailableAt(cd, timeSeconds) ? "ready" : "onCd";
}

/**
 * Whose deaths the ledger reads (triage res-readiness F-C4): with it, a
 * holder dead before the row's rendered second holds nothing — 539b6ed0's
 * `rdy:` kept a Druid's Incarnation and Stampeding Roar 16 s after he died.
 * Absent (hand-built fixtures) = nobody is dead.
 */
export interface ResHolderDeaths {
  matchStartMs: number;
  ownerUnit?: ICombatUnit;
}

type ResTeammateCds = {
  cds: IMajorCooldownInfo[];
  playerLabel?: string;
  /** the holder, for `ResHolderDeaths` */
  player?: ICombatUnit;
};

/**
 * Every friendly cooldown the [RES] ledger tracks, attributed, with whether
 * its holder is dead at the row — the ONE list `rdy:`, `cd:` and both delta
 * trackers are built from.
 *
 * No button → not on the ledger line at all (GH #106 step 2): "rdy:X" would
 * tell the model the player could press X.
 *
 * `holderDead` is `isDeadAt` (the one dead-at predicate) at the row's rendered
 * second: a death at 67.03 leaves the 1:07 row untouched — that row is how
 * the death block shows what the dying unit held — and empties the holder's
 * entries from 1:08 on.
 */
function friendlyResCds(
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: ResTeammateCds[],
  deaths: ResHolderDeaths | undefined,
): Array<{ displayName: string; cd: IMajorCooldownInfo; holderDead: boolean }> {
  // "dead before the row's second": `isDeadAt` 1 ms before it, so a death at
  // exactly 67.000 keeps the 1:07 row like one at 67.030 (codex review — the
  // shared predicate's own `<=` is unchanged)
  const rowMs =
    deaths === undefined
      ? undefined
      : deaths.matchStartMs + toRenderSecond(timeSeconds) * 1000 - 1;
  const dead = (unit: ICombatUnit | undefined) =>
    rowMs !== undefined && unit !== undefined && isDeadAt(unit, rowMs);
  const ownerDead = dead(deaths?.ownerUnit);
  return [
    ...ownerCDs
      .filter((cd) => !cdIsProcOnly(cd))
      .map((cd) => ({
        displayName: cd.spellName,
        cd,
        holderDead: ownerDead,
      })),
    ...teammateCDs.flatMap(({ cds, playerLabel, player }) => {
      const holderDead = dead(player);
      return cds
        .filter((cd) => !cdIsProcOnly(cd))
        .map((cd) => ({
          displayName: playerLabel
            ? `${playerLabel}:${cd.spellName}`
            : cd.spellName,
          cd,
          holderDead,
        }));
    }),
  ];
}

/**
 * B14a: the [RES] display names of positional cooldowns whose holder stood
 * out of their reach of `outOfReachOf.victim` at that instant
 * (`positionalWallReach` === "out-of-reach": the reach predicate of
 * `positionalWallReaches`, with "no position sample" kept apart; a
 * non-positional cooldown always reaches, the victim's own cooldowns are
 * never listed). `buildResourceSnapshot` drops
 * these from a death row's `rdy:`; the snapshot resolver counts the rows
 * that lost one, for the legend.
 */
export function positionalOutOfReachNames(
  ownerUnit: ICombatUnit | undefined,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: ResTeammateCds[],
  outOfReachOf: { victim: ICombatUnit; atMs: number },
): Set<string> {
  const out = new Set<string>();
  const holders: Array<{
    unit: ICombatUnit | undefined;
    cds: IMajorCooldownInfo[];
    label?: string;
  }> = [
    { unit: ownerUnit, cds: ownerCDs },
    ...teammateCDs.map(({ player, cds, playerLabel }) => ({
      unit: player,
      cds,
      label: playerLabel,
    })),
  ];
  for (const { unit, cds, label } of holders) {
    if (!unit || unit.id === outOfReachOf.victim.id) continue;
    for (const cd of cds)
      // only a KNOWN out-of-reach leaves the row: a missing position sample
      // drops nothing (the row is a fact, and its legend says "stood out of
      // reach" — agy review of the batch: the first cut used the
      // accusation-side predicate, which fails closed)
      if (
        positionalWallReach(
          cd.spellId,
          unit,
          outOfReachOf.victim,
          outOfReachOf.atMs,
        ) === "out-of-reach"
      )
        out.add(label ? `${label}:${cd.spellName}` : cd.spellName);
  }
  return out;
}

export function computeReadyNames(
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: ResTeammateCds[],
  deaths?: ResHolderDeaths,
): string[] {
  const readyNames: string[] = [];
  for (const { displayName, cd, holderDead } of friendlyResCds(
    timeSeconds,
    ownerCDs,
    teammateCDs,
    deaths,
  ))
    if (!holderDead && resStateOf(cd, timeSeconds) === "ready")
      readyNames.push(displayName);
  return readyNames;
}

/**
 * Returns the B35 delta keys (`onCdKey`: attributed display name @ the press
 * it is cooling from) of all CDs currently on cooldown. Mirrors
 * computeReadyNames but returns on-CD entries. Used by the resourceSnapshot
 * closure in buildMatchTimeline to track prevOnCDNamesState for B35 delta
 * suppression — its only consumer, which compares keys, never displays them.
 */
export function computeOnCDDisplayNames(
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: ResTeammateCds[],
  deaths?: ResHolderDeaths,
): string[] {
  const onCDNames: string[] = [];
  for (const { displayName, cd, holderDead } of friendlyResCds(
    timeSeconds,
    ownerCDs,
    teammateCDs,
    deaths,
  ))
    if (!holderDead && resStateOf(cd, timeSeconds) === "onCd")
      onCDNames.push(onCdKey(displayName, cd, timeSeconds));
  return onCDNames;
}
interface ResourceSnapshotParams {
  timeSeconds: number;
  ownerCDs: IMajorCooldownInfo[];
  ownerName: string;
  ownerSpec: string;
  teammateCDs: Array<{
    player: ICombatUnit;
    spec: string;
    cds: IMajorCooldownInfo[];
  }>;
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  enemyCDTimeline: IEnemyCDTimeline;
  playerIdMap?: Map<string, number>;
  /**
   * Ready CD names from the previous snapshot (attributed: "SpellName" for owner, "pid:SpellName" for
   * teammates). When provided, the [RES] line emits a delta form (rdy:Δ+Added,-Removed).
   */
  prevReadyNames?: string[];
  /**
   * On-CD spell display names from the previous snapshot. When provided, [RES] only shows cd: entries
   * for CDs that are NEWLY on cooldown (not present in prevOnCDNames). B35: reduces token bloat.
   */
  prevOnCDNames?: string[];
  matchStartMs?: number;
  ownerUnit?: ICombatUnit;
  /** unit GUID → roster side (`buildRosterSides`), for the focus pick's
   * incoming-pressure read */
  rosterSides?: RosterSides;
  /** the timeline's mana fallback (raw.txt pass) and the round's bounds, for
   * the `(no mana …)` tag on the owner's ready cooldowns (`affordableAt`) */
  manaFallback?: ManaFallback;
  roundBounds?: { startTime: number; endTime: number };
  /**
   * B-tier B14a (user ruling 2026-10-06, "够不着就不列"): the snapshot under
   * a friendly [DEATH]. A POSITIONAL cooldown (`MITIGATION_TABLE`
   * `positional`: Darkness' zone) whose holder stood out of its reach of the
   * dying player at `atMs` is left out of `rdy:` — `positionalWallReach`,
   * the reach predicate cd-hoarded and [DEFENSIVE AVAILABLE] read (A58 /
   * F-MC1) with its third answer kept apart: a missing position sample is
   * "unknown" and drops nothing here (it fails closed on the accusation side).
   * The dying player's own cooldowns are untouched. Only on a full line
   * (no `prevReadyNames`): a delta would print the drop as a spent `-X`.
   */
  outOfReachOf?: { victim: ICombatUnit; atMs: number };
}

export function buildResourceSnapshot({
  timeSeconds: rawTimeSeconds,
  ownerCDs,
  ownerName,
  ownerSpec: _ownerSpec,
  teammateCDs,
  ccTrinketSummaries,
  enemyCDTimeline,
  playerIdMap,
  prevReadyNames,
  prevOnCDNames,
  matchStartMs,
  ownerUnit,
  rosterSides,
  manaFallback,
  roundBounds,
  outOfReachOf,
}: ResourceSnapshotParams): string {
  // Render-grid anchor (CLAUDE.md shared-predicate rule; GH #63, 2026-09-04):
  // callers hand in the cast's fractional instant, but the line is printed
  // next to `fmtTime`'s floored second, so every "(Ns)" / rdy / cd fact here
  // is computed at that floored second — a snapshot at 10.2 s and at 10.0 s
  // are byte-identical (test/context.resourceSnapshot.test.ts pins it). The
  // seam surfaced when Fade (30 s) entered the Discipline ledger through the
  // healer save-CD roster: cast at 3.6 s, remaining read 24 s at 10.0 and
  // 23 s at 10.2.
  const timeSeconds = toRenderSecond(rawTimeSeconds);
  function pid(name: string): string {
    if (!playerIdMap) return name;
    const id = playerIdMap.get(name);
    return id !== undefined ? String(id) : name;
  }

  // ── rdy / cd — B34: attribute teammate CDs with player pid prefix ──────────
  // Owner CDs: plain "SpellName"; teammate CDs: "pid:SpellName"
  const labelledTeammates = teammateCDs.map(({ player, cds }) => ({
    cds,
    player,
    playerLabel: pid(player.name),
  }));
  const deaths: ResHolderDeaths | undefined =
    matchStartMs !== undefined ? { matchStartMs, ownerUnit } : undefined;
  // B14a: positional cooldowns out of reach of the dying friendly
  const outOfReach =
    outOfReachOf && prevReadyNames === undefined
      ? positionalOutOfReachNames(
          ownerUnit,
          ownerCDs,
          labelledTeammates,
          outOfReachOf,
        )
      : new Set<string>();
  const readyNames = computeReadyNames(
    timeSeconds,
    ownerCDs,
    labelledTeammates,
    deaths,
  ).filter((n) => !outOfReach.has(n));

  // Build on-CD display list with player attribution (B34) and delta filtering (B35).
  const onCDParts: string[] = [];
  const prevOnCDSet =
    prevOnCDNames !== undefined ? new Set(prevOnCDNames) : null;

  const everyFriendlyCd = friendlyResCds(
    timeSeconds,
    ownerCDs,
    labelledTeammates,
    deaths,
  );
  // F-C4: a dead holder's entries leave the line without a `-X` — the delta
  // reports cooldowns that were SPENT, and a death is on its own line.
  const deadHolderNames = new Set(
    everyFriendlyCd.filter((x) => x.holderDead).map((x) => x.displayName),
  );
  const allFriendlyCDs = everyFriendlyCd.filter((x) => !x.holderDead);

  // B114: per-charge readiness suffix "[k/N]" for multi-charge CDs, so the model can tell a partly
  // available CD (1/2) from a fully spent one (0/2) or a fully available one (2/2). Only applied to
  // full-form lines below (delta comparison keeps the bare displayName to stay stable).
  const chargeSuffix = new Map<string, string>();
  for (const { displayName, cd } of allFriendlyCDs) {
    if ((cd.charges ?? 1) > 1) {
      const certain = chargesReadyCount(cd, timeSeconds);
      // a combat-shortened cooldown may already hold more (codex astra
      // review, GH #106 step 3: "(≤4s)[0/2]" contradicted itself)
      const most =
        cd.earliestCooldownSeconds === undefined
          ? certain
          : cdChargesReadyAt(cd, timeSeconds, cd.earliestCooldownSeconds);
      chargeSuffix.set(
        displayName,
        most > certain
          ? `[${certain}–${most}/${cd.charges}]`
          : `[${certain}/${cd.charges}]`,
      );
    }
  }

  const currentOnCDNames: string[] = [];
  for (const { displayName, cd } of allFriendlyCDs) {
    if (resStateOf(cd, timeSeconds) !== "onCd") continue;
    const key = onCdKey(displayName, cd, timeSeconds);
    currentOnCDNames.push(key);
    // B35: in delta mode only show CDs that newly went on cooldown (not in previous snapshot).
    if (prevOnCDSet === null || !prevOnCDSet.has(key)) {
      // B114: a multi-charge CD in cd: has 0 charges ready; the "(Ns)" is time to the next charge.
      onCDParts.push(
        `${displayName}(${remainingText(cd, timeSeconds)})${chargeSuffix.get(displayName) ?? ""}`,
      );
    }
  }

  // Triage res-readiness F-C3 (user ruling 2026-09-30, res R2 = A): an owner
  // cooldown that is off cooldown but costs more mana than the owner has at
  // this rendered second stays `rdy` and says so — `X(no mana 6.1k/11.5k)`.
  // Display only: the ready set, the delta keys and `computeReadyNames` are
  // unchanged. `affordableAt` is the one affordability predicate (cd-hoarded
  // F-H6 reads its window form); unknown cost or no reading → no tag.
  const noManaTag = new Map<string, string>();
  if (ownerUnit && matchStartMs !== undefined) {
    const k = (n: number) => `${(n / 1000).toFixed(1)}k`;
    for (const cd of ownerCDs) {
      if (cdIsProcOnly(cd)) continue;
      const a = affordableAt(
        ownerUnit,
        cd.spellId,
        matchStartMs + timeSeconds * 1000,
        manaFallback,
        roundBounds,
      );
      if (a && !a.affordable)
        noManaTag.set(cd.spellName, `(no mana ${k(a.mana)}/${k(a.cost)})`);
    }
  }
  const rdyDisplay = (n: string) => `${n}${noManaTag.get(n) ?? ""}`;

  // ── rdy: — full form first time, delta form on subsequent calls ─────────────
  let rdyPart: string;
  if (prevReadyNames !== undefined) {
    const prevSet = new Set(prevReadyNames);
    const currentSet = new Set(readyNames);
    const added = readyNames.filter((n) => !prevSet.has(n));
    const removed = prevReadyNames.filter(
      (n) => !currentSet.has(n) && !deadHolderNames.has(n),
    );
    // H1: prefix each item with its own +/- sign and space-separate them. The previous
    // `+a,b-c,d` form used a bare '-' as the added/removed boundary, which collided with
    // the hyphens inside spell names (e.g. "Anti-Magic Zone"), making the delta unparseable.
    const parts = [
      ...added.map((n) => `+${rdyDisplay(n)}`),
      ...removed.map((n) => `-${n}`),
    ];
    rdyPart = parts.length > 0 ? `rdy:Δ ${parts.join(" ")}` : "rdy:Δ";
  } else {
    // B114: annotate multi-charge CDs with their ready-charge count in the full ready list.
    const readyDisplay = readyNames.map(
      (n) => `${rdyDisplay(n)}${chargeSuffix.get(n) ?? ""}`,
    );
    rdyPart = `rdy:${readyDisplay.length > 0 ? readyDisplay.join(",") : "—"}`;
  }

  let line = `      [RES] ${rdyPart}  cd:${onCDParts.length > 0 ? onCDParts.join(",") : "—"}`;

  // ── F169: Active Atonement count for Disc Priests ────────────────────────────
  if (
    _ownerSpec === "Discipline Priest" &&
    matchStartMs !== undefined &&
    ownerUnit
  ) {
    const allFriends = [ownerUnit, ...teammateCDs.map((t) => t.player)];
    line += ` | Atonements: ${countActiveAtonements(allFriends, matchStartMs + timeSeconds * 1000)}`;
  }

  // ── enemy: active offensive CDs (omit when empty) ──────────────────────────
  // B116: render each active enemy offensive CD with its REMAINING active duration,
  // counting DOWN as "Ns left". The prior code emitted elapsed-since-cast, which counted
  // UP and was misread near expiry as a freshly-cast / long-active CD (e.g. Avatar shown
  // as (4s)->(15s) growing instead of shrinking). "left" also disambiguates from the
  // friendly cd: field, where (Ns) means "N seconds until the CD is READY again".
  const enemyActiveParts: string[] = [];
  for (const player of enemyCDTimeline.players) {
    for (const cd of player.offensiveCDs) {
      // Shown until its effect ends — `buffEndSeconds`, the burst span's own
      // end (the observed aura chain, else the official duration; triage
      // G16). The old 30 s cap made a chain the log shows running 52 s read
      // "5s left" at 35 s (codex review): no cap. If duration is 0 (instant
      // cast), show it for 8 seconds to ensure AI has context.
      const buffDuration = cd.buffEndSeconds - cd.castTimeSeconds;
      const displayWindowSeconds = buffDuration > 0 ? buffDuration : 8;

      const agoSeconds = timeSeconds - cd.castTimeSeconds;
      if (agoSeconds >= 0 && agoSeconds <= displayWindowSeconds) {
        const remainingSeconds = Math.max(
          1,
          Math.round(displayWindowSeconds - agoSeconds),
        );
        enemyActiveParts.push(
          `${cd.spellName}/${player.specName}(${remainingSeconds}s left)`,
        );
      }
    }
  }

  if (enemyActiveParts.length > 0) {
    line += `  enemy:${enemyActiveParts.join(",")}`;
  }

  // ── F164: Enemy Focus Target ─────────────────────────────────────────────
  // H10: focus is the FRIENDLY unit the enemy team is concentrating damage on.
  // It is a distinct top-level field — NOT glued onto the enemy: field (which lists
  // enemy offensive CDs). Render it with the same `  ` separator as rdy/cd/enemy/cc.
  let focusPart = "";
  if (matchStartMs !== undefined && ownerUnit) {
    let maxDmg = 0;
    let focusFriendName = "";
    const focusLookbackMs = 3000;
    const allFriends = [ownerUnit, ...teammateCDs.map((t) => t.player)].filter(
      Boolean,
    );
    const atMs = matchStartMs + timeSeconds * 1000;
    for (const f of allFriends) {
      const dmg = sumIncomingPressure(
        f,
        atMs - focusLookbackMs,
        atMs,
        rosterSides,
      );
      if (dmg > maxDmg) {
        maxDmg = dmg;
        focusFriendName = f.name;
      }
    }
    // Only flag a focus target if damage was meaningful (> 50k in 3 seconds)
    if (maxDmg > 50000) {
      focusPart = `focus:${pid(focusFriendName)}`;
      line += `  ${focusPart}`;
    }
  }

  // ── cc: (omit when empty) ──────────────────────────────────────────────────
  const summaryByName = new Map(
    ccTrinketSummaries.map((s) => [s.playerName, s]),
  );

  const allFriendlyPlayers: Array<{ name: string }> = [
    { name: ownerName },
    ...teammateCDs.map(({ player }) => ({ name: player.name })),
  ];

  const ccParts: string[] = [];
  for (const { name } of allFriendlyPlayers) {
    const summary = summaryByName.get(name);

    // Hard CC (existing)
    const activeCC = summary?.ccInstances.find(
      (cc) =>
        cc.atSeconds <= timeSeconds &&
        timeSeconds < cc.atSeconds + cc.durationSeconds,
    );
    if (activeCC) {
      const remaining = Math.round(
        activeCC.atSeconds + activeCC.durationSeconds - timeSeconds,
      );
      const isStun = activeCC.drInfo?.category === "Stun";
      const stunTag = isStun ? "[stun]" : "";
      const trinketUsedNow =
        summary?.trinketUseTimes.some((t) => Math.abs(t - timeSeconds) <= 1) ??
        false;
      const trinketTag = isStun && trinketUsedNow ? "[trinketed]" : "";
      ccParts.push(
        `${pid(name)}/${activeCC.spellName}-${remaining}s${stunTag}${trinketTag}`,
      );
    }

    // Root
    const activeRoot = summary?.rootInstances?.find(
      (r) =>
        r.atSeconds <= timeSeconds &&
        timeSeconds < r.atSeconds + r.durationSeconds,
    );
    if (activeRoot) {
      const remaining = Math.round(
        activeRoot.atSeconds + activeRoot.durationSeconds - timeSeconds,
      );
      ccParts.push(`${pid(name)}/${activeRoot.spellName}-${remaining}s[root]`);
    }

    // Disarm
    const activeDisarm = summary?.disarmInstances?.find(
      (d) =>
        d.atSeconds <= timeSeconds &&
        timeSeconds < d.atSeconds + d.durationSeconds,
    );
    if (activeDisarm) {
      const remaining = Math.round(
        activeDisarm.atSeconds + activeDisarm.durationSeconds - timeSeconds,
      );
      ccParts.push(
        `${pid(name)}/${activeDisarm.spellName}-${remaining}s[disarm]`,
      );
    }

    // Kick lockout
    const activeKick = summary?.interruptInstances?.find(
      (k) =>
        k.atSeconds <= timeSeconds &&
        timeSeconds < k.atSeconds + k.lockoutDurationSeconds,
    );
    if (activeKick) {
      const remaining = Math.round(
        activeKick.atSeconds + activeKick.lockoutDurationSeconds - timeSeconds,
      );
      ccParts.push(
        `${pid(name)}/${activeKick.kickSpellName}-${remaining}s[kick]`,
      );
    }
  }

  if (ccParts.length > 0) {
    line += `  cc:${ccParts.join(",")}`;
  }

  // Suppress empty lines that contribute no information. focusPart is now a separate
  // field (H10), so it must be considered here too — a line carrying only a focus
  // target still conveys information and must not be suppressed.
  const isRdyEmpty = rdyPart === "rdy:Δ" || readyNames.length === 0;
  if (
    isRdyEmpty &&
    onCDParts.length === 0 &&
    enemyActiveParts.length === 0 &&
    focusPart === "" &&
    ccParts.length === 0
  ) {
    return "";
  }

  return line;
}
