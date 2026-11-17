/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t128.ts — pipeline T128 (CXA13 D28): `[HEALER EXPOSURE]` listed
 * Blinding Light and Hammer of Justice as Full-DR threats in LoS while the
 * healer held Nullifying Shroud (ba2503cc r0, 0:06), the next control's
 * immunity — the threat filter read DR immunity and immunity forms only.
 *
 *  - `exposureThreatUnderCover`: every `IN LoS:` threat of a `[HEALER
 *    EXPOSURE]` line, against the owner side's healer. A violation when one
 *    of the healer's CC-avoidance auras that would stop that control
 *    (`healerCcCoverAt` — the producer's own reading) is up through the
 *    whole rendered second (sampled every 50 ms: the window's instant is
 *    inside it); up for only part of it is counted as `ambiguous` (kind).
 *    The threat's name maps to every `DR_CATEGORY_MAP` id of that English name.
 *    Kind = `<buff> vs <threat>`.
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { DR_CATEGORY_MAP } from "@gladlog/analysis/src/utils/drAnalysis";
import { healerCcCoverAt } from "@gladlog/analysis/src/utils/healerExposureAnalysis";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["exposureThreatUnderCover"] as const;

const LINE =
  /^\s*(\d+:\d\d)\s+\[HEALER EXPOSURE\]\s.*?\| IN LoS: (.*?)(?: \| Pillar-blocked: .*?)?(?: \| → .*)?$/;
const SPELL = /^(.+?) (?:Full|50%) DR$/;

let idsByName: Map<string, string[]> | undefined;
const idsOf = (name: string): string[] => {
  if (!idsByName) {
    idsByName = new Map();
    // the producer's control domain: every control with a DR family
    // (`DR_CATEGORY_MAP`, silences included — codex T128-1 P2)
    for (const id of Object.keys(DR_CATEGORY_MAP)) {
      const n = getEnglishSpellName(id, "");
      if (!n) continue;
      idsByName.set(n, [...(idsByName.get(n) ?? []), id]);
    }
  }
  return idsByName.get(name) ?? [];
};

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const healers = (ctx.players as any[]).filter(
    (u) => u.reaction === ctx.owner!.reaction && isHealerSpec(u.spec),
  );
  if (healers.length !== 1) return;
  const healer = healers[0];
  const unitsById = new Map<string, any>(
    (ctx.units as any[]).map((u) => [u.id, u]),
  );
  ctx.lines.forEach((line) => {
    const m = LINE.exec(line);
    if (!m) return;
    const sec = secOf(m[1]!);
    const atMs = ctx.start + sec * 1000;
    // the window's instant is somewhere in the rendered second: sampled
    // every 50 ms, at its last ms, and on both sides of every aura row of
    // the healer's inside it — cover changes only at a row or an official-
    // length expiry, so an aura removed and re-applied between samples
    // (155-1 r1 0:17: off 17.003–17.828; codex T128-1: off 6.011–6.039)
    // is seen off
    const offsets = new Set<number>([
      ...Array.from({ length: 20 }, (_, k) => k * 50),
      999,
    ]);
    for (const a of healer.auraEvents ?? []) {
      const dt = a.timestamp - atMs;
      if (dt < 0 || dt > 999) continue;
      for (const d of [dt - 1, dt, dt + 1])
        if (d >= 0 && d <= 999) offsets.add(d);
    }
    const covers = [...offsets].map((dt) =>
      healerCcCoverAt(healer, atMs + dt, ctx.start, unitsById),
    );
    for (const group of m[2]!.split("; ")) {
      const spells = group.slice(group.indexOf(": ") + 2).split(", ");
      for (const sp of spells) {
        const s = SPELL.exec(sp.trim());
        if (!s) continue;
        ctx.bump("exposureThreatUnderCover");
        const ids = idsOf(s[1]!);
        const at = covers.map((c) => ids.map((id) => c(id)).find(Boolean));
        const a = at.every(Boolean) ? at[0] : undefined;
        const b = at.find(Boolean);
        if (!b) continue;
        ctx.violate(
          "exposureThreatUnderCover",
          a && b ? `${a} vs ${s[1]}` : `ambiguous: ${a ?? b} vs ${s[1]}`,
          atMs,
          `${healer.name}:${sec}:${s[1]}`,
          `${healer.name} under ${a ?? b}${a && b ? "" : " (part of the second)"} at ${m[1]}; listed threat ${sp.trim()}`,
          line.trim().slice(0, 240),
        );
      }
    }
  });
}
