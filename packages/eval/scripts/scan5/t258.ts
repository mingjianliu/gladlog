/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t258.ts — ticket T258, three rulings of 2026-11-24 (GH #225-A10,
 * #226-16, #226-17).
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's. Windows,
 * the pressured unit, the response list and the span are the engine's
 * (`burstWindowDecisionPoints`, `burstResponseSpanMs`); the menu rows are
 * the candidate pass's own (`extractCandidateFindings`); the death cut is the
 * producer's `casterAuraOutlives`.
 *
 *  - `amsInBurstWindow` (R112): an Anti-Magic Shell press — 48707 by the
 *    pressured unit, or Spellwarden's 410358 by the pressured unit or on
 *    it — inside a burst window's response span is in the window's
 *    response list. Kind `not in the response list` is the failure; the
 *    presses that are in it are counted by whether the schools the shell
 *    covers (`saveSchoolMask`) are at least `SCHOOL_SAVE_MIN_SHARE` of the
 *    damage the pressured unit took in the span, landed and absorbed, by
 *    the save candidates' own reader (`incomingPressureBySchool`;
 *    inventory: the ruling set no school gate). Counted: every such press
 *    in a window.
 *  - `preWallBeforeOpenerMs` (R113): no response of a window was pressed
 *    more than `BURST_RESPONSE_PRE_MS` before the opener's own
 *    millisecond. A landed control is left out: it answers by its landing
 *    and prints its press or its totem's drop (R90 / R109).
 *    Counted: every other response of a window.
 *  - `slowResponseRowDiffers` (both rulings, read on the capture): a
 *    healer owner's `slow-defensive-response` menu rows against the rows
 *    the checkout's builder emits. Kinds: `printed, the builder emits
 *    none` / `not printed, the pass emits it`. Non-zero on a capture
 *    taken before the fix, 0 on one taken with it.
 *    Counted: every row printed or emitted.
 *  - `petCopyKeepsEffectAfterDeath` (R114, inventory — the split stays and
 *    is registered as deliberately not shared): an enemy cooldown whose
 *    caster died while its effect ran, where `casterAuraOutlives` says the
 *    effect outlives the death and says it does not once the copies on
 *    pets / guardians / totems are left out (`isEffectHolderUnit`).
 *    Counted: every enemy cooldown press of a caster that died before the
 *    press's effect was due to end.
 */
import { analysisDataReady } from "@gladlog/analysis";
import {
  ANTI_MAGIC_SHELL_ANSWER_IDS,
  BURST_RESPONSE_PRE_MS,
  burstResponseSpanMs,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { extractCandidateFindings } from "@gladlog/analysis/src/analysis/candidateFindings";
import {
  saveSchoolMask,
  SCHOOL_SAVE_MIN_SHARE,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { schoolShareCoveredBy } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { isEffectHolderUnit } from "@gladlog/analysis/src/utils/effectHolder";
import {
  casterAuraOutlives,
  cooldownEffectAuras,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis/src/utils/enemyCDs";
import {
  documentRecordsAttackSpell,
  incomingPressureBySchool,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { buildRosterSides } from "@gladlog/analysis/src/utils/rosterSide";
import {
  AURA_NATURAL_END_JITTER_S,
  DEATH_CASCADE_MS,
  firstDeathMs,
} from "@gladlog/analysis/src/utils/unitDeath";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "amsInBurstWindow",
  "preWallBeforeOpenerMs",
  "slowResponseRowDiffers",
  "petCopyKeepsEffectAfterDeath",
] as const;

const AMS_SHARES = [
  "in the list; covered schools are most of the damage",
  "in the list; covered schools are under half of the damage",
  "in the list; no damage on the pressured unit in the span",
] as const;
const PET_KINDS = [
  "kept alive by a pet's / guardian's copy alone",
  "a holder's copy outlives the death",
  "over at the death",
  "no aura of the effect",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  ...AMS_SHARES.map((h) => `amsInBurstWindow|${h}`),
  ...PET_KINDS.map((k) => `petCopyKeepsEffectAfterDeath|${k}`),
]);

const MENU_ROW = /id=slow-defensive-response:\S+?:(\d+) type=/g;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  const at = (ms: number): string => ((ms - ctx.start) / 1000).toFixed(1);
  const friendlies = (ctx.players as any[]).filter(
    (u) => u.reaction === owner.reaction,
  );
  let sides_: ReturnType<typeof buildRosterSides> | undefined;
  const sides = () => (sides_ ??= buildRosterSides(ctx.units as any[]));
  let records_: boolean | undefined;
  const recordsAttackSpell = () =>
    (records_ ??= documentRecordsAttackSpell(ctx.units as any[]));
  // one shell, two ids: both carry the same DB2 absorb mask
  const amsMask = saveSchoolMask([...ANTI_MAGIC_SHELL_ANSWER_IDS][0]!) ?? 0x7e;
  for (const p of points) {
    const pr = p.pressured;
    if (!pr) continue;
    const { w0, w1 } = burstResponseSpanMs(p.tMs, p.leadMs);
    const fact = `${ctx.roundKey}|${owner.reaction}|${p.tSec}`;

    // ── R112: Anti-Magic Shell inside the span ────────────────────────────
    const prUnit = ctx.units.find((u: any) => u.id === pr.unitId);
    for (const f of friendlies)
      for (const c of successesOf(f)) {
        const id = String(c.spellId);
        if (!ANTI_MAGIC_SHELL_ANSWER_IDS.has(id)) continue;
        const ms = tsOf(c);
        if (ms < w0 || ms > w1) continue;
        const dest: string | undefined = c.destUnitId;
        const selfCast = !dest || /^0+$/.test(dest) || dest === f.id;
        const forPressured =
          (f.id === pr.unitId && selfCast) || dest === pr.unitId;
        if (!forPressured) continue;
        ctx.bump("amsInBurstWindow");
        // the damage on the pressured unit by school, landed and absorbed,
        // the one reader the save candidates use (`incomingPressureBySchool`:
        // a hit the shell itself absorbed counts, a deferred tick counts
        // under the school it was thrown in; T300, codex 80-WSL-BW1-1 #2),
        // and the share the candidates read off it (`schoolShareCoveredBy`:
        // a mixed school counts when it shares a bit with the shell's mask;
        // codex 85-tk-L2-T300-1 #2); null = no damage
        const share = prUnit
          ? schoolShareCoveredBy(
              {
                dmg2sBySchool: incomingPressureBySchool(
                  prUnit,
                  w0,
                  w1,
                  sides(),
                  recordsAttackSpell(),
                ),
              },
              amsMask,
            )
          : null;
        const inList = p.responseCasts.some(
          (r) => r.spellId === id && r.casterId === f.id,
        );
        ctx.violate(
          "amsInBurstWindow",
          !inList
            ? "not in the response list"
            : share === null
              ? AMS_SHARES[2]
              : share >= SCHOOL_SAVE_MIN_SHARE
                ? AMS_SHARES[0]
                : AMS_SHARES[1],
          ms,
          `${fact}|${f.id}|${id}|${ms}`,
          `window at ${p.tSec}s (${p.leadCd.spellName}): ${f.name} Anti-Magic Shell ${id} at ${at(ms)}s${dest === pr.unitId && f.id !== pr.unitId ? ` on ${pr.name}` : ""}; pressured ${pr.name} low ${pr.minHpPct ?? "?"}%${pr.died ? " (died)" : ""}; covered share ${share === null ? "-" : `${Math.round(100 * share)}%`}; responded ${p.responded}`,
        );
      }

    // ── R113: no response pressed more than PRE before the opener's ms ────
    for (const r of p.responseCasts) {
      // a landed control answers by its landing and prints its press or
      // its totem's drop however early (rulings R90 / R109)
      if (r.category === "control" && r.landed === undefined) continue;
      ctx.bump("preWallBeforeOpenerMs");
      if (!(r.latencySec < -(BURST_RESPONSE_PRE_MS / 1000) - 0.05)) continue;
      ctx.violate(
        "preWallBeforeOpenerMs",
        `a ${r.category} pressed before the allowance`,
        p.tMs,
        `${fact}|${r.casterName}|${r.spellId}|${r.tSec}`,
        `window at ${p.tSec}s (${p.leadCd.spellName}): ${r.casterName} ${r.spellName} (${r.category}) ${r.latencySec}s; pressured ${pr.name} low ${pr.minHpPct ?? "?"}%${pr.died ? " (died)" : ""}`,
      );
    }
  }

  // ── both rulings on the capture: the owner's slow-defensive-response rows
  if (isHealerSpec(owner.spec)) {
    // the producer's own selection: the whole candidate pass (the builder's
    // rows less whatever the pass drops after it), not the builder alone
    // the tables the pass reads are loaded: the entry that runs this
    // module (verify/run.ts, verify/scan.ts) awaits ensureAnalysisData
    // first; a menu built before them is a degraded one, so refuse
    if (!analysisDataReady())
      throw new Error("scan5/t258: await ensureAnalysisData() first");
    let rows: ReturnType<typeof extractCandidateFindings> = [];
    try {
      // with the round's raw streams, the menu as the app builds it
      // (eval/test/rawStreamsEntrypoints.test.ts)
      rows = extractCandidateFindings(ctx.legacy, owner.id, ctx.rawStreams());
    } catch {
      return;
    }
    const emitted = new Set(
      rows
        .filter((row) => row.type === "slow-defensive-response")
        .map((row) => Number(row.id.split(":").pop())),
    );
    const printed = new Set(
      [...ctx.menu.matchAll(MENU_ROW)].map((m) => Number(m[1])),
    );
    for (const t of new Set([...emitted, ...printed])) {
      ctx.bump("slowResponseRowDiffers");
      if (emitted.has(t) === printed.has(t)) continue;
      const p = points.find((x) => x.tSec === t);
      ctx.violate(
        "slowResponseRowDiffers",
        printed.has(t)
          ? "printed, the pass emits none"
          : "not printed, the pass emits it",
        ctx.start + t * 1000,
        `${ctx.roundKey}|${owner.reaction}|${t}`,
        `window at ${t}s${p ? ` (${p.leadCd.spellName}); responded ${p.responded}; responses ${p.responseCasts.map((r) => `${r.spellName} ${r.latencySec}s`).join(", ") || "-"}` : ": the engine has no window"}`,
      );
    }
  }

  // ── R114 (inventory): a pet's copy alone keeps a dead caster's effect alive ──────
  if (!ctx.firstOwnerOfRound) return;
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  const holdersOnly = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: Object.fromEntries(
      Object.entries(ctx.legacy.units ?? {}).filter(([, u]) =>
        isEffectHolderUnit(u as any),
      ),
    ),
  };
  for (const u of ctx.players as any[]) {
    const diedMs = firstDeathMs(u);
    if (!Number.isFinite(diedMs) || diedMs > ctx.end) continue;
    const diedS = (diedMs - ctx.start) / 1000;
    const casts = reconstructEnemyCDTimeline(
      [u] as never,
      combat as never,
    ).players.flatMap((p) => p.offensiveCDs);
    for (const cd of casts) {
      if (cd.castTimeSeconds > diedS) continue;
      // due to run past the death: the official end the producer kept, or
      // the end it reads
      const dueEndS = Math.max(
        cd.buffEndSeconds,
        cd.deathCutOfficialEndSeconds ?? -Infinity,
      );
      if (!(dueEndS - diedS > AURA_NATURAL_END_JITTER_S)) continue;
      ctx.bump("petCopyKeepsEffectAfterDeath");
      const effect = cooldownEffectAuras(cd.spellId, cd.spellName);
      const untilMs = diedMs + DEATH_CASCADE_MS;
      const all = casterAuraOutlives(u, effect, untilMs, combat as never);
      const held = casterAuraOutlives(u, effect, untilMs, holdersOnly as never);
      const kind = !all.any
        ? PET_KINDS[3]
        : !all.outlives
          ? PET_KINDS[2]
          : held.outlives
            ? PET_KINDS[1]
            : PET_KINDS[0];
      ctx.violate(
        "petCopyKeepsEffectAfterDeath",
        kind,
        diedMs,
        `${ctx.roundKey}|${u.id}|${cd.spellId}|${cd.castTimeSeconds}`,
        `${u.name} ${nameOf(cd.spellId, cd.spellName)} pressed ${cd.castTimeSeconds.toFixed(1)}s, died ${diedS.toFixed(1)}s, listed to ${cd.buffEndSeconds.toFixed(1)}s, official end ${dueEndS.toFixed(1)}s${cd.deathCutAtSeconds !== undefined ? ` (death cut ${cd.deathCutAtSeconds.toFixed(1)}s)` : ""}`,
      );
    }
  }
}
