/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t308.ts — ticket T308 (T284 (a), audit 01 D2): a burst ledger span
 * (`analyzeBurstLedger`, the producer's own spans) that ends more than 1 s
 * before the round's end while the owner's own aura of that press (APPLIED
 * or REFRESH within 1 s of the cast) logs no REMOVED inside the round and
 * the ledger has no later entry of the spell before the span's end — and
 * what the log shows of that aura past the printed end (user 2026-11-27:
 * an aura surely still up is printed; one that might have ended unlogged is
 * not — ~4.5 % of REMOVED rows are lost).
 *
 * Check `burstAuraPastSpan`, kind = the evidence (the spell in the detail;
 * `report()` splits per spell):
 *  - `surely up` (in the total) — the producer's own reading
 *    (`auraSurelyUpPastMs`: the aura's REFRESH / DOSE rows, or the owner's
 *    damage / heal rows under its name, more than 1 s past the printed
 *    end): the span should have run on (T308);
 *  - `lost: re-applied` — an APPLIED of the aura on the owner later in the
 *    round with no REMOVED before it: the first life ended unlogged;
 *  - `can't tell` — neither.
 * `lost` and `can't tell` are out of the total (an inventory).
 *
 * `report()` adds, per aura, the lives the log does close (APPLIED to its
 * REMOVED, no later ledger entry of the spell inside) and how many of the
 * `can't tell` facts end before the longest of them (the round's end inside
 * a life the corpus has seen).
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraRebroadcast";
import {
  AURA_SURELY_UP_PAST_MS,
  auraLifeLastPress,
  auraSurelyUpEndMs,
  auraSurelyUpUntilMs,
  otherEffectAurasOf,
  resentAuraApplications,
} from "@gladlog/analysis/src/utils/auraSurelyUp";
import { buffDurationOfApplication } from "@gladlog/analysis/src/utils/buffDuration";
import { analyzeBurstLedger } from "@gladlog/analysis/src/utils/burstLedger";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { APPLIED, ev, type IRoundCtx, REFRESH, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["burstAuraPastSpan"] as const;

const KINDS = ["surely up", "lost: re-applied", "can't tell"] as const;

/** aura id → closed lives (s); spell name → official span (s) seen */
let lives = new Map<string, number[]>();
let auraName = new Map<string, string>();
/** the `can't tell` facts: aura id, the round's end after the APPLIED (s) */
let undecided: Array<{ aura: string; spell: string; toEndS: number }> = [];
let seen = new Set<string>();
/** spell → evidence → distinct facts */
let perSpell = new Map<string, Map<string, number>>();

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let ledger: ReturnType<typeof analyzeBurstLedger>;
  try {
    const side = ctx.players.filter((u) => u.reaction === owner.reaction);
    const enemies = ctx.players.filter((u) => u.reaction !== owner.reaction);
    ledger = analyzeBurstLedger(owner, side, enemies, ctx.legacy);
  } catch {
    return;
  }
  const endMs = roundEndMs(ctx.legacy);
  // re-broadcast pairs dropped, as the interval builder and the predicate
  // read them (codex 85-tk-L5-T308-1 #7: a REMOVED / APPLIED pair mid-life
  // read as a closed life)
  // …and a REMOVED written with no source of an aura on the owner: it
  // closes the life as the builder pairs it (codex 85-tk-L5-T308-1d #7)
  const own = dropAuraRebroadcasts(
    ((owner.auraEvents ?? []) as any[]).filter(
      (r) =>
        r.destUnitId === owner.id &&
        (r.srcUnitId === owner.id ||
          ((!r.srcUnitId || r.srcUnitId === "0000000000000000") &&
            ev(r) === REMOVED)),
    ),
  );
  const all = ledger.flatMap((x) => x.spells);
  for (const s of all) {
    const castMs = ctx.start + s.castTimeSeconds * 1000;
    const app = own.find(
      (r) =>
        (r.spellId === s.spellId ||
          getEnglishSpellName(r.spellId, r.spellName ?? "") === s.spellName) &&
        (ev(r) === APPLIED || ev(r) === REFRESH) &&
        Math.abs(tsOf(r) - castMs) <= 1000,
    );
    if (!app) continue;
    const key = `${ctx.roundKey}|${owner.id}|${s.spellId}|${s.castTimeSeconds}`;
    const first = !seen.has(key);
    seen.add(key);
    // the spell's next press: a later ledger entry of it, or the owner's
    // next cast row of any button that puts the aura up — the producers'
    // own reading (`nextAuraPressMs`; codex 85-tk-L5-T308-1c #10:
    // Ascendance's Doom Winds closed the first press's life)
    // a granting press inside the life carries it on (the producers'
    // `auraLifeLastPress`; codex 85-tk-L5-T308-1f #3: 90c01e7f r6's
    // Ascendance 3.3 s into Doom Winds read as its next press) — from the
    // aura's own official end, as the producers cap it, not the printed span
    // (under ruling (B) the printed span IS the evidence's end)
    const ownFullS = buffDurationOfApplication(app.spellId, owner, tsOf(app));
    const life = auraLifeLastPress(
      owner,
      app.spellId,
      s.spellId,
      castMs,
      ownFullS === undefined
        ? ctx.start + s.spanToSeconds * 1000
        : tsOf(app) + ownFullS * 1000,
      (atMs) => buffDurationOfApplication(app.spellId, owner, atMs),
    );
    const renewed = Math.min(
      all
        .filter(
          (o) =>
            o.spellId === s.spellId && o.castTimeSeconds > s.castTimeSeconds,
        )
        .reduce((m, o) => Math.min(m, o.castTimeSeconds), Infinity),
      (life.nextPressMs - ctx.start) / 1000,
    );
    // the REMOVED that closes THIS life: before the spell's next press — a
    // later life's REMOVED leaves this one unclosed (codex 85-tk-L5-T308-1b
    // #11)
    // …and before the aura's next APPLIED: a REMOVED past it is that later
    // life's (codex 85-tk-L5-T308-1d #2, d79985d0 r6: Malevolence applied
    // at 25.7 and 48.6 s, removed at 61.7 s — read as a 36 s closed life)
    // — a new life as the builder reads one: an APPLIED re-sent inside the
    // life (`resentAuraApplications`) is none (codex 85-tk-L5-T308-1e #2,
    // c1dd6341: Avatar re-sent 2.7 s in, removed at its 20 s, read as lost)
    const auraRows = own.filter((r) => r.spellId === app.spellId);
    const resent = resentAuraApplications(owner, auraRows, app.spellId);
    const nextApplied = auraRows.find(
      (r) =>
        ev(r) === APPLIED &&
        r.srcUnitId === owner.id &&
        tsOf(r) > tsOf(app) &&
        !resent.has(r),
    );
    const gone = own.find(
      (r) =>
        r.spellId === app.spellId &&
        ev(r) === REMOVED &&
        tsOf(r) > tsOf(app) &&
        tsOf(r) <=
          Math.min(
            endMs,
            ctx.start + renewed * 1000,
            nextApplied ? tsOf(nextApplied) : Infinity,
          ),
    );
    auraName.set(app.spellId, s.spellName);
    // a life the log closes, with no later press of the spell inside it
    if (gone) {
      if (first && (tsOf(gone) - ctx.start) / 1000 <= renewed) {
        const l = lives.get(app.spellId) ?? [];
        l.push((tsOf(gone) - tsOf(app)) / 1000);
        lives.set(app.spellId, l);
      }
      continue;
    }
    // …and never past the owner's death (the producers' `auraSurelyUpUntilMs`)
    const untilMs = auraSurelyUpUntilMs(
      owner,
      tsOf(app),
      Math.min(endMs, ctx.start + renewed * 1000),
    );
    const upTo = (untilMs - ctx.start) / 1000;
    const capMs = life.capMs;
    const reapplied = auraRows.some(
      (r) =>
        ev(r) === APPLIED &&
        !resent.has(r) &&
        tsOf(r) > tsOf(app) + AURA_SURELY_UP_PAST_MS &&
        tsOf(r) <= untilMs,
    );
    // ruling (B) (codex 85-tk-L5-T308-1h #1): a life the log shows up past
    // its deadline is printed to its last evidence row — ±1 s, the printed
    // grid — no shorter (the T308 bug) and no longer (The Hunt, 7abf7067 r6)
    const evidenceEndMs = reapplied
      ? undefined
      : auraSurelyUpEndMs(
          owner,
          owner,
          app.spellId,
          s.spellId,
          capMs,
          untilMs,
          {
            nextPressMs: ctx.start + renewed * 1000,
            // a row of the press's other effect aura is no evidence (1c #9)
            otherAuraIds: otherEffectAurasOf(s.spellId, app.spellId),
            lifeStartMs: tsOf(app),
          },
        );
    if (evidenceEndMs === undefined && s.spanToSeconds >= upTo - 1) continue;
    ctx.bump("burstAuraPastSpan");
    if (
      evidenceEndMs !== undefined &&
      Math.abs(s.spanToSeconds - (evidenceEndMs - ctx.start) / 1000) <= 1
    )
      continue;
    const evidence = reapplied
      ? "lost: re-applied"
      : evidenceEndMs !== undefined
        ? "surely up"
        : "can't tell";
    if (first) {
      const m = perSpell.get(s.spellName) ?? new Map<string, number>();
      m.set(evidence, (m.get(evidence) ?? 0) + 1);
      perSpell.set(s.spellName, m);
    }
    if (evidence === "can't tell" && first)
      undecided.push({
        aura: app.spellId,
        spell: s.spellName,
        toEndS: (untilMs - tsOf(app)) / 1000,
      });
    ctx.violate(
      "burstAuraPastSpan",
      evidence,
      castMs,
      key,
      `${s.spellName} ${s.castTimeSeconds.toFixed(1)}–${s.spanToSeconds.toFixed(1)}s printed; aura ${app.spellId} has no REMOVED to ${((untilMs - ctx.start) / 1000).toFixed(1)}s${evidenceEndMs !== undefined ? `, its last evidence at ${((evidenceEndMs - ctx.start) / 1000).toFixed(1)}s` : ""}`,
    );
  }
}

/** the undecided kinds are an inventory */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstAuraPastSpan|lost: re-applied",
  "burstAuraPastSpan|can't tell",
]);

export function report(): string[] {
  const out = [
    "burstAuraPastSpan inventory — closed lives per aura (APPLIED to REMOVED, no later press inside): n / max s; can't-tell facts ending inside the longest closed life",
  ];
  const by = new Map<string, { n: number; inside: number }>();
  for (const u of undecided) {
    const max = Math.max(0, ...(lives.get(u.aura) ?? []));
    const b = by.get(u.aura) ?? { n: 0, inside: 0 };
    b.n++;
    if (u.toEndS <= max) b.inside++;
    by.set(u.aura, b);
  }
  for (const [spell, m] of [...perSpell].sort())
    out.push(
      `  per spell: ${spell}: ${KINDS.map((k) => `${k} ${m.get(k) ?? 0}`).join(", ")}`,
    );
  const auras = new Set([...by.keys()]);
  for (const a of auras) {
    const l = lives.get(a) ?? [];
    const b = by.get(a)!;
    out.push(
      `  ${auraName.get(a) ?? a} (${a}): closed lives ${l.length}, max ${l.length ? Math.max(...l).toFixed(1) : "-"} s; can't tell ${b.n}, of them the round's end inside the longest life ${b.inside}`,
    );
  }
  return out;
}

export const state = () => ({ lives, auraName, undecided, seen, perSpell });
export const load = (st: ReturnType<typeof state>): void => {
  ({ lives, auraName, undecided, seen, perSpell } = st);
};
