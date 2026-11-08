/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t12.ts — pipeline T12 (fact12 D5 / D6 / D9): a line that names what
 * a player pressed naming a cast row nobody pressed. Truth = the player's
 * own SPELL_CAST_SUCCESS rows of the printed name at the printed time; a
 * row is no press when its id is a registered automatic or riding row —
 * an auto-attack replacement swing (`AUTO_ATTACK_REPLACEMENT_IDS`), a
 * passive proc (`PASSIVE_PROC_CAST_IDS`) or a copy of another press
 * (`COPY_CAST_IDS`). The tables are lookups; the reader's predicate is not
 * consulted. A line is a violation when every matching row is no press.
 *
 * Check `pressNamedRead`, kinds:
 *  - `postKick`: a kick-eaten menu row's "acted on another school Ns later
 *    (X; …)" or "; first cast Ns later (X)" — 1d26a991 Crusading Strikes
 *    swings 2.1–2.6 s after each kick, 4cacc702 Sundering 467283 beside the
 *    Lava Lash press.
 *  - `dispellerPressed`: a missed-cleanse row's `dispellerPressed=X +Ns`
 *    entry, matched on any player of the target's team — 1d26a991 Twin
 *    Flame beside Disintegrate.
 *  - `abilitiesInto`: an ABILITIES INTO IMMUNITY/DR line naming X for a
 *    caster whose every row of X from the line's second to 30 s later is
 *    no press — 1d26a991 0:53 Crusading Strikes into Time Dilation.
 *  - `unregisteredCompanion` (informational, out of the total): a matched
 *    row with no DB2 SpellCooldowns row (`isButtonPress`), no registry entry,
 *    logged within 15 ms of a button row of another id of its caster — the
 *    forward check of the registries (Sundering 467283 before it was
 *    registered). The id is in the detail.
 */
import { isButtonPress } from "@gladlog/analysis/src/utils/castCommitSpans";
import { COPY_CAST_IDS } from "@gladlog/analysis/src/utils/castPress";
import { PASSIVE_PROC_CAST_IDS } from "@gladlog/analysis/src/utils/cooldowns";
import { AUTO_ATTACK_REPLACEMENT_IDS } from "@gladlog/analysis/src/utils/damagePress";

import { type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["pressNamedRead"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "pressNamedRead|unregisteredCompanion",
]);

const MENU_ROW =
  /^\s*- id=\S+ type=(kick-eaten|missed-cleanse) t=\S+ units=(\S+) facts=\{t=([\d.]+), (.*)\}\s*$/;
const ACTED = /acted on another school ([\d.]+)s later \(([^;)]+)/;
const FIRST_CAST = /; first cast ([\d.]+)s later \(([^)]+)\)/;
const DISP_PRESSED = /dispellerPressed=([^,}]*)/;
const INTO =
  /^\s*\[(\d+:\d\d)\] [^(]+\(([^)]+)\): (.+) into (.+)'s (.+?)(?: \(deferral\))?$/;
/** the printed offsets are tenths (toFixed / floor), the fact's t floored */
const SLACK_MS = 250;
const COMPANION_MS = 15;
const INTO_SPAN_MS = 30_000;

const registered = (id: string): boolean =>
  AUTO_ATTACK_REPLACEMENT_IDS.has(id) ||
  PASSIVE_PROC_CAST_IDS.has(id) ||
  COPY_CAST_IDS.has(id);

export function run(ctx: IRoundCtx): void {
  const rowsNamed = (u: any, name: string, from: number, to: number) =>
    successesOf(u).filter(
      (c: any) =>
        nameOf(c.spellId, c.spellName ?? "") === name &&
        tsOf(c) >= from &&
        tsOf(c) <= to,
    );
  const judge = (
    kind: string,
    u: any,
    rows: any[],
    label: string,
    line: string,
  ): void => {
    if (rows.length === 0) return;
    ctx.bump("pressNamedRead");
    const all = successesOf(u);
    for (const c of rows) {
      const id = String(c.spellId ?? "");
      if (registered(id) || isButtonPress(id)) continue;
      if (
        all.some(
          (o: any) =>
            o !== c &&
            String(o.spellId) !== id &&
            isButtonPress(String(o.spellId)) &&
            Math.abs(tsOf(o) - tsOf(c)) <= COMPANION_MS,
        )
      )
        ctx.violate(
          "pressNamedRead",
          "unregisteredCompanion",
          tsOf(c),
          `${u.name}:${id}:${tsOf(c)}`,
          `${label}: ${id} (unregistered) has no SpellCooldowns row and rides a button row`,
          line,
        );
    }
    if (rows.some((c: any) => !registered(String(c.spellId ?? "")))) return;
    const c = rows[0];
    ctx.violate(
      "pressNamedRead",
      kind,
      tsOf(c),
      `${u.name}:${c.spellId}:${tsOf(c)}`,
      `${label}: ${rows.map((r: any) => r.spellId).join("/")} is no press`,
      line,
    );
  };

  for (const line of ctx.menu.split("\n")) {
    const m = MENU_ROW.exec(line);
    if (!m) continue;
    const t0 = ctx.start + Number(m[3]) * 1000;
    const facts = m[4]!;
    if (m[1] === "kick-eaten") {
      const victim = ctx.byName.get(m[2]!.split("/")[0]!);
      if (!victim) continue;
      for (const re of [ACTED, FIRST_CAST]) {
        const a = re.exec(facts);
        if (!a) continue;
        const at = t0 + Number(a[1]) * 1000;
        const name = a[2]!.trim();
        judge(
          "postKick",
          victim,
          rowsNamed(victim, name, at - SLACK_MS, at + 100 + SLACK_MS),
          `${name} +${a[1]}s`,
          line,
        );
      }
      continue;
    }
    const d = DISP_PRESSED.exec(facts);
    const target = ctx.byName.get(m[2]!.split("/")[0]!);
    if (!d || !target) continue;
    const mates = (ctx.players as any[]).filter(
      (p) => p.reaction === target.reaction,
    );
    for (const entry of d[1]!.split("、")) {
      const e = /^(.+) \+([\d.]+)s$/.exec(entry.trim());
      if (!e) continue;
      const at = t0 + Number(e[2]) * 1000;
      const name = e[1]!;
      // the teammate whose row it is: the one with a row of the name there
      const owner = mates.find(
        (p) =>
          rowsNamed(p, name, at - SLACK_MS, at + 100 + SLACK_MS).length > 0,
      );
      if (!owner) continue;
      judge(
        "dispellerPressed",
        owner,
        rowsNamed(owner, name, at - SLACK_MS, at + 100 + SLACK_MS),
        `${name} +${e[2]}s`,
        line,
      );
    }
  }

  for (const line of ctx.lines) {
    const m = INTO.exec(line);
    if (!m) continue;
    const caster = ctx.byName.get(m[2]!);
    if (!caster) continue;
    const from = ctx.start + secOf(m[1]!) * 1000;
    for (const part of m[3]!.split(" + ")) {
      const name = part.replace(/ ×\d+$/, "").trim();
      judge(
        "abilitiesInto",
        caster,
        rowsNamed(caster, name, from, from + INTO_SPAN_MS),
        `${name} at ${m[1]}`,
        line,
      );
    }
  }
}
