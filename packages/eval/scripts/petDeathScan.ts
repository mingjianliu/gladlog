/**
 * petDeathScan.ts — GH #100 follow-up (user question 2026-09-20: a hunter's or
 * warlock's pet dying changes how hard they are to kill — do we account for
 * it?). The product ignores pet deaths entirely (candidateFindings.ts: "a pet
 * death is noise"). This measures the facts first: how often a PERMANENT pet
 * (GUID `Pet-…`) is killed, how long the owner stays petless, and whether the
 * owner dies more often afterwards. Kill evidence = UNIT_DIED or a damage event
 * with overkill > 0 (12.x logs rarely write UNIT_DIED for non-players).
 *
 * Usage: npx tsx packages/eval/scripts/petDeathScan.ts --manifest <txt> [--offset 3000] [--limit 300] --out <new.json>
 */
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
  .slice(0, Number(flag("--limit") ?? 300));

// spec id → class bucket, only the pet classes we ask about
const HUNTER = new Set([253, 254, 255]);
const WARLOCK = new Set([265, 266, 267]);
const DK_UNHOLY = new Set([252]);
const bucketOf = (spec: number): string =>
  HUNTER.has(spec)
    ? "hunter"
    : WARLOCK.has(spec)
      ? "warlock"
      : DK_UNHOLY.has(spec)
        ? "unholy dk"
        : "other";

type Bucket = {
  ownerRounds: number;
  ownerRoundsWithPet: number;
  ownerRoundsPetKilled: number;
  petKills: number;
  killEvidence: { unitDied: number; overkillOnly: number };
  petlessSeconds: number[]; // kill → next event by any Pet- unit of that owner
  neverBackBeforeRoundEnd: number;
  killAtSeconds: number[];
  ownerDiedAfterPetKill: number;
  ownerDiedNoPetKill: number;
};
const mk = (): Bucket => ({
  ownerRounds: 0,
  ownerRoundsWithPet: 0,
  ownerRoundsPetKilled: 0,
  petKills: 0,
  killEvidence: { unitDied: 0, overkillOnly: 0 },
  petlessSeconds: [],
  neverBackBeforeRoundEnd: 0,
  killAtSeconds: [],
  ownerDiedAfterPetKill: 0,
  ownerDiedNoPetKill: 0,
});
const buckets: Record<string, Bucket> = {};
let scanned = 0;

for (const path of files) {
  let text: string;
  try {
    const raw = readFileSync(path);
    text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  scanned++;
  // per round state
  let start = 0;
  let specs = new Map<string, number>();
  let petOwner = new Map<string, string>(); // Pet guid → owner player guid
  let petEvents = new Map<string, number[]>(); // owner → timestamps of any pet activity
  let kills: Array<{ owner: string; t: number; unitDied: boolean }> = [];
  let killed = new Set<string>();
  let ownerDeath = new Map<string, number>();
  let lastT = 0;
  const flush = () => {
    if (!start) return;
    for (const [owner, spec] of specs) {
      const name = bucketOf(spec);
      if (name === "other") continue;
      const b = (buckets[name] ??= mk());
      b.ownerRounds++;
      const acts = petEvents.get(owner) ?? [];
      if (!acts.length) continue;
      b.ownerRoundsWithPet++;
      const mine = kills.filter((k) => k.owner === owner);
      const died = ownerDeath.get(owner);
      if (!mine.length) {
        if (died !== undefined) b.ownerDiedNoPetKill++;
        continue;
      }
      b.ownerRoundsPetKilled++;
      if (died !== undefined && died > mine[0].t) b.ownerDiedAfterPetKill++;
      for (const k of mine) {
        b.petKills++;
        if (k.unitDied) b.killEvidence.unitDied++;
        else b.killEvidence.overkillOnly++;
        b.killAtSeconds.push((k.t - start) / 1000);
        const back = acts.find((t) => t > k.t + 500);
        if (back === undefined) b.neverBackBeforeRoundEnd++;
        else b.petlessSeconds.push((back - k.t) / 1000);
      }
    }
  };
  for (const line of text.split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.eventName === "ARENA_MATCH_START") {
      flush();
      start = p.timestamp;
      specs = new Map();
      petOwner = new Map();
      petEvents = new Map();
      kills = [];
      killed = new Set();
      ownerDeath = new Map();
      continue;
    }
    if (p.eventName === "ARENA_MATCH_END") {
      flush();
      start = 0;
      continue;
    }
    if (!start) continue;
    lastT = p.timestamp;
    if (p.eventName === "COMBATANT_INFO" && p.combatantInfo) {
      specs.set(p.params[0], p.combatantInfo.specId);
      continue;
    }
    const a = p.advanced;
    if (a?.actorGuid.startsWith("Pet-") && a.ownerGuid.startsWith("Player-"))
      petOwner.set(a.actorGuid, a.ownerGuid);
    if (!p.base) continue;
    const { srcGuid, destGuid } = p.base;
    if (p.eventName === "SPELL_SUMMON" && destGuid.startsWith("Pet-"))
      petOwner.set(destGuid, srcGuid);
    if (p.eventName === "UNIT_DIED" && destGuid.startsWith("Player-")) {
      if (!ownerDeath.has(destGuid) && !p.unitDied?.unconscious)
        ownerDeath.set(destGuid, p.timestamp);
    }
    // pet activity: the pet acts (src) — being a target does not prove it is alive and useful
    if (srcGuid.startsWith("Pet-")) {
      const owner = petOwner.get(srcGuid);
      if (owner) {
        const list = petEvents.get(owner) ?? [];
        list.push(p.timestamp);
        petEvents.set(owner, list);
      }
    }
    if (destGuid.startsWith("Pet-") && !killed.has(destGuid)) {
      const owner = petOwner.get(destGuid);
      const unitDied = p.eventName === "UNIT_DIED";
      const overkill = !!p.damage && (p.damage.overkill ?? 0) > 0;
      if (owner && (unitDied || overkill)) {
        killed.add(destGuid);
        kills.push({ owner, t: p.timestamp, unitDied });
      }
    }
  }
  flush();
  void lastT;
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? +s[Math.floor((s.length - 1) * p)].toFixed(1) : null;
};
const result = {
  scannedFiles: scanned,
  scope:
    "Permanent pets only (GUID Pet-…), owner from the advanced block / SPELL_SUMMON. Rounds = START→END or START→next START. 'petless' = kill → the owner's next pet ACTION (any Pet- unit sourcing an event); neverBack = no further pet action before the round ended. Owner death comparison is RAW and confounded (a team that is losing loses pets and players alike) — a lead, not an effect size.",
  buckets: Object.fromEntries(
    Object.entries(buckets).map(([k, b]) => [
      k,
      {
        ownerRounds: b.ownerRounds,
        ownerRoundsWithPet: b.ownerRoundsWithPet,
        ownerRoundsPetKilled: b.ownerRoundsPetKilled,
        petKilledShareOfPetRounds: +(
          b.ownerRoundsPetKilled / Math.max(b.ownerRoundsWithPet, 1)
        ).toFixed(3),
        petKills: b.petKills,
        killEvidence: b.killEvidence,
        killAtSeconds: {
          p10: q(b.killAtSeconds, 0.1),
          p50: q(b.killAtSeconds, 0.5),
          p90: q(b.killAtSeconds, 0.9),
        },
        petlessSeconds: {
          n: b.petlessSeconds.length,
          p10: q(b.petlessSeconds, 0.1),
          p50: q(b.petlessSeconds, 0.5),
          p90: q(b.petlessSeconds, 0.9),
        },
        neverBackBeforeRoundEnd: b.neverBackBeforeRoundEnd,
        ownerDiedShare_petKilledFirst: +(
          b.ownerDiedAfterPetKill / Math.max(b.ownerRoundsPetKilled, 1)
        ).toFixed(3),
        ownerDiedShare_petNeverKilled: +(
          b.ownerDiedNoPetKill /
          Math.max(b.ownerRoundsWithPet - b.ownerRoundsPetKilled, 1)
        ).toFixed(3),
      },
    ]),
  ),
};
writeFileSync(out, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
