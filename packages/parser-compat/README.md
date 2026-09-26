# @gladlog/parser-compat

**English** · [Chinese](README.zh-CN.md)

The seam between the new parser and the analysis code. `@gladlog/parser` produces `GladMatch` / `GladShuffle`; almost everything in `@gladlog/analysis` (and the parts of `@gladlog/desktop` and `@gladlog/eval` that call it) is written against the older `ICombatUnit` / `IArenaMatch` shape. This package converts one into the other and owns the legacy enums those consumers import. Its only dependency is `@gladlog/parser`.

## What it exports (`src/index.ts`)

| Module        | Exports                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convert.ts`  | `toLegacyMatch(m: GladMatch): IArenaMatch` and `toLegacyShuffle(s: GladShuffle): IShuffleMatch` — the conversion itself, including unit flags, spell schools, aura and dispel extras, HP samples and advanced actions.                        |
| `types.ts`    | The legacy document types: `ICombatUnit`, `IArenaMatch`, `IShuffleMatch`, `IShuffleRound`, `ILogLine`, `ICombatEvent` and the event subtypes, plus `AtomicArenaCombat` (one arena match or one shuffle round — the unit analysis works on). |
| `enums.ts`    | `LogEvent` (the literal event tokens), `CombatUnitPowerType`, `CombatUnitReaction`, `CombatUnitType`, `CombatResult`, and `getUnitType` / `getUnitReaction` for decoding `COMBATLOG_OBJECT_*` flag masks.                                    |
| `enumsGenerated.ts` | `CombatUnitClass` and `CombatUnitSpec`, generated from Blizzard DB2 by `packages/analysis/scripts/datagen/genCombatUnitEnums.ts` — do not hand-edit.                                                                                    |
| `shim.ts`     | `WoWCombatLogParser`, a class with the old call-site shape (`on("arena_match_ended", …)` / `on("solo_shuffle_ended", …)`) wrapping `GladLogParser` and converting on the way out. Its one consumer is `Utils.parseFromStringArray` in `packages/analysis/src/utils/utils.ts` (parse a log from an array of lines, used by tests and scripts); the app never goes through it. |

Provenance matters here: `enums.ts` used to be transcribed from wowarenalogs (CC BY-NC-ND, incompatible with this repo's MIT licence). Every enum is now anchored to a public Blizzard fact of its own, and `data/legacy-enum-manifest.json` records what changed — see `docs/DATA-COMPLIANCE.md`.

## How the other packages use it

- **analysis** imports the types and enums everywhere (`ICombatUnit`, `LogEvent`, `CombatUnitReaction`, …) and expects an already-converted document.
- **desktop** converts in the renderer through `toLegacySafe` (`src/renderer/src/report/derive/legacySource.ts`), which memoises `toLegacyMatch` per document and is the only sanctioned call site — see `docs/architecture.md` §5.
- **eval** and **corpus-tools** call `toLegacyMatch` / `toLegacyShuffle` directly when they replay archived logs (`packages/eval/src/corpus/buildCorpus.ts`, `packages/corpus-tools/src/perMatchRecord.ts`, and most of `packages/eval/scripts/`).

## Testing

```bash
npm test --workspace=packages/parser-compat
```

Vitest in `test/`: `convert.test.ts` (field-by-field conversion), `enums.test.ts` (enum values against the manifest and the flag decoders), `shim.test.ts` (the legacy event names fire with the legacy types).
