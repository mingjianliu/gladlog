/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t17.ts — pipeline T17 (GH #129.1, user ruling Q3): a [RES] row's
 * `X(no mana a/b)` prints b, the cooldown's mana cost. A spell DB2 prices as
 * a percentage costs that share of BASE mana — what the caster's own cast
 * rows state — not of the reading's max (3282debd: Divine Toll `8.2k` for
 * 7,500 on a raised-max Holy Paladin).
 *
 * Check `noManaCostOffBase`, kind `offBase`: the tag's b is not the cost the
 * log implies. Truth: a flat row's DB2 cost; for a percentage row, the
 * cost the owner's own cast rows of that spell state in the round, read
 * through the producer's own selection (`statedManaCostInRound`, the
 * highest in the round's bounds); else DB2's percentage of the base mana
 * the owner's other percentage-priced rows of the round imply (stated ÷
 * percentage, the most common value), converted by the producer's own
 * arithmetic (`pctManaCost(pct, base)`) — the base is read off the log, the
 * conversion is shared (batch review 80-PIPE-31-B31b). The entry name is the
 * longest text before the tag that names a spell (a name may carry a
 * comma). Counted: every tag whose spell resolves and whose truth one of
 * those gives.
 */
import {
  pctManaCost,
  SPELL_MANA_COST_TABLE,
} from "@gladlog/analysis/src/data/spellManaCost";
import { statedManaCostInRound } from "@gladlog/analysis/src/utils/resourceAt";

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

const statedMana = (c: any): number | undefined => {
  const cost = (c.powerCosts ?? []).find(
    (p: any) => Number(p.type) === MANA,
  )?.cost;
  return cost !== undefined && cost > 0 ? cost : undefined;
};

/** the owner's base mana, from its own percentage-priced cast rows of the
 * round (the bounds `statedManaCostInRound` reads: a Solo Shuffle round's
 * units keep the rows that follow it) */
function baseManaOf(
  owner: any,
  spec: string,
  round: { startTime: number; endTime: number },
): number | undefined {
  const n = new Map<number, number>();
  for (const c of successesOf(owner)) {
    const t = c.logLine?.timestamp ?? c.timestamp;
    if (!(t >= round.startTime && t <= round.endTime)) continue;
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
  // the round the product prices against (`costFor`'s `combat`: the round's
  // own start and end)
  const round = {
    startTime: ctx.legacy.startTime as number,
    endTime: ctx.legacy.endTime as number,
  };
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
      let truth =
        row.pct === undefined
          ? row.flat
          : (statedManaCostInRound(owner, id, round) ?? undefined);
      const from =
        row.pct !== undefined && truth !== undefined
          ? "its own cast rows"
          : undefined;
      if (truth === undefined) {
        if (base === null) base = baseManaOf(owner, spec, round);
        if (base === undefined) continue;
        truth = pctManaCost(row.pct!, base);
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
