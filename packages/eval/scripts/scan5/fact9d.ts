/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, advancedActions, healIn, damageIn) */
/**
 * scan5/fact9d.ts — the round-9 audit's class-3 checks (fact9 F24: talent
 * copies and the HP of a press). Truth is read off the log rows; lookups
 * (the mitigation table's `pctOnOthers`, spell names) only name things.
 *
 *  - `allyCopyAsExternal` (D1): an `[ENEMY DEF]` line that puts a
 *    talent-shared wall on an ally as `X → unit` — a full external. The ally
 *    holds the talent's N % copy (`pctOnOthers`, Flameshaper Obsidian Scales
 *    15 %); the legend's form is `X + N% copy → unit`.
 *  - `copyPressMerged` (D13): an enemy's aura put up with no press of it (a
 *    talent copy — Exhilaration's Survival of the Fittest) and then
 *    REFRESHed, in a LATER second, by the unit's own press of it (cast row and
 *    REFRESH within 20 ms). The press is a press of its own: its second must
 *    carry an `[ENEMY DEF]` line of that spell. One line at the copy's second
 *    printed the press's HP there.
 *  - `pressHpAfterTriggeredHeal` (D18): an `[ENEMY DEF]` press line's
 *    `(at N% HP)` above the unit's last reading before a direct heal the
 *    press triggered — a heal from the unit on itself, under another spell,
 *    in the same millisecond as the press's own APPLIED / REFRESH and logged
 *    AFTER that aura row, within the press's 100 ms lead — and that heal
 *    spell's every direct heal on the unit (≥ 2) lands at the millisecond of
 *    a press of it: the pairing is a rule, not one coincidence.
 *  - `maxHpLagHealJump` (D33): the first sample of a max-HP lag run the
 *    product rewrote (its max HP differs from the one its own log line
 *    carries) whose current-HP jump from the row before is the unit's logged
 *    heals / hits between the two rows in LOG ORDER — a real heal, not a
 *    rescale (f73f4f15 r0 1:11: a same-ms heal behind a cast row; the
 *    pre-Healthstone reading took the Soulburn maximum). Reads the scanner's
 *    own parse: a base count needs the base tree's scanner.
 */
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import { PRESS_EFFECT_LEAD_MS } from "@gladlog/analysis/src/utils/cooldowns";

import {
  APPLIED,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "allyCopyAsExternal",
  "copyPressMerged",
  "pressHpAfterTriggeredHeal",
  "maxHpLagHealJump",
] as const;

const ENEMY_DEF =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}(\d+)\([^)]*\) \([^)]*\): (.+?)(?: \(| → | \+ \d+% copy → |$)/;
const lineOf = (e: any): number | undefined => e.logLine?.lineIndex;

let copyNames: Set<string> | undefined;
const allyCopyNames = () =>
  (copyNames ??= new Set(
    Object.entries(MITIGATION_TABLE)
      .filter(([, row]) => row.pctOnOthers !== undefined)
      .map(([id]) => nameOf(id)),
  ));

function allyCopies(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF.exec(line);
    if (!m || !m[0].endsWith(" → ") || !allyCopyNames().has(m[3]!)) continue;
    ctx.bump("allyCopyAsExternal");
    if (m[0].includes("% copy → ")) continue;
    ctx.violate(
      "allyCopyAsExternal",
      "enemyDef",
      ctx.start + secOf(m[1]!) * 1000,
      `${m[2]}#${m[1]}#${m[3]}`,
      `${m[3]} on an ally printed as a full external`,
      line.slice(0, 300),
    );
  }
}

/** pid → [second → spell names of its `[ENEMY DEF]` lines] */
function enemyDefLines(ctx: IRoundCtx): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  for (const line of ctx.lines) {
    const m = ENEMY_DEF.exec(line);
    if (!m) continue;
    const bySecond = out.get(m[2]!) ?? new Map<string, Set<string>>();
    bySecond.set(m[1]!, (bySecond.get(m[1]!) ?? new Set()).add(m[3]!));
    out.set(m[2]!, bySecond);
  }
  return out;
}

function copyPress(ctx: IRoundCtx): void {
  for (const [pid, bySecond] of enemyDefLines(ctx)) {
    const u = ctx.unitOfPid(pid);
    if (!u) continue;
    const own = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.srcUnitId === u.id && a.destUnitId === u.id,
    );
    const casts = successesOf(u);
    for (const c of casts) {
      const cMs = tsOf(c);
      // a press after the round's end is not this round's (codex 20-F24-11
      // #3); one at it is, as the timeline keeps it
      if (cMs > ctx.roundEndAt) continue;
      const refresh = own.some(
        (a) =>
          a.spellId === c.spellId &&
          a.logLine?.event === REFRESH &&
          Math.abs(tsOf(a) - cMs) <= 20,
      );
      if (!refresh) continue;
      // the copy: an APPLIED of it 0.15–1.5 s before the press, with no
      // cast of it beside that APPLIED
      const copy = own.find(
        (a) =>
          a.spellId === c.spellId &&
          a.logLine?.event === APPLIED &&
          cMs - tsOf(a) > 150 &&
          cMs - tsOf(a) <= 1500 &&
          !casts.some(
            (o) =>
              o.spellId === c.spellId && Math.abs(tsOf(o) - tsOf(a)) <= 150,
          ),
      );
      if (!copy) continue;
      const name = nameOf(c.spellId, c.spellName);
      const copyS = fmtS((tsOf(copy) - ctx.start) / 1000);
      const pressS = fmtS((cMs - ctx.start) / 1000);
      // printed at all (a spell the [ENEMY DEF] list carries), and in two
      // seconds (one second reads the same either way)
      if (!bySecond.get(copyS)?.has(name) || copyS === pressS) continue;
      ctx.bump("copyPressMerged");
      if (bySecond.get(pressS)?.has(name)) continue;
      ctx.violate(
        "copyPressMerged",
        "noPressLine",
        cMs,
        `${pid}#${name}@${pressS}`,
        `${name}: copy at ${copyS}, press at ${pressS} has no line of its own`,
      );
    }
  }
}

const AT_HP = /\(at (\d+)% HP\)/;
const pctOf = (a: any): number =>
  (100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp;

function triggeredHeals(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF.exec(line);
    const hp = AT_HP.exec(line);
    if (!m || !hp || m[0].endsWith(" → ")) continue;
    const u = ctx.unitOfPid(m[2]);
    if (!u) continue;
    const sec = secOf(m[1]!);
    const presses = successesOf(u).filter(
      (c) =>
        nameOf(c.spellId, c.spellName) === m[3] &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
    );
    for (const c of presses) {
      const cMs = tsOf(c);
      const auraRows = ((u.auraEvents ?? []) as any[]).filter(
        (a) =>
          a.spellId === c.spellId &&
          a.srcUnitId === u.id &&
          (a.logLine?.event === APPLIED || a.logLine?.event === REFRESH) &&
          tsOf(a) <= cMs &&
          tsOf(a) >= cMs - PRESS_EFFECT_LEAD_MS,
      );
      // every press of it, all round: the heal-follows-press rule needs the
      // pairing to hold at least twice (codex 20-F24-09 #1 — one same-ms
      // heal after the aura row can be a coincidence), against the press's
      // own SUCCESS rows within the lead, with no press of the heal's own
      // spell there (codex 20-F24-11 #1: an aura row is no press)
      const successMs = (spellId: string) =>
        successesOf(u)
          .filter((x) => x.spellId === spellId)
          .map(tsOf);
      const pressMs = successMs(c.spellId);
      const directHeals = (spellId: string) =>
        ((u.healIn ?? []) as any[]).filter(
          (x) =>
            x.spellId === spellId &&
            x.srcUnitId === u.id &&
            !String(x.logLine?.event ?? "").includes("PERIODIC"),
        );
      const paired = (spellId: string) => {
        const same = directHeals(spellId);
        const own = successMs(spellId);
        return (
          same.length >= 2 &&
          same.every(
            (x) =>
              pressMs.some(
                (ms) => ms >= tsOf(x) && ms - tsOf(x) <= PRESS_EFFECT_LEAD_MS,
              ) &&
              !own.some(
                (ms) => Math.abs(ms - tsOf(x)) <= PRESS_EFFECT_LEAD_MS,
              ),
          )
        );
      };
      const heal = ((u.healIn ?? []) as any[]).find(
        (h) =>
          h.srcUnitId === u.id &&
          h.spellId !== c.spellId &&
          nameOf(h.spellId, "") !== m[3] &&
          !String(h.logLine?.event ?? "").includes("PERIODIC") &&
          paired(h.spellId) &&
          auraRows.some(
            (a) =>
              tsOf(a) === tsOf(h) &&
              lineOf(a) !== undefined &&
              lineOf(h) !== undefined &&
              lineOf(a)! < lineOf(h)!,
          ),
      );
      if (!heal) continue;
      ctx.bump("pressHpAfterTriggeredHeal");
      const before = ((u.advancedActions ?? []) as any[])
        .filter(
          (a) =>
            a.advancedActorId === u.id &&
            a.advancedActorMaxHp > 0 &&
            (tsOf(a) < tsOf(heal) ||
              (tsOf(a) === tsOf(heal) &&
                lineOf(a) !== undefined &&
                lineOf(a)! < lineOf(heal)!)),
        )
        .sort(
          (a, b) => tsOf(a) - tsOf(b) || (lineOf(a) ?? 0) - (lineOf(b) ?? 0),
        )
        .pop();
      if (!before || tsOf(heal) - tsOf(before) > 3000) continue;
      const want = Math.floor(pctOf(before));
      const printed = +hp[1]!;
      if (printed <= want + 1) continue;
      ctx.violate(
        "pressHpAfterTriggeredHeal",
        "enemyDef",
        cMs,
        `${m[2]}#${m[3]}@${m[1]}`,
        `${m[3]} at ${m[1]}: printed ${printed}%, ${want}% before the ${nameOf(heal.spellId, "")} heal it triggered`,
        line.slice(0, 300),
      );
    }
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lagRuns(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players) {
    const rows = ((u.advancedActions ?? []) as any[])
      .filter(
        (a) =>
          a.advancedActorId === u.id &&
          a.advancedActorMaxHp > 0 &&
          lineOf(a) !== undefined,
      )
      .sort((a, b) => tsOf(a) - tsOf(b) || lineOf(a)! - lineOf(b)!);
    if (rows.length < 2) continue;
    const idRe = escapeRe(u.id);
    /** the max HP the row's own log line carries */
    const rawMax = (a: any): number | undefined => {
      const text = ctx.rawLines[lineOf(a)!];
      if (!text) return undefined;
      const m = new RegExp(
        `,${idRe},[^,]*,${a.advancedActorCurrentHp},(\\d+),`,
      ).exec(text);
      return m ? +m[1]! : undefined;
    };
    const events = [
      ...((u.healIn ?? []) as any[]).map((h) => ({
        ms: tsOf(h),
        line: lineOf(h),
        amount: Math.abs(h.effectiveAmount ?? 0),
      })),
      ...((u.damageIn ?? []) as any[]).map((d) => ({
        ms: tsOf(d),
        line: lineOf(d),
        amount: -Math.abs(d.effectiveAmount ?? 0),
      })),
    ].filter((e) => e.line !== undefined);
    for (let k = 1; k < rows.length; k++) {
      const p = rows[k - 1]!;
      const s = rows[k]!;
      const sRaw = rawMax(s);
      if (sRaw === undefined || sRaw === s.advancedActorMaxHp) continue;
      if (rawMax(p) !== p.advancedActorMaxHp) continue; // not the run's first
      ctx.bump("maxHpLagHealJump");
      const jump = s.advancedActorCurrentHp - p.advancedActorCurrentHp;
      if (jump === 0) continue;
      const sum = events
        .filter((e) => e.line! > lineOf(p)! && e.line! <= lineOf(s)!)
        .reduce((n, e) => n + e.amount, 0);
      if (sum === 0 || Math.abs(sum - jump) > 0.02 * Math.abs(jump)) continue;
      ctx.violate(
        "maxHpLagHealJump",
        "rewritten",
        tsOf(s),
        `${u.name}@${tsOf(s)}`,
        `${u.name} ${fmtS((tsOf(s) - ctx.start) / 1000)}: jump ${jump} = logged ${sum}, max rewritten ${sRaw} → ${s.advancedActorMaxHp}`,
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  allyCopies(ctx);
  copyPress(ctx);
  triggeredHeals(ctx);
  lagRuns(ctx);
}
