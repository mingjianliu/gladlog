# @gladlog/log-pipeline

**English** · [Chinese](README.zh-CN.md)

Cross-machine combat-log relay: the gaming PC streams `WoWCombatLog*.txt` as it grows into a shared folder (in practice a Google Drive for Desktop folder), and the analysis machine reconstructs byte-identical copies on its side. It is maintainer tooling — it never ships in the desktop bundle — and, like `@gladlog/parser`, it declares **no runtime dependencies** (Node stdlib only).

## The two bins

`package.json` ships two commands, both wired to root scripts (`npm run logs:stream` / `npm run logs:collect`; see `docs/commands/collect-logs.md` §2):

| Bin               | Entry               | Runs on          | What it does                                                                                                                                                                                                                                       |
| ----------------- | ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gladlog-stream`  | `src/streamCli.ts`  | the gaming PC    | Watches `<wowDirectory>/Logs`, and every `flushIntervalMs` (default 60 s, after a `quietPeriodMs` lull) gzips the bytes appended since the last checkpoint into a segment file under the storage folder. Writes a heartbeat after every flush.      |
| `gladlog-collect` | `src/collectCli.ts` | the analysis PC  | Polls the same folder, orders the segments per (host, file, generation), appends them to `outputDir/<name>.txt` in offset order, waits on gaps, and optionally deletes segments that are fully applied and older than 7 days (`cleanup: true`).      |

Both take `--config <file>`; the streamer requires the name to end in `.config.json` because it derives its checkpoint file (`*.state.json`) from that suffix, and `gladlog-stream --check` only validates the config and storage without watching.

## How it stays correct

- **Segment keys** (`src/protocol/segments.ts`): `raw/<host>/<logFile>/<gen8>/<start>_<length>.seg`. `gen8` is a hash of the file's first line (`src/protocol/identity.ts`), so a recreated log with the same name is a new generation rather than a corrupted continuation.
- **Resumable, idempotent flushes** (`src/flusher.ts`, `src/state.ts`): the checkpoint stores `{offset, firstLineChecksum}` per file; a lost or corrupt state file just re-uploads, which the collector tolerates.
- **Overlap-aware reconstruction** (`src/protocol/reconstruct.ts`): among segments covering the current size the collector picks the one reaching furthest, so re-flushed overlaps self-heal and a gap makes it wait instead of writing garbage.
- **Storage adapter** (`src/storage/`): a four-method contract (`put` / `list` / `get` / `delete`) with a `localDir` implementation for the shared folder and an in-memory one for tests. `diagnose` lets the collector explain a cloud-only placeholder the sync client has not hydrated.

## Relation to the other packages

Nothing here parses logs. The reconstructed `.txt` files are ordinary combat logs that the desktop app imports (`docs/commands/collect-logs.md` §1) and that `@gladlog/corpus-tools` archives to Drive (`npm run logs:archive-own`). The desktop app's own real-time tailer is separate code in `packages/desktop/src/worker/`.

## Testing

```bash
npm test --workspace=packages/log-pipeline
```

Vitest, co-located `*.test.ts`: the adapter contract (`storage/adapters.test.ts`), segment keys and reconstruction (`protocol/*.test.ts`), the flusher, cleanup, and an end-to-end `roundtrip.test.ts` through the memory adapter.
