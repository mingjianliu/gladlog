import { ICombatUnit } from "@gladlog/parser-compat";

import { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  CD_INSTANT_SLACK_S,
  IMajorCooldownInfo,
  isProcOnlyActivation,
  specToString,
} from "../utils/cooldowns";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import { sumIncomingPressure } from "../utils/incomingPressure";
import { toRenderSecond } from "../utils/renderGrid";
import { getPvpToolkit } from "../utils/talentBehaviors";

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
    "  NOTE: each unit's kit below lists only abilities there is evidence this player actually has THIS round (talent selection, PvP talents, or casts). Do not base coaching on class/spec abilities absent from these lists — talents differ per player and, in Solo Shuffle, per round.",
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
  const fmtCDLabel = (cd: IMajorCooldownInfo) =>
    `${cd.spellName} [${cd.cooldownSeconds}s${cd.maxChargesDetected > 1 ? `, ${cd.maxChargesDetected} Charges` : ""}]${
      isProcOnlyActivation(cd.spellId)
        ? " [PASSIVE]"
        : cd.neverUsed
          ? " [UNUSED]"
          : ""
    }`;

  const ownerId = nextId++;
  friendlyIdMap.set(owner.name, ownerId);
  friendlyIdMap.set(owner.name.split("-")[0], ownerId);
  const ownerCDStr =
    ownerCDs.length > 0 ? ownerCDs.map(fmtCDLabel).join(", ") : "none tracked";

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
      cds.length > 0 ? cds.map(fmtCDLabel).join(", ") : "none tracked";
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
      observedOnly.push(`${cd.spellName} [${cd.cooldownSeconds}s]`);
    }
    const parts = [...(kit ?? []).map(fmtCDLabel), ...observedOnly];
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
      `    <cooldowns>${kit ? kit.map(fmtCDLabel).join(", ") : "none tracked"}</cooldowns>`,
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
  const maxCharges = cd.maxChargesDetected > 1 ? cd.maxChargesDetected : 1;
  // ≤ t+0.5: a cast in the same rendered second counts as already consumed —
  // a [RES] block under a [CD] line must reflect the state AFTER that line's
  // cast, not before it (RES-lag defect, Gemini adversarial review 2026-07-15;
  // the old `< t − 0.5` guard made every snapshot stale by exactly the event
  // it was attached to). Same boundary at every priorCasts site in this file.
  const priorCasts = cd.casts.filter(
    (c) => c.timeSeconds <= timeSeconds + CD_INSTANT_SLACK_S,
  );
  if (priorCasts.length === 0) return maxCharges;
  const recent = priorCasts.slice(-maxCharges);
  const stillRecharging = recent.filter(
    (c) =>
      c.timeSeconds + cd.cooldownSeconds > timeSeconds + CD_INSTANT_SLACK_S,
  ).length;
  return Math.max(0, maxCharges - stillRecharging);
}

export function computeReadyNames(
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: Array<{ cds: IMajorCooldownInfo[]; playerLabel?: string }>,
): string[] {
  const readyNames: string[] = [];
  const allFriendlyCDs: Array<{ displayName: string; cd: IMajorCooldownInfo }> =
    [
      ...ownerCDs.map((cd) => ({ displayName: cd.spellName, cd })),
      ...teammateCDs.flatMap(({ cds, playerLabel }) =>
        cds.map((cd) => ({
          displayName: playerLabel
            ? `${playerLabel}:${cd.spellName}`
            : cd.spellName,
          cd,
        })),
      ),
    ];
  for (const { displayName, cd } of allFriendlyCDs) {
    const priorCasts = cd.casts.filter(
      (c) => c.timeSeconds <= timeSeconds + CD_INSTANT_SLACK_S,
    );
    if (priorCasts.length === 0) {
      if (timeSeconds > 5) readyNames.push(displayName);
      continue;
    }
    const charges = cd.maxChargesDetected > 1 ? cd.maxChargesDetected : 1;
    const relevantCasts = priorCasts.slice(-charges);
    const earliestSlotReady = relevantCasts[0].timeSeconds + cd.cooldownSeconds;
    if (earliestSlotReady <= timeSeconds + CD_INSTANT_SLACK_S)
      readyNames.push(displayName);
  }
  return readyNames;
}

/**
 * Returns attributed display names for all CDs currently on cooldown.
 * Mirrors computeReadyNames but returns on-CD entries. Used by the resourceSnapshot
 * closure in buildMatchTimeline to track prevOnCDNamesState for B35 delta suppression.
 */
export function computeOnCDDisplayNames(
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  teammateCDs: Array<{ cds: IMajorCooldownInfo[]; playerLabel?: string }>,
): string[] {
  const onCDNames: string[] = [];
  const allFriendlyCDs: Array<{ displayName: string; cd: IMajorCooldownInfo }> =
    [
      ...ownerCDs.map((cd) => ({ displayName: cd.spellName, cd })),
      ...teammateCDs.flatMap(({ cds, playerLabel }) =>
        cds.map((cd) => ({
          displayName: playerLabel
            ? `${playerLabel}:${cd.spellName}`
            : cd.spellName,
          cd,
        })),
      ),
    ];
  for (const { displayName, cd } of allFriendlyCDs) {
    const priorCasts = cd.casts.filter(
      (c) => c.timeSeconds <= timeSeconds + CD_INSTANT_SLACK_S,
    );
    if (priorCasts.length === 0) continue;
    const charges = cd.maxChargesDetected > 1 ? cd.maxChargesDetected : 1;
    const relevantCasts = priorCasts.slice(-charges);
    const earliestSlotReady = relevantCasts[0].timeSeconds + cd.cooldownSeconds;
    if (earliestSlotReady > timeSeconds + CD_INSTANT_SLACK_S)
      onCDNames.push(displayName);
  }
  return onCDNames;
}
export interface ResourceSnapshotParams {
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
  const readyNames = computeReadyNames(
    timeSeconds,
    ownerCDs,
    teammateCDs.map(({ player, cds }) => ({
      cds,
      playerLabel: pid(player.name),
    })),
  );

  // Build on-CD display list with player attribution (B34) and delta filtering (B35).
  const onCDParts: string[] = [];
  const prevOnCDSet =
    prevOnCDNames !== undefined ? new Set(prevOnCDNames) : null;

  const allFriendlyCDs: Array<{ displayName: string; cd: IMajorCooldownInfo }> =
    [
      ...ownerCDs.map((cd) => ({ displayName: cd.spellName, cd })),
      ...teammateCDs.flatMap(({ player, cds }) =>
        cds.map((cd) => ({
          displayName: `${pid(player.name)}:${cd.spellName}`,
          cd,
        })),
      ),
    ];

  // B114: per-charge readiness suffix "[k/N]" for multi-charge CDs, so the model can tell a partly
  // available CD (1/2) from a fully spent one (0/2) or a fully available one (2/2). Only applied to
  // full-form lines below (delta comparison keeps the bare displayName to stay stable).
  const chargeSuffix = new Map<string, string>();
  for (const { displayName, cd } of allFriendlyCDs) {
    if (cd.maxChargesDetected > 1) {
      chargeSuffix.set(
        displayName,
        `[${chargesReadyCount(cd, timeSeconds)}/${cd.maxChargesDetected}]`,
      );
    }
  }

  const currentOnCDNames: string[] = [];
  for (const { displayName, cd } of allFriendlyCDs) {
    const priorCasts = cd.casts.filter(
      (c) => c.timeSeconds <= timeSeconds + CD_INSTANT_SLACK_S,
    );
    if (priorCasts.length === 0) continue;
    const charges = cd.maxChargesDetected > 1 ? cd.maxChargesDetected : 1;
    const relevantCasts = priorCasts.slice(-charges);
    const earliestSlotReady = relevantCasts[0].timeSeconds + cd.cooldownSeconds;
    if (earliestSlotReady > timeSeconds + CD_INSTANT_SLACK_S) {
      const remaining = Math.round(earliestSlotReady - timeSeconds);
      currentOnCDNames.push(displayName);
      // B35: in delta mode only show CDs that newly went on cooldown (not in previous snapshot).
      if (prevOnCDSet === null || !prevOnCDSet.has(displayName)) {
        // B114: a multi-charge CD in cd: has 0 charges ready; the "(Ns)" is time to the next charge.
        onCDParts.push(
          `${displayName}(${remaining}s)${chargeSuffix.get(displayName) ?? ""}`,
        );
      }
    }
  }

  // ── rdy: — full form first time, delta form on subsequent calls ─────────────
  let rdyPart: string;
  if (prevReadyNames !== undefined) {
    const prevSet = new Set(prevReadyNames);
    const currentSet = new Set(readyNames);
    const added = readyNames.filter((n) => !prevSet.has(n));
    const removed = prevReadyNames.filter((n) => !currentSet.has(n));
    // H1: prefix each item with its own +/- sign and space-separate them. The previous
    // `+a,b-c,d` form used a bare '-' as the added/removed boundary, which collided with
    // the hyphens inside spell names (e.g. "Anti-Magic Zone"), making the delta unparseable.
    const parts = [
      ...added.map((n) => `+${n}`),
      ...removed.map((n) => `-${n}`),
    ];
    rdyPart = parts.length > 0 ? `rdy:Δ ${parts.join(" ")}` : "rdy:Δ";
  } else {
    // B114: annotate multi-charge CDs with their ready-charge count in the full ready list.
    const readyDisplay = readyNames.map(
      (n) => `${n}${chargeSuffix.get(n) ?? ""}`,
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
      // If the buff duration is known, show it until it expires (capped at 30s to prevent bugs).
      // If duration is 0 (instant cast), show it for 8 seconds to ensure AI has context.
      const buffDuration = cd.buffEndSeconds - cd.castTimeSeconds;
      const displayWindowSeconds =
        buffDuration > 0 ? Math.min(buffDuration, 30) : 8;

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
      const dmg = sumIncomingPressure(f, atMs - focusLookbackMs, atMs);
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
