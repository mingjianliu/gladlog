import {
  computeHealerExposureEvents,
  computePressureWindows,
  DMG_SPIKE_THRESHOLD,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { type Language, translate } from "../../../../shared/i18n";
import { toLegacySafe } from "./legacySource";
import { langMemoKey, sourceMemo } from "./sourceMemo";
import type { ReportSource } from "./types";

export interface PressureBand {
  fromS: number;
  toS: number;
  targetName: string;
  totalDamage: number;
  /** k DPS computed from the rounded whole-second window length (≥1), on the
   *  same basis as the [DMG SPIKE] lines. */
  dpsK: number;
}
export interface ExposureMark {
  tS: number;
  label: "Critical" | "Exposed" | "Pressured"; // Safe does not enter the lane
  /** Hover text (in the UI language, assembled in derive): threat count /
   *  trinket state / LoS cover distance. */
  title: string;
}

/** Pressure-lane derive (#4): the spike threshold and window use the same
 * predicates as the [DMG SPIKE] prompt lines (DMG_SPIKE_THRESHOLD +
 * computePressureWindows' default arguments), so every segment the prompt has
 * must also appear in the lane. Exposure goes through the single entry point
 * computeHealerExposureEvents, which degrades gracefully without coordinates. */
function derivePressureLanesUncached(
  source: ReportSource,
  lang: Language,
): {
  spikes: PressureBand[];
  exposures: ExposureMark[];
} {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    if (friends.length === 0) return { spikes: [], exposures: [] };

    const spikes: PressureBand[] = computePressureWindows(friends, legacy)
      .filter((pw) => pw.totalDamage >= DMG_SPIKE_THRESHOLD)
      .map((pw) => {
        const windowSec = Math.round(pw.toSeconds - pw.fromSeconds);
        return {
          fromS: pw.fromSeconds,
          toS: pw.toSeconds,
          targetName: pw.targetName,
          totalDamage: pw.totalDamage,
          // Same basis: emitDmgSpikeEntries' dpsK formula (B20 guards Infinity)
          dpsK: Math.round(pw.totalDamage / Math.max(1, windowSec) / 1000),
        };
      });

    // Invariant: lane exposures = the non-Safe [HEALER EXPOSURE] prompt lines
    // (the prompt renders Safe too; the lane filters it out) — see the parity
    // test in pressureLanes.test.ts.
    const exposures: ExposureMark[] = computeHealerExposureEvents(legacy)
      .filter((e) => e.exposureLabel !== "Safe")
      .map((e) => {
        const exposed = e.threats.filter((t) => !t.losBlocked).length;
        const trinket = translate(
          lang,
          e.trinketState === "available"
            ? "report.pressure.trinketAvailable"
            : e.trinketState === "passive"
              ? "report.pressure.trinketPassive"
              : "report.pressure.trinketOnCd",
        );
        const los =
          e.losBreak && e.losBreak.repositionYards <= 30
            ? translate(lang, "report.pressure.losCover", {
                yd: e.losBreak.repositionYards,
              })
            : "";
        return {
          tS: e.atSeconds,
          label: e.exposureLabel as ExposureMark["label"],
          title: translate(lang, "report.pressure.exposureTitle", {
            label: e.exposureLabel,
            n: exposed,
            trinket,
            los,
          }),
        };
      });

    return { spikes, exposures };
  } catch {
    return { spikes: [], exposures: [] };
  }
}

/** derivePressureLanesUncached, kept per source object across mounts (see sourceMemo.ts). */
export function derivePressureLanes(
  source: ReportSource,
  lang: Language = "zh",
): ReturnType<typeof derivePressureLanesUncached> {
  return sourceMemo(source, langMemoKey("derivePressureLanes", lang), () =>
    derivePressureLanesUncached(source, lang),
  );
}
