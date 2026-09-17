/**
 * crisisProcMarkerProbe.ts — BACKLOG #43 step 1 (2026-09-17): "怎么认出这是
 * 触发不是主动按 — 逐个用日志核实,不要猜".
 *
 * Every automatic protection talent has a candidate MARKER id — the buff /
 * heal the game applies to the owner the instant the talent fires (usually
 * the internal-cooldown aura). A marker is usable only if, in the archive,
 * it is (a) applied by the owner to themselves and (b) applied at low HP
 * (the trigger condition) — the first run showed Dream Guide 1278914 failing
 * both (a hand-out buff, 22/153 self-sourced, 88 at ≥ 80 % HP) while
 * Well-Honed Instincts 382912 passed (1,039/1,039 self, 985 at ≤ 49 %).
 *
 * For each candidate marker (aura APPLIED on self, or a heal event on self
 * with that spellId): count, self-sourced share, [STATE] HP buckets at the
 * instant, and whether the triggered spell's SPELL_CAST_SUCCESS follows
 * within ±1 s (a proc'd cast is usually NOT logged as a cast).
 *
 * Usage: npx tsx packages/eval/scripts/crisisProcMarkerProbe.ts --manifest <m> [--every 50]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { gridHpPct } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "50"));

/** candidate markers — every sibling id the talent catalog saw in the
 * archive for each automatic protection talent (2026-09-17 list) */
const CANDIDATES: Record<string, { talent: string; triggers?: string[] }> = {
  // A. low-HP auto-protection
  "382912": { talent: "Well-Honed Instincts (Druid)", triggers: ["22842"] },
  "1278914": { talent: "Dream Guide (Druid)", triggers: ["8936", "1264664"] },
  "31616": { talent: "Nature's Guardian (Shaman)" },
  "374606": { talent: "Blood Draw (DK)" },
  "454871": { talent: "Blood Draw (DK) alt" },
  "386397": { talent: "Battle-Scarred Veteran (Prot Warrior)" },
  "456447": { talent: "Battle-Scarred Veteran alt" },
  "393108": { talent: "Gift of the Golden Val'kyr (Prot Paladin)" },
  "393879": { talent: "Gift of the Golden Val'kyr alt" },
  "441387": { talent: "Veteran Vitality (Warrior hero)" },
  "455179": { talent: "Elixir of Determination (BrM Monk)" },
  "451214": { talent: "Whirling Steel (Monk hero)" },
  // B. cheat-death
  "87023": { talent: "Cauterize (Mage) burn" },
  "108843": { talent: "Cauterize (Mage) speed" },
  "87024": { talent: "Cauterize (Mage) alt" },
  "116888": { talent: "Purgatory (Blood DK) absorb" },
  "123981": { talent: "Purgatory (Blood DK) icd" },
  "404381": { talent: "Defy Fate (Evoker) heal" },
  "404369": { talent: "Defy Fate (Evoker) icd" },
  "209261": { talent: "Last Resort (Vengeance DH)" },
  "45182": { talent: "Cheat Death (Rogue) dr" },
  "45181": { talent: "Cheat Death (Rogue) icd" },
};
// Guided Prayer: a Word of Glory 85673 cast on self at <= 25 % HP is the only
// candidate pattern; count it separately, never treat it as detection.
const WOG = "85673";

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

interface Row {
  talent: string;
  auraApplied: number;
  healEvents: number;
  selfSourced: number;
  hpKnown: number;
  hpLe40: number;
  hpLe50: number;
  hpBuckets: Record<string, number>;
  triggerCastWithin1s: number;
  noTriggerCast: number;
  units: Set<string>;
}
const t: Record<string, any> = {
  files: files.length,
  rounds: 0,
  markers: {} as Record<string, Row>,
  wogSelfLe25: 0,
  wogSelfAll: 0,
};

const rowOf = (id: string): Row =>
  (t.markers[id] ??= {
    talent: CANDIDATES[id]!.talent,
    auraApplied: 0,
    healEvents: 0,
    selfSourced: 0,
    hpKnown: 0,
    hpLe40: 0,
    hpLe50: 0,
    hpBuckets: {},
    triggerCastWithin1s: 0,
    noTriggerCast: 0,
    units: new Set<string>(),
  });

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    t.rounds++;
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      const casts = ((u.spellCastEvents ?? []) as any[]).filter(
        (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      const note = (
        id: string,
        ts: number,
        src: string | undefined,
        kind: "aura" | "heal",
      ) => {
        const row = rowOf(id);
        if (kind === "aura") row.auraApplied++;
        else row.healEvents++;
        if (src === u.id) row.selfSourced++;
        row.units.add(u.name);
        const hp = gridHpPct(u, ts);
        if (hp !== null) {
          row.hpKnown++;
          if (hp <= 40) row.hpLe40++;
          if (hp <= 50) row.hpLe50++;
          const b = `${Math.floor(hp / 10) * 10}s`;
          row.hpBuckets[b] = (row.hpBuckets[b] ?? 0) + 1;
        }
        const trig = CANDIDATES[id]!.triggers;
        if (trig) {
          if (
            casts.some(
              (c) =>
                trig.includes(String(c.spellId)) &&
                Math.abs(c.timestamp - ts) <= 1000,
            )
          )
            row.triggerCastWithin1s++;
          else row.noTriggerCast++;
        }
      };
      for (const ev of (u.auraEvents ?? []) as any[]) {
        if (ev.logLine?.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        if (ev.destUnitId !== u.id) continue;
        const id = String(ev.spellId);
        if (!CANDIDATES[id]) continue;
        note(id, ev.timestamp, ev.srcUnitId, "aura");
      }
      for (const h of (u.healIn ?? []) as any[]) {
        const id = String(h.spellId);
        if (!CANDIDATES[id]) continue;
        note(id, h.timestamp, h.srcUnitId, "heal");
      }
      for (const c of casts) {
        if (String(c.spellId) !== WOG || c.destUnitId !== u.id) continue;
        t.wogSelfAll++;
        const hp = gridHpPct(u, c.timestamp);
        if (hp !== null && hp <= 25) t.wogSelfLe25++;
      }
    }
  }
}
for (const r of Object.values(t.markers) as Row[])
  (r as any).units = r.units.size;
process.stdout.write(JSON.stringify(t, null, 2) + "\n");
