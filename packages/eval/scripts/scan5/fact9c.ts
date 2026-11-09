/**
 * scan5/fact9c.ts — the round-9 audit's class-2 checks (fact9 F24: what a
 * defensive / healing cooldown is filed as). Text checks on the rendered
 * prompt; the truth is a lookup (the mitigation table's deflection flag, the
 * user-signed curated ability facts) or the user rulings named below.
 *
 *  - `deflectAsImmunity` (D3): a line that calls a deflection
 *    (`deflectsDirectAttacks`, Aspect of the Turtle) an immunity — the death
 *    window's mitigation audit ("<spell> immunity covered …") or a
 *    `[STACKED DEFENSIVES]` line ("not priced here (immunity)"). User ruling
 *    2026-10-21: a deflection is no immunity.
 *  - `healAsDefensive` (D17): one of the five heals the user ruled out of the
 *    major defensives (2026-11-03: Tranquility, Divine Hymn, Desperate
 *    Prayer, Death Pact, Exhilaration) filed as one — a cd-waste row, a
 *    cd-hoarded `readyCds` entry, a `[DEFENSIVE AVAILABLE]` line, a `[DEATH]`
 *    `Unused:` entry, the NOTE's "never-used self-only defensive cooldowns",
 *    a cd-spent-idle row, a `[STACKED DEFENSIVES]` major, the match phases'
 *    "X committed — limited major CD coverage" (codex 20-F24-07 #5).
 *  - `rotationalHealCd` (D14): an `[ENEMY HEAL CD]` line for a spell the user
 *    signed `not_save_role` in `CURATED_ABILITY_FACTS` (Holy Word: Serenity,
 *    2026-09-04: a core rotational heal).
 *  - `killSeqPostDeathCd` (D4): a KILL SEQUENCE `[ENEMY CD]` entry whose own
 *    `@m:ss` is past the block's `[KILL]` second — a cooldown pressed after
 *    the death listed as active for it.
 */
import { CURATED_ABILITY_FACTS } from "@gladlog/analysis/src/data/curatedAbilityFacts";
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";

import { type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = [
  "deflectAsImmunity",
  "healAsDefensive",
  "rotationalHealCd",
  "killSeqPostDeathCd",
] as const;

// built on first use: spell names need the analysis data loaded
let names:
  | { deflection: Set<string>; heal: Set<string>; notSave: Set<string> }
  | undefined;
const lookups = () =>
  (names ??= {
    deflection: new Set(
      Object.entries(MITIGATION_TABLE)
        .filter(([, e]) => e.deflectsDirectAttacks === true)
        .map(([id]) => nameOf(id)),
    ),
    /** user ruling 2026-11-03 (fact9 D17): heals, not major defensives */
    heal: new Set(
      ["740", "64843", "19236", "48743", "109304"].map((id) => nameOf(id)),
    ),
    notSave: new Set(
      CURATED_ABILITY_FACTS.filter((f) => f.kind === "not_save_role").map((f) =>
        nameOf(f.id),
      ),
    ),
  });

const TIME = /^(\d+:\d{2})\s/;
const atMsOf = (ctx: IRoundCtx, line: string): number => {
  const m = TIME.exec(line);
  return m ? ctx.start + secOf(m[1]!) * 1000 : ctx.start;
};
/** "A; B" / "A, B" / "A×2 (…)" → bare spell names */
const namesIn = (list: string, sep: RegExp): string[] =>
  list
    .split(sep)
    .map((x) => x.replace(/\s*[([×].*$/, "").trim())
    .filter(Boolean);

function deflections(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    let name: string | undefined;
    // the corrected line reads `X (deflects …)` (codex 20-F24-07 #6)
    const audit = /Mitigation audit: (.+?) \(?(immunity|deflects)/.exec(line);
    const stacked =
      /\[STACKED DEFENSIVES\].*the later one, (.+?), is not priced here \(([^)]+)\)/.exec(
        line,
      );
    if (audit) {
      ctx.bump("deflectAsImmunity");
      // a split entry's row carries its school (T33: `X (magic damage)`)
      if (audit[2] === "immunity")
        name = audit[1]!.replace(/ \([a-z/]+ damage\)$/, "");
    } else if (stacked) {
      ctx.bump("deflectAsImmunity");
      if (stacked[2] === "immunity") name = stacked[1];
    }
    if (!name || !lookups().deflection.has(name)) continue;
    ctx.violate(
      "deflectAsImmunity",
      audit ? "mitigationAudit" : "stacked",
      atMsOf(ctx, line),
      `${name}@${line.slice(0, 12)}`,
      `${name} called an immunity`,
      line.slice(0, 300),
    );
  }
}

function heals(ctx: IRoundCtx): void {
  const flag = (kind: string, name: string, line: string, atMs: number) =>
    ctx.violate(
      "healAsDefensive",
      kind,
      atMs,
      `${kind}#${name}@${atMs}`,
      `${name} filed as a defensive (${kind})`,
      line.slice(0, 300),
    );
  for (const row of ctx.menu.split("\n")) {
    const type = /type=([\w-]+) t=([\d.]+s|whole-round)/.exec(row);
    if (!type) continue;
    const atMs =
      ctx.start + (type[2] === "whole-round" ? 0 : parseFloat(type[2]!) * 1000);
    if (type[1] === "cd-waste") {
      ctx.bump("healAsDefensive");
      const spell = /facts=\{.*?\bspell=([^,}]+)/.exec(row)?.[1];
      if (spell && lookups().heal.has(spell)) flag("cdWaste", spell, row, atMs);
    } else if (type[1] === "cd-spent-idle") {
      ctx.bump("healAsDefensive");
      const spell = /facts=\{.*?\bspell=([^,}]+)/.exec(row)?.[1];
      if (spell && lookups().heal.has(spell))
        flag("cdSpentIdle", spell, row, atMs);
    } else if (type[1] === "cd-hoarded") {
      ctx.bump("healAsDefensive");
      const ready = /\breadyCds=([^,}]+)/.exec(row)?.[1];
      for (const n of namesIn(ready ?? "", /;\s*/))
        if (lookups().heal.has(n)) flag("cdHoarded", n, row, atMs);
    }
  }
  for (const line of ctx.lines) {
    const avail =
      /\[DEFENSIVE AVAILABLE\]\s+\S+: (.+?) available but unused/.exec(line);
    if (avail) {
      ctx.bump("healAsDefensive");
      if (lookups().heal.has(avail[1]!))
        flag("defensiveAvailable", avail[1]!, line, atMsOf(ctx, line));
    }
    const unused = /\(Unused: ([^)]*)\)/.exec(line);
    if (unused) {
      ctx.bump("healAsDefensive");
      for (const n of namesIn(unused[1]!, /,\s*/))
        if (lookups().heal.has(n))
          flag("deathUnused", n, line, atMsOf(ctx, line));
    }
    if (line.includes("[STACKED DEFENSIVES]") && / had .+ up together /.test(line)) {
      ctx.bump("healAsDefensive");
      const pair = / had (.+?) \(from (?:[^()]|\([^()]*\))*\) and (.+?) \(from (?:[^()]|\([^()]*\))*\) up together/.exec(
        line,
      );
      for (const n of pair ? [pair[1]!, pair[2]!] : [])
        if (lookups().heal.has(n)) flag("stacked", n, line, atMsOf(ctx, line));
    }
    const phase = /'s (.+?) committed(?: [^—]*)? — limited major CD coverage/.exec(
      line,
    );
    if (phase) {
      ctx.bump("healAsDefensive");
      if (lookups().heal.has(phase[1]!))
        flag("matchPhase", phase[1]!, line, ctx.start);
    }
    const note = /never-used self-only defensive cooldowns \(([^)]*)\)/.exec(
      line,
    );
    if (note) {
      ctx.bump("healAsDefensive");
      for (const n of namesIn(note[1]!, /,\s*/))
        if (lookups().heal.has(n)) flag("noteHeld", n, line, ctx.start);
    }
  }
}

function enemyHealCds(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m =
      /\[ENEMY HEAL CD\]\s+.*?\): (.+?)(?: \(cast \d+ of \d+\))?\s*$/.exec(
        line,
      );
    if (!m || !TIME.test(line)) continue;
    ctx.bump("rotationalHealCd");
    const name = m[1]!.trim();
    if (!lookups().notSave.has(name)) continue;
    const atMs = atMsOf(ctx, line);
    ctx.violate(
      "rotationalHealCd",
      name,
      atMs,
      `${name}@${atMs}`,
      `${name} printed as a major heal cooldown`,
      line.slice(0, 300),
    );
  }
}

function killSequences(ctx: IRoundCtx): void {
  let block: string[] | null = null;
  const close = () => {
    if (!block) return;
    const kill = block.find((l) => /\[KILL\]/.test(l));
    const killS = kill ? secOf(TIME.exec(kill)?.[1] ?? "0:00") : undefined;
    for (const l of block) {
      if (!/\[ENEMY CD\]/.test(l)) continue;
      ctx.bump("killSeqPostDeathCd");
      if (killS === undefined) continue;
      for (const m of l.matchAll(/([^,]+?) @(\d+:\d{2})/g)) {
        const at = secOf(m[2]!);
        if (at <= killS) continue;
        const name = m[1]!.replace(/^.*\]\s+/, "").trim();
        ctx.violate(
          "killSeqPostDeathCd",
          "enemyCd",
          ctx.start + at * 1000,
          `${name}@${m[2]}/kill@${killS}`,
          `${name} @${m[2]} listed active for the ${TIME.exec(kill!)?.[1]} death`,
          l.slice(0, 300),
        );
      }
    }
    block = null;
  };
  for (const line of ctx.lines) {
    if (line.startsWith("KILL SEQUENCE")) {
      close();
      block = [];
      continue;
    }
    if (block) {
      if (line.trim() === "" || !TIME.test(line)) close();
      else block.push(line);
    }
  }
  close();
}

export function run(ctx: IRoundCtx): void {
  deflections(ctx);
  heals(ctx);
  enemyHealCds(ctx);
  killSequences(ctx);
}
