import { decodeFlags } from "./flags";
import type { ParsedLine } from "../l1/types";

export interface RosterUnit {
  id: string;
  name: string | null;
  kind: "Player" | "NPC" | "Pet" | "Guardian" | "Object" | "Unknown";
  reaction: "Friendly" | "Neutral" | "Hostile" | "Unknown";
  ownerId?: string;
  /** Distinct flag values in first-seen order — kind detection only. */
  flagsSeen: number[];
  /** flag value → number of events it appeared on. The reaction vote MUST use
   * these occurrence counts, not `flagsSeen.length`-style distinct values:
   * Mind Control (605) flips a unit's flags for a handful of events, and a
   * distinct-value vote lets 2 rare flipped values outvote thousands of
   * normal ones (issue #9; perf commit 1c9c05d silently regressed this). */
  flagCounts: Map<number, number>;
}

export function buildRoster(records: ParsedLine[]): {
  ownerId: string | null;
  units: Map<string, RosterUnit>;
} {
  const units = new Map<string, RosterUnit>();
  let ownerId: string | null = null;
  const petOwnersMap = new Map<string, string>();

  for (const record of records) {
    if (record.advanced) {
      const { actorGuid, ownerGuid } = record.advanced;
      if (
        ownerGuid &&
        ownerGuid !== "0000000000000000" &&
        ownerGuid !== "nil"
      ) {
        petOwnersMap.set(actorGuid, ownerGuid);
      }
    }

    if (record.base) {
      const { srcGuid, srcName, srcFlags, destGuid, destName, destFlags } =
        record.base;

      if (srcGuid && srcGuid !== "0000000000000000" && srcName !== null) {
        let srcUnit = units.get(srcGuid);
        if (!srcUnit) {
          srcUnit = {
            id: srcGuid,
            name: srcName,
            kind: "Unknown",
            reaction: "Unknown",
            flagsSeen: [],
            flagCounts: new Map(),
          };
          units.set(srcGuid, srcUnit);
        } else if (srcUnit.name === null && srcName !== null) {
          srcUnit.name = srcName;
        }
        if (srcUnit.flagsSeen.indexOf(srcFlags) === -1) {
          srcUnit.flagsSeen.push(srcFlags);
        }
        srcUnit.flagCounts.set(
          srcFlags,
          (srcUnit.flagCounts.get(srcFlags) ?? 0) + 1,
        );

        if (ownerId === null) {
          const decoded = decodeFlags(srcFlags);
          if (
            decoded.affiliation === "Mine" &&
            (srcGuid.startsWith("Player-") || decoded.kind === "Player")
          ) {
            ownerId = srcGuid;
          }
        }
      }

      if (destGuid && destGuid !== "0000000000000000" && destName !== null) {
        let destUnit = units.get(destGuid);
        if (!destUnit) {
          destUnit = {
            id: destGuid,
            name: destName,
            kind: "Unknown",
            reaction: "Unknown",
            flagsSeen: [],
            flagCounts: new Map(),
          };
          units.set(destGuid, destUnit);
        } else if (destUnit.name === null && destName !== null) {
          destUnit.name = destName;
        }
        if (destUnit.flagsSeen.indexOf(destFlags) === -1) {
          destUnit.flagsSeen.push(destFlags);
        }
        destUnit.flagCounts.set(
          destFlags,
          (destUnit.flagCounts.get(destFlags) ?? 0) + 1,
        );

        if (ownerId === null) {
          const decoded = decodeFlags(destFlags);
          if (
            decoded.affiliation === "Mine" &&
            (destGuid.startsWith("Player-") || decoded.kind === "Player")
          ) {
            ownerId = destGuid;
          }
        }
      }
    }

    if (record.combatantInfo) {
      const { playerGuid } = record.combatantInfo;
      if (playerGuid && playerGuid !== "0000000000000000") {
        let u = units.get(playerGuid);
        if (!u) {
          u = {
            id: playerGuid,
            name: null,
            kind: "Player",
            reaction: "Unknown",
            flagsSeen: [],
            flagCounts: new Map(),
          };
          units.set(playerGuid, u);
        }
      }
    }

    if (record.eventName === "SPELL_SUMMON" && record.base) {
      const { srcGuid, destGuid } = record.base;
      if (srcGuid && destGuid && destGuid !== "0000000000000000") {
        const destUnit = units.get(destGuid);
        if (destUnit) {
          // First SUMMON wins; never overwrite an ownerId that is already set.
          // The roster loop below then treats the two kinds differently: a
          // Pet's advanced ownerGuid OVERWRITES this, a Guardian's only fills
          // an empty one (the SPELL_SUMMON owner stays authoritative there).
          if (!destUnit.ownerId) {
            destUnit.ownerId = srcGuid;
          }
        }
      }
    }
  }

  if (ownerId === null) {
    for (const record of records) {
      if (record.combatantInfo) {
        ownerId = record.combatantInfo.playerGuid;
        break;
      }
    }
  }

  for (const [id, unit] of units.entries()) {
    let kind: "Player" | "NPC" | "Pet" | "Guardian" | "Object" | "Unknown" =
      "Unknown";
    if (id.startsWith("Player-")) {
      kind = "Player";
    } else if (id.startsWith("Pet-")) {
      kind = "Pet";
    } else if (id.startsWith("Creature-")) {
      // GH #57 (2026-08-29): player-summoned Creature- units carry the PET
      // bit (0x1000) in their flags — Primal Fire Elemental 0x1112, Army of
      // the Dead ghouls — and the old parser classified them by flags. Before
      // this they fell to NPC here, so mergePetEvents (Pet/Guardian only) never
      // folded their damage into the owner: 54.0M un-credited damage in
      // 240/1,127 rounds (300-match measurement on the issue).
      const kinds = unit.flagsSeen.map((f) => decodeFlags(f).kind);
      kind = kinds.includes("Guardian")
        ? "Guardian"
        : kinds.includes("Pet")
          ? "Pet"
          : "NPC";
    } else {
      let decodedKind:
        "Player" | "NPC" | "Pet" | "Guardian" | "Object" | "Unknown" =
        "Unknown";
      for (const f of unit.flagsSeen) {
        const k = decodeFlags(f).kind;
        if (k !== "Unknown") {
          decodedKind = k;
          break;
        }
      }
      kind = decodedKind;
    }
    unit.kind = kind;

    const reactionCounts: Record<
      "Friendly" | "Neutral" | "Hostile" | "Unknown",
      number
    > = {
      Friendly: 0,
      Neutral: 0,
      Hostile: 0,
      Unknown: 0,
    };
    // Majority vote by EVENT OCCURRENCE, not by distinct flag values (the
    // pre-1c9c05d semantics, restored for issue #9): decodeFlags runs once
    // per distinct value, the count carries the per-event weight. Ties keep
    // the earlier entry of Friendly > Neutral > Hostile (pinned by test).
    for (const [f, count] of unit.flagCounts) {
      const decoded = decodeFlags(f);
      reactionCounts[decoded.reaction] =
        (reactionCounts[decoded.reaction] || 0) + count;
    }
    let bestReaction: "Friendly" | "Neutral" | "Hostile" | "Unknown" =
      "Unknown";
    let maxCount = 0;
    for (const r of ["Friendly", "Neutral", "Hostile"] as const) {
      const count = reactionCounts[r] || 0;
      if (count > maxCount) {
        maxCount = count;
        bestReaction = r;
      }
    }
    unit.reaction = bestReaction;

    if (kind === "Pet") {
      const ownerGuid = petOwnersMap.get(id);
      if (ownerGuid) {
        unit.ownerId = ownerGuid;
      }
    } else if (kind === "Guardian" && !unit.ownerId) {
      // A totem / guardian summoned before the round's first logged line has
      // no SPELL_SUMMON to take an owner from, yet every advanced block it
      // emits names one. Fill only an EMPTY ownerId (a SPELL_SUMMON owner
      // stays authoritative, unlike the Pet branch's overwrite), and only with
      // a player: GH #99 attributes a summon through this field.
      const ownerGuid = petOwnersMap.get(id);
      if (ownerGuid && ownerGuid.startsWith("Player-")) {
        unit.ownerId = ownerGuid;
      }
    }
  }

  return { ownerId, units };
}
