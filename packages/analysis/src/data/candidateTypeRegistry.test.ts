/**
 * Anti-rot tests for the candidate type registry (GH #76).
 *
 * Two jobs: (1) prove the 2026-09-12 refactor is a no-op — the derived flag
 * object and allow-list are pinned against the literals they replaced;
 * (2) keep the registry honest against the code — every `type: "…"` literal
 * the emitters produce is registered, deleted entries have no literal left,
 * live/retired entries still have one, and every legend key in
 * buildFindingsPrompt.ts is registered. Wiring (does the assembly still call
 * the emitter) is NOT provable statically here; that stays with the corpus
 * scan (`candidateDiagnostics.ts` → `scanCandidateIncidence`).
 */
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import {
  BRACKET_TYPE_ALLOWLIST,
  CANDIDATE_TYPE_FLAGS,
} from "./candidateTypeFlags";
import {
  CANDIDATE_TYPE_REGISTRY,
  CANDIDATE_TYPE_STRINGS,
  CARD_TYPES,
  deriveCandidateTypeFlags,
  MENU_ONLY_TYPES,
  RETIRED_TYPES,
} from "./candidateTypeRegistry";

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYSIS_DIR = join(HERE, "..", "analysis");

/** Emitter sources: candidateFindings.ts + candidates/*.ts + the one mapper
 * that builds a CandidateEvent outside them (utils/killAttempts.ts →
 * attempt-into-trinket), tests excluded. */
function emitterSources(): string[] {
  const files = [
    join(ANALYSIS_DIR, "candidateFindings.ts"),
    join(HERE, "..", "utils", "killAttempts.ts"),
  ];
  const dir = join(ANALYSIS_DIR, "candidates");
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files.push(join(dir, f));
  }
  return files.map((f) => readFileSync(f, "utf8"));
}

/** Every `type: "kebab-case"` literal in the emitter sources. */
function emittedTypeLiterals(): Set<string> {
  const out = new Set<string>();
  for (const src of emitterSources()) {
    for (const m of src.matchAll(/\btype:\s*"([a-z][a-z0-9-]*)"/g)) {
      out.add(m[1]!);
    }
  }
  return out;
}

/** Legend keys: `"kebab-case": \`- "kebab-case": …` in buildFindingsPrompt.ts. */
function legendKeys(): Set<string> {
  const src = readFileSync(
    join(ANALYSIS_DIR, "buildFindingsPrompt.ts"),
    "utf8",
  );
  const out = new Set<string>();
  for (const m of src.matchAll(/"([a-z][a-z0-9-]*)":\s*`- "\1"/g)) {
    out.add(m[1]!);
  }
  return out;
}

describe("candidateTypeRegistry: the 2026-09-12 derivation is a no-op", () => {
  it("CANDIDATE_TYPE_FLAGS equals the literal it replaced, field for field", () => {
    // The object literal that lived in candidateTypeFlags.ts until 99cad7af.
    expect(CANDIDATE_TYPE_FLAGS).toEqual({
      missedSyncWindow: true,
      unsyncedBurst: false,
      cdHoarded: true,
      cdSpentIdle: false,
      attemptIntoTrinket: true,
      mdCycloneWindow: true,
      missedPurge: false,
      ccHeld: false,
      killReview: false,
      backlashDispel: true,
      // + kick-priority (GH #78, 2026-09-12) — the first flag added AFTER the derivation
      kickPriority: true,
    });
  });

  it("the flag object is a fresh mutable object (A/B harness contract), derived once at load", () => {
    const again = deriveCandidateTypeFlags();
    expect(again).toEqual(CANDIDATE_TYPE_FLAGS);
    expect(again).not.toBe(CANDIDATE_TYPE_FLAGS);
    expect(Object.isFrozen(CANDIDATE_TYPE_FLAGS)).toBe(false);
  });

  it("BRACKET_TYPE_ALLOWLIST is unchanged: 2v2 keeps only cd-hoarded / missed-cleanse, other brackets untouched", () => {
    expect(Object.keys(BRACKET_TYPE_ALLOWLIST)).toEqual(["2v2"]);
    expect([...BRACKET_TYPE_ALLOWLIST["2v2"]!].sort()).toEqual([
      "cd-hoarded",
      "missed-cleanse",
    ]);
  });

  it("the desktop's former IGNORED_CANDIDATE_TYPES hand list is reproduced member for member", () => {
    // mistakes.ts literal until 99cad7af, plus the five entries it had simply
    // forgotten (mana-*, off-target-in-window, unconverted-burst — none of
    // which can reach the renderer, so adding them changes no behaviour).
    const former = [
      "death",
      "death-setup",
      "juked-kick",
      "missed-cleanse",
      "missed-purge",
      "cc-locked",
      "kick-eaten",
      "wasted-trinket",
      "death-unused-defensive",
      "dr-clipped-cc",
      "burst-into-immunity",
      "md-cyclone-window",
    ];
    const forgotten = [
      "mana-pressure",
      "mana-efficiency",
      "off-target-in-window",
      "unconverted-burst",
    ];
    const derived = [...MENU_ONLY_TYPES, ...RETIRED_TYPES].filter(
      (t) => !CARD_TYPES.has(t),
    );
    expect([...new Set(derived)].sort()).toEqual(
      [...former, ...forgotten].sort(),
    );
  });

  it("CARD_TYPES equals the desktop MISTAKE_RULES roster as of 99cad7af (19 types) + kick-priority-missed/-team (GH #78)", () => {
    expect([...CARD_TYPES].sort()).toEqual(
      [
        "attempt-into-trinket",
        "burst-into-mitigation",
        "cd-waste",
        "missed-kick",
        "missed-purge-kill-window",
        "crisis-no-response",
        "backlash-dispel",
        "backlash-dispel-window",
        "kick-priority-missed",
        "kick-priority-team",
        "external-unused",
        "questionable-external",
        "healing-gap",
        "position-mistake",
        "cc-held",
        "cc-avoidable",
        "slow-defensive-response",
        "missed-sync-window",
        "unsynced-burst",
        "cd-hoarded",
        "cd-spent-idle",
      ].sort(),
    );
  });
});

describe("candidateTypeRegistry: registry ⇄ code", () => {
  const literals = emittedTypeLiterals();

  it("every type literal an emitter produces is registered", () => {
    const unregistered = [...literals].filter(
      (t) => !(t in CANDIDATE_TYPE_REGISTRY),
    );
    expect(
      unregistered,
      "candidateFindings.ts / candidates/*.ts emit a type the registry does not know — add a row (status/surface/origin/since/issue/reason)",
    ).toEqual([]);
  });

  it("deleted entries have no type literal left; live and retired candidate entries still have one", () => {
    for (const [type, e] of Object.entries(CANDIDATE_TYPE_REGISTRY)) {
      if (e.virtual || e.origin !== "candidate") continue;
      if (e.status === "deleted") {
        expect(
          literals.has(type),
          `${type} is 'deleted' but an emitter still produces it`,
        ).toBe(false);
      } else {
        expect(
          literals.has(type),
          `${type} is '${e.status}' but no emitter produces the literal — set status 'deleted' or restore the emitter`,
        ).toBe(true);
      }
    }
  });

  it("desktop-origin rows are never emitted by analysis (they are built in mistakes.ts)", () => {
    for (const [type, e] of Object.entries(CANDIDATE_TYPE_REGISTRY)) {
      if (e.origin === "desktop") expect(literals.has(type)).toBe(false);
    }
  });

  it("every legend key in buildFindingsPrompt.ts is registered", () => {
    const unknown = [...legendKeys()].filter(
      (t) => !(t in CANDIDATE_TYPE_REGISTRY),
    );
    expect(unknown).toEqual([]);
  });

  it("every flag key in the type union is carried by at least one entry, and shared flags agree", () => {
    const flags = new Set(
      Object.values(CANDIDATE_TYPE_REGISTRY)
        .map((e) => e.flag)
        .filter((f): f is NonNullable<typeof f> => f !== undefined),
    );
    expect([...flags].sort()).toEqual(Object.keys(CANDIDATE_TYPE_FLAGS).sort());
    expect(() => deriveCandidateTypeFlags()).not.toThrow();
  });

  it("virtual rows are excluded from CANDIDATE_TYPE_STRINGS and from every derived set", () => {
    for (const [type, e] of Object.entries(CANDIDATE_TYPE_REGISTRY)) {
      if (!e.virtual) continue;
      expect(CANDIDATE_TYPE_STRINGS).not.toContain(type);
      expect(MENU_ONLY_TYPES.has(type)).toBe(false);
      expect(RETIRED_TYPES.has(type)).toBe(false);
      expect(CARD_TYPES.has(type)).toBe(false);
    }
  });

  it("every entry carries a date, an issue and a reason (no silent rulings)", () => {
    for (const [type, e] of Object.entries(CANDIDATE_TYPE_REGISTRY)) {
      expect(e.since, type).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.issue.length, type).toBeGreaterThan(0);
      expect(e.reason.length, type).toBeGreaterThan(20);
    }
  });

  it("BRACKET_TYPE_ALLOWLIST names only live types", () => {
    for (const set of Object.values(BRACKET_TYPE_ALLOWLIST)) {
      for (const t of set!) {
        expect(CANDIDATE_TYPE_REGISTRY[t]?.status, t).toBe("live");
      }
    }
  });
});
