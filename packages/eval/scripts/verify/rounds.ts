/* eslint-disable @typescript-eslint/no-explicit-any -- the scans walk the untyped legacy parse objects (match.units, damageIn, absorbsIn) by the hundred */
/**
 * verify/rounds.ts — one walk of a capture for every scan: each archive is
 * parsed once, each round rebuilt once, and each owner's context handed to
 * every scan. Before this every scan parsed the corpus for itself (nine
 * times over) and rebuilt the legacy match per owner, which was about half
 * of all the machine time a verification round spent.
 *
 * The rows are shared between owners and between scans: a check reads them
 * and never writes them (`--freeze` proves it on a sample).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  parseRawStreams,
  parseRawStreamsAbsolute,
  type RawStreamsAbsolute,
} from "@gladlog/analysis/src/utils/rawStreams";
import { playableEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

import { timed } from "./timing";

export interface IContextFile {
  shard: string;
  name: string;
  fileNo: number;
  round: number;
  /** the capture's running owner number */
  ownerNo: number;
}

/** what every scan gets per captured owner context (one round as one owner
 * saw it) */
export interface IContext {
  f: IContextFile;
  /** `<shard>/<file>` of the capture */
  where: string;
  /** the round's raw archive path (line 1 of the context file) */
  archive: string;
  /** line 2 of the context file */
  ownerName: string;
  /** 1-based round in the archive (Solo Shuffle) */
  round: number;
  /** `${archive}#${round}` — owner-independent round identity */
  roundKey: string;
  text: string;
  /** the context's timeline lines (prompt text the gates read) */
  lines: string[];
  /** the findings menu text (`- id=… type=… facts={…}` rows + legend) */
  menu: string;
  /** the round's raw combat-log lines */
  rawLines: string[];
  legacy: any;
  units: any[];
  /** units with `info` (players) */
  players: any[];
  byName: Map<string, any>;
  /** the context's `<unit id="N" name="…">` pid → unit */
  unitOfPid: (pid: string | undefined) => any;
  pidOf: (unitName: string) => string | undefined;
  /** undefined when the owner is not in the log's roster: most scans skip */
  owner: any;
  start: number;
  end: number;
  /** the product's end of play (playableEndMs), ≤ end */
  roundEndAt: number;
  /** lazily parsed raw streams of the round (castFailed, …) */
  rawStreams: () => ReturnType<typeof parseRawStreams>;
  /** lazily parsed absolute-time raw streams of the whole archive */
  rawAbsolute: () => RawStreamsAbsolute;
  /** the archive's text */
  fileText: () => string;
}

interface IRound {
  item: GladMatch;
  rawLines: string[];
  legacy: any;
  units: any[];
  players: any[];
  byName: Map<string, any>;
  start: number;
  end: number;
  roundEndAt: number;
  streams?: ReturnType<typeof parseRawStreams>;
}

/** every context of a capture: by shard, archive, round and owner. One round
 * sits together, so it can be dropped after its last owner, and the order does
 * not hang on what `readdir` returns (on APFS, not name order). */
export function listContextFiles(dir: string): IContextFile[] {
  const files: IContextFile[] = [];
  for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
    const cdir = join(dir, shard, "context");
    for (const name of readdirSync(cdir)) {
      const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
      if (m)
        files.push({
          shard,
          name,
          fileNo: +m[1]!,
          round: +m[2]!,
          ownerNo: +m[3]!,
        });
    }
  }
  return files.sort(
    (a, b) =>
      (a.shard === b.shard ? 0 : a.shard < b.shard ? -1 : 1) ||
      a.fileNo - b.fileNo ||
      a.round - b.round ||
      a.ownerNo - b.ownerNo,
  );
}

const PARSE_MS_PER_MB = 66;
const CHECKS_MS_PER_CONTEXT = 255;

/** cut the contexts into `n` contiguous runs of about the same cost, never
 * across an archive: whatever a scan keeps per round stays in one process,
 * and the runs joined back in order are the serial order. The costs are the
 * measured ones (2026-11-01: 66 ms/MB parse and rebuild, 255 ms per owner in
 * the checks). */
export function splitContexts(
  dir: string,
  files: IContextFile[],
  n: number,
  archiveDir = "",
): IContextFile[][] {
  const groups: Array<{ files: IContextFile[]; cost: number }> = [];
  for (const f of files) {
    const last = groups.at(-1);
    if (
      last &&
      last.files[0]!.shard === f.shard &&
      last.files[0]!.fileNo === f.fileNo
    ) {
      last.files.push(f);
      last.cost += CHECKS_MS_PER_CONTEXT;
      continue;
    }
    const head = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
    const archive = head.slice(0, head.indexOf("\n"));
    const path = archive.startsWith("/")
      ? archive
      : resolve(archiveDir, archive);
    const mb = existsSync(path)
      ? (statSync(path).size / 1e6) * (path.endsWith(".gz") ? 10 : 1)
      : 0;
    groups.push({
      files: [f],
      cost: mb * PARSE_MS_PER_MB + CHECKS_MS_PER_CONTEXT,
    });
  }
  const total = groups.reduce((s, g) => s + g.cost, 0);
  const out: IContextFile[][] = Array.from({ length: n }, () => []);
  let sum = 0;
  for (const g of groups) {
    const i = Math.min(n - 1, Math.floor((sum / total) * n));
    out[i]!.push(...g.files);
    sum += g.cost;
  }
  return out;
}

function parseText(text: string): GladMatch[] {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

function deepFreeze(o: any, seen = new Set<object>()): void {
  if (o === null || typeof o !== "object" || seen.has(o)) return;
  seen.add(o);
  if (ArrayBuffer.isView(o)) return;
  if (o instanceof Map || o instanceof Set) {
    for (const v of o.values()) deepFreeze(v, seen);
    if (o instanceof Map) for (const k of o.keys()) deepFreeze(k, seen);
    return;
  }
  for (const v of Object.values(o)) deepFreeze(v, seen);
  Object.freeze(o);
}

function buildRound(item: GladMatch, freeze: boolean): IRound {
  const legacy: any = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  const units = Object.values(legacy.units ?? {}) as any[];
  const start: number = legacy.startTime;
  const end: number = legacy.endTime;
  const round: IRound = {
    item,
    rawLines: ((item as any).rawLines ?? []) as string[],
    legacy,
    units,
    players: units.filter((u) => u.info),
    byName: new Map(units.map((u) => [u.name, u])),
    start,
    end,
    roundEndAt: Math.min(
      end,
      playableEndMs(legacy as never, units as never) ?? Infinity,
    ),
  };
  if (freeze) deepFreeze([legacy, item]);
  return round;
}

/** hand every context of `files` to `visit`. A context that cannot be mapped
 * back to a parsed round goes to `unmapped`: any one fails the run. */
export function forEachContext(
  dir: string,
  files: IContextFile[],
  visit: (ctx: IContext) => void,
  unmapped: string[],
  opts: { archiveDir?: string; freeze?: boolean; textOnly?: boolean } = {},
): void {
  let cacheKey = "";
  let items: GladMatch[] = [];
  let fileText = "";
  let absolute: RawStreamsAbsolute | undefined;
  const rounds = new Map<number, IRound | null>();
  // a long log holds a hundred rounds: each is dropped after its last owner,
  // or the rows of the whole archive stay alive with every cache keyed on them
  const lastOwner = new Map<string, number>();
  files.forEach((f, i) =>
    lastOwner.set(`${f.shard}:${f.fileNo}:${f.round}`, i),
  );
  for (const [i, f] of files.entries()) {
    const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
    const findingsPath = join(dir, f.shard, "findings", f.name);
    const menu = existsSync(findingsPath)
      ? readFileSync(findingsPath, "utf8")
      : "";
    const [archive, ownerName] = text.split("\n", 2);
    if (!archive || !ownerName) {
      unmapped.push(`${f.shard}/${f.name} (no archive or owner line)`);
      continue;
    }
    if (opts.textOnly) {
      visit({ f, text, menu, archive, ownerName } as IContext);
      continue;
    }
    // by manifest entry: a round of an entry is dropped after its last owner,
    // and an archive listed twice must not find the first entry's holes
    const key = `${f.shard}:${f.fileNo}:${archive}`;
    if (key !== cacheKey) {
      rounds.clear();
      absolute = undefined;
      try {
        const path = archive.startsWith("/")
          ? archive
          : resolve(opts.archiveDir ?? "", archive);
        fileText = timed("walk: read and gunzip", () => {
          const raw = readFileSync(path);
          return (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString(
            "utf8",
          );
        });
        const whole = fileText;
        items = timed("walk: parse", () => parseText(whole));
      } catch {
        items = [];
        fileText = "";
      }
      cacheKey = key;
    }
    const item = items[f.round - 1];
    const where = `${f.shard}/${f.name}`;
    if (!item) {
      unmapped.push(`${where} (${archive})`);
      continue;
    }
    if (!rounds.has(f.round)) {
      try {
        const built = timed("walk: rebuild round", () =>
          buildRound(item, opts.freeze ?? false),
        );
        rounds.set(f.round, built);
      } catch {
        rounds.set(f.round, null);
      }
    }
    const r = rounds.get(f.round);
    if (!r) {
      unmapped.push(`${where} (toLegacyMatch threw)`);
      continue;
    }
    const lines = text.split("\n");
    const pidName = new Map<string, string>();
    for (const l of lines) {
      const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
      if (u) pidName.set(u[1]!, u[2]!);
    }
    const pidByName = new Map<string, string>();
    for (const [pid, n] of pidName) pidByName.set(n, pid);
    visit({
      f,
      where,
      archive,
      ownerName,
      round: f.round,
      roundKey: `${archive}#${f.round}`,
      text,
      lines,
      menu,
      rawLines: r.rawLines,
      legacy: r.legacy,
      units: r.units,
      players: r.players,
      byName: r.byName,
      unitOfPid: (pid) =>
        pid ? r.byName.get(pidName.get(pid) ?? "") : undefined,
      pidOf: (n) => pidByName.get(n),
      owner: r.byName.get(ownerName),
      start: r.start,
      end: r.end,
      roundEndAt: r.roundEndAt,
      rawStreams: () => {
        if (!r.streams) {
          r.streams = parseRawStreams(
            r.rawLines.join("\n"),
            r.start,
            (r.end - r.start) / 1000,
          );
          if (opts.freeze) deepFreeze(r.streams);
        }
        return r.streams;
      },
      rawAbsolute: () => (absolute ??= parseRawStreamsAbsolute(fileText)),
      fileText: () => fileText,
    });
    if (lastOwner.get(`${f.shard}:${f.fileNo}:${f.round}`) === i) {
      rounds.delete(f.round);
      delete items[f.round - 1];
    }
  }
}
