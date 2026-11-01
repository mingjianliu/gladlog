/* eslint-disable @typescript-eslint/no-explicit-any -- walks the untyped legacy parse objects */
/**
 * scan5/replacedKit.ts — the F22 class check: does the prompt state that a
 * unit HAS a spell its own talents replaced?
 *
 * A Lightsmith Holy Paladin has no Divine Toll: Holy Armaments takes the
 * button. The coach still told such a player "never pressed Divine Toll".
 * The fact class is "is this spell in this unit's kit at all", for every
 * replacement pair, not that one id.
 *
 * Truth, per player of the round:
 *  - talents decoded from COMBATANT_INFO (`getPlayerTalentedSpellInfo`; a
 *    loadout that does not decode counts as unknown, never as "holds nothing",
 *    and the unit's PvP talents still prove their own pairs) plus the unit's
 *    PvP talents, put through the replacement TABLES
 *    (`replacedSpellIds`, a lookup — the table is what this check measures
 *    the prompt against, so a base capture is counted with the new table);
 *  - minus a pair whose button the model keeps alive under another name
 *    (`talentReplacementsOf`: `pressedAs` Ice Cold is Ice Block, `procOnly`);
 *  - minus a spell of the talent's own name (Raise Dead 46584 → 46585: the
 *    prompt cannot tell the two apart);
 *  - minus a spell the unit cast this round under that name: a SUCCESS beats
 *    the table, the ledger's own rule and a real press to report.
 *
 * Kinds:
 *  - `kit`: the name in that unit's `<cooldowns>` loadout;
 *  - `res`: on a `[RES]` row as that unit's (`N:Name`, the owner's bare) —
 *    `rdy:`, `rdy:Δ` or `cd:`;
 *  - `resEnemy`: in a `[RES]` row's `enemy:` column under that unit's spec,
 *    for an enemy whose same-spec opponents all had the spell replaced (the
 *    column names a spec, not a unit);
 *  - `ccKit`: under that unit on the `ENEMY CC KIT` header (the talent-blind
 *    spec default of `SPEC_PRIMARY_CC`, the one kit reader off the ledger);
 *  - `menu`: a findings row's fact about a kit (`spell=`, `readyCds=`) that
 *    names the spell as that unit's: `(yours)` for the owner, `(<name>'s)`,
 *    or bare on a row whose first `units=` entry is the unit (the second is
 *    the crisis target, never the holder);
 *  - `timeline`: any other timeline line naming the unit's label and the
 *    spell (measured, not in the total: a hand reads these).
 */
import { specToString } from "@gladlog/analysis";
import { replacedSpellIds } from "@gladlog/analysis/src/data/talentReplaces";
import { TALENT_REPLACES_GENERATED } from "@gladlog/analysis/src/data/talentReplacesGenerated";
import {
  PVP_TALENT_REPLACES,
  talentReplacementsOf,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  getPlayerTalentedSpellInfo,
  talentsOf,
} from "@gladlog/analysis/src/utils/talents";

import { type IRoundCtx, nameOf, successesOf } from "./ctx";

export const CHECKS = ["replacedSpellListed"] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "replacedSpellListed|timeline",
]);

const CHECK = "replacedSpellListed";
const TIMED = /^(\d+):(\d\d) {2}\[/;

/** the talents behind a replaced id, to skip a spell of the talent's own name */
const talentsReplacing = (id: string): string[] =>
  Object.entries(TALENT_REPLACES_GENERATED)
    .filter(([, ys]) => ys.includes(id))
    .map(([t]) => t);

interface IReplacedSpell {
  unit: any;
  pid: string | undefined;
  id: string;
  name: string;
}

/** Exported for the planted-case test. */
export function replacedSpellsOf(ctx: IRoundCtx): IReplacedSpell[] {
  const out: IReplacedSpell[] = [];
  for (const u of ctx.players) {
    const specId = parseInt(u.spec, 10);
    const talents = talentsOf(u);
    const selected =
      !Number.isNaN(specId) && talents?.length
        ? getPlayerTalentedSpellInfo(specId, talents)
        : null;
    const pvp = new Set<string>(u.info?.pvpTalents ?? []);
    const replaced = replacedSpellIds(
      selected ? new Set(selected.keys()) : null,
      pvp,
      PVP_TALENT_REPLACES,
    );
    if (replaced.size === 0) continue;
    const kept = talentReplacementsOf(u);
    const castNames = new Set(
      successesOf(u).map((c: any) => nameOf(c.spellId, c.spellName ?? "")),
    );
    for (const id of replaced) {
      if (kept.pressedAs.has(id) || kept.procOnly.has(id)) continue;
      const name = nameOf(id);
      if (!name || castNames.has(name)) continue;
      if (
        talentsReplacing(id).some((t) => selected?.has(t) && nameOf(t) === name)
      )
        continue;
      out.push({ unit: u, pid: ctx.pidOf(u.name), id, name });
    }
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `<cooldowns>` of one `<unit>`: its entries' bare names */
function kitOf(lines: readonly string[], pid: string): string[] {
  let inside = false;
  for (const l of lines) {
    const u = /<unit id="(\d+)"/.exec(l);
    if (u) inside = u[1] === pid;
    const cds = /<cooldowns>(.*)<\/cooldowns>/.exec(l);
    if (inside && cds)
      return cds[1]!
        .split(/, (?=[A-Z])/)
        .map((p) => p.replace(/ \[.*$/, "").trim());
  }
  return [];
}

/** Does the `ENEMY CC KIT` line list `spell` under `unitName`'s entry? */
function kitEntryOf(line: string, unitName: string, spell: string): boolean {
  const at = line.indexOf(`(${unitName})`);
  if (at < 0) return false;
  const rest = line.slice(at);
  const end = rest.indexOf(";");
  return (end < 0 ? rest : rest.slice(0, end)).includes(spell);
}

/**
 * The kit facts of one menu row, as `[entry, owner]`: `owner` is `"yours"`,
 * a unit name, or undefined for a bare entry.
 */
function kitFactEntries(row: string): [string, string | undefined][] {
  const facts = row.slice(row.indexOf(" facts={"));
  const out: [string, string | undefined][] = [];
  for (const m of facts.matchAll(/(?:\{|, )(?:spell|readyCds)=([^,}]*)/g))
    for (const part of m[1]!.split(/; |、/)) {
      const q = /^(.*?) \((yours|.*'s)\)$/.exec(part.trim());
      if (q) out.push([q[1]!, q[2]!.replace(/'s$/, "")]);
      else out.push([part.trim(), undefined]);
    }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const rs = replacedSpellsOf(ctx);
  if (rs.length === 0) return;
  ctx.bump(CHECK, rs.length);
  const menuRows = ctx.menu.split("\n").filter((l) => l.includes(" facts={"));
  const ownerTeam = ctx.owner?.info?.teamId;
  const isEnemy = (u: any) => u.info?.teamId !== ownerTeam;
  for (const r of rs) {
    const fact = `${r.unit.name}|${r.id}`;
    const seen = (kind: string, atMs: number, line?: string) =>
      ctx.violate(CHECK, kind, atMs, fact, `${r.name} (${r.id})`, line);
    const label = r.pid ? `${r.pid}(` : undefined;
    if (r.pid && kitOf(ctx.lines, r.pid).includes(r.name))
      seen("kit", ctx.start);
    const isOwner = r.unit.id === ctx.owner?.id;
    // The owner's entries are bare: not a mate's `2:Name`, not `Mass Name`.
    const token = isOwner
      ? new RegExp(
          `(?<!\\d:)(?<![\\p{L}'] )(?:^|(?<=[,:\\s+-]))${escapeRe(r.name)}(?:\\[|\\(|,|\\s|$)`,
          "u",
        )
      : r.pid
        ? new RegExp(`${r.pid}:${escapeRe(r.name)}(?:\\[|\\(|,|\\s|$)`)
        : undefined;
    const specName = specToString(r.unit.spec);
    const readsEnemyColumn =
      isEnemy(r.unit) &&
      ctx.players
        .filter((p) => isEnemy(p) && p.spec === r.unit.spec)
        .every((p) => rs.some((x) => x.unit === p && x.id === r.id));
    const enemyToken = new RegExp(
      `${escapeRe(r.name)}(?: \\([^)]*\\))?/${escapeRe(specName)}\\(`,
    );
    let at = ctx.start;
    for (const l of ctx.lines) {
      if (l.includes("ENEMY CC KIT (") && kitEntryOf(l, r.unit.name, r.name))
        seen("ccKit", ctx.start, l);
      const t = TIMED.exec(l);
      if (t) at = ctx.start + (Number(t[1]) * 60 + Number(t[2])) * 1000;
      if (l.includes("[RES] ")) {
        const col = /\[RES\] (.*?)(?: {2}enemy:(.*?))?(?: {2}focus:.*)?$/.exec(
          l,
        );
        const own = col?.[1] ?? "";
        const en = col?.[2] ?? "";
        if (token?.test(own)) seen("res", at, l);
        if (readsEnemyColumn && enemyToken.test(en)) seen("resEnemy", at, l);
        continue;
      }
      if (
        label &&
        t &&
        l.includes(label) &&
        new RegExp(`(?<![\\p{L}'] )\\b${escapeRe(r.name)}\\b`, "u").test(l)
      )
        seen("timeline", at, l);
    }
    for (const m of menuRows) {
      // Only a fact about a kit: `cc=` on a row naming a healer is the CC that
      // landed ON it.
      const holder = /\bunits=([^/\s]+)/.exec(m)?.[1];
      const names = kitFactEntries(m).some(
        ([entry, owner]) =>
          entry === r.name &&
          (owner === "yours"
            ? isOwner
            : owner
              ? owner === r.unit.name
              : holder === r.unit.name),
      );
      if (names) seen("menu", ctx.start, m);
    }
  }
}
