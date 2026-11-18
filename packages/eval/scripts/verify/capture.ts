/**
 * verify/capture.ts — a capture of a manifest, in parallel, that cannot end
 * half-done without saying so.
 *
 *   npx tsx packages/eval/scripts/verify/capture.ts --manifest <file> --out <dir>
 *     [--shards 3] [--heap 8000] [--archive-dir <dir>] [--archive-root <dir>]
 *   npx tsx packages/eval/scripts/verify/capture.ts --rehash <captureDir> [--write]
 *     [--archive-root <dir>]
 *
 * Splits the manifest round-robin into `s<k>/manifest.txt`, runs
 * acceptanceCapture on each and writes `s<k>/{context,findings,summary.txt,
 * stderr.txt}`, the layout every comparison reads. It exits 1 when a shard dies
 * or a populated shard has no owners, and refuses a directory that already
 * holds something, an archive it cannot read (acceptanceCapture skips those
 * silently) and a manifest listing one twice; a log that reads but does not
 * gunzip fails it afterwards. Rounds or owners that would not build are excluded
 * on both sides of a comparison: their count is printed, and `compare.ts` fails
 * if the owner count moved. `capture.sha256` exists only for a
 * capture that passed; it hashes every owner's context and menu by archive,
 * round and owner, the archive read relative to the capture's archive root
 * (`verify/captureHash.ts`), so it depends neither on the shard count nor on
 * the machine: two runs of a tree that hash alike rendered the same prompts.
 * `--rehash` prints an existing capture's hash under this reading.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { captureHashLine, captureHashOf } from "./captureHash";
import { argOf } from "./scan";

const MANIFEST = argOf("--manifest");
const OUT = argOf("--out");
const SHARDS = Number(argOf("--shards") ?? 3);
const HEAP = argOf("--heap") ?? "8000";
const ARCHIVE_DIR = argOf("--archive-dir");
const ARCHIVE_ROOT = argOf("--archive-root");
const REHASH = argOf("--rehash");
if (REHASH) {
  // an existing capture's hash as this tree reads it (a base stamped before
  // T203 hashed absolute paths)
  const h = captureHashOf(REHASH, ARCHIVE_ROOT);
  process.stdout.write(captureHashLine(h));
  if (h.owners === 0 || h.noMenu.length > 0) {
    console.error(
      `rehash refused: ${h.owners} owners, ${h.noMenu.length} with no findings file`,
    );
    process.exit(1);
  }
  if (process.argv.includes("--write")) {
    // `--write` re-stamps a capture that passed — one that already carries
    // a stamp: a capture that failed has none, and the files alone do not
    // show that (codex 85-tk-EVAL-T203-1 #2)
    const stamp = join(REHASH, "capture.sha256");
    if (!existsSync(stamp)) {
      console.error(
        "rehash --write refused: no capture.sha256 there (the capture did not pass)",
      );
      process.exit(1);
    }
    // …and still holds every owner it was stamped with (a shard lost in a
    // copy would be certified at its smaller count — 1b #1)
    const stamped = /^\S+ {2}(\d+) owners/.exec(readFileSync(stamp, "utf8"));
    if (!stamped || Number(stamped[1]) !== h.owners) {
      console.error(
        `rehash --write refused: stamped ${stamped?.[1] ?? "?"} owners, ${h.owners} there now`,
      );
      process.exit(1);
    }
    writeFileSync(stamp, captureHashLine(h));
  }
  process.exit(0);
}
if (!MANIFEST || !OUT) {
  console.error(
    "usage: verify/capture.ts --manifest <file> --out <dir> [--archive-root <dir>] | --rehash <captureDir> [--write] [--archive-root <dir>]",
  );
  process.exit(2);
}

const children: ChildProcess[] = [];

function refuse(why: string): never {
  console.error(`capture refused: ${why}`);
  process.exit(2);
}

function runShard(k: number, paths: string[]): Promise<number> {
  const dir = join(OUT!, `s${k}`);
  mkdirSync(join(dir, "context"), { recursive: true });
  mkdirSync(join(dir, "findings"), { recursive: true });
  const manifest = join(dir, "manifest.txt");
  writeFileSync(manifest, `${paths.join("\n")}\n`);
  const out = openSync(join(dir, "summary.txt"), "w");
  const err = openSync(join(dir, "stderr.txt"), "w");
  const script = join(import.meta.dirname, "..", "acceptanceCapture.ts");
  const args = [
    ...process.execArgv,
    script,
    "--manifest",
    manifest,
    "--every",
    "1",
    "--context-dir",
    join(dir, "context"),
    "--findings-dir",
    join(dir, "findings"),
    ...(ARCHIVE_DIR ? ["--archive-dir", ARCHIVE_DIR] : []),
  ];
  return new Promise((done) => {
    const p = spawn(process.execPath, args, {
      stdio: ["ignore", out, err],
      env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP}` },
    });
    children.push(p);
    p.on("exit", (code, signal) => {
      closeSync(out);
      closeSync(err);
      done(code ?? (signal ? 1 : 0));
    });
  });
}

async function main(): Promise<void> {
  const t0 = Date.now();
  // a second capture into one directory would hash and scan the first's files
  if (existsSync(OUT!) && readdirSync(OUT!).length > 0)
    refuse(`${OUT} already holds something, give it a new directory`);
  const paths = readFileSync(MANIFEST!, "utf8").split("\n").filter(Boolean);
  if (paths.length === 0) refuse("the manifest is empty");
  if (new Set(paths).size !== paths.length)
    refuse("the manifest lists an archive twice");
  for (const p of paths) {
    try {
      accessSync(
        p.startsWith("/") ? p : resolve(ARCHIVE_DIR ?? "", p),
        constants.R_OK,
      );
    } catch {
      refuse(`cannot read ${p}`);
    }
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => {
      for (const c of children) c.kill();
      process.exit(1);
    });
  mkdirSync(OUT!, { recursive: true });
  const parts = Array.from({ length: SHARDS }, (_, k) =>
    paths.filter((_p, i) => i % SHARDS === k),
  );
  const codes = await Promise.all(parts.map((p, k) => runShard(k, p)));
  const dead = codes.flatMap((c, k) => (c === 0 ? [] : [`s${k}: exit ${c}`]));
  for (let k = 0; k < SHARDS; k++) {
    const err = readFileSync(join(OUT!, `s${k}`, "stderr.txt"), "utf8");
    if (err.includes("FATAL ERROR")) dead.push(`s${k}: FATAL ERROR`);
  }
  const skipped = [0, 0, 0];
  for (let k = 0; k < SHARDS; k++) {
    const summary = readFileSync(join(OUT!, `s${k}`, "summary.txt"), "utf8");
    for (const m of summary.matchAll(/^unreadable: (.+)$/gm))
      dead.push(`s${k}: unreadable ${m[1]}`);
    const s = /^skipped: legacy=(\d+) candidates=(\d+) context=(\d+)$/m.exec(
      summary,
    );
    if (!s) dead.push(`s${k}: no summary`);
    else [1, 2, 3].forEach((i) => (skipped[i - 1]! += Number(s[i])));
  }
  const hash = captureHashOf(OUT!, ARCHIVE_ROOT);
  const { sha, owners, perShard, noMenu } = hash;
  parts.forEach((p, k) => {
    if (p.length > 0 && perShard[k] === 0) dead.push(`s${k}: no owners`);
  });
  if (noMenu.length > 0)
    dead.push(`${noMenu.length} owners with no findings file`);
  console.log(
    `capture: ${paths.length} files, ${owners} owners, ${SHARDS} shards, skipped legacy ${skipped[0]} candidates ${skipped[1]} context ${skipped[2]}, ${((Date.now() - t0) / 60000).toFixed(1)} min, ${sha.slice(0, 12)}`,
  );
  if (dead.length > 0 || owners === 0) {
    console.error(`capture FAILED: ${dead.join("; ") || "no owners"}`);
    process.exit(1);
  }
  writeFileSync(join(OUT!, "capture.sha256"), captureHashLine(hash));
}

await main();
