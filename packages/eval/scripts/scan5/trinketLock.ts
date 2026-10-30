/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents, auraEvents) */
/**
 * scan5/trinketLock.ts — PvP-trinket readiness (fact6 F20, D2 / D27 / B9:
 * 4caab013's Will to Survive locked the Medallion past the flat 60 s the
 * ledger models; the game refused the press "El objeto aún no está listo"
 * 66.5 s after it). The class is EVERY rendered statement of whether a
 * player's PvP trinket (or its trinket-sharing racial) is ready, checked
 * against the presses the log shows — not the Will to Survive id alone.
 *
 * Log truth, per unit, inside the round (rows only, never the readiness
 * predicate):
 *  - S  = a trinket USE: SPELL_CAST_SUCCESS 336126 (Gladiator's Medallion) or
 *         a self SPELL_AURA_APPLIED 283167 (Adaptation's trigger). A use at s
 *         proves the trinket was ready at s.
 *  - F  = a REFUSED Medallion press: the recorder's SPELL_CAST_FAILED 336126
 *         (`ctx.rawStreams().castFailed`, only the log owner's are logged)
 *         whose reason is the client's "item not ready" text in any locale
 *         (`ITEM_NOT_READY` below: the product's `OTHER_REFUSAL_REASONS["item not
 *         ready yet"]` plus ru / ko, which that list lacks). An F within
 *         KEY_REPEAT_MS of an S of the same unit, either row order, is the
 *         key repeating on the press itself and is dropped. An F at f proves
 *         the trinket was NOT ready at f — and, cooldowns only counting down,
 *         at every earlier instant from which no new lock began before f.
 *  - L  = a lock START: an S, or a press of a racial that shares the
 *         trinket's lock (DB2 SpellCategories.Category 1166: Will to Survive
 *         59752 / Will of the Forsaken 7744 casts, Stoneform / Fireblood read
 *         from their self buffs 65116 / 273104 — their casts are not logged).
 *  - racial evidence (the `X: ON CD (Ns left)` note): S_r = the racial's own
 *         press (as above); F_r = the recorder's SPELL_CAST_FAILED 59752 with a
 *         `NOT_READY_REASONS` text (Will to Survive is off the GCD — DB2
 *         StartRecoveryCategory 0 — so its "not yet recovered" is the
 *         cooldown; 7744 sits in GCD category 133 and its not-ready presses
 *         are mostly the GCD, so only Will to Survive refusals are read). The
 *         racial's lock starts: S_r or a trinket S.
 *
 * Rendered claims (context timeline; T = the printed second, the claim's
 * own instant x lies in [T, T+1)):
 *  - `[CC ON TEAM] N(..) ← … | trinket: ON CD (Ns left…)` → back in (T+N−1, T+N+1);
 *  - a `[CC ON TEAM]` line of a trinket owner (≥1 S or F in the round) with no
 *    trinket note at all (no `trinket: ON CD`, `trinket broke this CC`,
 *    `PvP trinket NOT used`, `ended by their PvP trinket`) → ready at x;
 *  - `[DEATH] N(..) … (PvP Trinket available…)` → ready at the death;
 *  - `[HEALER EXPOSURE] … healer trinket ready` → the friendly healer ready;
 *    `healer trinket on CD (back m:ss)` → back in [B, B+1);
 *  - `[PEEL OPTION]` / `[CC BOOKMARK]` `at m:ss: … , N(..) PvP trinket ready`
 *    → the target ready at m:ss (enemies: S evidence only — no F is logged
 *    for them, so the check can only ever fire on the owner's side);
 *  - `[CC ON TEAM]` `(Will to Survive|Will of the Forsaken|Stoneform|
 *    Fireblood): ON CD (Ns left)` → that racial back in (T+N−1, T+N+1); and a
 *    `[CC ON TEAM]` line of a unit seen pressing Will to Survive in the round,
 *    not itself broken by the trinket / a racial, with no such note → ready.
 *
 * Check `trinketReadyVsPress`, kinds `<reader>: <test>`:
 *  - `ready, refused later` — a ready claim and an F at f ≥ T+1 with no L in
 *    [T, f];
 *  - `ON CD understated` — back by B (= T+N+1, or HEALER EXPOSURE's B+1) and
 *    an F at f ≥ B with no L in [T, f];
 *  - `ON CD overstated` — an S at T+1 ≤ s < T+N−1 (B for HEALER EXPOSURE);
 *  - `racial …` — the same three on the racial evidence.
 * Not read: the KILL ATTEMPTS tier (`trinket up` / PRIME) — enemy, and by
 * user ruling P-b7 (2026-10-01) it deliberately ignores the racial lock;
 * `PvP trinket on cooldown` (PEEL / BOOKMARK) — no row can show an enemy's
 * trinket was ready at an instant without pressing it. Fact identity =
 * unit, printed second, reader, test: one per falsified line, the same in
 * every owner's context of the round.
 *
 * Check `trinketPressVsModel` (measured only, out of the total): every trinket
 * press row against the product's model at that instant —
 * `pvpTrinketRemainingSecondsAt(analyzePlayerCCAndTrinket(...), t)`, evaluated
 * just before the press (MEDALLION_AURA_LEAD_S, so the press's own aura does
 * not count): an S while the model says ON CD by more than PRESS_SLACK_S
 * (`success while model ON CD`), an F while the model says ready
 * (`refusal while model ready`). It audits the predicate itself, including
 * the lock lengths no rendered line happens to sit on; once per round.
 */
import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import { OTHER_REFUSAL_REASONS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import {
  analyzePlayerCCAndTrinket,
  pvpTrinketRemainingSecondsAt,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { APPLIED, ev, fmtS, type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["trinketReadyVsPress", "trinketPressVsModel"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "trinketPressVsModel|refusal while model ready",
  "trinketPressVsModel|success while model ON CD",
]);

const MEDALLION = "336126";
const ADAPTATION_TRIGGER = "283167";
const WILL_TO_SURVIVE = "59752";
/** category-1166 racials: cast-logged ones, and the buff-logged ones → their racial */
const LOCK_RACIAL_CASTS = new Set(["59752", "7744"]);
const LOCK_RACIAL_BUFFS: Record<string, string> = {
  "65116": "20594", // Stoneform
  "273104": "265221", // Fireblood
};
const RACIAL_BY_NAME: Record<string, string> = {
  "Will to Survive": "59752",
  "Will of the Forsaken": "7744",
  Stoneform: "20594",
  Fireblood: "265221",
};
/** "item not ready yet" in every client locale the corpus carries. The
 * product's list lacks ru and ko (corpus: 7 and 1 Medallion rows on the
 * 605 + wide captures) — added here until the product list has them. */
const ITEM_NOT_READY: ReadonlySet<string> = new Set([
  ...(OTHER_REFUSAL_REASONS["item not ready yet"] ?? []),
  "Предмет еще не готов.",
  "아직 사용할 준비가 안 됐습니다.",
]);
/** a refusal this close to a success of the same unit is the key repeating */
const KEY_REPEAT_MS = 300;
/** the Medallion's own aura is logged ≤ 150 ms before its cast row */
const MEDALLION_AURA_LEAD_S = 0.35;
/** model rounding slack for the measured control */
const PRESS_SLACK_S = 0.5;

interface IEvidence {
  /** trinket uses (ms) */
  S: number[];
  /** refused Medallion presses (ms) */
  F: number[];
  /** trinket lock starts (ms) */
  L: number[];
  /** per racial id: own presses (ms) */
  Sr: Map<string, number[]>;
  /** Will to Survive refused presses (ms) */
  Fr: number[];
}

function evidenceOf(ctx: IRoundCtx, u: any): IEvidence {
  const inRound = (t: number) => t >= ctx.start && t <= ctx.end;
  const S: number[] = [];
  const Sr = new Map<string, number[]>();
  const addR = (id: string, t: number) =>
    Sr.set(id, [...(Sr.get(id) ?? []), t]);
  for (const c of successesOf(u)) {
    const t = tsOf(c);
    if (!inRound(t)) continue;
    const id = String(c.spellId ?? "");
    if (id === MEDALLION) S.push(t);
    else if (LOCK_RACIAL_CASTS.has(id)) addR(id, t);
  }
  for (const a of (u.auraEvents ?? []) as any[]) {
    if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
    if (a.destUnitId !== undefined && a.destUnitId !== u.id) continue;
    const t = tsOf(a);
    if (!inRound(t)) continue;
    const id = String(a.spellId ?? "");
    if (id === ADAPTATION_TRIGGER) S.push(t);
    else if (LOCK_RACIAL_BUFFS[id]) addR(LOCK_RACIAL_BUFFS[id], t);
  }
  S.sort((a, b) => a - b);
  const failed = ctx
    .rawStreams()
    .castFailed.filter((f) => f.unitGuid === u.id)
    .map((f) => ({ ...f, t: ctx.start + f.tSeconds * 1000 }))
    .filter((f) => inRound(f.t));
  const near = (t: number, xs: number[]) =>
    xs.some((x) => Math.abs(x - t) <= KEY_REPEAT_MS);
  const F = failed
    .filter(
      (f) =>
        String(f.spellId) === MEDALLION &&
        ITEM_NOT_READY.has(f.reason.trim()) &&
        !near(f.t, S),
    )
    .map((f) => f.t);
  const wts = Sr.get(WILL_TO_SURVIVE) ?? [];
  const Fr = failed
    .filter(
      (f) =>
        String(f.spellId) === WILL_TO_SURVIVE &&
        NOT_READY_REASONS.has(f.reason.trim()) &&
        !near(f.t, wts),
    )
    .map((f) => f.t);
  const L = [...S, ...[...Sr.values()].flat()].sort((a, b) => a - b);
  return { S, F, L, Sr, Fr };
}

const CC_ON_TEAM = /^(\d+):(\d{2})\s+\[CC ON TEAM\]\s+(\d+)\(/;
const DEATH = /^(\d+):(\d{2})\s+\[DEATH\]\s+(\d+)\(/;
const HEALER_EXPOSURE =
  /^(\d+):(\d{2})\s+\[HEALER EXPOSURE\].*?healer trinket (ready|on CD \(back (\d+):(\d{2})\))/;
const PEEL_OR_BOOKMARK =
  /\[(PEEL OPTION|CC BOOKMARK)\].*\| at (\d+):(\d{2}): .*, (\d+)\([^)]*\) PvP trinket (ready|on cooldown)\s*$/;
const TRINKET_BREAK_NOTE =
  /trinket broke this CC|PvP trinket NOT used|ended by their PvP trinket/;
const RACIAL_NOTE =
  /(Will to Survive|Will of the Forsaken|Stoneform|Fireblood): ON CD \((\d+)s left\)/g;
const RACIAL_BROKE =
  /(Will to Survive|Will of the Forsaken|Stoneform|Fireblood) broke this CC/;

const fmtMs = (ctx: IRoundCtx, t: number) => {
  const s = (t - ctx.start) / 1000;
  return `${fmtS(s)}.${Math.floor((s % 1) * 10)}`;
};

export function run(ctx: IRoundCtx): void {
  claims(ctx);
  if (ctx.firstOwnerOfRound) pressVsModel(ctx);
}

function claims(ctx: IRoundCtx): void {
  const C = "trinketReadyVsPress";
  const cache = new Map<string, IEvidence>();
  const evOf = (u: any) => {
    let e = cache.get(u.id);
    if (!e) cache.set(u.id, (e = evidenceOf(ctx, u)));
    return e;
  };
  const msOf = (sec: number) => ctx.start + sec * 1000;
  /** the first refusal at/after `from` with no lock start in [claimAt, f] */
  const refusedAfter = (
    F: number[],
    L: number[],
    claimAt: number,
    from: number,
  ) => F.find((f) => f >= from && !L.some((l) => l >= claimAt && l <= f));
  const report = (
    u: any,
    T: number,
    reader: string,
    test: string,
    atMs: number,
    detail: string,
    line: string,
  ) =>
    ctx.violate(
      C,
      `${reader}: ${test}`,
      atMs,
      `${u.id}:${T}:${reader}:${test}`,
      `${u.name} ${fmtS(T)} ${detail}`,
      line,
    );
  const ready = (u: any, T: number, reader: string, line: string) => {
    const e = evOf(u);
    ctx.bump(C);
    const f = refusedAfter(e.F, e.L, msOf(T), msOf(T + 1));
    if (f !== undefined)
      report(
        u,
        T,
        reader,
        "ready, refused later",
        f,
        `said ready; the Medallion press at ${fmtMs(ctx, f)} was refused "not ready" with no trinket use or shared-lock racial in between`,
        line,
      );
  };
  /** back in [lo, hi): understated when refused at/after hi, overstated when used before lo */
  const onCd = (
    u: any,
    T: number,
    lo: number,
    hi: number,
    reader: string,
    line: string,
  ) => {
    const e = evOf(u);
    ctx.bump(C);
    const f = refusedAfter(e.F, e.L, msOf(T), msOf(hi));
    if (f !== undefined)
      report(
        u,
        T,
        reader,
        "ON CD understated",
        f,
        `said back by ${fmtS(hi)}; the Medallion press at ${fmtMs(ctx, f)} was refused "not ready" with no trinket use or shared-lock racial in between`,
        line,
      );
    const s = e.S.find((x) => x >= msOf(T + 1) && x < msOf(lo));
    if (s !== undefined)
      report(
        u,
        T,
        reader,
        "ON CD overstated",
        s,
        `said not back before ${fmtS(lo)}; the trinket was used at ${fmtMs(ctx, s)}`,
        line,
      );
  };
  const racial = (
    u: any,
    T: number,
    racialId: string,
    racialName: string,
    lo: number | null,
    hi: number | null,
    line: string,
  ) => {
    const e = evOf(u);
    ctx.bump(C);
    const own = e.Sr.get(racialId) ?? [];
    // the racial's lock starts: its own press and a trinket use
    const Lr = [...own, ...e.S];
    const Fr = racialId === WILL_TO_SURVIVE ? e.Fr : [];
    const reader = "[CC ON TEAM]";
    if (lo === null || hi === null) {
      const f = refusedAfter(Fr, Lr, msOf(T), msOf(T + 1));
      if (f !== undefined)
        report(
          u,
          T,
          reader,
          `racial ready, refused later`,
          f,
          `no ${racialName} note (= ready); its press at ${fmtMs(ctx, f)} was refused "not yet recovered" with no ${racialName} or trinket use in between`,
          line,
        );
      return;
    }
    const f = refusedAfter(Fr, Lr, msOf(T), msOf(hi));
    if (f !== undefined)
      report(
        u,
        T,
        reader,
        "racial ON CD understated",
        f,
        `${racialName} said back by ${fmtS(hi)}; its press at ${fmtMs(ctx, f)} was refused "not yet recovered" with no ${racialName} or trinket use in between`,
        line,
      );
    const s = own.find((x) => x >= msOf(T + 1) && x < msOf(lo));
    if (s !== undefined)
      report(
        u,
        T,
        reader,
        "racial ON CD overstated",
        s,
        `${racialName} said not back before ${fmtS(lo)}; pressed at ${fmtMs(ctx, s)}`,
        line,
      );
  };

  const friendlyHealers = ctx.players.filter(
    (p) => p.reaction === ctx.owner.reaction && isHealerSpec(p.spec),
  );
  for (const line of ctx.lines) {
    let m = CC_ON_TEAM.exec(line);
    if (m) {
      const u = ctx.unitOfPid(m[3]);
      if (!u) continue;
      const T = Number(m[1]) * 60 + Number(m[2]);
      const e = evOf(u);
      const cd = /trinket: ON CD \((\d+)s left/.exec(line);
      const broken = TRINKET_BREAK_NOTE.test(line);
      if (cd) {
        const n = Number(cd[1]);
        onCd(u, T, T + n - 1, T + n + 1, "[CC ON TEAM]", line);
      } else if (!broken && (e.S.length > 0 || e.F.length > 0))
        ready(u, T, "[CC ON TEAM] no trinket note", line);
      const noted = new Set<string>();
      for (const r of line.matchAll(RACIAL_NOTE)) {
        const id = RACIAL_BY_NAME[r[1]!]!;
        noted.add(id);
        const n = Number(r[2]);
        racial(u, T, id, r[1]!, T + n - 1, T + n + 1, line);
      }
      if (
        !noted.has(WILL_TO_SURVIVE) &&
        !broken &&
        !RACIAL_BROKE.test(line) &&
        (e.Sr.get(WILL_TO_SURVIVE)?.length ?? 0) > 0
      )
        racial(u, T, WILL_TO_SURVIVE, "Will to Survive", null, null, line);
      continue;
    }
    m = DEATH.exec(line);
    if (m) {
      if (!line.includes("(PvP Trinket available")) continue;
      const u = ctx.unitOfPid(m[3]);
      if (u) ready(u, Number(m[1]) * 60 + Number(m[2]), "[DEATH]", line);
      continue;
    }
    m = HEALER_EXPOSURE.exec(line);
    if (m) {
      if (friendlyHealers.length !== 1) continue;
      const u = friendlyHealers[0];
      const T = Number(m[1]) * 60 + Number(m[2]);
      if (m[3] === "ready") ready(u, T, "[HEALER EXPOSURE]", line);
      else {
        const B = Number(m[4]) * 60 + Number(m[5]);
        onCd(u, T, B, B + 1, "[HEALER EXPOSURE]", line);
      }
      continue;
    }
    const p = PEEL_OR_BOOKMARK.exec(line);
    if (p && p[5] === "ready") {
      const u = ctx.unitOfPid(p[4]);
      if (u) ready(u, Number(p[2]) * 60 + Number(p[3]), `[${p[1]}]`, line);
    }
  }
}

function pressVsModel(ctx: IRoundCtx): void {
  const C = "trinketPressVsModel";
  const castFailed = ctx.rawStreams().castFailed;
  for (const u of ctx.players) {
    const e = evidenceOf(ctx, u);
    if (e.S.length === 0 && e.F.length === 0) continue;
    const enemies = ctx.players.filter((x) => x.reaction !== u.reaction);
    const enemyIds = new Set(enemies.map((x) => x.id));
    const enemyPets = ctx.units.filter(
      (x) => x.ownerId && enemyIds.has(x.ownerId),
    );
    let summary: any;
    try {
      summary = analyzePlayerCCAndTrinket(
        u,
        enemies,
        ctx.legacy as never,
        enemyPets,
        castFailed,
      );
    } catch {
      continue;
    }
    const remAt = (t: number) =>
      pvpTrinketRemainingSecondsAt(summary, (t - ctx.start) / 1000) ?? 0;
    for (const s of e.S) {
      ctx.bump(C);
      const rem = remAt(s - MEDALLION_AURA_LEAD_S * 1000);
      if (rem > PRESS_SLACK_S)
        ctx.violate(
          C,
          "success while model ON CD",
          s,
          `${u.id}:${s}`,
          `${u.name} used the trinket at ${fmtMs(ctx, s)}; the model said ${rem.toFixed(1)} s left`,
        );
    }
    for (const f of e.F) {
      ctx.bump(C);
      const rem = remAt(f);
      if (rem <= 0)
        ctx.violate(
          C,
          "refusal while model ready",
          f,
          `${u.id}:${f}`,
          `${u.name}'s Medallion press at ${fmtMs(ctx, f)} was refused "not ready"; the model said ready`,
        );
    }
  }
}
