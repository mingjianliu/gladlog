# @gladlog/parser

**English** · [Chinese](README.zh-CN.md)

The zero-dependency combat log parsing engine of gladlog: transforms raw World of Warcraft arena combat logs (`WoWCombatLog*.txt`) into structured, typed match documents (`GladMatch` and `GladShuffle`). It is pure TypeScript and executes in Node.js utility processes, worker threads, and browser environments.

## Core Properties

1. **Zero runtime dependencies**: `package.json` declares no `dependencies`. The parser relies solely on JavaScript/TypeScript language primitives and `Intl.DateTimeFormat` for timezone-aware timestamp decoding.
2. **Streaming and push-based**: Processes combat logs line-by-line via `GladLogParser.prototype.push(rawLine)`.
3. **Strict performance budget**: Must parse a 200,000-event match in under 2000ms (`test/parseBudget.test.ts`).
4. **Differential oracle testing**: All parser modifications must pass the 164-match differential oracle in the private repository (`oracle/`, `npm run gate`) to verify zero unintended output drift.

## Three-Layer Architecture

```
Raw text lines
      │
      ▼
[ Layer 1: Line Tokenizer & Decoders (src/l1/) ]
  parseLine() / splitLine() / parseTimestamp() / decodeCombatantInfo()
      │  ParsedLine stream
      ▼
[ Layer 2: Match Segmenter & State Machine (src/l2/) ]
  Segmenter (ARENA_MATCH_START, ARENA_MATCH_END, ZONE_CHANGE)
      │  Segment (Arena match) / ShuffleClose (Solo Shuffle rounds)
      ▼
[ Layer 3: Match Composition & Roster Aggregation (src/l3/) ]
  buildMatch() / buildShuffle() / roster resolution / slimMatchParams()
      │
      ▼
GladMatch / GladShuffle (typed document)
```

### Layer 1: Tokenizer & Decoders (`src/l1/`)

- **`splitTopLevel.ts` (`splitLine`, `splitTopLevel`)**: Fast CSV tokenizer aware of nested brackets and quotes. Strips trailing `\r` from CRLF logs (critical: prevents `"1\r" !== "1"` Feign Death flag bugs).
- **`timestamp.ts` (`parseTimestamp`)**: Parses Blizzard log timestamps (`M/D/YYYY HH:MM:SS.mmm` or `M/D HH:MM:SS.mmm`) into epoch milliseconds, reconstructing UTC offset when omitted.
- **`decoders.ts`**: Decodes standard combat log events (`SWING_DAMAGE`, `SPELL_DAMAGE`, `SPELL_HEAL`, `SPELL_AURA_APPLIED`, `UNIT_DIED`, `ARENA_MATCH_START`, `ARENA_MATCH_END`, etc.) and unpacks the advanced parameter block (unit coordinates, facing, item level).
- **`combatantInfo.ts` (`decodeCombatantInfo`)**: Decodes the complex `COMBATANT_INFO` payload, extracting talent trees, PvP talents, gear, gems, and spec IDs.

### Layer 2: Segmenter & State Machine (`src/l2/`)

- **`segmenter.ts` (`Segmenter`)**: Stateful stream processor that delineates match boundaries from continuous log streams.
- **Lifecycle Events**:
  - `segmentOpen`: Emitted upon `ARENA_MATCH_START` (when arena doors open), used by desktop `RecorderService` to trigger OBS recording.
  - `segmentClose`: Emitted upon `ARENA_MATCH_END`, triggering OBS recording stop.
- **Robustness & Recovery**: Recovers from unclosed matches, double start events, and zone transitions (`ZONE_CHANGE`) without clean termination markers.

### Layer 3: Model & Composition (`src/l3/`)

- **`compose.ts` (`buildMatch`, `buildShuffle`)**: Assembles raw segments into validated `GladMatch` and `GladShuffle` documents.
- **`roster.ts`**: Extracts combatants (`GladUnit`), assigns team affiliations, resolves specs and factions, and links pet GUIDs to owner units.
- **`model.ts`**: Canonical data types defining the parsed document format.

## Born Slim: Memory Optimization (`src/slim.ts`)

Arena matches with hundreds of thousands of events can overwhelm IPC channels and V8 heaps. The parser applies `slimMatchParams()` during document composition:
- Strips redundant raw parameter strings from event payloads.
- Retains `SLIM_PARAMS_KEEP` fields required for HP timeline calculation, coordinate replay interpolation, and downstream analysis.
- Keeps peak memory footprint minimal while preserving full analytical fidelity.

## Public API (`src/api.ts`)

```ts
import { GladLogParser } from "@gladlog/parser";

const parser = new GladLogParser({ timezone: "America/New_York" });

parser.on("segmentOpen", (info) => {
  // Arena doors opened — trigger recording
});

parser.on("segmentClose", (info) => {
  // Arena match ended
});

parser.on("match", (match) => {
  // Typed GladMatch ready
});

parser.on("shuffle", (shuffle) => {
  // Typed GladShuffle ready
});

// Stream lines
parser.push(rawLine);

// Flush and complete
parser.end();
```

## Invariants and Integrity (`src/invariants.ts`, `src/completeness.ts`)

The parser verifies core structural invariants on constructed documents:
- Timestamps must be strictly monotonic.
- Every arena match must have valid rosters with players and non-zero duration.
- Combatant spec assignments and team IDs must be consistent.

## Testing

```bash
npm test --workspace=packages/parser
```

- **Unit tests**: `test/l1.*`, `test/l2.*`, and `test/l3.*` cover tokenizer edge cases, synthetic streams, and golden fixture regressions.
- **Performance budget**: `test/parseBudget.test.ts` validates that 200k-event logs parse within the `<2000ms` budget.
- **Differential oracle**: In the private repository, `npm run gate` validates parser output consistency across 164 real matches against historic output.
