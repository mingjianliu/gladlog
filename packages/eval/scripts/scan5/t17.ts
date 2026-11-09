/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t17.ts — pipeline T17 (GH #129.1, user ruling Q3): a [RES] row's
 * `X(no mana a/b)` prints b, the cooldown's mana cost. A spell DB2 prices as
 * a percentage costs that share of BASE mana — what the caster's own cast
 * rows state — not of the reading's max (3282debd: Divine Toll `8.2k` for
 * 7,500 on a raised-max Holy Paladin).
 *
 * Check `noManaCostOffBase`, kind `offBase`: the tag's b is not the cost the
 * log implies. Truth comes from the log rows, not from the analysis cost
 * predicate: a flat row's cost; for a percentage row, the cost the owner's
 * own cast rows of that spell state (the most common), else DB2's
 * percentage of the base
 * mana the owner's other percentage-priced cast rows imply (stated cost ÷
 * percentage, the most common value), in the game's arithmetic (float32,
 * half to even — `pctCost`). The entry name is the longest text before the
 * tag that names a spell (a name may carry a comma). Counted: every tag
 * whose spell resolves and whose truth one of those gives.
 */
import { SPELL_MANA_COST_TABLE } from "@gladlog/analysis/src/data/spellManaCost";

import { type IRoundCtx, nameOf, successesOf } from "./ctx";

export const CHECKS = ["noManaCostOffBase"] as const;

const TAG = /\(no mana ([\d.]+)k\/([\d.]+)k\)/g;
/** where a `rdy:` entry starts: the list's head, a full-form comma, a
 * delta-form ` +` / ` ~` */
const ENTRY_HEADS = ["rdy:Δ ", "rdy:", ",", " +", " ~"];

/**
 * The entry names a tag at `at` can belong to, longest first: the text from
 * each place an entry can start up to the tag. A name may carry a comma of
 * its own (`Invoke Chi-Ji, the Red Crane`: codex 85-tk-E-T17-1 #1), so the
 * caller takes the longest one that names a spell, never the text after the
 * last comma.
 */
function entriesBefore(line: string, at: number): string[] {
  const pre = line.slice(0, at);
  const starts = new Set<number>();
  for (const h of ENTRY_HEADS)
    for (let i = pre.indexOf(h); i >= 0; i = pre.indexOf(h, i + 1))
      starts.add(i + h.length);
  return [...starts]
    .sort((a, b) => a - b)
    .map((i) => pre.slice(i).replace(/^[+~]/, "").trim())
    .filter((n) => n.length > 0 && !n.includes("(") && !n.includes("["));
}
const MANA = 0;

/** the caster's own row for the spell: `bySpec` first, else the spell's own */
function rowOf(
  spellId: string,
  spec: string,
): { pct?: number; flat?: number } | undefined {
  const row = SPELL_MANA_COST_TABLE[spellId];
  if (!row) return undefined;
  const r =
    row.bySpec?.[spec] ??
    (row.pct !== undefined || row.flat !== undefined ? row : undefined);
  return r && (r.pct !== undefined || r.flat !== undefined) ? r : undefined;
}

/** A percentage cost in whole mana as the game charges it (the log's own
 * arithmetic, kept here and not taken from the analysis cost predicate): the
 * share of base mana in float32, rounded half to even — every stated cost
 * of the 401,548 percentage-priced cast rows of the T17 probe. */
function pctCost(pct: number, base: number): number {
  const x = Math.fround(Math.fround(pct) * (base / 100));
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** the cost the owner's own cast rows of this spell state, the most common */
function statedCostOf(owner: any, spellId: string): number | undefined {
  const n = new Map<number, number>();
  for (const c of successesOf(owner)) {
    if (String(c.spellId) !== spellId) continue;
    const cost = statedMana(c);
    if (cost !== undefined) n.set(cost, (n.get(cost) ?? 0) + 1);
  }
  let best: number | undefined;
  for (const [v, k] of n) if (best === undefined || k > n.get(best)!) best = v;
  return best;
}

const statedMana = (c: any): number | undefined => {
  const cost = (c.powerCosts ?? []).find(
    (p: any) => Number(p.type) === MANA,
  )?.cost;
  return cost !== undefined && cost > 0 ? cost : undefined;
};

/** the owner's base mana, from its own percentage-priced cast rows */
function baseManaOf(owner: any, spec: string): number | undefined {
  const n = new Map<number, number>();
  for (const c of successesOf(owner)) {
    const cost = statedMana(c);
    const pct = rowOf(String(c.spellId), spec)?.pct;
    if (cost === undefined || pct === undefined || !(pct > 0)) continue;
    const base = Math.round(cost / (pct / 100) / 1000) * 1000;
    n.set(base, (n.get(base) ?? 0) + 1);
  }
  let best: number | undefined;
  for (const [b, k] of n) if (best === undefined || k > n.get(best)!) best = b;
  return best;
}

/** the spell id behind a printed name: the owner's own cast of it, else the
 * one cost-table id of that name this spec resolves */
function spellIdOf(owner: any, spec: string, name: string): string | undefined {
  for (const c of successesOf(owner))
    if (
      nameOf(c.spellId, c.spellName ?? "") === name &&
      rowOf(String(c.spellId), spec)
    )
      return String(c.spellId);
  const ids = Object.keys(SPELL_MANA_COST_TABLE).filter(
    (id) => nameOf(id) === name && rowOf(id, spec),
  );
  return ids.length === 1 ? ids[0] : undefined;
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const spec = String(owner.spec ?? "");
  let base: number | undefined | null = null;
  for (const line of ctx.lines) {
    if (!line.includes("[RES]") || !line.includes("(no mana ")) continue;
    for (const m of line.matchAll(TAG)) {
      const names = entriesBefore(line, m.index);
      // a teammate's entry (`N:X`) carries no tag
      if (names.length === 0 || /^\d+:/.test(names[names.length - 1]!))
        continue;
      let name: string | undefined;
      let id: string | undefined;
      for (const n of names) {
        id = spellIdOf(owner, spec, n);
        if (id) {
          name = n;
          break;
        }
      }
      if (!id || !name) continue;
      const row = rowOf(id, spec)!;
      // truth: DB2's flat cost; for a percentage row, what the owner's own
      // rows of this spell state, else its percentage of the base mana the
      // owner's other percentage-priced rows state
      // a flat row is its own truth: a flat spell's cast row can state what
      // it drained, not its price (Arcane Surge 365350: 1 mana, its rows
      // 320,773 — codex 85-tk-E-T17-1b)
      let truth = row.pct === undefined ? row.flat : statedCostOf(owner, id);
      const from =
        row.pct !== undefined && truth !== undefined
          ? "its own cast rows"
          : undefined;
      if (truth === undefined) {
        if (base === null) base = baseManaOf(owner, spec);
        if (base === undefined) continue;
        truth = pctCost(row.pct!, base);
      }
      ctx.bump("noManaCostOffBase");
      const printed = (truth / 1000).toFixed(1);
      if (printed === m[2]) continue;
      ctx.violate(
        "noManaCostOffBase",
        "offBase",
        ctx.start,
        `${owner.name}:${id}:${m[2]}`,
        `${owner.name} ${name} ${id}: printed ${m[2]}k, the log implies ${printed}k (${from ?? (row.pct !== undefined ? `base ${base}` : "flat")})`,
        line,
      );
    }
  }
}
