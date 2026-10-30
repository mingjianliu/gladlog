/**
 * absorbsIn semantics probe (coaching-grounding-audit D7).
 *
 * TWO LAYERS, and only one of them is what consumers read:
 *  - L3 `GladUnit.absorbsIn` is keyed by the ATTACKER ("damage I dealt that a
 *    shield soaked"). That is deliberate and stays: `convert.ts` folds it into
 *    `damageOut`, where attacker-keying is the correct grouping.
 *  - compat `ICombatUnit.absorbsIn` is what every analysis/desktop consumer
 *    actually holds. It used to be a straight copy of the L3 array — hence D7 —
 *    and is victim-keyed as of the 2026-08-23 fix.
 *
 * This probe originally measured only the L3 layer, so it could never show the
 * fix landing; it now reports both. Ground truth for "absorbs this unit took"
 * is the raw line's own victim (`decodeAbsorbed().victimGuid`).
 *
 * Usage: npx tsx packages/eval/scripts/absorbSemantics.ts <logDir> [maxRounds]
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { GladLogParser, parseLine } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";
const dir = process.argv[2]; const maxM = Number(process.argv[3] ?? 100);
const files = fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => f.endsWith(".txt") && fs.statSync(f).isFile());
let n = 0, unitsN = 0, flipTop = 0, matchesWithAbs = 0;
// compat layer (what consumers read)
let flipTopCompat = 0, compatUnits = 0, compatMismatch = 0;
// D7 second acceptance clause: does the grounding-totem branch stop being dead?
let compatTotems = 0, compatTotemsWithIn = 0, compatTotemsWithOwner = 0, compatTotemsUsable = 0;
let sumDealt = 0, sumTaken = 0, healerDealt = 0, healerTaken = 0;
const ratios: number[] = [];
let totemUnits = 0, totemWithIn = 0, totemWithOut = 0;
const HEALERS = new Set([105, 270, 65, 256, 257, 264, 1468]);
function handle(m: any) {
  // Ground truth is scoped to THIS round, off its own rawLines. The
  // arenaStart/arenaEnd snapshot queue this used to shift() is per MATCH, but
  // handle() runs per ROUND: in Solo Shuffle (6 rounds, one ARENA_MATCH_END)
  // the queue ran dry after round 1 and every later round scored taken=0,
  // which silently inflated every disagreement this probe reports.
  const taken = new Map<string, number>();
  for (const line of (m.rawLines ?? []) as string[]) {
    const pl = parseLine(line);
    if (!pl?.absorbed) continue;
    const amt = pl.absorbed.absorbedAmount;
    if (!Number.isFinite(amt)) continue;
    taken.set(pl.absorbed.victimGuid, (taken.get(pl.absorbed.victimGuid) ?? 0) + amt);
  }
  if (n >= maxM) return; n++;
  const units = Object.values(m.units) as any[];
  // true taken: victim guid = params[4] of SPELL_ABSORBED
  let any = false;
  const rows: { name: string; dealt: number; taken: number; dmgIn: number }[] = [];
  for (const u of units) {
    if (u.name?.toLowerCase().includes("grounding totem") || u.name?.includes("根基图腾")) { totemUnits++; if (u.absorbsIn.length) totemWithIn++; if (u.absorbsOut.length) totemWithOut++; }
    if (!String(u.id).startsWith("Player-")) continue;
    const dealt = u.absorbsIn.reduce((s: number, e: any) => s + e.absorbedAmount, 0);
    const tk = taken.get(u.id) ?? 0;
    const dmgIn = u.damageIn.reduce((s: number, e: any) => s + Math.abs(e.amount), 0);
    unitsN++; sumDealt += dealt; sumTaken += tk; if (dealt || tk) any = true;
    if (HEALERS.has(u.specId)) { healerDealt += dealt; healerTaken += tk; }
    if (tk > 0) ratios.push(dealt / tk);
    rows.push({ name: u.name, dealt, taken: tk, dmgIn });
  }
  if (any) matchesWithAbs++;
  // does the "most damaged friendly" (matchArchetype-style: dmgIn + absorbs) flip between wrong and right absorbs?
  const wrongTop = [...rows].sort((a, b) => b.dmgIn + b.dealt - (a.dmgIn + a.dealt))[0]?.name;
  const rightTop = [...rows].sort((a, b) => b.dmgIn + b.taken - (a.dmgIn + a.taken))[0]?.name;
  if (wrongTop !== rightTop) flipTop++;

  // Same question at the layer consumers actually hold.
  try {
    const legacy: any = toLegacyMatch({ ...m, rawLines: [] } as any);
    const cRows: { name: string; compat: number; taken: number; dmgIn: number }[] = [];
    for (const u of Object.values(legacy.units) as any[]) {
      if (!String(u.id).startsWith("Player-")) continue;
      const compat = (u.absorbsIn ?? []).reduce((s: number, e: any) => s + (Number(e.absorbedAmount) || 0), 0);
      const tk = taken.get(u.id) ?? 0;
      const dmgIn = (u.damageIn ?? []).reduce((s: number, e: any) => s + Math.abs(e.amount), 0);
      compatUnits++;
      if (Math.abs(compat - tk) > 1) compatMismatch++;
      cRows.push({ name: u.name, compat, taken: tk, dmgIn });
    }
    for (const u of Object.values(legacy.units) as any[]) {
      if (!String(u.name ?? "").toLowerCase().includes("grounding totem")) continue;
      compatTotems++;
      const hasIn = (u.absorbsIn ?? []).length > 0;
      if (hasIn) compatTotemsWithIn++;
      if (u.ownerId) compatTotemsWithOwner++;
      if (hasIn && u.ownerId) compatTotemsUsable++;
    }
    const compatTop = [...cRows].sort((a, b) => b.dmgIn + b.compat - (a.dmgIn + a.compat))[0]?.name;
    const truthTop = [...cRows].sort((a, b) => b.dmgIn + b.taken - (a.dmgIn + a.taken))[0]?.name;
    if (compatTop !== truthTop) flipTopCompat++;
  } catch {
    /* a round that fails conversion is not a keying question */
  }
}
const p = new GladLogParser();
p.on("match", handle);
p.on("shuffle", (s: any) => { for (const r of s.rounds ?? []) handle(r); });
(async () => {
  for (const f of files) { if (n >= maxM) break; const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity }); for await (const line of rl) { p.push(line); if (n >= maxM) break; } p.end(); }
  ratios.sort((a, b) => a - b); const q = (x: number) => ratios[Math.min(ratios.length - 1, Math.floor(x * ratios.length))]?.toFixed(2);
  console.log(`rounds=${n} (with any absorb ${matchesWithAbs}) playerUnits=${unitsN}`);
  console.log(`absorbsIn-as-'taken' sum=${sumDealt} vs true taken sum=${sumTaken}; healers: absorbsIn=${healerDealt} trueTaken=${healerTaken}`);
  console.log(`per-unit ratio absorbsIn/trueTaken: p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)} (n=${ratios.length})`);
  console.log(`top-damaged-friendly (dmgIn+absorbs) differs wrong-vs-right in ${flipTop}/${n} rounds  [L3 layer: attacker-keyed BY DESIGN, feeds damageOut]`);
  console.log(`  same question on the compat layer consumers read: ${flipTopCompat}/${n} rounds; per-unit absorbsIn != true taken in ${compatMismatch}/${compatUnits}`);
  console.log(`grounding totem units=${totemUnits} withAbsorbsIn=${totemWithIn} withAbsorbsOut=${totemWithOut}  [L3 layer]`);
  console.log(`  compat layer: totems=${compatTotems} withAbsorbsIn=${compatTotemsWithIn} withOwnerId=${compatTotemsWithOwner} both(=groundingAbsorbs can emit)=${compatTotemsUsable}`);
})();
