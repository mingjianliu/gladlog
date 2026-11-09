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
 * predicate: the owner's base mana is what the owner's own percentage-priced
 * cast rows imply (stated cost ÷ DB2 percentage, the most common value over
 * the archive's rows), the spell's percentage is DB2's (a table lookup); a
 * flat row is its flat cost. Counted: every tag whose spell resolves and
 * whose owner has at least one percentage-priced cast row to read base mana
 * from.
 */
import { SPELL_MANA_COST_TABLE } from "@gladlog/analysis/src/data/spellManaCost";

import { type IRoundCtx, nameOf, successesOf } from "./ctx";

export const CHECKS = ["noManaCostOffBase"] as const;

const TAG = /\(no mana ([\d.]+)k\/([\d.]+)k\)/g;
/** where a `rdy:` entry starts: the list's head, a full-form comma, a
 * delta-form ` +` / ` ~` */
const ENTRY_HEADS = ["rdy:Δ ", "rdy:", ",", " +", " ~"];

/** the entry name right before a tag at `at` */
function entryBefore(line: string, at: number): string {
  const pre = line.slice(0, at);
  let from = -1;
  for (const h of ENTRY_HEADS) {
    const i = pre.lastIndexOf(h);
    if (i >= 0 && i + h.length > from) from = i + h.length;
  }
  return pre.slice(from).replace(/^[+~]/, "").trim();
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
      const name = entryBefore(line, m.index);
      if (/^\d+:/.test(name)) continue; // a teammate's entry: no tag there
      const id = spellIdOf(owner, spec, name);
      if (!id) continue;
      const row = rowOf(id, spec)!;
      if (base === null) base = baseManaOf(owner, spec);
      if (row.pct !== undefined && base === undefined) continue;
      const truth = Math.round(
        row.pct !== undefined ? (row.pct / 100) * base! : row.flat!,
      ); // whole mana, as the log states it (DB2's pct is float32)
      ctx.bump("noManaCostOffBase");
      const printed = (truth / 1000).toFixed(1);
      if (printed === m[2]) continue;
      ctx.violate(
        "noManaCostOffBase",
        "offBase",
        ctx.start,
        `${owner.name}:${id}:${m[2]}`,
        `${owner.name} ${name} ${id}: printed ${m[2]}k, the log implies ${printed}k (base ${base ?? "-"})`,
        line,
      );
    }
  }
}
