import { deriveKeyMoments, type KeyMomentKind } from "./keyMoments";
import { deriveMistakes } from "./mistakes";
import { shortUnitName } from "./teamSide";
import type { ReportSource } from "./types";

/** The single moment source for the recording tab (shared by the marker bar and
 * the event feed): keyMoments (deaths / burst bands / defensives / dispels /
 * CC) + deterministic mistakes ⚠ + AI deep-dive chips.
 * tS is always in seconds relative to this match (this round, for shuffle); the
 * caller converts to video seconds (+ (source.startTime - startedAt)/1000). */
export interface VideoMoment {
  tS: number;
  /** burst-band only: end of the interval. */
  toS?: number;
  kind: KeyMomentKind | "mistake" | "ai";
  weight: "major" | "minor";
  label: string;
  unitNames: string[];
}

export interface AiChipLike {
  t: number;
  label: string;
  unitNames?: string[];
}

export function deriveVideoMoments(
  source: ReportSource,
  aiChips?: AiChipLike[],
): VideoMoment[] {
  const out: VideoMoment[] = [];
  try {
    for (const k of deriveKeyMoments(source)) {
      out.push({
        tS: k.t,
        toS: k.toT,
        kind: k.kind,
        weight: k.weight,
        label: k.detail ? `${k.title} · ${k.detail}` : k.title,
        unitNames: k.unitNames,
      });
    }
  } catch {
    /* one failing source must not take the rest down */
  }
  try {
    for (const mk of deriveMistakes(source)) {
      out.push({
        tS: mk.tS,
        kind: "mistake",
        weight: "major",
        label: `${mk.label} · ${shortUnitName(mk.unitName)}`,
        unitNames: mk.seekNames,
      });
    }
  } catch {
    /* as above */
  }
  for (const c of aiChips ?? []) {
    if (!Number.isFinite(c?.t) || !c.label) continue;
    out.push({
      tS: c.t,
      kind: "ai",
      weight: "major",
      label: c.label,
      unitNames: c.unitNames ?? [],
    });
  }
  return out.sort((a, b) => a.tS - b.tS);
}
