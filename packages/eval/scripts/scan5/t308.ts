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
 *  - `surely up: aura rows` — a REFRESH / APPLIED_DOSE / REMOVED_DOSE of the
 *    aura on the owner by the owner more than 1 s past the printed end;
 *  - `surely up: effect rows` — a damage / heal row of the owner under the
 *    aura's or the press's English name more than 1 s past the printed end;
 *  - `lost: re-applied` — an APPLIED of the aura on the owner later in the
 *    round with no REMOVED before it: the first life ended unlogged;
 *  - `can't tell` — none of these.
 * Every kind is out of the total (an inventory for the ruling).
 *
 * `report()` adds, per aura, the lives the log does close (APPLIED to its
 * REMOVED, no later ledger entry of the spell inside) and how many of the
 * `can't tell` facts end before the longest of them (the round's end inside
 * a life the corpus has seen).
 */
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { analyzeBurstLedger } from "@gladlog/analysis/src/utils/burstLedger";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { APPLIED, ev, type IRoundCtx, REFRESH, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["burstAuraPastSpan"] as const;

const KINDS = [
  "surely up: aura rows",
  "surely up: effect rows",
  "lost: re-applied",
  "can't tell",
] as const;
const PAST_MS = 1000;

/** aura id → closed lives (s); spell name → official span (s) seen */
const lives = new Map<string, number[]>();
const auraName = new Map<string, string>();
/** the `can't tell` facts: aura id, the round's end after the APPLIED (s) */
const undecided: Array<{ aura: string; spell: string; toEndS: number }> = [];
const seen = new Set<string>();
/** spell → evidence → distinct facts */
const perSpell = new Map<string, Map<string, number>>();

function effectName(r: any): string {
  return r.attackSpellId
    ? getEnglishSpellName(String(r.attackSpellId), r.attackSpellName ?? "")
    : getEnglishSpellName(String(r.spellId), r.spellName ?? "");
}

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
  const endS = (endMs - ctx.start) / 1000;
  const own = ((owner.auraEvents ?? []) as any[]).filter(
    (r) => r.srcUnitId === owner.id && r.destUnitId === owner.id,
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
    const renewed = all
      .filter(
        (o) => o.spellId === s.spellId && o.castTimeSeconds > s.castTimeSeconds,
      )
      .reduce((m, o) => Math.min(m, o.castTimeSeconds), Infinity);
    const gone = own.find(
      (r) =>
        r.spellId === app.spellId &&
        ev(r) === REMOVED &&
        tsOf(r) > tsOf(app) &&
        tsOf(r) <= endMs,
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
    const upTo = Math.min(renewed, endS);
    if (s.spanToSeconds >= upTo - 1) continue;
    ctx.bump("burstAuraPastSpan");
    const pastMs = ctx.start + s.spanToSeconds * 1000 + PAST_MS;
    const untilMs = Math.min(endMs, ctx.start + renewed * 1000);
    const reapplied = own.some(
      (r) =>
        r.spellId === app.spellId &&
        ev(r) === APPLIED &&
        tsOf(r) > tsOf(app) + PAST_MS &&
        tsOf(r) <= untilMs,
    );
    const auraRows = own.some(
      (r) =>
        r.spellId === app.spellId &&
        (ev(r) === REFRESH ||
          ev(r) === "SPELL_AURA_APPLIED_DOSE" ||
          ev(r) === "SPELL_AURA_REMOVED_DOSE") &&
        tsOf(r) > pastMs &&
        tsOf(r) <= untilMs,
    );
    const names = new Set([
      s.spellName,
      getEnglishSpellName(app.spellId, app.spellName ?? ""),
    ]);
    const effectRows = [...(owner.damageOut ?? []), ...(owner.healOut ?? [])]
      .filter((r: any) => r.srcUnitId === owner.id)
      .some(
        (r: any) =>
          tsOf(r) > pastMs && tsOf(r) <= untilMs && names.has(effectName(r)),
      );
    const evidence = reapplied
      ? "lost: re-applied"
      : auraRows
        ? "surely up: aura rows"
        : effectRows
          ? "surely up: effect rows"
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
      `${s.spellName} ${s.castTimeSeconds.toFixed(1)}–${s.spanToSeconds.toFixed(1)}s printed (official ${(s.spanToSeconds - s.castTimeSeconds).toFixed(1)}s); aura ${app.spellId} has no REMOVED to ${((untilMs - ctx.start) / 1000).toFixed(1)}s`,
    );
  }
}

/** every kind is an inventory */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  KINDS.map((k) => `burstAuraPastSpan|${k}`),
);

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
