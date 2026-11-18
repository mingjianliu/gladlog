/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, actionIn) */
/**
 * scan5/t169.ts — ticket T169 (round 14 D8 / D9): two tolerances on how a
 * control ended.
 *
 *  - `channelKickCauseNotLogged`: a channelled control (`CHANNELED_SPELL_IDS`)
 *    on a player whose REMOVED follows, by up to 1 s, a SPELL_INTERRUPT on
 *    its caster that names this channel (`extraSpellId` the control or a
 *    cast whose effect it is). The log wrote the cause: the control's line
 *    (landing second, name, player) must not say `ended early — cause not
 *    logged`. Kind = how far the kick row sits before the REMOVED row.
 *    Checked = every such removal whose line is there. 3c8cd2a3 r0: Wind
 *    Shear on the priest's Mind Control 65 ms before it came off.
 *  - `trinketAfterRanOut`: a Gladiator's Medallion press (`pvpTrinketUses`,
 *    the producer's press instant) later than
 *    `PRESS_ENDED_CC_LAG_MS` after (and within
 *    `TRINKET_BREAK_AFTER_REMOVAL_MS` of) the REMOVED of a control on the
 *    presser that the log gives no other cause, where the control had run
 *    its full official length less at most `AURA_NATURAL_END_JITTER_S` — it
 *    ran out. No line may credit the trinket with it: `[ENEMY TRINKET] …
 *    out of <control>` at the press second, or the control's line saying
 *    `trinket broke this CC` / `ended by their PvP trinket`. Kind = how far
 *    short of the official length it ran; kinds beyond the jitter are an
 *    inventory, out of the total. The official length is the table's
 *    (`ccFullDurationSeconds`, no DR step): a control at a DR step runs
 *    shorter and is not judged here. 449dd530 3:49: Holy Word: Chastise ran
 *    2.997 s of 3 s, the Medallion 83 ms later, `used PvP trinket out of
 *    Holy Word: Chastise`.
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { ccFullDurationSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  PRESS_ENDED_CC_LAG_MS,
  TRINKET_BREAK_AFTER_REMOVAL_MS,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { pvpTrinketUses } from "@gladlog/analysis/src/utils/pvpTrinketUses";
import {
  AURA_NATURAL_END_JITTER_S,
  DEATH_CASCADE_MS,
} from "@gladlog/analysis/src/utils/unitDeath";
import { LogEvent } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "channelKickCauseNotLogged",
  "trinketAfterRanOut",
  "naturalEndShortfall",
] as const;
const SHORT_KINDS = [
  "101–250 ms short",
  "251–500 ms short",
  "over 500 ms short",
];
const NATURAL_KINDS = [
  "over by 11–50 ms",
  "over by 1–10 ms",
  "on its official end",
  "1–10 ms short",
  "11–25 ms short",
  "26–50 ms short",
  "51–100 ms short",
  "101–250 ms short",
];
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  ...SHORT_KINDS.map((k) => `trinketAfterRanOut|${k}`),
  ...NATURAL_KINDS.map((k) => `naturalEndShortfall|${k}`),
]);
const naturalKind = (short: number): string | undefined =>
  short < -50 || short > 250
    ? undefined
    : short < -10
      ? NATURAL_KINDS[0]
      : short < 0
        ? NATURAL_KINDS[1]
        : short === 0
          ? NATURAL_KINDS[2]
          : short <= 10
            ? NATURAL_KINDS[3]
            : short <= 25
              ? NATURAL_KINDS[4]
              : short <= 50
                ? NATURAL_KINDS[5]
                : short <= 100
                  ? NATURAL_KINDS[6]
                  : NATURAL_KINDS[7];

const KICK_LOOKBACK_MS = 1000;
const JITTER_MS = AURA_NATURAL_END_JITTER_S * 1000;
const BROKEN = new Set<string>([
  LogEvent.SPELL_AURA_BROKEN,
  LogEvent.SPELL_AURA_BROKEN_SPELL,
]);

const leadKind = (ms: number): string =>
  ms <= 50
    ? "kick 0–50 ms before"
    : ms <= 100
      ? "kick 51–100 ms before"
      : ms <= 250
        ? "kick 101–250 ms before"
        : "kick 251–1000 ms before";
const shortKind = (ms: number): string =>
  ms <= 0
    ? "ran its full length"
    : ms <= 10
      ? "1–10 ms short"
      : ms <= 50
        ? "11–50 ms short"
        : ms <= JITTER_MS
          ? "51–100 ms short"
          : ms <= 250
            ? SHORT_KINDS[0]!
            : ms <= 500
              ? SHORT_KINDS[1]!
              : SHORT_KINDS[2]!;

export function run(ctx: IRoundCtx): void {
  const at = (ms: number) => fmtS((ms - ctx.start) / 1000);
  const byId = new Map<string, any>(ctx.units.map((u) => [u.id, u]));
  const ccLinesOf = (pid: string, t: string, name: string): string[] =>
    ctx.lines.filter(
      (l) =>
        (l.startsWith(`${t}  [CC ON TEAM]   ${pid}(`) ||
          l.startsWith(`${t}  [CC ON ENEMY]   ${pid}(`)) &&
        l.includes(`← ${name} `),
    );
  const appliedBefore = (auras: any[], r: any): any =>
    [...auras]
      .reverse()
      .find(
        (a) =>
          a.spellId === r.spellId &&
          a.srcUnitId === r.srcUnitId &&
          ev(a) === APPLIED &&
          tsOf(a) <= tsOf(r),
      );

  for (const u of ctx.players as any[]) {
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    const auras = ((u.auraEvents ?? []) as any[]).filter(
      (a) => !a.destUnitId || a.destUnitId === u.id,
    );

    // the producer's press instants (`pvpTrinketUses`: the Medallion's own
    // aura, the cast row can trail it — codex 85-tk-CC-T169-1 #3)
    const presses = pvpTrinketUses(u)
      .filter((p) => p.kind === "medallion")
      .map((p) => p.atMs);
    const deaths = ((u.deathRecords ?? []) as any[]).map(
      (d) => d.timestamp as number,
    );

    // ── channelKickCauseNotLogged ─────────────────────────────────────────
    for (const r of auras) {
      if (ev(r) !== REMOVED || !r.spellId) continue;
      if (!CHANNELED_SPELL_IDS.has(r.spellId) || !ccSpellIds.has(r.spellId))
        continue;
      const rms = tsOf(r);
      if (rms < ctx.start || rms > ctx.roundEndAt) continue;
      const channelIds = new Set([r.spellId, ...castsOfEffectAura(r.spellId)]);
      const kick = [...((byId.get(r.srcUnitId)?.actionIn ?? []) as any[])]
        .reverse()
        .find(
          (a) =>
            ev(a) === LogEvent.SPELL_INTERRUPT &&
            tsOf(a) >= rms - KICK_LOOKBACK_MS &&
            tsOf(a) <= rms + PRESS_ENDED_CC_LAG_MS &&
            a.extraSpellId !== undefined &&
            channelIds.has(a.extraSpellId),
        );
      if (!kick) continue;
      const applied = appliedBefore(auras, r);
      if (!applied || tsOf(applied) > tsOf(kick)) continue;
      const t = at(tsOf(applied));
      const name = nameOf(r.spellId, r.spellName);
      const lines = ccLinesOf(pid, t, name);
      if (lines.length === 0) continue;
      ctx.bump("channelKickCauseNotLogged");
      const bad = lines.find((l) =>
        l.includes("ended early — cause not logged"),
      );
      if (bad)
        ctx.violate(
          "channelKickCauseNotLogged",
          leadKind(rms - tsOf(kick)),
          rms,
          `${ctx.roundKey}:${u.id}:${r.spellId}:${rms}`,
          `${name} on ${u.name} came off ${rms - tsOf(kick)} ms after ${nameOf(kick.spellId, kick.spellName)} interrupted it on its caster`,
          bad.trim().slice(0, 240),
        );
    }

    // ── naturalEndShortfall (inventory) ───────────────────────────────────
    // how far from its table length a control ends when nothing ended it:
    // no BROKEN row, no dispel, no Medallion within 300 ms, no death of its
    // holder within the teardown lag after it
    if (ctx.firstOwnerOfRound)
      for (const r of auras) {
        if (ev(r) !== REMOVED || !r.spellId || !ccSpellIds.has(r.spellId))
          continue;
        const rms = tsOf(r);
        if (rms < ctx.start || rms > ctx.roundEndAt) continue;
        const full = ccFullDurationSeconds(r.spellId);
        const applied = appliedBefore(auras, r);
        if (!applied || full === undefined) continue;
        const kind = naturalKind(
          Math.round(full * 1000 - (rms - tsOf(applied))),
        );
        if (!kind) continue;
        if (
          auras.some(
            (a) =>
              BROKEN.has(ev(a)) &&
              a.spellId === r.spellId &&
              Math.abs(tsOf(a) - rms) <= 50,
          ) ||
          ((u.actionIn ?? []) as any[]).some(
            (x) =>
              ev(x) === LogEvent.SPELL_DISPEL &&
              x.extraSpellId === r.spellId &&
              Math.abs(tsOf(x) - rms) <= 50,
          ) ||
          presses.some((ms) => Math.abs(ms - rms) <= 300) ||
          // the aura teardown of the holder's death (codex
          // 85-tk-CC-T169-1 #1, 0179dbd4 r1: a Mortal Coil removed 7 ms
          // before its holder's UNIT_DIED counted as 107 ms short)
          deaths.some((d) => d >= rms && d - rms <= DEATH_CASCADE_MS)
        )
          continue;
        ctx.violate(
          "naturalEndShortfall",
          kind,
          rms,
          `${ctx.roundKey}:${u.id}:${r.spellId}:${rms}`,
          `${nameOf(r.spellId, r.spellName)} on ${u.name}`,
        );
      }

    // ── trinketAfterRanOut ────────────────────────────────────────────────
    for (const ts of presses) {
      if (ts < ctx.start || ts > ctx.roundEndAt) continue;
      for (const r of auras) {
        if (ev(r) !== REMOVED || !r.spellId || !ccSpellIds.has(r.spellId))
          continue;
        const rms = tsOf(r);
        if (ts - rms <= PRESS_ENDED_CC_LAG_MS) continue;
        if (ts - rms > TRINKET_BREAK_AFTER_REMOVAL_MS) continue;
        // another logged cause at the removal: a BROKEN row or a dispel
        const caused =
          auras.some(
            (a) =>
              BROKEN.has(ev(a)) &&
              a.spellId === r.spellId &&
              tsOf(a) - rms <= 1 &&
              rms - tsOf(a) <= 50,
          ) ||
          ((u.actionIn ?? []) as any[]).some(
            (x) =>
              ev(x) === LogEvent.SPELL_DISPEL &&
              x.extraSpellId === r.spellId &&
              Math.abs(tsOf(x) - rms) <= 50,
          );
        if (caused) continue;
        const applied = appliedBefore(auras, r);
        const full = ccFullDurationSeconds(r.spellId);
        if (!applied || full === undefined) continue;
        const short = Math.round(full * 1000 - (rms - tsOf(applied)));
        const name = nameOf(r.spellId, r.spellName);
        const pressLine = ctx.lines.find(
          (l) =>
            l.startsWith(`${at(ts)}  [ENEMY TRINKET]   ${pid}(`) &&
            l.includes(` out of ${name}`),
        );
        const ccLine = ccLinesOf(pid, at(tsOf(applied)), name).find((l) =>
          /trinket broke this CC|ended by their PvP trinket/.test(l),
        );
        const kind = shortKind(short);
        const inTotal = !OUT_OF_TOTAL.has(`trinketAfterRanOut|${kind}`);
        if (inTotal) ctx.bump("trinketAfterRanOut");
        const credited = pressLine ?? ccLine;
        if (credited)
          ctx.violate(
            "trinketAfterRanOut",
            kind,
            ts,
            `${ctx.roundKey}:${u.id}:${r.spellId}:${rms}`,
            `${name} on ${u.name} ran ${((rms - tsOf(applied)) / 1000).toFixed(3)} s of ${full} s, Medallion ${ts - rms} ms after it came off`,
            credited.trim().slice(0, 240),
          );
      }
    }
  }
}
