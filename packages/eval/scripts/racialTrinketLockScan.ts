/**
 * racialTrinketLockScan — how long does each racial lock the PvP trinket, and
 * the trinket the racial? Re-measures `racialTrinketLockoutMs`
 * (packages/analysis/src/data/racialAbilities.ts) against a corpus
 * (CLAUDE.md Game-Behaviour Rule 8). Raw lines only, never the analysis
 * predicate.
 *
 * Per racial (Will to Survive 59752, Will of the Forsaken 7744 — the
 * cast-logged ones; Stoneform / Fireblood are logged only as buffs) × role
 * (COMBATANT_INFO spec; healer = `isHealerSpec`, the role the lock reads):
 *  - racial → Medallion (336126): gaps of the first trinket press after the
 *    racial with no trinket use in between. A success at gap g proves
 *    lock ≤ g; a refusal (`ITEM_NOT_READY_REASONS`, any locale) proves the
 *    trinket was not ready at g. Each pair is split by whether the trinket's
 *    own cooldown was still running at the racial press (the lock is a floor
 *    from the press — `max(own end, press + lock)`, fact6 F20 — so only the
 *    "own cooldown clear" refusals bound the lock alone).
 *  - Medallion → racial (the reverse lock, ruling A′15): gaps of racial
 *    successes after a trinket use, and of Will to Survive refusals
 *    (`NOT_READY_REASONS`; it is off the GCD, Will of the Forsaken is not —
 *    its "not yet recovered" is mostly the GCD and is not read) with the
 *    racial's own cooldown clear.
 *  - FLAG: every press the table contradicts under `max(own trinket CD end,
 *    racial press + racialTrinketLockoutMs(id, healer))` — a success before
 *    it, or a refusal after it with no lock start in between. The own
 *    cooldown reads HEALER_TRINKET_CD_S / DPS_TRINKET_CD_S.
 * A refusal within 0.3 s of a success of the same unit (either row order —
 * same-ms rows) is the key repeating and is dropped. Arena rounds reset every
 * cooldown (ARENA_MATCH_START).
 *
 *   npx tsx packages/eval/scripts/racialTrinketLockScan.ts \
 *     --manifest <manifest.txt> [--every 5]
 *
 * 2026-10-28 (fact6 F20; 15 + 605 + wide = 1,348 files, measured with the
 * same logic): Will to Survive → Medallion DPS successes n=122 min 90.2 s,
 * refusals max 89.8 s; healer n=59 min 60.3 s; reverse DPS min 90.0 s
 * (n=116, refusal 87.4 s), healer min 60.0 s (n=79). Will of the Forsaken
 * min 30.1 s (healer n=736), 32.0 s (DPS n=54); reverse min 30.0 s (n=377).
 * FLAGs under the role-split table: 0 Will to Survive presses.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { NOT_READY_REASONS } from "@gladlog/analysis/src/analysis/candidates/shared";
import { ITEM_NOT_READY_REASONS } from "@gladlog/analysis/src/context/spellOutcomeLines";
import { racialTrinketLockoutMs } from "@gladlog/analysis/src/data/racialAbilities";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  DPS_TRINKET_CD_S,
  HEALER_TRINKET_CD_S,
} from "@gladlog/analysis/src/utils/trinketCooldown";
import type { CombatUnitSpec } from "@gladlog/parser-compat";

import { arg, argOf } from "./lib/cli";

const RACIALS: Record<string, string> = {
  "7744": "Will of the Forsaken",
  "59752": "Will to Survive",
};
/** off-GCD racials whose "not yet recovered" is the cooldown (DB2
 * SpellCategories.StartRecoveryCategory 0; 7744 is 133, the GCD) */
const OFF_GCD = new Set(["59752"]);
/** the racials' own cooldowns (DB2 RecoveryTime) */
const OWN_CD_S: Record<string, number> = { "7744": 120, "59752": 180 };
const MEDALLION = "336126";
const KEY_REPEAT_S = 0.3;
const ITEM_NOT_READY = new Set(ITEM_NOT_READY_REASONS);

const manifest = arg("--manifest", "");
if (!manifest) {
  console.error("usage: --manifest <file> [--every N]");
  process.exit(2);
}
const every = argOf("--every", 5);
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const TS = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/;
const secs = (line: string): number | null => {
  const m = TS.exec(line);
  if (!m) return null;
  return (
    Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, +m[6]!) / 1000 +
    Number(m[7]) / 10 ** m[7]!.length
  );
};

interface IRow {
  t: number;
  id: string;
  ok: boolean;
  reason: string;
}
type Cell = { ok: number[]; refused: number[] };
const cells = new Map<string, Cell>();
const cell = (k: string): Cell => {
  let c = cells.get(k);
  if (!c) cells.set(k, (c = { ok: [], refused: [] }));
  return c;
};
const flags: string[] = [];

function scanUnit(file: string, rows: IRow[], healer: boolean): void {
  const role = healer ? "healer" : "dps";
  const trinketCd = healer ? HEALER_TRINKET_CD_S : DPS_TRINKET_CD_S;
  const okAt = (id: string) =>
    rows.filter((r) => r.ok && r.id === id).map((r) => r.t);
  const trinketOk = okAt(MEDALLION);
  const keyRepeat = (r: IRow) =>
    rows.some(
      (x) => x.ok && x.id === r.id && Math.abs(x.t - r.t) <= KEY_REPEAT_S,
    );
  const presses = rows.filter((r) => r.ok || !keyRepeat(r));
  for (const [id, name] of Object.entries(RACIALS)) {
    const racialOk = okAt(id);
    if (racialOk.length === 0) continue;
    const lockS = racialTrinketLockoutMs(id, healer) / 1000;
    // racial → trinket
    for (const r of presses) {
      if (r.id !== MEDALLION) continue;
      if (!r.ok && !ITEM_NOT_READY.has(r.reason)) continue;
      const lastRacial = racialOk.filter((x) => x < r.t).pop();
      const lastTrinket = trinketOk.filter((x) => x < r.t).pop();
      // the model, from the rows: max(own end, every racial press + lock)
      const ready = Math.max(
        lastTrinket === undefined ? -Infinity : lastTrinket + trinketCd,
        ...racialOk.filter((x) => x < r.t).map((x) => x + lockS),
      );
      if (r.ok ? r.t < ready - 0.5 : r.t > ready + 0.5)
        flags.push(
          `${file} ${name} ${role}: Medallion ${r.ok ? "success" : "refusal"} ${(r.t - ready).toFixed(1)} s ${r.ok ? "before" : "after"} the model's ready time`,
        );
      if (lastRacial === undefined) continue;
      if (lastTrinket !== undefined && lastTrinket > lastRacial) continue;
      const ownRunning =
        lastTrinket !== undefined && lastTrinket + trinketCd > lastRacial;
      const c = cell(
        `${name} → trinket | ${role} | own CD ${ownRunning ? "running" : "clear"}`,
      );
      (r.ok ? c.ok : c.refused).push(r.t - lastRacial);
    }
    // trinket → racial
    for (const r of presses) {
      if (r.id !== id) continue;
      if (!r.ok && !(OFF_GCD.has(id) && NOT_READY_REASONS.has(r.reason)))
        continue;
      const lastTrinket = trinketOk.filter((x) => x < r.t).pop();
      const lastOwn = racialOk.filter((x) => x < r.t).pop();
      if (lastTrinket === undefined) continue;
      if (lastOwn !== undefined && lastOwn + OWN_CD_S[id]! > r.t) continue;
      const c = cell(`trinket → ${name} | ${role}`);
      (r.ok ? c.ok : c.refused).push(r.t - lastTrinket);
      const ready = lastTrinket + lockS;
      if (r.ok ? r.t < ready - 0.5 : r.t > ready + 0.5)
        flags.push(
          `${file} ${name} ${role}: ${name} ${r.ok ? "success" : "refusal"} ${(r.t - ready).toFixed(1)} s ${r.ok ? "before" : "after"} the trinket lock's end`,
        );
    }
  }
}

for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  let spec = new Map<string, string>();
  let rows = new Map<string, IRow[]>();
  const flush = () => {
    for (const [guid, rs] of rows) {
      const s = spec.get(guid);
      if (s !== undefined) scanUnit(f, rs, isHealerSpec(s as CombatUnitSpec));
    }
    rows = new Map();
    spec = new Map();
  };
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.includes("ARENA_MATCH_START")) {
      flush();
      continue;
    }
    const body = line.slice(line.indexOf("  ") + 2);
    if (body.startsWith("COMBATANT_INFO,")) {
      const p = body.split(",", 26);
      spec.set(p[1]!, p[25]!);
      continue;
    }
    if (
      !body.startsWith("SPELL_CAST_SUCCESS,") &&
      !body.startsWith("SPELL_CAST_FAILED,")
    )
      continue;
    const parts = body.split(",");
    const id = parts[9]!;
    if (id !== MEDALLION && !RACIALS[id]) continue;
    const t = secs(line);
    if (t === null) continue;
    const ok = parts[0] === "SPELL_CAST_SUCCESS";
    const reason = ok ? "" : parts.slice(12).join(",").replace(/^"|"$/g, "");
    const guid = parts[1]!;
    rows.set(guid, [...(rows.get(guid) ?? []), { t, id, ok, reason }]);
  }
  flush();
}

const fmt = (xs: number[], pick: "min" | "max") => {
  if (xs.length === 0) return "n=0";
  const s = [...xs].sort((a, b) => a - b);
  const v = pick === "min" ? s[0]! : s[s.length - 1]!;
  return `n=${s.length} ${pick}=${v.toFixed(1)}`;
};
for (const [k, c] of [...cells].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  console.log(
    `${k}: successes ${fmt(c.ok, "min")} | refusals ${fmt(c.refused, "max")}`,
  );
console.log(`FLAG (presses the table contradicts): ${flags.length}`);
for (const l of flags.slice(0, 30)) console.log(`  ${l}`);
