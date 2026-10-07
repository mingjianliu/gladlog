import {
  annotateMissedPurgesWithKillWindows,
  computeOffensiveWindows,
  missedPurgeNotActionable,
  missedPurgesFor,
  reconstructDispelSummary,
  type ICCEfficiencyStat,
  type IDispelEvent,
  type IMissedPurgeWindow,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { displaySpellName } from "./spellDisplay";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/** One dispel / missed-dispel instance (used by row expansion and lists);
 * tS = relative seconds. */
export interface DispelInstance {
  tS: number;
  label: string;
  /** The unit the ▶ jump focuses the camera on (caster or target). */
  unitName: string;
  /** proc or rider — not a cleanse decision (analysis `dispelKind`,
   * UI review 2026-08-21 #3). */
  passive: boolean;
  /** A missed scoped removal (Shattering Throw on an immunity shield) whose
   * holder could not have pressed it — locked out, out of reach, or on
   * cooldown for the whole buff (analysis `missedPurgeNotActionable`, the
   * prompt's "not actionable"). Listed all the same (user ruling X1). */
  notActionable?: boolean;
}

export interface DispelDashRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  /** Cleansing debuffs off teammates (deliberate casts only). */
  cleanses: number;
  /** Offensive dispels (purges; deliberate casts only). */
  purges: number;
  /** Buff steals (SPELL_STOLEN; deliberate casts only). */
  steals: number;
  /** Passive dispels (procs + movement/form riders) by this unit — shown,
   * never counted as decisions. */
  passive: number;
  events: DispelInstance[];
}

export interface DispelDash {
  rows: DispelDashRow[];
  /** Friendly-side totals — the single source for the KPI chip and the
   * engagement tab label (they used to each reduce `rows`). */
  totals: { friendlyDeliberate: number; friendlyPassive: number };
  /** Offensive dispel opportunities our side missed (a Critical/High enemy
   * buff sat for >3s) — and, since B-tier X1, the windows only a SCOPED
   * removal could have answered (analysis `scopedMissedPurgeWindows`), one
   * row per teammate who holds that removal, the ones that were not
   * actionable included and flagged. The mistake cards do not read this. */
  missedPurges: DispelInstance[];
  /** Windows where our side missed a cleanse of CC / a debuff. */
  missedCleanses: DispelInstance[];
  /** Per-friendly-target removal rate for cleansable CC (analysis
   * ccEfficiency). */
  ccEfficiency: ICCEfficiencyStat[];
}

const EMPTY: DispelDash = {
  rows: [],
  totals: { friendlyDeliberate: 0, friendlyPassive: 0 },
  missedPurges: [],
  missedCleanses: [],
  ccEfficiency: [],
};

const fmtName = (id: string, fallback: string): string =>
  displaySpellName(id, fallback);

/**
 * B-tier X1 (user ruling 2026-10-06): the windows only a SCOPED removal could
 * have answered (Shattering Throw on an immunity shield), one row per
 * teammate holding that removal — analysis' own per-player view
 * (`missedPurgesFor`, the one the prompt's owner line is built from) over the
 * scoped array only, so a window a general purger carried is not listed
 * twice. Every such window is shown; one its holder could not have answered
 * says so (`missedPurgeNotActionable`, the prompt's "not actionable").
 */
export function scopedMissedPurgeInstances(
  friends: ReadonlyArray<Parameters<typeof missedPurgesFor>[0]>,
  scopedWindows: IMissedPurgeWindow[],
  range?: TimeRange | null,
): DispelInstance[] {
  const out: DispelInstance[] = [];
  for (const f of friends) {
    const mine = missedPurgesFor(f, {
      missedPurgeWindows: [],
      scopedMissedPurgeWindows: scopedWindows,
    });
    for (const w of mine) {
      if (!w.viaScopedTool || !tInRange(w.timeSeconds, range)) continue;
      const why = missedPurgeNotActionable(w);
      const notActionable =
        why.lockedOut || why.noReach || why.onCooldownThroughout;
      out.push({
        tS: w.timeSeconds,
        label: `${fmtName(w.spellId, w.spellName)} 挂在 ${w.enemyName} 身上 ${Math.round(
          w.durationSeconds,
        )}s 未被打掉 · 可用 ${w.viaScopedTool.name}(${f.name})${
          why.lockedOut ? "(持有者被控/被锁)" : ""
        }${why.noReach ? "(无视线/超射程)" : ""}${
          why.onCooldownThroughout ? "(技能全程在 CD)" : ""
        }${notActionable ? " · 当时做不到" : ""}`,
        unitName: w.enemyName,
        passive: false,
        ...(notActionable ? { notActionable: true } : {}),
      });
    }
  }
  return out;
}

/**
 * Dispel dashboard (backlog #3): the completed ledger (purge / cleanse /
 * steal, both sides) plus the missed opportunities (missedPurgeWindows /
 * missedCleanseWindows / ccEfficiency). Every judgment consumes analysis's
 * reconstructDispelSummary -- the same predicate the prompt side's [MISSED
 * PURGE OPPORTUNITY] / [CLEANSE] use; the render layer never rebuilds its own
 * whitelist.
 */
/** `range` (time-window linkage, part 1): the ledger and missed opportunities
 * are filtered by the timestamp of the fact; ccEfficiency is a whole-match
 * aggregate (analysis carries no per-window timestamps), so when a window is
 * active the component labels it as whole-match scope. */
export function deriveDispelDash(
  source: ReportSource,
  range?: TimeRange | null,
): DispelDash {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return EMPTY;
    const combatLike = { startTime: legacy.startTime, endTime: legacy.endTime };

    // Build once per side (same approach as statsTable); pet dispels are
    // attributed to the owner (B45) via the pets parameters
    const petsOf = (owners: typeof players) => {
      const ids = new Set(owners.map((o) => o.id));
      return Object.values(legacy.units).filter(
        (u) => u.ownerId && ids.has(u.ownerId),
      );
    };
    const ours = reconstructDispelSummary(
      friends,
      enemies,
      combatLike,
      petsOf(friends),
      petsOf(enemies),
    );
    const theirs = reconstructDispelSummary(
      enemies,
      friends,
      combatLike,
      petsOf(enemies),
      petsOf(friends),
    );
    // Annotate whether each missed purge falls inside one of our kill windows
    // (the same annotation predicate the prompt side uses)
    const windows = computeOffensiveWindows(enemies, friends, legacy);
    annotateMissedPurgesWithKillWindows(ours.missedPurgeWindows, windows);

    const isDeliberate = (d: IDispelEvent): boolean =>
      d.dispelKind === "deliberate";
    const toInstance = (d: IDispelEvent): DispelInstance => ({
      tS: d.timeSeconds,
      label: `${fmtName(d.dispelSpellId, d.dispelSpellName)} ${
        d.isSpellSteal ? "偷走" : "驱散"
      } ${fmtName(d.removedSpellId, d.removedSpellName)}(${d.targetName})${
        d.wasFatal ? " ☠致命" : ""
      }${isDeliberate(d) ? "" : "(被动)"}`,
      unitName: d.sourceName,
      passive: !isDeliberate(d),
    });

    const rows: DispelDashRow[] = [];
    for (const p of players) {
      const side = p.reaction === CombatUnitReaction.Friendly ? ours : theirs;
      const cleanse = side.allyCleanse.filter(
        (d) => d.sourceName === p.name && tInRange(d.timeSeconds, range),
      );
      const purge = side.ourPurges.filter(
        (d) => d.sourceName === p.name && tInRange(d.timeSeconds, range),
      );
      const all = [...cleanse, ...purge];
      if (all.length === 0) continue;
      // Counts are decisions only (UI review #3): a Holy Paladin's 80 Cleanse
      // the Weak procs are listed in `events` and summed in `passive`, but
      // never inflate 解队友 / purge / 偷 — same predicate as the prompt's
      // [MINOR DISPELS] "(passive)" fold.
      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        cleanses: cleanse.filter(isDeliberate).length,
        purges: purge.filter((d) => isDeliberate(d) && !d.isSpellSteal).length,
        steals: purge.filter((d) => isDeliberate(d) && d.isSpellSteal).length,
        passive: all.filter((d) => !isDeliberate(d)).length,
        events: all.map(toInstance).sort((a, b) => a.tS - b.tS),
      });
    }
    const totals = rows
      .filter((r) => r.reaction === "Friendly")
      .reduce(
        (a, r) => ({
          friendlyDeliberate:
            a.friendlyDeliberate + r.cleanses + r.purges + r.steals,
          friendlyPassive: a.friendlyPassive + r.passive,
        }),
        { friendlyDeliberate: 0, friendlyPassive: 0 },
      );
    rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) ||
        b.cleanses + b.purges + b.steals - (a.cleanses + a.purges + a.steals),
    );

    const missedPurges: DispelInstance[] = ours.missedPurgeWindows
      .filter((w) => tInRange(w.timeSeconds, range))
      .map((w) => ({
        tS: w.timeSeconds,
        label: `${fmtName(w.spellId, w.spellName)} 挂在 ${w.enemyName} 身上 ${Math.round(
          w.durationSeconds,
        )}s 未被驱散${w.duringKillWindow ? "(我方击杀窗口内)" : ""}${
          w.purgeWasOnCD ? "(驱散在 CD)" : ""
        }${w.purgersLockedOut ? "(驱散者被控/被锁)" : ""}${
          w.losReachable === false ? "(无视线/超射程)" : ""
        }`,
        unitName: w.enemyName,
        passive: false,
      }));
    missedPurges.push(
      ...scopedMissedPurgeInstances(
        friends,
        ours.scopedMissedPurgeWindows ?? [],
        range,
      ),
    );
    missedPurges.sort((a, b) => a.tS - b.tS);

    const missedCleanses: DispelInstance[] = ours.missedCleanseWindows
      .filter((w) => tInRange(w.timeSeconds, range))
      .map((w) => ({
        tS: w.timeSeconds,
        label: `${w.targetName} 挂 ${fmtName(w.spellId, w.spellName)} ${Math.round(
          w.durationSeconds,
        )}s 未被解${w.cleanseWasOnCD ? "(解法在 CD)" : ""}${
          w.dispellersLockedOut ? "(驱散者被控/被锁)" : ""
        }${w.losReachable === false ? "(无视线/超射程)" : ""}${
          w.drChainRisk ? "(对方 DR 未递减,解了易被续控)" : ""
        }`,
        unitName: w.targetName,
        passive: false,
      }))
      .sort((a, b) => a.tS - b.tS);

    return {
      rows,
      totals,
      missedPurges,
      missedCleanses,
      ccEfficiency: ours.ccEfficiency,
    };
  } catch {
    return EMPTY;
  }
}
