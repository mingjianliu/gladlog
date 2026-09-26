/**
 * petDeathScan.ts — GH #100 follow-up. User, 2026-09-20: a hunter's or
 * warlock's pet dying "should matter a lot" (a DK's does not). The product
 * ignores pet deaths entirely (candidateFindings.ts: "a pet death is noise").
 *
 * v1 asked the wrong question (does the OWNER die more afterwards — no visible
 * difference) and mis-measured petless time (a hunter's second pet acting read
 * as a 0.8 s revive). What a dead pet costs is CAPABILITY: the pet-sourced
 * buttons (Roar of Sacrifice, Master's Call, Spell Lock, Singe/Devour Magic,
 * Axe Toss, …) are gone until it is back. So v2 measures, for hunters and
 * warlocks only:
 *  - how often a permanent pet (GUID `Pet-…`) is killed (UNIT_DIED, or damage
 *    with overkill > 0 — 12.x logs rarely write UNIT_DIED for non-players);
 *  - how long THAT pet is gone: until the same GUID acts again, or a pet GUID
 *    the owner had not fielded before the kill acts, or the round ends
 *    (censored). A second pet already out before the kill does not count;
 *  - whether the owner pressed a revive / re-summon at all, and how soon;
 *  - what the pet had been doing: every pet-sourced spell, by class, with the
 *    share of owner-rounds that used it — i.e. what is lost.
 *
 * Usage: npx tsx packages/eval/scripts/petDeathScan.ts --manifest <txt> [--offset 3000] [--limit 1500] --out <new.json>
 */
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { parseLine } from "@gladlog/parser";
import { readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = flag("--out");
if (!flag("--manifest") || !out) throw new Error("--manifest and --out");
const files = readFileSync(flag("--manifest")!, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(Number(flag("--offset") ?? 3000))
  .slice(0, Number(flag("--limit") ?? 1500));

const CLASS_OF_SPEC: Record<number, "hunter" | "warlock"> = {
  253: "hunter",
  254: "hunter",
  255: "hunter",
  265: "warlock",
  266: "warlock",
  267: "warlock",
};
/** Owner casts that bring a pet back. Names are matched as logged (English
 * clients only), so a localized recorder under-counts `ownerPressedRevive`. */
const REVIVE_NAME =
  /^(Revive Pet|Call Pet \d|Summon (Imp|Voidwalker|Felhunter|Succubus|Sayaad|Felguard|Incubus)|Fel Domination)$/;

type Bucket = {
  ownerRounds: number;
  ownerRoundsWithPet: number;
  ownerRoundsPetKilled: number;
  petKills: number;
  overkillOnly: number;
  killAtSeconds: number[];
  goneSecondsUnitDied: number[];
  goneSecondsOverkillOnly: number[];
  goneSeconds: number[]; // kill → that pet (or a newly fielded one) acts again
  goneUntilRoundEnd: number; // censored
  goneUntilRoundEndSeconds: number[];
  ownerPressedRevive: number;
  reviveDelaySeconds: number[];
  ownerDiedWhilePetGone: number;
  petSpellRounds: Record<string, number>; // spell → owner-rounds in which a pet cast it
};
const mk = (): Bucket => ({
  ownerRounds: 0,
  ownerRoundsWithPet: 0,
  ownerRoundsPetKilled: 0,
  petKills: 0,
  overkillOnly: 0,
  killAtSeconds: [],
  goneSecondsUnitDied: [],
  goneSecondsOverkillOnly: [],
  goneSeconds: [],
  goneUntilRoundEnd: 0,
  goneUntilRoundEndSeconds: [],
  ownerPressedRevive: 0,
  reviveDelaySeconds: [],
  ownerDiedWhilePetGone: 0,
  petSpellRounds: {},
});
const buckets: Record<string, Bucket> = { hunter: mk(), warlock: mk() };
let scanned = 0;
const examples: string[] = [];

type Round = {
  start: number;
  end: number;
  spec: Map<string, number>;
  petOwner: Map<string, string>;
  petActs: Map<string, number[]>; // pet guid → action timestamps
  ownerRevives: Map<string, number[]>;
  ownerDeath: Map<string, number>;
  kills: Array<{ pet: string; owner: string; t: number; unitDied: boolean }>;
  petSpells: Map<string, Set<string>>; // owner → spells its pets cast
};
const newRound = (start: number): Round => ({
  start,
  end: start,
  spec: new Map(),
  petOwner: new Map(),
  petActs: new Map(),
  ownerRevives: new Map(),
  ownerDeath: new Map(),
  kills: [],
  petSpells: new Map(),
});

function settle(r: Round): void {
  for (const [owner, spec] of r.spec) {
    const cls = CLASS_OF_SPEC[spec];
    if (!cls) continue;
    const b = buckets[cls];
    b.ownerRounds++;
    const myPets = [...r.petOwner]
      .filter(([, o]) => o === owner)
      .map(([g]) => g);
    if (!myPets.some((g) => (r.petActs.get(g) ?? []).length)) continue;
    b.ownerRoundsWithPet++;
    for (const s of r.petSpells.get(owner) ?? [])
      b.petSpellRounds[s] = (b.petSpellRounds[s] ?? 0) + 1;
    const mine = r.kills.filter((k) => k.owner === owner);
    if (!mine.length) continue;
    b.ownerRoundsPetKilled++;
    for (const k of mine) {
      b.petKills++;
      if (!k.unitDied) b.overkillOnly++;
      b.killAtSeconds.push((k.t - r.start) / 1000);
      // fielded before the kill = had acted before it
      const fieldedBefore = new Set(
        myPets.filter((g) => (r.petActs.get(g) ?? []).some((t) => t < k.t)),
      );
      let back = Infinity;
      for (const g of myPets) {
        const acts = r.petActs.get(g) ?? [];
        const t =
          g === k.pet
            ? acts.find((x) => x > k.t + 500)
            : fieldedBefore.has(g)
              ? undefined
              : acts.find((x) => x > k.t);
        if (t !== undefined) back = Math.min(back, t);
      }
      const goneEnd = Number.isFinite(back) ? back : r.end;
      if (Number.isFinite(back)) {
        b.goneSeconds.push((back - k.t) / 1000);
        (k.unitDied ? b.goneSecondsUnitDied : b.goneSecondsOverkillOnly).push(
          (back - k.t) / 1000,
        );
      } else {
        b.goneUntilRoundEnd++;
        b.goneUntilRoundEndSeconds.push((r.end - k.t) / 1000);
      }
      const revive = (r.ownerRevives.get(owner) ?? []).find((t) => t > k.t);
      if (revive !== undefined) {
        b.ownerPressedRevive++;
        b.reviveDelaySeconds.push((revive - k.t) / 1000);
      }
      const died = r.ownerDeath.get(owner);
      if (died !== undefined && died > k.t && died <= goneEnd)
        b.ownerDiedWhilePetGone++;
      // Value-gate rendering: what a context line could honestly say.
      if (examples.length < Number(flag("--show") ?? 0)) {
        const lost = [...(r.petSpells.get(owner) ?? [])]
          .map((x) => x.split(" ").slice(1).join(" "))
          .filter((x) =>
            /Master's Call|Spell Lock|Devour Magic|Singe Magic|Seduction|Axe Toss|Roar of Sacrifice|Soul Link/.test(
              x,
            ),
          );
        examples.push(
          `${fmtTime((k.t - r.start) / 1000)}  [PET DOWN]   ${cls}'s pet killed` +
            (Number.isFinite(back)
              ? ` — back at ${fmtTime((back - r.start) / 1000)} (${((back - k.t) / 1000).toFixed(0)}s without it)`
              : ` — not back before the round ended (${((r.end - k.t) / 1000).toFixed(0)}s)`) +
            (lost.length
              ? `; pet buttons it had used this round: ${[...new Set(lost)].join(", ")}`
              : ""),
        );
      }
    }
  }
}

for (const path of files) {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  scanned++;
  let r: Round | null = null;
  const killed = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.eventName === "ARENA_MATCH_START") {
      if (r) settle(r);
      r = newRound(p.timestamp);
      killed.clear();
      continue;
    }
    if (!r) continue;
    r.end = p.timestamp;
    if (p.eventName === "ARENA_MATCH_END") {
      settle(r);
      r = null;
      continue;
    }
    if (p.eventName === "COMBATANT_INFO" && p.combatantInfo) {
      r.spec.set(p.params[0], p.combatantInfo.specId);
      continue;
    }
    const a = p.advanced;
    if (a?.actorGuid.startsWith("Pet-") && a.ownerGuid.startsWith("Player-"))
      r.petOwner.set(a.actorGuid, a.ownerGuid);
    if (!p.base) continue;
    const { srcGuid, destGuid } = p.base;
    if (p.eventName === "SPELL_SUMMON" && destGuid.startsWith("Pet-"))
      r.petOwner.set(destGuid, srcGuid);
    if (
      p.eventName === "UNIT_DIED" &&
      destGuid.startsWith("Player-") &&
      !p.unitDied?.unconscious &&
      !r.ownerDeath.has(destGuid)
    )
      r.ownerDeath.set(destGuid, p.timestamp);
    if (
      p.eventName === "SPELL_CAST_SUCCESS" &&
      srcGuid.startsWith("Player-") &&
      REVIVE_NAME.test(p.spell?.spellName ?? "")
    ) {
      const list = r.ownerRevives.get(srcGuid) ?? [];
      list.push(p.timestamp);
      r.ownerRevives.set(srcGuid, list);
    }
    // An ACTION is a cast or a melee swing. Periodic damage keeps ticking with
    // the pet as its source after the pet is dead (bleeds), which made a first
    // pass read a dead hunter pet as "back" after a median 2.6 s.
    if (
      srcGuid.startsWith("Pet-") &&
      (p.eventName === "SPELL_CAST_SUCCESS" || p.eventName === "SWING_DAMAGE")
    ) {
      const acts = r.petActs.get(srcGuid) ?? [];
      acts.push(p.timestamp);
      r.petActs.set(srcGuid, acts);
      const owner = r.petOwner.get(srcGuid);
      if (owner && p.eventName === "SPELL_CAST_SUCCESS" && p.spell) {
        const set = r.petSpells.get(owner) ?? new Set<string>();
        set.add(`${p.spell.spellId} ${p.spell.spellName}`);
        r.petSpells.set(owner, set);
      }
    }
    if (destGuid.startsWith("Pet-") && !killed.has(destGuid)) {
      const owner = r.petOwner.get(destGuid);
      const unitDied = p.eventName === "UNIT_DIED";
      const overkill = !!p.damage && (p.damage.overkill ?? 0) > 0;
      if (owner && (unitDied || overkill)) {
        killed.add(destGuid);
        r.kills.push({ pet: destGuid, owner, t: p.timestamp, unitDied });
      }
    }
  }
  if (r) settle(r);
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? +s[Math.floor((s.length - 1) * p)].toFixed(1) : null;
};
const dist = (xs: number[]) => ({
  n: xs.length,
  p10: q(xs, 0.1),
  p50: q(xs, 0.5),
  p90: q(xs, 0.9),
});
const result = {
  scannedFiles: scanned,
  scope:
    "Hunters and warlocks only; permanent pets (GUID Pet-…). 'gone' = kill → the same pet acts again, or a pet the owner had NOT fielded before the kill acts; otherwise censored at round end. ownerPressedRevive matches English spell names only, so it is a floor. petSpellShare = share of owner-rounds-with-a-pet in which a pet cast that spell at least once.",
  buckets: Object.fromEntries(
    Object.entries(buckets).map(([k, b]) => [
      k,
      {
        ownerRounds: b.ownerRounds,
        ownerRoundsWithPet: b.ownerRoundsWithPet,
        ownerRoundsPetKilled: b.ownerRoundsPetKilled,
        petKilledShare: +(
          b.ownerRoundsPetKilled / Math.max(b.ownerRoundsWithPet, 1)
        ).toFixed(4),
        petKills: b.petKills,
        overkillOnly: b.overkillOnly,
        killAtSeconds: dist(b.killAtSeconds),
        cameBack: dist(b.goneSeconds),
        cameBack_unitDiedEvidence: dist(b.goneSecondsUnitDied),
        cameBack_overkillOnlyEvidence: dist(b.goneSecondsOverkillOnly),
        goneUntilRoundEnd: b.goneUntilRoundEnd,
        goneUntilRoundEndSeconds: dist(b.goneUntilRoundEndSeconds),
        ownerPressedRevive: b.ownerPressedRevive,
        reviveDelaySeconds: dist(b.reviveDelaySeconds),
        ownerDiedWhilePetGone: b.ownerDiedWhilePetGone,
        petSpellShare: Object.fromEntries(
          Object.entries(b.petSpellRounds)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 25)
            .map(([s, n]) => [
              s,
              +(n / Math.max(b.ownerRoundsWithPet, 1)).toFixed(3),
            ]),
        ),
      },
    ]),
  ),
};
writeFileSync(out, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
if (examples.length) console.log("\n" + examples.join("\n"));
