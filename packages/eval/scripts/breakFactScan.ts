/**
 * breakFactScan.ts — F15 (fact1215 R2 + R3, 2026-10-16): re-derive "who
 * dispelled" and "what a PvP trinket press removed" from the parsed log and
 * check the rendered lines, over an acceptanceCapture `--context-dir`
 * capture (`<dir>/s<k>/context/`, layout as `pressFactScan.ts`).
 *
 * Read from the log events (the classification sets — `ccSpellIds`,
 * `disarmSpellIds`, `isSilenceOnlyAura` — are the only analysis imports; the
 * binders under audit are not used):
 *
 *  - `petDispel` (R2): a SPELL_DISPEL whose source is a pet of player P (a
 *    unit whose `ownerId` is P). No [PURGE] / [ENEMY PURGE] / [ENEMY
 *    CLEANSE] line at that second, and no [MINOR DISPELS] line, may credit
 *    P's pid with that dispel spell without `'s pet` / `'s guardian` /
 *    `'s totem` (`summonKindOf`'s words; P casting the spell
 *    itself in the round exempts it).
 *  - `enemyTrinketOutOf` (R3): an enemy's Gladiator's Medallion cast at
 *    which one of our CC / disarm / silence auras on that enemy was REMOVED
 *    within −25…+50 ms (the trinket's own removal cluster,
 *    `TRINKET_BREAK_AFTER_REMOVAL_MS`). Its `[ENEMY TRINKET]` line must name
 *    `out of`. Roots are left out (not named — a judgment call); so is a
 *    removal the log gives another cause before the press (BROKEN / dispel)
 *    and a press after the round's end (`roundEndMs`: a Shuffle round's
 *    ending death — its CCs are cut there).
 *  - `trinketAfterCause` (R3): a Medallion cast 1–50 ms after a CC on its
 *    caster was removed with a SPELL_DISPEL of it or a SPELL_AURA_BROKEN /
 *    _BROKEN_SPELL line at that removal. The CC's line (its landing second,
 *    its name) must not say the trinket ended it.
 *
 *  - `brokenByHolder` (R4, 2026-10-18): a SPELL_AURA_BROKEN_SPELL row on a
 *    player whose source is that player, with a hit of the breaking spell on
 *    them from ANOTHER unit 0–100 ms before it (the log writes the holder
 *    for a guardian's Wrath of Nathreza). The control's line (its landing
 *    second, its English name, on that player) must not say `broken by
 *    <the holder>'s <spell>`.
 *  - `brokenBySplitAlly` (C4): a BROKEN_SPELL row whose breaking spell is
 *    Blessing of Sacrifice and whose hit on the holder is a DAMAGE_SPLIT,
 *    while the holder's own 6940 link aura is up (the damage the holder's
 *    Blessing moved onto them; the row names the protected ally). The line
 *    must not say `broken by <that ally>'s Blessing of Sacrifice`.
 *
 *   npx tsx packages/eval/scripts/breakFactScan.ts <captureDir>
 *     [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ccSpellIds,
  disarmSpellIds,
} from "@gladlog/analysis/src/data/spellTags";
import { isSilenceOnlyAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: breakFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]",
  );
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;
const adIdx = process.argv.indexOf("--archive-dir");
const ARCHIVE_DIR = adIdx > 0 ? (process.argv[adIdx + 1] ?? "") : "";
const MEDALLION = "336126";

const fmt = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
type Check =
  | "petDispel"
  | "enemyTrinketOutOf"
  | "trinketAfterCause"
  | "brokenByHolder"
  | "brokenBySplitAlly";
const expected = new Map<Check, number>();
const bad = new Map<Check, string[]>();
const unmapped: string[] = [];
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const fail = (c: Check, s: string) => {
  const l = bad.get(c) ?? [];
  l.push(s);
  bad.set(c, l);
};

function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

await ensureAnalysisData();
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  for (const name of readdirSync(join(dir, shard, "context"))) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

const isRemoved = (a: any) => a.logLine.event === LogEvent.SPELL_AURA_REMOVED;
const isBroken = (a: any) =>
  a.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
  a.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL;

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const [archive] = text.split("\n", 1);
  if (!archive) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(
        archive.startsWith("/") ? archive : resolve(ARCHIVE_DIR, archive),
      );
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) {
    unmapped.push(`${f.shard}/${f.name} (${archive})`);
    continue;
  }
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    unmapped.push(`${f.shard}/${f.name} (toLegacyMatch threw)`);
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const units = Object.values(legacy.units ?? {}) as any[];
  const pidOf = new Map<string, { pid: string; enemy: boolean }>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (u) pidOf.set(u[2]!, { pid: u[1]!, enemy: u[3] === "enemy" });
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const friendlyOrSummon = (id: string | undefined): boolean => {
    if (!id) return false;
    const u = byId.get(id);
    const ownerId = u?.ownerId as string | undefined;
    const p = u && pidOf.get(u.name);
    if (p) return !p.enemy;
    const o = ownerId ? byId.get(ownerId) : undefined;
    const op = o && pidOf.get(o.name);
    return !!op && !op.enemy;
  };
  const start = legacy.startTime;
  // a Solo Shuffle round ends at its ending death; a press after it breaks
  // nothing inside the round (its CCs are cut there)
  const roundEnd = roundEndMs(legacy as any);
  const at = (ts: number) => fmt((ts - start) / 1000);
  const where = `${f.shard}/${f.name}`;

  // ── petDispel ───────────────────────────────────────────────────────────
  for (const pet of units) {
    const owner = pet.ownerId ? byId.get(pet.ownerId) : undefined;
    const op = owner && pidOf.get(owner.name);
    if (!owner || !op || owner.id === pet.id) continue;
    for (const x of pet.actionOut ?? []) {
      if (x.logLine.event !== LogEvent.SPELL_DISPEL) continue;
      if (x.srcUnitId !== pet.id) continue;
      if (x.logLine.timestamp < start || x.logLine.timestamp > legacy.endTime)
        continue;
      const spell = x.spellName as string;
      const ownerCastsIt = (owner.actionOut ?? []).some(
        (y: any) =>
          y.logLine.event === LogEvent.SPELL_DISPEL &&
          y.srcUnitId === owner.id &&
          y.spellName === spell,
      );
      if (ownerCastsIt) continue;
      bump("petDispel");
      const t = at(x.logLine.timestamp);
      const credited = lines.some(
        (l) =>
          ((l.startsWith(`${t}  `) && /\[(ENEMY )?(PURGE|CLEANSE)\]/.test(l)) ||
            l.includes("[MINOR DISPELS]")) &&
          l.includes(`]   ${op.pid}(`) &&
          !new RegExp(`\\]   ${op.pid}\\([^)]*\\)'s (pet|guardian|totem)`).test(
            l,
          ) &&
          l.includes(spell),
      );
      if (credited)
        fail("petDispel", `${where} ${t} ${owner.name}'s pet ${spell}`);
    }
  }

  // ── who broke a control (R4 / C4) ───────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const auras = (u.auraEvents ?? []) as any[];
    for (let i = 0; i < auras.length; i++) {
      const b = auras[i];
      if (b.logLine.event !== LogEvent.SPELL_AURA_BROKEN_SPELL) continue;
      if (b.destUnitId && b.destUnitId !== u.id) continue;
      if (!b.spellId || !ccSpellIds.has(b.spellId)) continue;
      const ts = b.logLine.timestamp;
      if (ts < start || ts > roundEnd) continue;
      const breakId = String(b.logLine.parameters?.[11] ?? "");
      if (!breakId) continue;
      const hit = [...((u.damageIn ?? []) as any[])]
        .reverse()
        .find(
          (d) =>
            d.spellId === breakId &&
            d.logLine.timestamp <= ts &&
            ts - d.logLine.timestamp <= 100 &&
            (d.logLine.lineIndex === undefined ||
              b.logLine.lineIndex === undefined ||
              d.logLine.lineIndex < b.logLine.lineIndex),
        );
      if (!hit) continue;
      let check: Check | undefined;
      let wrongPid: string | undefined;
      if (b.srcUnitId === u.id && hit.srcUnitId && hit.srcUnitId !== u.id) {
        check = "brokenByHolder";
        wrongPid = me.pid;
      } else if (
        breakId === "6940" &&
        hit.logLine.event === LogEvent.DAMAGE_SPLIT &&
        b.srcUnitId !== u.id
      ) {
        let link = false;
        for (const a of auras.slice(0, i))
          if (a.spellId === "6940" && a.srcUnitId === u.id)
            link =
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH
                ? true
                : a.logLine.event === LogEvent.SPELL_AURA_REMOVED
                  ? false
                  : link;
        const ally = byId.get(b.srcUnitId);
        const allyPid = ally && pidOf.get(ally.name)?.pid;
        if (link && allyPid) {
          check = "brokenBySplitAlly";
          wrongPid = allyPid;
        }
      }
      if (!check || !wrongPid) continue;
      const applied = auras
        .slice(0, i)
        .reverse()
        .find(
          (a) =>
            a.spellId === b.spellId &&
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED,
        );
      if (!applied) continue;
      bump(check);
      const t = at(applied.logLine.timestamp);
      const ccName = getEnglishSpellName(b.spellId, b.spellName);
      const breakName = getEnglishSpellName(
        breakId,
        String(b.logLine.parameters?.[12] ?? ""),
      );
      const wrong = lines.some(
        (l) =>
          l.startsWith(`${t}  [CC ON `) &&
          l.includes(`${me.pid}(`) &&
          l.includes(ccName) &&
          new RegExp(
            `broken by ${wrongPid}\\([^)]*\\)'s ${breakName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          ).test(l),
      );
      if (wrong)
        fail(check, `${where} ${t} ${u.name} ${ccName} broken by ${breakName}`);
    }
  }

  // ── trinket presses ─────────────────────────────────────────────────────
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (c.spellId !== MEDALLION) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const auras = (u.auraEvents ?? []).filter(
        (a: any) => a.destUnitId === u.id,
      );
      const removedNear = (lo: number, hi: number) =>
        auras.filter(
          (a: any) =>
            isRemoved(a) &&
            a.logLine.timestamp - ts >= lo &&
            a.logLine.timestamp - ts <= hi,
        );
      /** the log gives this removal another cause: a BROKEN line of the
       * aura at it, or a SPELL_DISPEL of it within 50 ms */
      const causedAt = (r: any): boolean => {
        const rTs = r.logLine.timestamp;
        return (
          // the BROKEN line can precede the REMOVED it caused by a few ms
          // (65-2 Intimidating Shout: BROKEN_SPELL .428, REMOVED .436)
          auras.some(
            (a: any) =>
              isBroken(a) &&
              a.spellId === r.spellId &&
              a.logLine.timestamp - rTs <= 1 &&
              rTs - a.logLine.timestamp <= 50,
          ) ||
          (u.actionIn ?? []).some(
            (x: any) =>
              x.logLine.event === LogEvent.SPELL_DISPEL &&
              x.extraSpellId === r.spellId &&
              Math.abs(x.logLine.timestamp - rTs) <= 50,
          )
        );
      };
      // enemyTrinketOutOf
      if (me.enemy && ts <= roundEnd) {
        const ours = removedNear(-25, 50).filter(
          (a: any) =>
            !(a.logLine.timestamp < ts && causedAt(a)) &&
            friendlyOrSummon(a.srcUnitId) &&
            a.spellId &&
            (ccSpellIds.has(a.spellId) ||
              disarmSpellIds.has(a.spellId) ||
              isSilenceOnlyAura(a.spellId)),
        );
        if (ours.length > 0) {
          bump("enemyTrinketOutOf");
          const t = at(ts);
          const ok = lines.some(
            (l) =>
              l.startsWith(`${t}  [ENEMY TRINKET]   ${me.pid}(`) &&
              l.includes(" out of "),
          );
          if (!ok)
            fail(
              "enemyTrinketOutOf",
              `${where} ${t} ${u.name} removed ${ours.map((a: any) => a.spellName).join("/")}`,
            );
        }
      }
      // trinketAfterCause
      for (const r of removedNear(-50, -1)) {
        if (!r.spellId || !ccSpellIds.has(r.spellId)) continue;
        const rTs = r.logLine.timestamp;
        if (!causedAt(r)) continue;
        const applied = [...auras]
          .reverse()
          .find(
            (a: any) =>
              a.spellId === r.spellId &&
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              a.logLine.timestamp <= rTs,
          );
        if (!applied) continue;
        bump("trinketAfterCause");
        const t = at(applied.logLine.timestamp);
        const name = r.spellName as string;
        const credited = lines.some(
          (l) =>
            l.startsWith(`${t}  `) &&
            l.includes(`${me.pid}(`) &&
            l.includes(name) &&
            /trinket broke this CC|ended by their PvP trinket/.test(l),
        );
        if (credited)
          fail("trinketAfterCause", `${where} ${t} ${u.name} ${name}`);
      }
    }
  }
}

console.log(`contexts: ${contexts}`);
for (const c of [
  "petDispel",
  "enemyTrinketOutOf",
  "trinketAfterCause",
  "brokenByHolder",
  "brokenBySplitAlly",
] as Check[]) {
  const b = bad.get(c) ?? [];
  console.log(`${c}: expected ${expected.get(c) ?? 0}, wrong ${b.length}`);
  for (const s of b.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
