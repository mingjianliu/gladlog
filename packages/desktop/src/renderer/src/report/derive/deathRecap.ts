import {
  analyzePlayerCCAndTrinket,
  buildDeathOutcomeSummary,
  computeMissedExternalCounterfactuals,
  computeMitigationAudit,
  computeUnusedSelfCounterfactuals,
  COUNTERFACTUAL_WINDOW_S,
  detectPanicDefensives,
  extractMajorCooldowns,
  findCheaperDefensiveAlternatives,
  ICounterfactualHit,
  IDispelEvent,
  IMajorCooldownInfo,
  IMitigationAuditRow,
  reconstructDispelSummary,
  SPELL_CATEGORIES,
} from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { displaySpellName } from "./spellDisplay";
import type { ReportSource } from "./types";

/** Look-back window before death (seconds). The same fact as analysis's
 * counterfactual window — aliased, not re-declared (issue #11 window
 * unification; (criticalMoments.ts, deleted 2026-09-05, used to consume the same
 * constant). Registered under COUNTERFACTUAL_WINDOW_S in
 * docs/predicate-index.md. */
export const DEATH_RECAP_WINDOW_S = COUNTERFACTUAL_WINDOW_S;

/** Below this fraction of the victim's maxHp a single direct hit / direct heal
 * is folded away instead of getting its own row (issue #11: median 114 rows
 * per recap made the card unreadable). This is a **UI display-density
 * threshold**, an independent fact from any analysis predicate — the prompt
 * has no per-event table, so there is no analysis/gate consumer of this
 * number today. If a second consumer ever appears, register it in
 * docs/predicate-index.md ("Report UI" section) immediately. The maxHp it is
 * compared against comes from the victim's `advancedActions` — the same
 * source `hpRangeAt` reads, so the threshold and the HP bar can never
 * disagree about maxHp. */
export const DEATH_RECAP_MIN_EVENT_PCT = 0.02;

export interface DeathRecapEvent {
  /** Relative seconds (since combat start). */
  tS: number;
  kind: "dmg" | "heal" | "cc" | "def_used" | "dispel";
  spell: string;
  /** Raw spell id (#21 item1: feeds the inline icon; ChipIcon degrades on its
   * own when there is no table entry). */
  spellId?: string;
  amount?: number;
  srcName: string;
  hpBeforePct?: number;
  hpAfterPct?: number;
  /** kind="def_used" only (#10 T5): the same analysis verdict
   * (detectPanicDefensives, the same predicate as the defensive panic note in
   * keyMoments.ts) -- a major cooldown pressed with no visible enemy threat. */
  panic?: boolean;
}

/** A per-(spell x source) periodic-damage subtotal (issue #11): DoT ticks,
 * swings and other non-GCD damage (everything in `damageIn` whose log event is
 * not SPELL_DAMAGE) are one line each instead of one line per tick. */
export interface DeathRecapSubtotal {
  type: "subtotal";
  kind: "dmg" | "heal";
  /** First / last tick, relative seconds. */
  fromS: number;
  toS: number;
  spell: string;
  spellId?: string;
  srcName: string;
  /** Sum of the constituent events' amounts. */
  total: number;
  /** Constituent event count. */
  ticks: number;
}

/** The fold bucket (issue #11): sub-threshold direct hits/heals and HoT ticks.
 * Never a silent delete — every folded event stays inside `events` (with its
 * hpBefore/hpAfter) and the card can expand the bucket; the row itself carries
 * the totals so amounts stay conserved. */
export interface DeathRecapFolded {
  type: "folded";
  count: number;
  dmgTotal: number;
  healTotal: number;
  events: DeathRecapEvent[];
}

export type DeathRecapRow =
  | { type: "event"; event: DeathRecapEvent }
  | DeathRecapSubtotal
  | DeathRecapFolded;

export interface DeathRecap {
  unitId: string;
  unitName: string;
  /** Time of death, relative seconds. */
  deathS: number;
  /** Raw event stream over the DEATH_RECAP_WINDOW_S seconds before death
   * (ascending) — every tick/hit, unfiltered. The card's 显示全部 mode. */
  events: DeathRecapEvent[];
  /** Condensed display rows (issue #11): direct hits/heals ≥
   * DEATH_RECAP_MIN_EVENT_PCT of maxHp keep their own row; periodic damage is
   * one subtotal per (spell x source); sub-threshold events and HoT ticks go
   * into a single expandable fold bucket. CC / defensive / dispel rows are
   * kept unconditionally. Amounts are conserved: rows partition `events`
   * (minus zero-amount kinds), so the per-kind sums are equal — asserted in
   * report.deathrecap.filter.test.tsx. */
  rows: DeathRecapRow[];
  /** Immunities/survival cooldowns that were available at time of death but
   * not pressed (analysis deathOutcome predicate). */
  availableImmunities: Array<{
    spellId: string;
    spellName: string;
    wasInCC: boolean;
    /** Same predicate as F166 (findCheaperDefensiveAlternatives): which
     * strictly cheaper (shorter cooldown) majors were also available and
     * unpressed at time of death -- lets the card append a "cheaper
     * alternative" hint. Empty array when there is no matching ledger row or
     * no cheaper option. */
    cheaperAlternatives: string[];
  }>;
  /** External survival cooldowns a teammate could have given but did not
   * (and whether that caster was under CC). */
  missedExternals: Array<{
    casterName: string;
    spellId: string;
    spellName: string;
    casterWasInCC: boolean;
  }>;
  /**
   * Mitigation audit (form A, #17b Task4): a row-by-row accounting of the
   * whitelisted mitigation that was **already active** on the victim inside
   * the death window. The numbers come straight from computeMitigationAudit
   * in Task1's counterfactual.ts -- the render layer does not re-derive how
   * much damage was absorbed.
   */
  mitigationAudit: IMitigationAuditRow[];
  /**
   * Counterfactuals (B / narrow gate merged, decisive only): teammate
   * externals that were available but not given, plus own cooldowns that were
   * available but not pressed. Only the "clearly would have survived" tier is
   * kept (honesty ethics: marginal/fatal stay silent).
   */
  counterfactuals: ICounterfactualHit[];
}

const DEF_TYPES = new Set(["immunities", "buffs_defensive"]);

/**
 * A recap of every death (backlog #6). All verdicts consume the analysis
 * predicates (buildDeathOutcomeSummary / analyzePlayerCCAndTrinket) -- the
 * render layer does not rebuild death judgements; that is the lesson from the
 * duplicate-predicate disease found in the audit.
 */
export function deriveDeathRecaps(source: ReportSource): DeathRecap[] {
  try {
    const legacy = toLegacySafe(source);
    const matchStartMs = legacy.startTime;
    // Cover deaths on both sides: our deaths = defensive review, enemy deaths
    // = kill-execution review.
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];

    const combatLike = {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
      // legacy.startInfo.zoneId is a required string (toLegacyMatch builds
      // IStartInfo unconditionally, see parser-compat/src/{types,convert}.ts)
      // -- no optional fallback is needed. The previous version widened it to
      // `{zoneId?: string} | undefined` and silenced the compiler with a
      // forced type assertion, which reproduces exactly the class of bug this
      // change fixes (once the check is silenced, the compiler can no longer
      // see that a nonexistent field is being read).
      startInfo: { zoneId: legacy.startInfo.zoneId },
    };
    const allUnits = Object.values(legacy.units);
    const ccSummaries = players.map((p) => {
      const opponents = players.filter((o) => o.reaction !== p.reaction);
      const oppIds = new Set(opponents.map((o) => o.id));
      const oppPets = allUnits.filter(
        (u) => u.ownerId && oppIds.has(u.ownerId),
      );
      return analyzePlayerCCAndTrinket(p, opponents, combatLike, oppPets);
    });
    // I-1 (reviewer finding): the teammate/missedExternals loop inside
    // buildDeathOutcomeSummary does no faction filtering (it trusts the caller
    // to pass a pure teammate pool -- the only other call site on the analysis
    // side, buildMatchContext.ts, does exactly that: friends and enemies
    // passed separately). This component used to pass the whole `players` pool
    // from both sides as friends, a usage unique to it (it needs to review
    // deaths on both sides), so a still-living enemy healer was treated as a
    // "teammate in the queue" and pushed into the victim's missedExternals --
    // the report would name an enemy as "the person who should have saved
    // you". Call it twice, split by the victim's faction, feeding each call
    // only its own faction pool, then merge the events: each call's internal
    // teammate loop can then only see its own team, with no change to
    // buildDeathOutcomeSummary itself.
    const friendlyPlayers = players.filter(
      (p) => p.reaction === CombatUnitReaction.Friendly,
    );
    const hostilePlayers = players.filter(
      (p) => p.reaction === CombatUnitReaction.Hostile,
    );
    const outcomeCombat = {
      startTime: legacy.startTime,
      zoneId: legacy.startInfo.zoneId,
    };
    const outcomeEvents = [
      ...buildDeathOutcomeSummary(outcomeCombat, friendlyPlayers, ccSummaries)
        .events,
      ...buildDeathOutcomeSummary(outcomeCombat, hostilePlayers, ccSummaries)
        .events,
    ];
    // Mitigation audit / counterfactuals (#17b Task4): victimCds/ccSummary are
    // aligned by unit.id with what was already computed above, not recomputed
    // -- legacy already carries startTime/endTime/units, so feed it straight
    // to Task1's three functions (the same usage as extractMajorCooldowns(u,
    // legacy) in keyMoments.ts).
    const cdsByUnit = new Map<string, IMajorCooldownInfo[]>(
      players.map((p) => [p.id, extractMajorCooldowns(p, legacy)]),
    );
    const ccSummaryByUnit = new Map(
      players.map((p, i) => [p.id, ccSummaries[i]!]),
    );
    // Panic usage (#10 T5): the gate predicate is the spec -- consume
    // analysis's detectPanicDefensives directly (the same verdict as the
    // defensive panic note in keyMoments.ts), calling it twice split by the
    // victim's faction (same reason as buildDeathOutcomeSummary above: the
    // function does no faction filtering internally, so friends/enemies must
    // each be fed their own faction pool).
    const panicsFriendly = detectPanicDefensives(
      friendlyPlayers,
      hostilePlayers,
      combatLike,
    );
    const panicsEnemy = detectPanicDefensives(
      hostilePlayers,
      friendlyPlayers,
      combatLike,
    );
    const panicsFor = (reaction: CombatUnitReaction) =>
      reaction === CombatUnitReaction.Friendly ? panicsFriendly : panicsEnemy;

    // Dispels touching a victim inside a death window (issue #11): consume the
    // same reconstructDispelSummary predicate the prompt's [CLEANSE]/[MISSED
    // PURGE OPPORTUNITY] blocks and the dispel dashboard (dispelDash.ts) use —
    // the recap never rebuilds its own dispel whitelist. Both directions are
    // computed (same pattern as dispelDash) so enemy-side deaths see their
    // side's cleanses too; the four buckets used (ours/theirs x
    // allyCleanse/ourPurges) partition the (src, dest) faction combinations,
    // so no event is double-counted. Additive decoration: a throw here must
    // not nuke every recap through the outer catch, hence the local guard.
    let allDispels: IDispelEvent[] = [];
    try {
      if (friendlyPlayers.length > 0 && hostilePlayers.length > 0) {
        const petsOf = (owners: typeof players) => {
          const ids = new Set(owners.map((o) => o.id));
          return allUnits.filter((u) => u.ownerId && ids.has(u.ownerId));
        };
        const dispelCombat = {
          startTime: legacy.startTime,
          endTime: legacy.endTime,
          zoneId: legacy.startInfo.zoneId,
        };
        const ours = reconstructDispelSummary(
          friendlyPlayers,
          hostilePlayers,
          dispelCombat,
          petsOf(friendlyPlayers),
          petsOf(hostilePlayers),
        );
        const theirs = reconstructDispelSummary(
          hostilePlayers,
          friendlyPlayers,
          dispelCombat,
          petsOf(hostilePlayers),
          petsOf(friendlyPlayers),
        );
        allDispels = [
          ...ours.allyCleanse,
          ...ours.ourPurges,
          ...theirs.allyCleanse,
          ...theirs.ourPurges,
        ];
      }
    } catch {
      allDispels = [];
    }

    const nameOf = (id: string): string => legacy.units[id]?.name ?? "unknown";

    const recaps: DeathRecap[] = [];
    for (const unit of players) {
      for (const death of unit.deathRecords) {
        const deathS = (death.timestamp - matchStartMs) / 1000;
        const fromS = deathS - DEATH_RECAP_WINDOW_S;
        const events: DeathRecapEvent[] = [];
        /** Condensation class (issue #11): "agg" = periodic-like damage (one
         * subtotal per spell x source), "hot" = HoT tick (fold bucket),
         * "direct" = thresholded by DEATH_RECAP_MIN_EVENT_PCT; events not in
         * the map (cc / def_used / dispel) are kept unconditionally. */
        const cls = new Map<DeathRecapEvent, "agg" | "hot" | "direct">();
        /** Raw log timestamp per dmg/heal event, so the threshold's maxHp
         * lookup does not roundtrip through relative seconds. */
        const rawTs = new Map<DeathRecapEvent, number>();

        const clampPct = (v: number) => Math.min(100, Math.max(0, v));
        /** HP before/after an event: the advanced sample at the same
         * timestamp = HP after it landed; the before value = the after value
         * walked back by this event's amount.
         * amountTowardBefore: +|amount| for dmg (HP was higher before),
         * -amount for heal (HP was lower before). */
        const hpRangeAt = (
          tsMs: number,
          amountTowardBefore: number,
        ): { hpBeforePct: number; hpAfterPct: number } | undefined => {
          const sample = unit.advancedActions.find(
            (a) => a.logLine?.timestamp === tsMs,
          );
          if (!sample || sample.advancedActorMaxHp <= 0) return undefined;
          const max = sample.advancedActorMaxHp;
          const hpAfterPct = clampPct(
            (sample.advancedActorCurrentHp / max) * 100,
          );
          const hpBeforePct = clampPct(
            hpAfterPct + (amountTowardBefore / max) * 100,
          );
          return { hpBeforePct, hpAfterPct };
        };
        /** maxHp for the display-density threshold (issue #11): the same
         * advancedActions array hpRangeAt reads (one maxHp fact, one source)
         * — the exact-timestamp sample when it exists, else the nearest
         * sample by |timestamp|. undefined (no advanced logging at all)
         * disables folding for that event: never fold on a guess. */
        const maxHpNear = (tsMs: number): number | undefined => {
          let best: number | undefined;
          let bestD = Infinity;
          for (const a of unit.advancedActions) {
            if (a.advancedActorMaxHp <= 0) continue;
            const ts = a.logLine?.timestamp;
            if (ts === undefined) continue;
            const dd = Math.abs(ts - tsMs);
            if (dd < bestD) {
              bestD = dd;
              best = a.advancedActorMaxHp;
            }
          }
          return best;
        };

        // Damage taken (log sign convention: raw damage is negative ->
        // Math.abs). "GCD-related direct hit" is judged by the log event
        // token: SPELL_DAMAGE = direct; everything else in damageIn
        // (SPELL_PERIODIC_*, SWING_*, RANGE_DAMAGE, DAMAGE_SHIELD, ...) is
        // periodic/auto/proc traffic that gets a per-(spell x source)
        // subtotal. The off-GCD table was measured to have no discriminating
        // power on damage rows (0.61% hit rate on the 50-match corpus), so
        // the event token IS the predicate here.
        for (const d of unit.damageIn) {
          const tS = (d.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          const ev: DeathRecapEvent = {
            tS,
            kind: "dmg",
            spell: displaySpellName(d.spellId ?? "", d.spellName ?? ""),
            spellId: d.spellId,
            amount: Math.abs(d.effectiveAmount),
            srcName: nameOf(d.srcUnitId),
            ...hpRangeAt(d.logLine.timestamp, Math.abs(d.effectiveAmount)),
          };
          events.push(ev);
          cls.set(
            ev,
            d.logLine.event === LogEvent.SPELL_DAMAGE ? "direct" : "agg",
          );
          rawTs.set(ev, d.logLine.timestamp);
        }
        // Healing taken. HoT ticks (SPELL_PERIODIC_HEAL) go to the fold
        // bucket rather than per-spell subtotals: measured on the 50-match
        // corpus, folding gives median 24 rows/recap vs 26 with HoT
        // subtotals ("whichever yields fewer rows" per the issue #11 spec —
        // the fold row exists in virtually every recap anyway, so HoTs ride
        // it for free; per-healer HoT detail stays reachable via expand /
        // 显示全部).
        for (const h of unit.healIn) {
          const tS = (h.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          if (h.effectiveAmount <= 0) continue;
          const ev: DeathRecapEvent = {
            tS,
            kind: "heal",
            spell: displaySpellName(h.spellId ?? "", h.spellName ?? ""),
            spellId: h.spellId,
            amount: h.effectiveAmount,
            srcName: nameOf(h.srcUnitId),
            ...hpRangeAt(h.logLine.timestamp, -h.effectiveAmount),
          };
          events.push(ev);
          cls.set(
            ev,
            h.logLine.event === LogEvent.SPELL_PERIODIC_HEAL ? "hot" : "direct",
          );
          rawTs.set(ev, h.logLine.timestamp);
        }
        // CC applied to the victim (curated cc category)
        for (const a of unit.auraEvents) {
          if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
          if (SPELL_CATEGORIES[a.spellId ?? ""]?.type !== "cc") continue;
          const tS = (a.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          events.push({
            tS,
            kind: "cc",
            spell: displaySpellName(a.spellId ?? "", a.spellName ?? ""),
            spellId: a.spellId,
            srcName: nameOf(a.srcUnitId),
          });
        }
        // Defensives the victim pressed; panic usage (#10 T5) is aligned to
        // detectPanicDefensives' output by (spellId, caster name, ~second) --
        // the same verdict, not rebuilt here.
        const panics = panicsFor(unit.reaction);
        for (const c of unit.spellCastEvents) {
          if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          if (!DEF_TYPES.has(SPELL_CATEGORIES[c.spellId ?? ""]?.type ?? ""))
            continue;
          const tS = (c.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          const panic = panics.some(
            (p) =>
              p.spellId === c.spellId &&
              p.casterName === unit.name &&
              Math.abs(p.timeSeconds - tS) < 1,
          );
          events.push({
            tS,
            kind: "def_used",
            spell: displaySpellName(c.spellId ?? "", c.spellName ?? ""),
            spellId: c.spellId,
            srcName: unit.name,
            ...(panic ? { panic: true } : {}),
          });
        }
        // Dispels the victim took part in, either direction (issue #11, kept
        // unconditionally). spellId is the REMOVED aura (that is the fact the
        // row is about); srcName is the dispeller.
        for (const d of allDispels) {
          if (d.timeSeconds < fromS || d.timeSeconds > deathS) continue;
          const isSource = d.sourceName === unit.name;
          const isTarget = d.targetName === unit.name;
          if (!isSource && !isTarget) continue;
          const removed = displaySpellName(
            d.removedSpellId,
            d.removedSpellName,
          );
          const verb = d.isSpellSteal ? "偷走" : "驱散";
          events.push({
            tS: d.timeSeconds,
            kind: "dispel",
            spell:
              isSource && isTarget
                ? `${removed}(自解)`
                : isTarget
                  ? `${removed}(被${verb})`
                  : `${removed}(${verb} ${d.targetName})`,
            spellId: d.removedSpellId,
            srcName: d.sourceName,
          });
        }
        events.sort((a, b) => a.tS - b.tS);

        // Condensed display rows (issue #11). Partition of `events`: every
        // event lands in exactly one of {own row, subtotal, fold bucket}, so
        // per-kind amount sums are conserved by construction (asserted in
        // report.deathrecap.filter.test.tsx).
        const rows: DeathRecapRow[] = [];
        const foldedEvents: DeathRecapEvent[] = [];
        const aggGroups = new Map<
          string,
          { events: DeathRecapEvent[]; total: number }
        >();
        for (const e of events) {
          const c = cls.get(e);
          if (c === undefined) {
            // cc / def_used / dispel: unconditional
            rows.push({ type: "event", event: e });
          } else if (c === "agg") {
            const k = `${e.spellId ?? e.spell}|${e.srcName}`;
            const g = aggGroups.get(k) ?? { events: [], total: 0 };
            g.events.push(e);
            g.total += e.amount ?? 0;
            aggGroups.set(k, g);
          } else if (c === "hot") {
            foldedEvents.push(e);
          } else {
            const maxHp = maxHpNear(rawTs.get(e)!);
            if (
              maxHp !== undefined &&
              (e.amount ?? 0) < DEATH_RECAP_MIN_EVENT_PCT * maxHp
            ) {
              foldedEvents.push(e);
            } else {
              rows.push({ type: "event", event: e });
            }
          }
        }
        for (const g of aggGroups.values()) {
          // A single in-window tick keeps its own row (same row count as a
          // 1-tick subtotal, but the HP bar survives).
          if (g.events.length === 1) {
            rows.push({ type: "event", event: g.events[0]! });
            continue;
          }
          const first = g.events[0]!;
          const last = g.events[g.events.length - 1]!;
          rows.push({
            type: "subtotal",
            kind: "dmg",
            fromS: first.tS,
            toS: last.tS,
            spell: first.spell,
            spellId: first.spellId,
            srcName: first.srcName,
            total: g.total,
            ticks: g.events.length,
          });
        }
        const rowT = (r: DeathRecapRow): number =>
          r.type === "event"
            ? r.event.tS
            : r.type === "subtotal"
              ? r.fromS
              : Infinity;
        rows.sort((a, b) => rowT(a) - rowT(b));
        if (foldedEvents.length > 0) {
          const sumKind = (kind: "dmg" | "heal") =>
            foldedEvents
              .filter((e) => e.kind === kind)
              .reduce((s, e) => s + (e.amount ?? 0), 0);
          rows.push({
            type: "folded",
            count: foldedEvents.length,
            dmgTotal: sumKind("dmg"),
            healTotal: sumKind("heal"),
            events: foldedEvents,
          });
        }

        // deathOutcome events are aligned by (name, second)
        const oc = outcomeEvents.find(
          (e) =>
            e.deadPlayer === unit.name && Math.abs(e.atSeconds - deathS) < 1,
        );

        // Mitigation audit / counterfactuals (#17b Task4): all three functions
        // are called once with the same deathS so the numbers are
        // single-source -- the card does not re-derive absorbed/saved damage,
        // it only consumes Task1's return values.
        const victimCds = cdsByUnit.get(unit.id) ?? [];
        const victimCcSummary = ccSummaryByUnit.get(unit.id);
        const mitigationAudit = computeMitigationAudit(
          unit,
          legacy,
          deathS,
        ).rows;
        const counterfactuals: ICounterfactualHit[] = [
          ...(victimCcSummary
            ? computeUnusedSelfCounterfactuals(
                unit,
                victimCds,
                victimCcSummary,
                legacy,
                deathS,
              )
            : []),
          ...computeMissedExternalCounterfactuals(
            oc?.missedExternals ?? [],
            unit,
            legacy,
            deathS,
          ),
        ];

        recaps.push({
          unitId: unit.id,
          unitName: unit.name,
          deathS,
          events,
          rows,
          // Cheaper alternatives (#10 T5, same predicate as F166): align the
          // unpressed major to its row in the victimCds ledger by spellId and
          // feed that to findCheaperDefensiveAlternatives to find shorter-
          // cooldown options still available at time of death -- when the
          // ledger has no such row (not recorded / not a major) we silently
          // return an empty array rather than pretending an alternative
          // exists.
          availableImmunities: (oc?.availableImmunities ?? []).map((i) => {
            const cd = victimCds.find((c) => c.spellId === i.spellId);
            return {
              spellId: i.spellId,
              spellName: i.spellName,
              wasInCC: i.wasInCC,
              cheaperAlternatives: cd
                ? findCheaperDefensiveAlternatives(cd, victimCds, deathS, {})
                : [],
            };
          }),
          missedExternals: (oc?.missedExternals ?? []).map((m) => ({
            casterName: m.casterName,
            spellId: m.spellId,
            spellName: m.spellName,
            casterWasInCC: m.casterWasInCC,
          })),
          mitigationAudit,
          counterfactuals,
        });
      }
    }
    return recaps.sort((a, b) => a.deathS - b.deathS);
  } catch {
    return [];
  }
}
