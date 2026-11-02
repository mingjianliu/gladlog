/* eslint-disable @typescript-eslint/no-explicit-any -- a scan's state is its own business */
/**
 * verify/scan.ts — the shape of a corpus scan, and the way a scan script still
 * runs on its own (`npx tsx packages/eval/scripts/corpusFactScan3.ts <capture>`).
 * `verify/run.ts` runs them all at once over one walk of the capture.
 */
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import { ensureAnalysisData } from "@gladlog/analysis";

import type { MergeRule } from "./merge";
import { forEachContext, type IContext, listContextFiles } from "./rounds";

export type { IContext } from "./rounds";

export interface IScanOpts {
  dir: string;
  examples: number;
  json?: string;
  only?: string[];
}

export interface IReport {
  /** contexts that could not be mapped back to a parsed round */
  unmapped: string[];
}

export interface IScan<S extends object = any> {
  name: string;
  /** reads the capture's text only: no archive is parsed for it */
  textOnly?: boolean;
  configure: (o: IScanOpts) => void;
  run: (ctx: IContext) => void;
  /** prints through `console.log`; reads the (merged) state */
  report: (r: IReport) => void;
  /** every accumulator `report` reads */
  state: () => S;
  load: (s: S) => void;
  /** fields that do not merge the default way (`verify/merge.ts`) */
  merge?: Partial<Record<keyof S, MergeRule>>;
}

/** through symlinks: argv keeps the path as typed, a module URL resolves it,
 * and a false here is a scan that exits 0 having read nothing */
export function isMainScan(url: string, entry = argv[1]): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

export const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i > 0 ? argv[i + 1] : undefined;
};

/** one scan, in this process, the way the scripts always ran */
export async function runScanCli(scan: IScan): Promise<void> {
  const dir = argv[2];
  if (!dir) {
    console.error(
      `usage: ${scan.name}.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]`,
    );
    process.exit(2);
  }
  await ensureAnalysisData();
  const json = argOf("--json");
  const only = argOf("--only")?.split(",");
  scan.configure({
    dir,
    examples: Number(argOf("--examples") ?? 5),
    ...(json ? { json } : {}),
    ...(only ? { only } : {}),
  });
  const unmapped: string[] = [];
  forEachContext(dir, listContextFiles(dir), scan.run, unmapped, {
    archiveDir: argOf("--archive-dir") ?? "",
  });
  scan.report({ unmapped });
  if (unmapped.length > 0) {
    console.error(`UNMAPPED contexts: ${unmapped.length}`);
    for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
    process.exit(1);
  }
}
