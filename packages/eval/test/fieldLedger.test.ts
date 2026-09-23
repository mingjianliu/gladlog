/**
 * Anti-rot test for the field-coverage ledger in
 * `docs/log-observability-audit.md` (and its zh-CN twin), GH #100.
 *
 * The ledger follows every field L1 decodes and every L3 unit array through
 * L3 → compat → consumers → prompt. It is only useful while it is complete, so
 * this pins it to the code in both directions:
 *  1. every key an L1 decoder returns, and every array on an L3 unit, appears
 *     as a backticked token in the ledger — in BOTH languages;
 *  2. every `family.field` token the ledger lists still exists (a rename or a
 *     removed decoder field turns this red instead of leaving a stale row).
 *
 * Adding a decoder field or a unit array therefore means adding its row:
 * where it goes after L1, who reads it, and which class it is in.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import {
  decodeCombatantInfo,
  GladLogParser,
  type GladMatch,
  splitLine,
} from "@gladlog/parser";
import {
  decodeAbsorbed,
  decodeAdvanced,
  decodeArenaEnd,
  decodeArenaStart,
  decodeAura,
  decodeBaseUnits,
  decodeDamage,
  decodeExtraSpell,
  decodeHeal,
  decodeHealAbsorbed,
  decodeMissed,
  decodeSpell,
} from "@gladlog/parser/src/l1/decoders";
import { synthArenaLog } from "@gladlog/parser/src/testing/synthLog";

const ROOT = resolve(__dirname, "../../..");

function ledgerTokens(file: string): Set<string> {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const start = text.indexOf("<!-- field-ledger:start -->");
  const end = text.indexOf("<!-- field-ledger:end -->");
  expect(start, `${file}: ledger start marker`).toBeGreaterThan(-1);
  expect(end, `${file}: ledger end marker`).toBeGreaterThan(start);
  const out = new Set<string>();
  for (const m of text
    .slice(start, end)
    .matchAll(/`([a-zA-Z]+\.[a-zA-Z0-9]+)`/g))
    out.add(m[1]!);
  return out;
}

/** Every decoder's own return shape, read off a dummy call — the decoders
 * build their result objects unconditionally, so the keys do not depend on
 * the values. */
function decodedFieldTokens(): Set<string> {
  const p = Array.from({ length: 60 }, () => "1");
  const shapes: Record<string, object> = {
    base: decodeBaseUnits(p),
    spell: decodeSpell(p, 8),
    damage: decodeDamage(p, 20),
    heal: decodeHeal(p, 20),
    advanced: decodeAdvanced(p, 11),
    aura: { ...decodeAura(p, 11), amount: 0 },
    extraSpell: decodeExtraSpell(p, 11),
    absorbed: decodeAbsorbed(p),
    healAbsorbed: decodeHealAbsorbed(p),
    missed: decodeMissed(p, 11),
    arenaStart: decodeArenaStart(p),
    arenaEnd: decodeArenaEnd(p),
  };
  const out = new Set<string>();
  for (const [family, obj] of Object.entries(shapes))
    for (const k of Object.keys(obj)) out.add(`${family}.${k}`);
  // ParsedLine's own scalar members that are not decoder objects.
  out.add("line.empowerLevel");
  out.add("line.unitDied");
  // L3 unit arrays off a real parse of the synthetic log; COMBATANT_INFO's
  // decoded shape off its own line.
  const parser = new GladLogParser();
  let match: GladMatch | null = null;
  parser.on("match", (m) => (match = m));
  for (const line of synthArenaLog().split("\n")) parser.push(line);
  parser.end();
  expect(match).not.toBeNull();
  const ciLine = synthArenaLog()
    .split("\n")
    .find((l) => l.includes("COMBATANT_INFO"));
  const ci = decodeCombatantInfo(splitLine(ciLine!)!.params);
  expect(ci).not.toBeNull();
  for (const k of Object.keys(ci!)) out.add(`combatantInfo.${k}`);
  const unit = Object.values(match!.units)[0]!;
  for (const [k, v] of Object.entries(unit))
    if (Array.isArray(v)) out.add(`unit.${k}`);
  return out;
}

describe("field-coverage ledger (docs/log-observability-audit.md)", () => {
  const expected = decodedFieldTokens();

  for (const file of [
    "docs/log-observability-audit.md",
    "docs/log-observability-audit.zh-CN.md",
  ]) {
    it(`${file}: every decoded field and L3 unit array has a row`, () => {
      const listed = ledgerTokens(file);
      const missing = [...expected].filter((t) => !listed.has(t)).sort();
      expect(missing).toEqual([]);
    });

    it(`${file}: every listed field still exists`, () => {
      const families = new Set([...expected].map((t) => t.split(".")[0]));
      const stale = [...ledgerTokens(file)]
        .filter((t) => families.has(t.split(".")[0]!))
        .filter((t) => !expected.has(t))
        .sort();
      expect(stale).toEqual([]);
    });
  }
});
