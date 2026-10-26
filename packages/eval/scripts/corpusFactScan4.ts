/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, damageIn, absorbsIn) by the hundred */
/**
 * corpusFactScan4.ts — corpus-wide deterministic fact checks, batch 4
 * (fact5 F18, 2026-10-24): the recurring classes of the round-5 double audit
 * (`runs/fact5-2026-10-24`), searched over a whole acceptanceCapture capture
 * (`<dir>/s<k>/{context,findings}/`). The same harness as
 * `corpusFactScan3.ts` (file loop, parse cache, pid mapping, `unmapped` →
 * exit 1, `--examples N`, distinct-fact counting). Every check derives its
 * fact from the log rows directly — never through the analysis predicate it
 * audits. Tables read here are lookups only: English names, the raw
 * SPELL_CAST_FAILED stream (`parseRawStreams`, the log's own rows).
 *
 *  - `castDamageIdSplit` (D7 / D8): an `ABILITIES INTO IMMUNITY/DR` line
 *    `[m:ss] Spec (Name): A + B ×2 … into Target's Defense`. The player's
 *    successful casts at the target inside the defense's logged run (its
 *    aura on the target, APPLIED at the printed second → its REMOVED) whose
 *    English name is one of the player's ≥ 5 % landed-damage spells counted
 *    BY NAME: more than the line lists, the extra casts being of a spell
 *    whose cast id never appears among the player's damage ids (Execute
 *    281000 ↔ 260798). `noLine`: such a run with another player's line and
 *    the section's door of such casts by this one (2 into an unconditional
 *    defensive, 3 into a gated wall — the verdict table), no line of theirs.
 *  - `negAbsorbSum` (D26): a `[DMG SPIKE] … (X absorbed)` line whose window
 *    holds a negative SPELL_ABSORBED row on the unit (Fel Armor's
 *    correction): X sits nearer the sum of the rows' absolute values than
 *    their signed sum and than the sum without that shield's rows (a
 *    deferral shield read as delay, FT-T02b), and the first two differ by
 *    more than X's rounding. The
 *    signed sum is the log's own: it equals the hit's MISSED ABSORB / landed
 *    `absorbed` field (dfb06d44 0:48, 9238-hit: −18,090 + 1,446 + 24,279 =
 *    7,635).
 *  - `friendlyRedistribution` (D10): a `[DMG SPIKE]` window on a unit whose
 *    damage rows (landed + absorbed) from a teammate player (not the unit
 *    itself) reach 5 % of the printed total and 20k, and the printed total
 *    sits nearer the window's whole incoming than the whole minus that share
 *    — health a teammate moved, counted as an enemy hit (Tempered in Battle
 *    469704). Blessing of Sacrifice's 6940 is left out (ruling A22 = B: it
 *    stays pressure). Kind = the spell.
 *  - `refusedAttemptDropped` (D6): a `cd-waste` menu event (whole round,
 *    never cast) with no `attempted=` while the owner has a SPELL_CAST_FAILED
 *    row of that spell id in the round and no SUCCESS of it.
 *  - `inactivityRefused` (D12): an `[INACTIVITY] N inactive Ls` line; the
 *    owner has SPELL_CAST_FAILED rows inside [m:ss + 1, m:ss + L] (inside
 *    the gap whatever the start's fraction) and the
 *    line states none of them (no spell of theirs, no `pressed but
 *    rejected (…)`).
 *
 * Inventories printed after the checks (not checks): negative SPELL_ABSORBED
 * rows by shield; teammate-sourced damage by spell; per shield with negative
 * rows, its positive / negative sums against its holder's same-named
 * periodic damage (a deferral shield's ticks).
 *
 *   npx tsx packages/eval/scripts/corpusFactScan4.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  castKeyOfAura,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import healerSaveCdGenerated from "@gladlog/analysis/src/data/healerSaveCdGenerated.json";
import {
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
} from "@gladlog/analysis/src/data/mitigationData";
import { mitigationVerdictOf } from "@gladlog/analysis/src/data/mitigationVerdicts";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import { ENEMY_IMMUNITY_SAVE_AURAS } from "@gladlog/analysis/src/data/spellIdLists";
import { immunityCoversSpell } from "@gladlog/analysis/src/data/spellSchools";
import { COPY_CAST_IDS } from "@gladlog/analysis/src/utils/castPress";
import { charmedAt } from "@gladlog/analysis/src/utils/charmedPlayer";
import { isEnemyCdWindowSpell } from "@gladlog/analysis/src/utils/cooldowns";
import {
  isExternalSaveId,
  KW_OWN_ROTATIONAL_ABSORB_AURA_IDS,
  KW_REDIRECT_PROTECTION_AURA_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { parseRawStreams } from "@gladlog/analysis/src/utils/rawStreams";
import { playableEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { ccThreatReachYards } from "@gladlog/analysis/src/utils/spellRange";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: corpusFactScan4.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]",
  );
  process.exit(2);
}
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ARCHIVE_DIR = argOf("--archive-dir") ?? "";
const EXAMPLES = Number(argOf("--examples") ?? 5);
const JSON_OUT = argOf("--json");
const unmapped: string[] = [];

const CHECKS = [
  "castDamageIdSplit",
  "negAbsorbSum",
  "friendlyRedistribution",
  "refusedAttemptDropped",
  "inactivityRefused",
  "enemyCdAuraForward",
  "enemyExternalForward",
  "unclosedAtRoundEnd",
  "ccReadyOutOfReach",
  "defenselessImmunityInHand",
  "defenselessExternalCaster",
  "spanCdBackInside",
  "rosterSides",
  "enemyHealCdForward",
  "defenselessRedirectUp",
] as const;
type Check = (typeof CHECKS)[number];
/** kinds counted but kept out of a check's violation total */
const OUT_OF_TOTAL = new Set<string>();
/** checks measured only: `unclosedAtRoundEnd` cannot tell a REMOVED the log
 * lost (a 15 s Power Infusion "up" for two minutes) from an aura that really
 * outlived its official length (fact5 D17: talent-lengthened, refreshed) —
 * every kind stays out of the total until a mechanism reading lands */
const MEASURED_ONLY = new Set<string>(["unclosedAtRoundEnd"]);
interface IViolation {
  check: Check;
  kind: string;
  where: string;
  archive: string;
  round: number;
  offMs: number;
  /** owner-independent identity of the fact (distinct counting) */
  fact: string;
  detail: string;
  line?: string;
}
const checked = new Map<string, number>();
const violations: IViolation[] = [];
const bump = (c: string, n = 1) => checked.set(c, (checked.get(c) ?? 0) + n);
/** inventory (not a check): negative SPELL_ABSORBED rows by shield, and
 * teammate-sourced damage on a unit by spell, over every round */
const negShield = new Map<string, { rows: number; sum: number }>();
const mateDamage = new Map<string, { rows: number; sum: number }>();
const tally = (
  m: Map<string, { rows: number; sum: number }>,
  k: string,
  v: number,
) => {
  const x = m.get(k) ?? { rows: 0, sum: 0 };
  x.rows++;
  x.sum += v;
  m.set(k, x);
};
const inventoried = new Set<string>();
/** per shield name: its positive / negative SPELL_ABSORBED rows and the
 * same-named periodic damage its holder took (landed + absorbed) — a
 * deferral shield's ticks (Time Dilation's shape) */
const deferral = new Map<
  string,
  { pos: number; neg: number; ticks: number; units: number }
>();
/** Blessing of Sacrifice's transfer 6940: damage the enemy caused, taken by
 * someone else — it stays pressure (ruling A22 = B, 2026-09-30) */
const SIGNED_TEAM_DAMAGE = new Set(["6940"]);

const nameOf = (id: string | undefined, fallback = ""): string =>
  id ? getEnglishSpellName(id, fallback) : fallback;
const fmtS = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const secOf = (mss: string): number => {
  const [m, s] = mss.split(":");
  return Number(m) * 60 + Number(s);
};
const ev = (a: any): string => a.logLine?.event;
const tsOf = (a: any): number => a.logLine?.timestamp ?? a.timestamp;
const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
const SUCCESS = LogEvent.SPELL_CAST_SUCCESS as string;
const ABSORBED = LogEvent.SPELL_ABSORBED as string;
/** "0.87M" / "110k" / "950" → its value and half its last printed digit */
function amountOf(s: string): { v: number; half: number } | undefined {
  const m = /^([\d.]+)([kM]?)$/.exec(s);
  if (!m) return undefined;
  const mul = m[2] === "M" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  const dec = m[1]!.includes(".") ? m[1]!.split(".")[1]!.length : 0;
  return { v: Number(m[1]) * mul, half: (mul / 10 ** dec) * 0.5 };
}

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
/** the offensive cooldowns' casts and their same-named effect auras — the
 * enemy-CD timeline's membership (corpusFactScan3's `OFFENSIVE_AURA_IDS`) */
const OFFENSIVE_AURA_IDS = new Set<string>();
for (const id of OFFENSIVE_CD_SPELL_IDS) {
  if (!isEnemyCdWindowSpell(id)) continue;
  OFFENSIVE_AURA_IDS.add(id);
  for (const a of effectAurasOfCast(id))
    if (nameOf(a) === nameOf(id)) OFFENSIVE_AURA_IDS.add(a);
}
const official = spellEffectGenerated as Record<
  string,
  { name?: string; durationSeconds?: number }
>;
const idsByName = new Map<string, string[]>();
for (const [id, r] of Object.entries(official))
  if (r?.name) idsByName.set(r.name, [...(idsByName.get(r.name) ?? []), id]);
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  const cdir = join(dir, shard, "context");
  for (const name of readdirSync(cdir)) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const findingsPath = join(dir, f.shard, "findings", f.name);
  const menu = existsSync(findingsPath)
    ? readFileSync(findingsPath, "utf8")
    : "";
  const [archive, ownerName] = text.split("\n", 2);
  if (!archive || !ownerName) continue;
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
  const rawLines: string[] = ((item as any).rawLines ?? []) as string[];
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
  const byName = new Map(units.map((u) => [u.name, u]));
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  const unitOfPid = (pid: string | undefined): any =>
    pid ? byName.get(pidName.get(pid) ?? "") : undefined;
  const owner = byName.get(ownerName);
  if (!owner) continue;
  const start: number = legacy.startTime;
  const end: number = legacy.endTime;
  const where = `${f.shard}/${f.name}`;
  const roundKey = `${archive}#${f.round}`;
  const players = units.filter((u) => u.info);
  const violate = (
    check: Check,
    kind: string,
    atMs: number,
    factId: string,
    detail: string,
    line?: string,
  ) =>
    violations.push({
      check,
      kind,
      where,
      archive,
      round: f.round,
      offMs: atMs - start,
      fact: `${roundKey}#${check}#${kind}#${factId}`,
      detail,
      ...(line ? { line } : {}),
    });
  let failedRows: ReturnType<typeof parseRawStreams>["castFailed"] | undefined;
  const castFailed = () =>
    (failedRows ??= parseRawStreams(
      rawLines.join("\n"),
      start,
      (end - start) / 1000,
    ).castFailed);
  const successesOf = (u: any): any[] =>
    ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);

  // ── inventory, once per round ──
  if (!inventoried.has(roundKey)) {
    inventoried.add(roundKey);
    for (const u of players) {
      for (const r of (u.absorbsIn ?? []) as any[]) {
        const a = Number(r.absorbedAmount) || 0;
        if (a < 0 && tsOf(r) >= start && tsOf(r) <= end)
          tally(
            negShield,
            `${nameOf(String(r.spellId), String(r.spellId))} ${r.spellId}`,
            a,
          );
      }
      const shields = new Map<string, { pos: number; neg: number }>();
      for (const r of (u.absorbsIn ?? []) as any[]) {
        if (tsOf(r) < start || tsOf(r) > end) continue;
        const n = nameOf(String(r.spellId), "");
        if (!n) continue;
        const a = Number(r.absorbedAmount) || 0;
        const x = shields.get(n) ?? { pos: 0, neg: 0 };
        if (a < 0) x.neg += a;
        else x.pos += a;
        shields.set(n, x);
      }
      for (const [n, x] of shields) {
        if (x.neg === 0) continue;
        let ticks = 0;
        for (const d of (u.damageIn ?? []) as any[])
          if (
            tsOf(d) >= start &&
            tsOf(d) <= end &&
            d.srcUnitId === u.id &&
            ev(d) !== ABSORBED &&
            nameOf(String(d.spellId), "") === n
          )
            ticks += Math.abs(d.effectiveAmount ?? 0);
        for (const r of (u.absorbsIn ?? []) as any[])
          if (
            tsOf(r) >= start &&
            tsOf(r) <= end &&
            r.attackerId === u.id &&
            nameOf(String(r.attackSpellId), "") === n
          )
            ticks += Math.abs(Number(r.absorbedAmount) || 0);
        const y = deferral.get(n) ?? { pos: 0, neg: 0, ticks: 0, units: 0 };
        y.pos += x.pos;
        y.neg += x.neg;
        y.ticks += ticks;
        y.units++;
        deferral.set(n, y);
      }
      const mates = new Set(
        players
          .filter((x) => x.reaction === u.reaction && x.id !== u.id)
          .map((x) => x.id as string),
      );
      for (const d of (u.damageIn ?? []) as any[]) {
        if (ev(d) === ABSORBED || !mates.has(d.srcUnitId)) continue;
        if (tsOf(d) < start || tsOf(d) > end) continue;
        tally(
          mateDamage,
          `${nameOf(String(d.spellId), String(d.spellId))} ${d.spellId}`,
          Math.abs(d.effectiveAmount ?? 0),
        );
      }
      for (const r of (u.absorbsIn ?? []) as any[]) {
        if (!mates.has(r.attackerId) || tsOf(r) < start || tsOf(r) > end)
          continue;
        tally(
          mateDamage,
          `${nameOf(String(r.attackSpellId), String(r.attackSpellId))} ${r.attackSpellId} (absorbed)`,
          Math.abs(Number(r.absorbedAmount) || 0),
        );
      }
    }
  }

  // ── castDamageIdSplit ──
  {
    const AB_RE = /^ {2}\[(\d+:\d\d)\] .+? \(([^)]+)\): (.+) into (.+)'s (.+)$/;
    let inSection = false;
    const printed: Array<{
      sec: number;
      player: any;
      target: any;
      defense: string;
      count: number;
      line: string;
    }> = [];
    for (const l of lines) {
      if (l.startsWith("ABILITIES INTO IMMUNITY/DR")) inSection = true;
      else if (inSection && l !== "" && !l.startsWith(" ")) inSection = false;
      if (!inSection) continue;
      const m = AB_RE.exec(l);
      if (!m) continue;
      const player = byName.get(m[2]!);
      const target = byName.get(m[4]!);
      if (!player || !target) continue;
      const count = m[3]!
        .split(" + ")
        .reduce((n, part) => n + Number(/×(\d+)$/.exec(part)?.[1] ?? 1), 0);
      printed.push({
        sec: secOf(m[1]!),
        player,
        target,
        defense: m[5]!,
        count,
        line: l,
      });
    }
    // the player's ≥ 5 % landed-damage spells by English name, and the ids
    // its damage rows carry
    const hvCache = new Map<string, { names: Set<string>; ids: Set<string> }>();
    const hvOf = (u: any) => {
      let h = hvCache.get(u.id);
      if (!h) {
        const tot = new Map<string, number>();
        const ids = new Set<string>();
        let all = 0;
        for (const d of (u.damageOut ?? []) as any[]) {
          if (ev(d) === ABSORBED) continue;
          const id = d.spellId ? String(d.spellId) : "";
          if (id) ids.add(id);
          const n = id ? nameOf(id, d.spellName ?? "") : "melee";
          const a = Math.abs(d.effectiveAmount ?? 0);
          tot.set(n, (tot.get(n) ?? 0) + a);
          all += a;
        }
        h = {
          names: new Set(
            [...tot]
              .filter(([, v]) => all > 0 && v >= all * 0.05)
              .map(([k]) => k),
          ),
          ids,
        };
        hvCache.set(u.id, h);
      }
      return h;
    };
    const runOf = (target: any, defense: string, sec: number) => {
      const auras = ((target.auraEvents ?? []) as any[])
        .filter((a) => a.destUnitId === target.id)
        .sort((a, b) => tsOf(a) - tsOf(b));
      const app = auras.find(
        (a) =>
          ev(a) === APPLIED &&
          nameOf(String(a.spellId), a.spellName ?? "") === defense &&
          Math.floor((tsOf(a) - start) / 1000) === sec,
      );
      if (!app) return undefined;
      const rem = auras.find(
        (a) =>
          ev(a) === REMOVED &&
          a.spellId === app.spellId &&
          tsOf(a) >= tsOf(app),
      );
      return { from: tsOf(app), to: rem ? tsOf(rem) : end, auraId: String(app.spellId) };
    };
    const castsIn = (
      player: any,
      target: any,
      run: { from: number; to: number; auraId: string },
    ) => {
      const hv = hvOf(player);
      let rows = successesOf(player).filter(
        (c) =>
          c.destUnitId === target.id &&
          tsOf(c) >= run.from - 6000 &&
          tsOf(c) <= run.to &&
          tsOf(c) < end &&
          hv.names.has(nameOf(String(c.spellId), c.spellName ?? "")) &&
          // a copy / tick / later stage of another press is no cast (the
          // product's table: Mutilate's 27576, Penance's bolts)
          !COPY_CAST_IDS.has(String(c.spellId)) &&
          // a school the immunity does not cover landed (DB2 masks: a Frost
          // Strike into Blessing of Protection) — the section's own rule
          immunityCoversSpell(run.auraId, String(c.spellId)) !== false,
      );
      // an empowered spell's success row is written when the hold BEGINS:
      // it goes off at its SPELL_EMPOWER_END; a hold never ended fired
      // nothing (the log's own rows; codex 20-F18-03 #2)
      const starts = ((player.empowerStarts ?? []) as any[]).map(tsOf);
      const ends = ((player.empowerEnds ?? []) as any[])
        .map((x) => ({ id: String(x.spellId), ms: tsOf(x) }))
        .sort((a, b) => a.ms - b.ms);
      const firedAt = (c: any): number | null => {
        const t = tsOf(c);
        if (!starts.some((st) => Math.abs(st - t) <= 500)) return t;
        const e = ends.find(
          (x) =>
            x.ms >= t &&
            nameOf(x.id) === nameOf(String(c.spellId), c.spellName ?? ""),
        );
        return e ? e.ms : null;
      };
      rows = rows.filter((c) => {
        const at = firedAt(c);
        return at !== null && at >= run.from && at <= run.to;
      });
      // one press written under two ids of the spell in one instant (Flame
      // Shock 470411 + 188389) is one cast
      return rows.filter(
        (c, i) =>
          !rows.some(
            (o, j) =>
              j < i &&
              o.spellId !== c.spellId &&
              Math.abs(tsOf(o) - tsOf(c)) <= 5 &&
              nameOf(String(o.spellId), o.spellName ?? "") ===
                nameOf(String(c.spellId), c.spellName ?? ""),
          ),
      );
    };
    const runs = new Map<
      string,
      {
        from: number;
        to: number;
        auraId: string;
        target: any;
        defense: string;
        players: Set<string>;
      }
    >();
    for (const p of printed) {
      const run = runOf(p.target, p.defense, p.sec);
      if (!run) continue;
      const rk = `${p.target.id}|${p.defense}|${p.sec}`;
      if (!runs.has(rk))
        runs.set(rk, {
          ...run,
          target: p.target,
          defense: p.defense,
          players: new Set(),
        });
      runs.get(rk)!.players.add(p.player.id);
      bump("castDamageIdSplit");
      const casts = castsIn(p.player, p.target, run);
      const ids = hvOf(p.player).ids;
      const split = casts.filter((c) => !ids.has(String(c.spellId)));
      if (casts.length > p.count && split.length > 0)
        violate(
          "castDamageIdSplit",
          `short:${nameOf(String(split[0].spellId))}`,
          run.from,
          `${p.player.id}:${p.target.id}:${p.sec}`,
          `${p.player.name} into ${p.target.name}'s ${p.defense} at ${fmtS(p.sec)}: line lists ${p.count}, ${casts.length} by name (${split.length} cast-id ≠ damage-id: ${[...new Set(split.map((c) => nameOf(String(c.spellId))))].join(", ")})`,
          p.line,
        );
    }
    const friendsOf = (u: any) =>
      players.filter((x) => x.reaction !== u.reaction);
    for (const r of runs.values()) {
      for (const pl of friendsOf(r.target)) {
        if (r.players.has(pl.id)) continue;
        const casts = castsIn(pl, r.target, r);
        const ids = hvOf(pl).ids;
        const split = casts.filter((c) => !ids.has(String(c.spellId)));
        // the section's own door: 2 casts into an unconditional defensive,
        // 3 into a kill-live-gated wall (the verdict table, as data)
        const verdict = mitigationVerdictOf(
          castKeyOfAura(r.auraId, (id) => mitigationVerdictOf(id) !== null) ??
            r.auraId,
        );
        const door = verdict === "unconditional" ? 2 : 3;
        if (casts.length >= door && split.length > 0)
          violate(
            "castDamageIdSplit",
            `noLine:${nameOf(String(split[0].spellId))}`,
            r.from,
            `${pl.id}:${r.target.id}:${Math.floor((r.from - start) / 1000)}`,
            `${pl.name} into ${r.target.name}'s ${r.defense} at ${fmtS((r.from - start) / 1000)}: no line, ${casts.length} by name (${split.length} cast-id ≠ damage-id)`,
          );
      }
    }
  }

  // ── negAbsorbSum / friendlyRedistribution ──
  {
    const SPIKE_RE =
      /^(\d+:\d\d)–(\d+:\d\d)\s+\[DMG SPIKE\]\s+(\d+)\([^)]*\) \([^)]*\): ([\d.]+[kM]?) in /;
    for (const l of lines) {
      const m = SPIKE_RE.exec(l);
      if (!m) continue;
      const u = unitOfPid(m[3]);
      if (!u) continue;
      const a = start + secOf(m[1]!) * 1000;
      const b = start + (secOf(m[2]!) + 1) * 1000;
      const inWin = (r: any) => tsOf(r) >= a && tsOf(r) < b;
      // negAbsorbSum
      const absRows = ((u.absorbsIn ?? []) as any[]).filter(inWin);
      const neg = absRows.filter((r) => Number(r.absorbedAmount) < 0);
      const pm = / \(([\d.]+[kM]?) absorbed\)/.exec(l);
      if (neg.length > 0 && pm) {
        bump("negAbsorbSum");
        const p = amountOf(pm[1]!)!;
        const absSum = absRows.reduce(
          (s, r) => s + Math.abs(Number(r.absorbedAmount) || 0),
          0,
        );
        const signed = absRows.reduce(
          (s, r) => s + (Number(r.absorbedAmount) || 0),
          0,
        );
        // …or without the shield that wrote the negative rows at all (a
        // deferral shield read as delay, not absorb — the FT-T02b reading)
        const negIds = new Set(neg.map((r) => String(r.spellId)));
        const withoutNeg = absRows
          .filter((r) => !negIds.has(String(r.spellId)))
          .reduce((s, r) => s + Math.abs(Number(r.absorbedAmount) || 0), 0);
        if (
          absSum - signed > 2 * p.half &&
          Math.abs(p.v - absSum) < Math.abs(p.v - signed) &&
          Math.abs(p.v - absSum) < Math.abs(p.v - withoutNeg)
        )
          violate(
            "negAbsorbSum",
            `abs:${nameOf(String(neg[0].spellId))}`,
            a,
            `${u.id}:${m[1]}`,
            `${m[1]}–${m[2]} on ${u.name}: printed ${pm[1]} absorbed, |sum| ${Math.round(absSum / 1000)}k, signed ${Math.round(signed / 1000)}k (${neg.length} negative rows)`,
            l,
          );
      }
      // friendlyRedistribution
      const total = amountOf(m[4]!)!.v;
      const mates = new Set(
        players
          .filter((x) => x.reaction === u.reaction && x.id !== u.id)
          .map((x) => x.id as string),
      );
      const byId = new Map<string, number>();
      const byIdOfUnit = new Map(players.map((x) => [x.id as string, x]));
      // a charmed teammate's damage is the enemy's (ruling A22 = B)
      // …and so is a teammate's hit on the unit while IT is charmed (its own
      // team fighting a mind-controlled player) — friendly fire, not moved
      // health
      const charmed = (id: string, ms: number) => {
        const x = byIdOfUnit.get(id);
        return (!!x && charmedAt(x, ms)) || charmedAt(u, ms);
      };
      for (const d of (u.damageIn ?? []) as any[]) {
        if (!inWin(d) || !mates.has(d.srcUnitId)) continue;
        if (ev(d) === ABSORBED || charmed(d.srcUnitId, tsOf(d))) continue;
        const id = String(d.spellId ?? "melee");
        byId.set(id, (byId.get(id) ?? 0) + Math.abs(d.effectiveAmount ?? 0));
      }
      for (const r of absRows) {
        if (!mates.has(r.attackerId) || charmed(r.attackerId, tsOf(r))) continue;
        const id = String(r.attackSpellId ?? "melee");
        byId.set(
          id,
          (byId.get(id) ?? 0) + Math.abs(Number(r.absorbedAmount) || 0),
        );
      }
      bump("friendlyRedistribution");
      // the window's whole incoming (landed + absorbed): the printed total
      // holds the teammate's share when it sits nearer this than this minus it
      let allIn = 0;
      for (const d of (u.damageIn ?? []) as any[])
        if (inWin(d) && ev(d) !== ABSORBED)
          allIn += Math.abs(d.effectiveAmount ?? 0);
      for (const r of absRows) allIn += Math.abs(Number(r.absorbedAmount) || 0);
      for (const [id, amt] of byId)
        if (
          !SIGNED_TEAM_DAMAGE.has(id) &&
          amt >= 20000 &&
          amt >= total * 0.05 &&
          Math.abs(total - allIn) < Math.abs(total - (allIn - amt))
        )
          violate(
            "friendlyRedistribution",
            `${nameOf(id, id)} ${id}`,
            a,
            `${u.id}:${m[1]}:${id}`,
            `${m[1]}–${m[2]} on ${u.name}: ${Math.round(amt / 1000)}k of the printed ${m[4]} is ${nameOf(id, id)} from a teammate`,
            l,
          );
    }
  }

  const enemiesOfOwner = players.filter((u) => u.reaction !== owner.reaction);
  const deathMs = (u: any): number =>
    Math.min(
      Infinity,
      ...((u.deathRecords ?? []) as any[]).map((d) => d.timestamp),
    );
  const pidOf = new Map<string, string>();
  for (const [pid, n] of pidName) pidOf.set(n, pid);
  /** lines printed at the second `sec` (± `slack`) */
  const linesNear = (sec: number, slack: number) => {
    const want = new Set<string>();
    for (let x = sec - slack; x <= sec + slack; x++) want.add(fmtS(x));
    return lines.filter((l) => want.has(l.split(/\s/, 1)[0]!));
  };
  const castsOf = (u: any) => successesOf(u);

  // ── enemyCdAuraForward ──
  for (const e of enemiesOfOwner) {
    const pid = pidOf.get(e.name);
    if (!pid) continue;
    const dies = deathMs(e);
    const own = ((e.auraEvents ?? []) as any[])
      .filter((a) => a.srcUnitId === e.id && a.destUnitId === e.id)
      .sort((a, b) => tsOf(a) - tsOf(b));
    const openSince = new Map<string, number>();
    for (const a of own) {
      const id = String(a.spellId ?? "");
      if (ev(a) === REMOVED) {
        openSince.delete(id);
        continue;
      }
      if (ev(a) !== APPLIED) continue;
      const wasOpen = openSince.has(id);
      openSince.set(id, tsOf(a));
      if (wasOpen || !OFFENSIVE_AURA_IDS.has(id)) continue;
      const ts = tsOf(a);
      // a REMOVED → APPLIED re-broadcast of a running aura (≤ 50 ms)
      if (
        own.some(
          (b) =>
            ev(b) === REMOVED &&
            String(b.spellId) === id &&
            tsOf(b) <= ts &&
            ts - tsOf(b) <= 50,
        )
      )
        continue;
      if (ts < start || ts > end || ts >= dies) continue;
      const name = nameOf(id, a.spellName ?? "");
      // a press of it, or of a spell that applies it (Ascendance → Doom
      // Winds: one burst, Ascendance's — ruling 2026-09-26)
      const pressed = castsOf(e).some(
        (c) =>
          (nameOf(String(c.spellId), c.spellName ?? "") === name ||
            effectAurasOfCast(String(c.spellId)).includes(id)) &&
          tsOf(c) >= ts - 3000 &&
          tsOf(c) <= ts + 1000,
      );
      if (pressed) continue;
      bump("enemyCdAuraForward");
      const sec = Math.floor((ts - start) / 1000);
      const ok = linesNear(sec, 1).some(
        (l) =>
          l.includes("[ENEMY CD]") && l.includes(` ${pid}(`) && l.includes(name),
      );
      if (!ok)
        violate(
          "enemyCdAuraForward",
          name,
          ts,
          `${e.id}:${id}:${sec}`,
          `${pid} ${name} aura ${fmtS(sec)} with no press — no [ENEMY CD] line`,
        );
    }
  }

  // ── enemyExternalForward ──
  for (const e of enemiesOfOwner) {
    const dies = deathMs(e);
    for (const mate of enemiesOfOwner) {
      if (mate.id === e.id) continue;
      const pid = pidOf.get(e.name);
      if (!pid) continue;
      const rows = ((mate.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            a.srcUnitId === e.id &&
            a.destUnitId === mate.id &&
            isExternalSaveId(String(a.spellId ?? "")),
        )
        .sort((x, y) => tsOf(x) - tsOf(y));
      // up already (a re-listing when the unit comes back into view) or a
      // REMOVED → APPLIED re-broadcast (≤ 50 ms) is no new application
      const openIds = new Set<string>();
      const lastRemoved = new Map<string, number>();
      for (const a of rows) {
        const id = String(a.spellId ?? "");
        if (ev(a) === REMOVED) {
          openIds.delete(id);
          lastRemoved.set(id, tsOf(a));
          continue;
        }
        if (ev(a) !== APPLIED) continue;
        const wasOpen = openIds.has(id);
        openIds.add(id);
        if (wasOpen) continue;
        if (tsOf(a) - (lastRemoved.get(id) ?? -Infinity) <= 50) continue;
        const ts = tsOf(a);
        if (ts < start || ts > end || ts >= dies) continue;
        const name = nameOf(id, a.spellName ?? "");
        const pressed = castsOf(e).some(
          (c) =>
            nameOf(String(c.spellId), c.spellName ?? "") === name &&
            tsOf(c) >= ts - 3000 &&
            tsOf(c) <= ts + 1000,
        );
        if (pressed) continue;
        bump("enemyExternalForward");
        const sec = Math.floor((ts - start) / 1000);
        const ok = linesNear(sec, 1).some(
          (l) =>
            l.includes("[ENEMY DEF]") && l.includes(` ${pid}(`) && l.includes(name),
        );
        if (!ok)
          violate(
            "enemyExternalForward",
            name,
            ts,
            `${e.id}:${mate.id}:${id}:${sec}`,
            `${pid} ${name} on ${mate.name} at ${fmtS(sec)}, aura only — no [ENEMY DEF] line`,
          );
      }
    }
  }

  // ── unclosedAtRoundEnd ──
  {
    // the [RES] row's second is its timeline row's
    let rowSec = -1;
    const resAt: Array<{ sec: number; l: string }> = [];
    for (const l of lines) {
      const m = /^(\d+:\d\d)\s/.exec(l);
      if (m) rowSec = secOf(m[1]!);
      else if (/^\s+\[RES\]/.test(l) && rowSec >= 0) resAt.push({ sec: rowSec, l });
    }
    for (const e of enemiesOfOwner) {
      if (deathMs(e) <= end) continue;
      const evs = ((e.auraEvents ?? []) as any[])
        .filter((a) => a.srcUnitId === e.id && a.destUnitId === e.id)
        .sort((a, b) => tsOf(a) - tsOf(b));
      const visibleLate = [...castsOf(e), ...((e.damageOut ?? []) as any[])].some(
        (c) => tsOf(c) >= end - 5000 && tsOf(c) <= end,
      );
      if (!visibleLate) continue;
      for (const id of new Set(evs.map((a) => String(a.spellId ?? "")))) {
        if (!OFFENSIVE_AURA_IDS.has(id)) continue;
        const rows = evs.filter(
          (a) => String(a.spellId) === id && tsOf(a) >= start && tsOf(a) <= end,
        );
        const last = rows[rows.length - 1];
        if (!last || ev(last) === REMOVED) continue;
        const name = nameOf(id, last.spellName ?? "");
        const tag = new RegExp(
          name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            String.raw`/[^,(]+\((\d+)s left\)`,
        );
        bump("unclosedAtRoundEnd");
        const endS = (end - start) / 1000;
        const bad = resAt.filter((r) => {
          if (r.sec * 1000 + start < tsOf(last)) return false;
          const m = tag.exec(r.l);
          return !!m && r.sec + Number(m[1]) < endS - 2;
        });
        if (bad.length > 0)
          violate(
            "unclosedAtRoundEnd",
            name,
            tsOf(last),
            `${e.id}:${id}`,
            `${e.name} ${name} up from ${fmtS((tsOf(last) - start) / 1000)} with no REMOVED to the round end ${fmtS(endS)}; [RES] at ${fmtS(bad[0]!.sec)} says it ends earlier`,
            bad[0]!.l.trim().slice(0, 200),
          );
      }
    }
  }

  // ── ccReadyOutOfReach ──
  {
    const CT_RE =
      /^\s+\[CONTESTED\] (\d+:\d\d)–(\d+:\d\d) .*?: (.+?) ready on enemy healer (\S+) \(/;
    for (const l of lines) {
      const m = CT_RE.exec(l);
      if (!m) continue;
      const healer = byName.get(m[4]!);
      if (!healer) continue;
      const reach = Math.max(
        -1,
        ...(idsByName.get(m[3]!) ?? []).map(
          (id) => ccThreatReachYards(owner, id) ?? -1,
        ),
      );
      if (reach < 0) continue;
      bump("ccReadyOutOfReach");
      const a = secOf(m[1]!);
      const b = secOf(m[2]!);
      let reachable = false;
      let minD = Infinity;
      for (let x = a; x <= b && !reachable; x++) {
        const ms = start + x * 1000;
        const po = getUnitPositionAtTime(owner, ms, INTERP_MAX_GAP_MS);
        const ph = getUnitPositionAtTime(healer, ms, INTERP_MAX_GAP_MS);
        if (!po || !ph) {
          reachable = true; // unknown is no "out of reach"
          break;
        }
        const d = distanceBetween(po, ph);
        minD = Math.min(minD, d);
        if (d <= reach + 3) reachable = true;
      }
      if (!reachable)
        violate(
          "ccReadyOutOfReach",
          m[3]!,
          start + a * 1000,
          `${owner.id}:${healer.id}:${a}`,
          `${m[1]}–${m[2]} ${m[3]} (reach ${reach} yd) "ready on enemy healer" ${healer.name}: nearest ${Math.round(minD)} yd`,
          l.trim().slice(0, 200),
        );
    }
  }

  // ── defenselessImmunityInHand / defenselessExternalCaster ──
  {
    const DL_RE =
      /^\s+\[(?:KILL WINDOW|VULNERABLE)\] .*? on [^(]+\(([^)]+)\).*?\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/;
    const seenSpan = new Set<string>();
    for (const l of lines) {
      const m = DL_RE.exec(l);
      if (!m) continue;
      const u = byName.get(m[1]!);
      if (!u) continue;
      const a = secOf(m[2]!);
      const b = secOf(m[3]!);
      const sk = `${u.id}:${a}:${b}`;
      if (seenSpan.has(sk)) continue;
      seenSpan.add(sk);
      const aMs = start + a * 1000;
      const bMs = start + (b + 1) * 1000;
      // an immunity-kind save of its own in hand: first pressed after the
      // span opened, none in its cooldown before it
      bump("defenselessImmunityInHand");
      const ownAura = ((u.auraEvents ?? []) as any[]).filter(
        (x) => ev(x) === APPLIED && x.srcUnitId === u.id && x.destUnitId === u.id,
      );
      for (const id of Object.keys(ENEMY_IMMUNITY_SAVE_AURAS)) {
        const cd = official[id] as { cooldownSeconds?: number } | undefined;
        const cdS = cd?.cooldownSeconds ?? 0;
        if (cdS <= 0) continue;
        const presses = ownAura.filter((x) => String(x.spellId) === id).map(tsOf);
        if (presses.length === 0) continue;
        const before = presses.some((t) => t <= aMs && t >= aMs - cdS * 1000);
        const insideOrAfter = presses.some((t) => t > aMs && t <= bMs + 1000);
        if (!before && insideOrAfter)
          violate(
            "defenselessImmunityInHand",
            nameOf(id),
            aMs,
            sk,
            `${u.name} defenseless ${m[2]}–${m[3]} with ${nameOf(id)} in hand (first pressed ${fmtS((presses.find((t) => t > aMs)! - start) / 1000)})`,
            l.trim().slice(0, 200),
          );
      }
      // the span opened only when the unit's own external on an ally ran out
      bump("defenselessExternalCaster");
      const ext = successesOf(u).find(
        (c) =>
          isExternalSaveId(String(c.spellId ?? "")) &&
          c.destUnitId &&
          c.destUnitId !== u.id &&
          !/^0+$/.test(c.destUnitId) &&
          tsOf(c) <= aMs - 2000 &&
          tsOf(c) >= aMs - 13000,
      );
      if (!ext) continue;
      // the span opens where the external on the ally ran out, though the
      // unit's own last protection (a wall / immunity / external received,
      // official ≥ 20 %) had ended ≥ 2 s before that
      const extEnd =
        tsOf(ext) + (official[String(ext.spellId)]?.durationSeconds ?? 0) * 1000;
      if (Math.abs(extEnd - aMs) > 1500) continue;
      let lastProtEnd = -Infinity;
      for (const x of (u.auraEvents ?? []) as any[]) {
        if (ev(x) !== APPLIED || x.destUnitId !== u.id) continue;
        const id = String(x.spellId ?? "");
        if (id === String(ext.spellId)) continue; // its own link copy
        const row = MITIGATION_TABLE[id];
        // a wall / immunity of ≥ 20 %, or a shield / redirect the span
        // rulings count (own Power Word: Shield / Void Shield, Intervene,
        // Roar of Sacrifice, an immunity-kind save) — 605 s0/7-2: a span
        // that opened at its own Void Shield's end is no external's doing
        if (
          !(row && row.pct >= 20) &&
          !KW_OWN_ROTATIONAL_ABSORB_AURA_IDS.has(id) &&
          !KW_REDIRECT_PROTECTION_AURA_IDS.has(id) &&
          !(id in ENEMY_IMMUNITY_SAVE_AURAS)
        )
          continue;
        const rem = ((u.auraEvents ?? []) as any[]).find(
          (y) => ev(y) === REMOVED && String(y.spellId) === id && tsOf(y) >= tsOf(x),
        );
        const to = rem ? tsOf(rem) : tsOf(x);
        if (to <= aMs + 500) lastProtEnd = Math.max(lastProtEnd, to);
      }
      if (!(aMs - Math.max(lastProtEnd, tsOf(ext)) >= 2000)) continue;
      // …and no other own aura of the unit ended at the span's start (an
      // Ultimate Penitence, a Fade's image: the span opened at that, not at
      // the external — 605 s0/100-6, s2/41-6)
      if (
        ((u.auraEvents ?? []) as any[]).some(
          (x) =>
            ev(x) === REMOVED &&
            x.srcUnitId === u.id &&
            x.destUnitId === u.id &&
            String(x.spellId) !== String(ext.spellId) &&
            tsOf(x) >= aMs - 1500 &&
            tsOf(x) <= aMs + 500,
        )
      )
        continue;
      violate(
        "defenselessExternalCaster",
        nameOf(String(ext.spellId)),
        aMs,
        sk,
        `${u.name} defenseless from ${m[2]}: its ${nameOf(String(ext.spellId))} on an ally at ${fmtS((tsOf(ext) - start) / 1000)} held the span off`,
        l.trim().slice(0, 200),
      );
    }
  }

  // ── spanCdBackInside ──
  {
    let rowSec = -1;
    const resAt: Array<{ sec: number; l: string }> = [];
    for (const l of lines) {
      const m = /^(\d+:\d\d)\s/.exec(l);
      if (m) rowSec = secOf(m[1]!);
      else if (/^\s+\[RES\]/.test(l) && rowSec >= 0) resAt.push({ sec: rowSec, l });
    }
    // the defensive kit as data: the mitigation table and its absorb /
    // heal / transfer whitelist (Dark Pact)
    // a defensive as data: a wall / immunity row of ≥ 20 % in the mitigation
    // table, or an absorb shield of the whitelist (Dark Pact) — not a
    // self-heal (Desperate Prayer, Healthstone: filed Utility by ruling
    // 2026-10-09) and not a sub-20 % row (Avatar)
    const wallNames = new Set(
      [
        ...Object.entries(MITIGATION_TABLE)
          .filter(([, r]) => r.pct >= 20)
          .map(([id]) => id),
        ...[...NO_MITIGATION_IDS].filter((id) => abilityProfile(id).absorbs),
      ]
        .map((id) => nameOf(id))
        .filter(Boolean),
    );
    const SI_RE = /^\s+(\d+:\d\d)–(\d+:\d\d) \[.*— no defensive CD available$/;
    for (const l of lines) {
      const m = SI_RE.exec(l);
      if (!m) continue;
      bump("spanCdBackInside");
      const a = secOf(m[1]!);
      const b = secOf(m[2]!);
      const back = resAt.find((r) => {
        if (r.sec <= a || r.sec > b) return false;
        const m2 = /rdy:(Δ )?(.*?)(?: {2}|$)/.exec(r.l);
        if (!m2) return false;
        // `rdy:Δ +A +2:B -C` (a change list) or `rdy:A,B,2:C` (the full one)
        // a change list only: `+X` is X coming back at that second (the full
        // list says what is ready, not what came back)
        if (!m2[1]) return false;
        const added = m2[2]!
          .split(/\s+(?=[+-])/)
          .filter((t) => t.startsWith("+"))
          .map((t) => t.slice(1));
        return added.some((t) => !/^\d+:/.test(t) && wallNames.has(t.trim()));
      });
      if (back)
        violate(
          "spanCdBackInside",
          "unstated",
          start + a * 1000,
          `${owner.id}:${a}`,
          `STAYED IN ${m[1]}–${m[2]} "no defensive CD available", [RES] at ${fmtS(back.sec)} has one back`,
          back.l.trim().slice(0, 160),
        );
    }
  }

  // the end of play (a Solo Shuffle round's ending death, a 3v3's deciding
  // death) — the product's own cut for "attempted"
  const roundEndAt = Math.min(
    end,
    playableEndMs(legacy as never, units) ?? Infinity,
  );
  // ── rosterSides ──
  // A 3v3 / Solo Shuffle round is three against three: the context's roster
  // (`<unit … role=…>`) must say so (605 s1/148-3: four "teammates" and two
  // enemies — an enemy Frost Mage filed as a teammate)
  {
    const roles = lines
      .map((l) => /<unit id="\d+" name="[^"]+" spec="[^"]*" role="([^"]+)">/.exec(l)?.[1])
      .filter((r): r is string => !!r);
    if (roles.length === 6) {
      bump("rosterSides");
      const mine = roles.filter((r) => r !== "enemy").length;
      if (mine !== 3)
        violate(
          "rosterSides",
          `${mine}v${6 - mine}`,
          start,
          `${f.round}`,
          `roster ${mine} on the owner's side vs ${6 - mine}`,
        );
    }
  }

  const roundEndAtFor = Math.min(
    end,
    playableEndMs(legacy as never, units) ?? Infinity,
  );
  // ── enemyHealCdForward ──
  // An enemy healer's press of a healing major its spec's save-cooldown
  // roster lists (the generated table, as data) is printed by some enemy
  // line naming it at its second (± 1) — fact5 codex audit: Evangelism,
  // Tip the Scales, Nature's Swiftness, Convoke had none
  {
    const roster = (
      healerSaveCdGenerated as unknown as {
        specs: Record<string, { spells: { spellId: string }[] }>;
      }
    ).specs;
    for (const e of enemiesOfOwner) {
      const pid = pidOf.get(e.name);
      const specName = (/spec="([^"]+)"/.exec(
        lines.find((l) => l.includes(`name="${e.name}"`)) ?? "",
      ) ?? [])[1];
      const ids = new Set(
        (roster[specName ?? ""]?.spells ?? []).map((x) => x.spellId),
      );
      if (!pid || ids.size === 0) continue;
      for (const c of successesOf(e)) {
        if (!ids.has(String(c.spellId))) continue;
        // Fade: no standalone enemy line, by convention (the 2026-10-25
        // codex audit's refuted row)
        if (String(c.spellId) === "586") continue;
        if (tsOf(c) < start || tsOf(c) > roundEndAtFor) continue;
        bump("enemyHealCdForward");
        const sec = Math.floor((tsOf(c) - start) / 1000);
        const name = nameOf(String(c.spellId), c.spellName ?? "");
        const ok = linesNear(sec, 1).some(
          (l) => /\[ENEMY [A-Z ]+\]/.test(l) && l.includes(` ${pid}(`) && l.includes(name),
        );
        if (!ok)
          violate(
            "enemyHealCdForward",
            name,
            tsOf(c),
            `${e.id}:${c.spellId}:${sec}`,
            `${pid} (${specName}) pressed ${name} at ${fmtS(sec)} — no enemy line names it`,
          );
      }
    }
  }

  // ── defenselessRedirectUp ──
  // A `defenseless a–b` span on a unit carrying an Intervene or a Roar of
  // Sacrifice aura for ≥ 2 s of it (rulings 2026-10-21 / 2026-10-25: both
  // end the span while up)
  {
    const REDIRECT = new Set(["147833", "53480"]);
    const DL_RE2 =
      /^\s+\[(?:KILL WINDOW|VULNERABLE)\] .*? on [^(]+\(([^)]+)\).*?\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/;
    const seen2 = new Set<string>();
    for (const l of lines) {
      const m = DL_RE2.exec(l);
      if (!m) continue;
      const u = byName.get(m[1]!);
      if (!u) continue;
      const a = start + secOf(m[2]!) * 1000;
      const b = start + (secOf(m[3]!) + 1) * 1000;
      const k = `${u.id}:${m[2]}:${m[3]}`;
      if (seen2.has(k)) continue;
      seen2.add(k);
      bump("defenselessRedirectUp");
      const rows = ((u.auraEvents ?? []) as any[])
        .filter((x) => x.destUnitId === u.id && REDIRECT.has(String(x.spellId)))
        .sort((x, y) => tsOf(x) - tsOf(y));
      for (const x of rows) {
        if (ev(x) !== APPLIED) continue;
        const rem = rows.find((y) => ev(y) === REMOVED && String(y.spellId) === String(x.spellId) && tsOf(y) >= tsOf(x));
        const to = rem ? tsOf(rem) : tsOf(x) + 3000;
        const overlap = Math.min(b, to) - Math.max(a, tsOf(x));
        if (overlap >= 2000) {
          violate(
            "defenselessRedirectUp",
            nameOf(String(x.spellId)),
            tsOf(x),
            k,
            `${u.name} defenseless ${m[2]}–${m[3]} with ${nameOf(String(x.spellId))} on it for ${(overlap / 1000).toFixed(1)}s`,
            l.trim().slice(0, 180),
          );
          break;
        }
      }
    }
  }

  // ── refusedAttemptDropped ──
  {
    for (const l of menu.split("\n")) {
      const m = /id=cd-waste:([^:\s]+):(\d+) type=cd-waste/.exec(l);
      if (!m) continue;
      if (m[1] !== owner.id) continue;
      bump("refusedAttemptDropped");
      if (/attempted=/.test(l)) continue;
      const spellId = Number(m[2]);
      // a press while alive (a dead owner's refusals are no attempt)
      const fails = castFailed().filter(
        (c) =>
          c.unitGuid === owner.id &&
          c.spellId === spellId &&
          start + c.tSeconds * 1000 < deathMs(owner) &&
          // …and inside the round (a Solo Shuffle round ends at its death)
          start + c.tSeconds * 1000 <= roundEndAt,
      );
      if (fails.length === 0) continue;
      const cast = successesOf(owner).some(
        (c) => Number(c.spellId) === spellId,
      );
      if (cast) continue;
      violate(
        "refusedAttemptDropped",
        `cd-waste:${fails[0]!.reason}`,
        start + fails[0]!.tSeconds * 1000,
        `${owner.id}:${spellId}`,
        `cd-waste ${nameOf(String(spellId))}: no attempted, ${fails.length} refused press(es) from ${fmtS(fails[0]!.tSeconds)} (${fails[0]!.reason})`,
        l,
      );
    }
  }

  // ── inactivityRefused ──
  {
    const IN_RE =
      /^(\d+:\d\d)\s+\[INACTIVITY\]\s+(\d+)\([^)]*\) inactive ([\d.]+)s/;
    for (const l of lines) {
      const m = IN_RE.exec(l);
      if (!m) continue;
      const u = unitOfPid(m[2]);
      if (!u) continue;
      const S = secOf(m[1]!);
      const L = Number(m[3]);
      bump("inactivityRefused");
      const fails = castFailed().filter(
        (c) =>
          // certainly inside the gap: the line's second is the start floored,
          // so [S + 1, S + L] is inside whatever the fraction
          c.unitGuid === u.id && c.tSeconds >= S + 1 && c.tSeconds <= S + L,
      );
      if (fails.length === 0) continue;
      const names = [
        ...new Set(fails.map((c) => nameOf(String(c.spellId), c.spellName))),
      ];
      // the line states the refusal: the spell, or the intent guard's own
      // `pressed but rejected (…)` wording
      if (names.some((n) => l.includes(n)) || l.includes("pressed but rejected ("))
        continue;
      violate(
        "inactivityRefused",
        "unstated",
        start + S * 1000,
        `${u.id}:${S}`,
        `${m[1]} inactive ${L}s: ${fails.length} refused press(es) inside (${names.join(", ")}; ${fails[0]!.reason})`,
        l,
      );
    }
  }
}

// ── report ──
const say = (s: string) => console.log(s);
say(`corpusFactScan4 ${resolve(dir)}: ${contexts} contexts`);
for (const c of CHECKS) {
  const all = violations.filter((v) => v.check === c);
  const vs = all.filter(
    (v) => !MEASURED_ONLY.has(c) && !OUT_OF_TOTAL.has(`${c}|${v.kind}`),
  );
  const distinct = new Set(vs.map((v) => v.fact));
  say(
    `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct facts ${distinct.size})`,
  );
  const kinds = new Map<string, IViolation[]>();
  for (const v of all) kinds.set(v.kind, [...(kinds.get(v.kind) ?? []), v]);
  for (const [k, ks] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    const kd = new Set(ks.map((v) => v.fact)).size;
    say(
      `  ${k}: ${ks.length} (distinct ${kd})${OUT_OF_TOTAL.has(`${c}|${k}`) ? "  [not in the total]" : ""}`,
    );
    for (const v of ks.slice(0, EXAMPLES))
      say(`    ${v.where} r${v.round} +${v.offMs}ms ${v.detail}`);
  }
}
for (const [title, m] of [
  ["inventory: negative SPELL_ABSORBED rows by shield", negShield],
  ["inventory: damage on a unit from a teammate, by spell", mateDamage],
] as const) {
  say(title);
  for (const [k, v] of [...m]
    .sort((a, b) => Math.abs(b[1].sum) - Math.abs(a[1].sum))
    .slice(0, 25))
    say(`  ${k}: ${v.rows} rows, ${Math.round(v.sum / 1000)}k`);
}
say(
  "inventory: shields with negative rows — positive / negative / same-named self periodic damage (unit-rounds)",
);
for (const [n, y] of deferral)
  say(
    `  ${n}: +${Math.round(y.pos / 1000)}k / ${Math.round(y.neg / 1000)}k / ticks ${Math.round(y.ticks / 1000)}k (${y.units})`,
  );
if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        capture: resolve(dir),
        contexts,
        checked: Object.fromEntries(checked),
        violations,
      },
      null,
      1,
    ),
  );
  say(`wrote ${JSON_OUT}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
