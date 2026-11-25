/**
 * The verification runner (`scripts/verify/`): what makes its parallel run equal
 * to a serial one. The whole-corpus equality is measured, not tested — see
 * `docs/developer-guide.md`; here the rules that hold it together, above all the
 * one a new check can break without any error: an accumulator its report reads
 * that `state()` does not carry reads empty after the merge.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { deserialize } from "node:v8";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { operandsOf, withoutFlag, workerArgv } from "../scripts/verify/argv";
import { compareRuns, countsOf } from "../scripts/verify/compare";
import { coverageGapsOf, CoverageTracker } from "../scripts/verify/coverage";
import { pickCover } from "../scripts/verify/coverSet";
import { writeJsonIndent1 } from "../scripts/verify/jsonWrite";
import { addEach, mergeState, mergeValue } from "../scripts/verify/merge";
import { listContextFiles, splitContexts } from "../scripts/verify/rounds";
import { type IScan, isMainScan } from "../scripts/verify/scan";
import {
  isInsideDir,
  isWalkFile,
  makeStageDir,
  readSplitRun,
  removeWalk,
  STAGE_MARKER,
  writeSplit,
} from "../scripts/verify/stage";

const SCRIPTS = join(__dirname, "../scripts");

describe("mergeState", () => {
  it("ends where one process reading the runs in order would", () => {
    const a = {
      n: 2,
      rows: [{ x: 1 }],
      byId: new Map<string, unknown>([
        ["a", { n: 1, name: "first", casts: new Map([["c", 1]]) }],
      ]),
      seen: new Set(["r1"]),
      flag: new Map([["s", false]]),
    };
    const b = {
      n: 3,
      rows: [{ x: 2 }],
      byId: new Map<string, unknown>([
        [
          "a",
          {
            n: 4,
            name: "second",
            casts: new Map([
              ["c", 2],
              ["d", 1],
            ]),
          },
        ],
        ["b", { n: 1, name: "b", casts: new Map() }],
      ]),
      seen: new Set(["r1", "r2"]),
      flag: new Map([["s", true]]),
    };
    expect(mergeState(a, b)).toEqual({
      n: 5,
      rows: [{ x: 1 }, { x: 2 }],
      byId: new Map([
        [
          "a",
          {
            n: 5,
            name: "first",
            casts: new Map([
              ["c", 3],
              ["d", 1],
            ]),
          },
        ],
        ["b", { n: 1, name: "b", casts: new Map() }],
      ]),
      seen: new Set(["r1", "r2"]),
      flag: new Map([["s", true]]),
    });
    expect([...(a.byId as Map<string, unknown>).keys()]).toEqual(["a", "b"]);
  });

  it("lets a field that does not add name its own rule", () => {
    expect(
      mergeState(
        { tally: [1, 2, 3], n: 1 },
        { tally: [1, 0, 1], n: 1 },
        { tally: addEach },
      ),
    ).toEqual({ tally: [2, 2, 4], n: 2 });
  });

  it("keeps a string set only in a later part", () => {
    expect(mergeState({ source: "" }, { source: "DB2" })).toEqual({
      source: "DB2",
    });
    expect(mergeState({ source: "a" }, { source: "b" })).toEqual({
      source: "a",
    });
  });

  it("refuses a pair it has no meaning for", () => {
    expect(() => mergeValue(1, "x")).toThrow(/cannot merge/);
  });
});

describe("splitContexts", () => {
  const capture = () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    for (const s of ["s0", "s1"]) {
      mkdirSync(join(dir, s, "context"), { recursive: true });
      for (let file = 1; file <= 4; file++)
        for (let owner = 0; owner < 3; owner++)
          writeFileSync(
            join(dir, s, "context", `${file}-1-${file * 10 + owner}.txt`),
            `/nowhere/${s}-${file}.txt\nowner\n`,
          );
    }
    return dir;
  };

  it("keeps a round together whatever readdir returns", () => {
    const dir = capture();
    writeFileSync(join(dir, "s0", "context", "1-2-5.txt"), "/a\no\n");
    writeFileSync(join(dir, "s0", "context", "1-1-99.txt"), "/a\no\n");
    const rounds = listContextFiles(dir)
      .filter((f) => f.shard === "s0" && f.fileNo === 1)
      .map((f) => f.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });

  it("joined back in order is the serial order, and never cuts an archive", () => {
    const dir = capture();
    const files = listContextFiles(dir);
    const runs = splitContexts(dir, files, 3);
    expect(runs.flat()).toEqual(files);
    const home = new Map<string, number>();
    runs.forEach((run, k) => {
      for (const f of run) {
        const key = `${f.shard}:${f.fileNo}`;
        expect(home.get(key) ?? k).toBe(k);
        home.set(key, k);
      }
    });
    expect(runs.every((r) => r.length > 0)).toBe(true);
  });
});

describe("countsOf", () => {
  it("reads all three report shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const scan = join(dir, "corpusFactScan5.txt");
    writeFileSync(
      scan,
      "corpusFactScan5 /x: 3 contexts\na: checked 12 / violations 3 (distinct facts 1)\n  kind: 3 (distinct 1)\nb: expected 4, wrong 1\nc: expected 4, missing 0\n",
    );
    const gates = join(dir, "gates.txt");
    writeFileSync(gates, "gates 2, owner files 3\n  checkOne: 7\n");
    expect([...countsOf(scan)]).toEqual([
      ["a", { checked: 12, failed: 3 }],
      ["b", { checked: 4, failed: 1 }],
      ["c", { checked: 4, failed: 0 }],
    ]);
    expect(countsOf(gates).get("checkOne")).toEqual({ checked: 0, failed: 7 });
  });
});

describe("compareRuns", () => {
  const run = (reports: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    for (const [f, text] of Object.entries(reports))
      writeFileSync(join(dir, f), text);
    return dir;
  };
  const scan = (failed: number) => `a: checked 4 / violations ${failed} (x)\n`;

  it("needs a signature for a rise, with or without a ledger", () => {
    const r = compareRuns(run({ "s.txt": scan(1) }), run({ "s.txt": scan(2) }));
    expect(r.unsigned).toEqual(["s:a"]);
    const signed = compareRuns(
      run({ "s.txt": scan(1) }),
      run({ "s.txt": scan(2) }),
      new Map([["s:a", "lag the check"]]),
    );
    expect(signed.unsigned).toEqual([]);
  });

  it("calls a report missing on either side broken", () => {
    const whole = { "s.txt": scan(0), "t.txt": scan(0) };
    expect(compareRuns(run(whole), run({ "s.txt": scan(0) })).broken).toEqual([
      "t.txt: report on one side only",
    ]);
    expect(compareRuns(run({ "s.txt": scan(0) }), run(whole)).broken).toEqual([
      "t.txt: report on one side only",
    ]);
    expect(compareRuns(run({}), run({})).broken).toHaveLength(1);
  });

  it("does not read a check that vanished as a zero", () => {
    const base = run({ "s.txt": `${scan(3)}b: expected 4, wrong 2\n` });
    expect(compareRuns(base, run({ "s.txt": scan(3) })).broken).toEqual([
      "s:b: dropped",
    ]);
    expect(compareRuns(base, run({ "s.txt": "" })).broken).toContain(
      "s.txt: no checks in the report",
    );
  });

  it("wants a report's structure on both sides", () => {
    const gates = "gates 2, owner files 3\n  checkOne: 7\n";
    expect(
      compareRuns(run({ "gates.txt": gates }), run({ "gates.txt": "" })).broken,
    ).toEqual(["gates.txt: no header"]);
    expect(
      compareRuns(
        run({ "gates.txt": gates }),
        run({ "gates.txt": "gates 2, owner files 2\n" }),
      ).broken,
    ).toEqual(["gates.txt: owners 3 -> 2"]);
    expect(
      compareRuns(run({ "s.txt": "" }), run({ "s.txt": scan(0) })).broken,
    ).toEqual(["s.txt: no checks in the base report"]);
  });

  it("takes a gate class that stopped failing as a zero", () => {
    const r = compareRuns(
      run({ "gates.txt": "gates 2, owner files 3\n  checkOne: 7\n" }),
      run({ "gates.txt": "gates 2, owner files 3\n" }),
    );
    expect(r.broken).toEqual([]);
    expect(r.fell).toBe(1);
  });
});

describe("isMainScan", () => {
  it("sees the entry point through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    const real = join(dir, "real.ts");
    writeFileSync(real, "");
    const link = join(dir, "link.ts");
    symlinkSync(real, link);
    const url = pathToFileURL(real).href;
    expect(isMainScan(url, link)).toBe(true);
    expect(isMainScan(url, join(dir, "other.ts"))).toBe(false);
    expect(isMainScan(url, undefined)).toBe(false);
  });
});

describe("verify/cycle.ts", () => {
  it("refuses a directory holding an earlier pass", () => {
    const out = mkdtempSync(join(tmpdir(), "verify-"));
    writeFileSync(join(out, "old.txt"), "an earlier pass\n");
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(SCRIPTS, "verify/cycle.ts"),
        "--out",
        out,
        "--from",
        out,
      ],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cycle refused");
  }, 30_000);
});

describe("verify/run.ts", () => {
  const runner = (cap: string, out: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(SCRIPTS, "verify/run.ts"),
        cap,
        "--out",
        out,
        "--scans",
        "gates",
        "--workers",
        "1",
      ],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );

  it("fails on an empty capture and on a context with no owner line, leaving no report", () => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    const out = join(cap, "out");
    mkdirSync(out);
    writeFileSync(join(out, "gates.txt"), "the last good run\n");
    expect(runner(cap, out).status).toBe(1);
    expect(existsSync(join(out, "gates.txt"))).toBe(false);

    writeFileSync(join(out, "gates.txt"), "the last good run\n");
    writeFileSync(join(context, "1-1-1.txt"), "/nowhere\n");
    expect(runner(cap, out).status).toBe(1);
    expect(existsSync(join(out, "gates.txt"))).toBe(false);
    expect(readdirSync(cap).filter((f) => f.startsWith(".verify-"))).toEqual(
      [],
    );
  }, 60_000);

  it("publishes a clean text-only run", () => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    writeFileSync(join(context, "1-1-1.txt"), "/nowhere\nowner\n");
    const out = join(cap, "out");
    const r = runner(cap, out);
    expect(r.stdout).toContain("1/1 contexts");
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, "gates.txt"), "utf8")).toContain(
      "owner files 1",
    );
    expect(readFileSync(join(out, "gates.json"), "utf8")).toContain('"files"');
  }, 60_000);
});

describe("verify/run.ts --chunks / --join-from (T263)", () => {
  const runner = (cap: string, out: string, ...more: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(SCRIPTS, "verify/run.ts"),
        cap,
        "--out",
        out,
        "--scans",
        "gates",
        ...more,
      ],
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );
  /** five archives, one owner view each */
  const capture = (): string => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    for (let i = 1; i <= 5; i++)
      writeFileSync(join(context, `${i}-1-1.txt`), `/nowhere/${i}\nowner\n`);
    return cap;
  };
  const keptDirs = (cap: string) =>
    readdirSync(cap).filter((f) => f.startsWith(".verify-"));

  it("reports the same bytes however the walk is cut", () => {
    const cap = capture();
    const whole = join(cap, "whole");
    const cut = join(cap, "cut");
    expect(runner(cap, whole, "--workers", "1").status).toBe(0);
    const r = runner(cap, cut, "--workers", "2", "--chunks", "4");
    expect(r.stdout).toContain("5/5 contexts");
    expect(r.status).toBe(0);
    for (const f of ["gates.txt", "gates.json"])
      expect(readFileSync(join(cut, f), "utf8")).toBe(
        readFileSync(join(whole, f), "utf8"),
      );
    expect(keptDirs(cap)).toEqual([]);
  }, 120_000);

  // root writes through a read-only directory, and on Windows the mode bits
  // of a directory do not stop a file being made in it: nothing here would fail
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "keeps a finished walk whose join threw, and joins it without walking",
    () => {
      const cap = capture();
      const whole = join(cap, "whole");
      expect(runner(cap, whole, "--workers", "1").status).toBe(0);
      const out = join(cap, "out");
      mkdirSync(out);
      // the join's last step cannot write: the reports are made, not published
      chmodSync(out, 0o555);
      const failed = runner(cap, out, "--workers", "2", "--chunks", "3");
      chmodSync(out, 0o755);
      expect(failed.status).not.toBe(0);
      expect(readdirSync(out)).toEqual([]);
      const [kept] = keptDirs(cap);
      expect(kept).toBeDefined();
      expect(failed.stderr).toContain(`--join-from ${join(cap, kept!)}`);

      // another split's states are not this run's
      const other = runner(
        cap,
        out,
        "--chunks",
        "2",
        "--join-from",
        join(cap, kept!),
      );
      expect(other.status).toBe(1);
      expect(other.stderr).toContain("does not hold a finished walk");
      expect(keptDirs(cap)).toEqual([kept]);

      // no worker runs: a walk of these, their owner line gone, fails (above)
      for (let i = 1; i <= 5; i++)
        writeFileSync(
          join(cap, "s0", "context", `${i}-1-1.txt`),
          `/nowhere/${i}\n`,
        );
      const joined = runner(
        cap,
        out,
        "--chunks",
        "3",
        "--join-from",
        join(cap, kept!),
      );
      expect(joined.stdout).toContain("5/5 contexts");
      expect(joined.status).toBe(0);
      for (const f of ["gates.txt", "gates.json"])
        expect(readFileSync(join(out, f), "utf8")).toBe(
          readFileSync(join(whole, f), "utf8"),
        );
      expect(keptDirs(cap)).toEqual([]);
    },
    180_000,
  );

  it("refuses a directory with no finished walk, and a split of none", () => {
    const cap = capture();
    const r = runner(cap, join(cap, "out"), "--join-from", cap);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not hold a finished walk");
    for (const n of ["0", "x"]) {
      const bad = runner(cap, join(cap, "out"), "--chunks", n);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("--chunks takes a whole number");
    }
    expect(keptDirs(cap)).toEqual([]);
    expect(existsSync(join(cap, "s0", "context", "1-1-1.txt"))).toBe(true);
  }, 60_000);

  it("refuses --join-from / --chunks with no value before it touches --out", () => {
    const cap = capture();
    const out = join(cap, "out");
    mkdirSync(out);
    const last = "the last good run\n";
    const cases: Array<[string, string[]]> = [
      ["--join-from", ["--join-from", ""]],
      ["--join-from", ["--join-from"]],
      ["--join-from", ["--join-from", "--chunks", "2"]],
      ["--chunks", ["--chunks"]],
      ["--chunks", ["--chunks", ""]],
    ];
    for (const [flag, more] of cases) {
      writeFileSync(join(out, "gates.txt"), last);
      const r = runner(cap, out, ...more);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`${flag} takes a value`);
      expect(r.stdout).not.toContain("contexts");
      expect(readFileSync(join(out, "gates.txt"), "utf8")).toBe(last);
      expect(keptDirs(cap)).toEqual([]);
    }
  }, 60_000);

  it("stages under the directory --out resolves to, and publishes through a symlink", () => {
    const cap = capture();
    const real = join(mkdtempSync(join(tmpdir(), "verify-real-")), "reports");
    mkdirSync(real);
    const linkParent = join(cap, "work");
    mkdirSync(linkParent);
    const out = join(linkParent, "out");
    symlinkSync(real, out);

    const stage = makeStageDir(out);
    expect(dirname(stage)).toBe(realpathSync(real));
    expect(readdirSync(stage)).toEqual([STAGE_MARKER]);
    expect(readdirSync(linkParent)).toEqual(["out"]);
    // the next stage clears it; a directory the walk to join lies in stays,
    // marked or not, and so does one with the prefix and no marker
    const holder = join(real, ".verify-out-holder");
    mkdirSync(join(holder, "walk"), { recursive: true });
    writeFileSync(join(holder, STAGE_MARKER), "1\n");
    mkdirSync(join(real, ".verify-out-plain"));
    const next = makeStageDir(out, join(out, ".verify-out-holder", "walk"));
    expect(existsSync(stage)).toBe(false);
    expect(readdirSync(real).sort()).toEqual(
      [".verify-out-holder", ".verify-out-plain", next.split("/").pop()].sort(),
    );
    expect(existsSync(join(holder, "walk"))).toBe(true);
    for (const d of [next, holder, join(real, ".verify-out-plain")])
      rmSync(d, { recursive: true });

    const r = runner(cap, out, "--workers", "1");
    expect(r.stdout).toContain("5/5 contexts");
    expect(r.status).toBe(0);
    expect(readdirSync(real).sort()).toEqual([
      "gates.json",
      "gates.txt",
      "timing.txt",
    ]);
    // the report names the path the caller gave, not the staging directory
    expect(readFileSync(join(real, "gates.txt"), "utf8")).not.toContain(
      ".verify-out-",
    );
    expect(readdirSync(linkParent)).toEqual(["out"]);
  }, 60_000);

  // B197 review 1: the capture directory, the walk restored into it
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "joins a walk kept beside other files and removes only the walk's own",
    () => {
      const cap = capture();
      const work = mkdtempSync(join(tmpdir(), "verify-work-"));
      const out = join(work, "reports");
      mkdirSync(out);
      chmodSync(out, 0o555);
      const failed = runner(cap, out, "--workers", "2", "--chunks", "3");
      chmodSync(out, 0o755);
      expect(failed.status).not.toBe(0);
      const [kept] = keptDirs(work);
      expect(kept).toBeDefined();
      const walkFiles = readdirSync(join(work, kept!));
      expect(walkFiles).toContain("walk.json");
      expect(walkFiles).toContain("split.json");
      for (const f of walkFiles) renameSync(join(work, kept!, f), join(cap, f));
      rmdirSync(join(work, kept!));
      writeFileSync(join(cap, "notes.txt"), "not the walk's\n");
      writeFileSync(join(cap, "w0.bin.notAScan.0"), "not the walk's\n");

      const joined = runner(cap, out, "--chunks", "3", "--join-from", cap);
      expect(joined.stdout).toContain("5/5 contexts");
      expect(joined.status).toBe(0);
      expect(readdirSync(out).sort()).toEqual([
        "gates.json",
        "gates.txt",
        "timing.txt",
      ]);
      expect(readdirSync(cap).sort()).toEqual([
        "notes.txt",
        "s0",
        "w0.bin.notAScan.0",
      ]);
      expect(readdirSync(join(cap, "s0", "context"))).toHaveLength(5);
    },
    180_000,
  );

  // B197 review 2: a worker walks what the parent recorded, not its own cut
  it("walks the chunk the parent recorded, whatever a new cut would give", () => {
    const cap = capture();
    const files = listContextFiles(cap);
    const walkDir = mkdtempSync(join(tmpdir(), "verify-walk-"));
    // no cut of five equal archives in two gives four and one
    expect(splitContexts(cap, files, 2).map((r) => r.length)).not.toEqual([
      4, 1,
    ]);
    writeSplit(walkDir, [files.slice(0, 4), files.slice(4)]);
    const state = join(walkDir, "w0.bin");
    const r = runner(
      cap,
      join(cap, "out"),
      "--worker",
      "0/2",
      "--state",
      state,
    );
    expect(r.status).toBe(0);
    expect(
      (deserialize(readFileSync(state)) as { contexts: number }).contexts,
    ).toBe(4);
    // a worker of another split does not read this one
    const other = runner(
      cap,
      join(cap, "out"),
      "--worker",
      "0/3",
      "--state",
      state,
    );
    expect(other.status).not.toBe(0);
    expect(other.stderr).toContain("does not record chunk 0 of 3");
  }, 120_000);

  // B197 review 4
  it("refuses a later occurrence with no value, and two values that differ, before it touches --out", () => {
    const cap = capture();
    const out = join(cap, "out");
    mkdirSync(out);
    const last = "the last good run\n";
    const cases: Array<[string, string[]]> = [
      ["--chunks takes a value", ["--chunks", "10", "--chunks"]],
      ["--join-from takes a value", ["--join-from", cap, "--join-from", ""]],
      ["--chunks given more than once", ["--chunks", "2", "--chunks", "3"]],
    ];
    for (const [message, more] of cases) {
      writeFileSync(join(out, "gates.txt"), last);
      const r = runner(cap, out, ...more);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(message);
      expect(r.stdout).not.toContain("contexts");
      expect(readFileSync(join(out, "gates.txt"), "utf8")).toBe(last);
      expect(readdirSync(out)).toEqual(["gates.txt"]);
      expect(keptDirs(cap)).toEqual([]);
    }
  }, 60_000);

  // B197 review 5
  it("clears a stage a killed join left inside --out", () => {
    const cap = capture();
    const out = join(cap, "out");
    const stale = join(out, ".verify-out-x");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, STAGE_MARKER), "1\n");
    writeFileSync(join(stale, "corpusFactScan5.json"), '{"capture": "half');
    const r = runner(cap, out, "--workers", "1");
    expect(r.status).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      "gates.json",
      "gates.txt",
      "timing.txt",
    ]);
  }, 60_000);

  /** a finished walk whose join could not publish, moved to `to` */
  const keptWalkAt = (cap: string, to: string, ...cut: string[]): void => {
    const work = mkdtempSync(join(tmpdir(), "verify-work-"));
    const blocked = join(work, "reports");
    mkdirSync(blocked);
    chmodSync(blocked, 0o555);
    const failed = runner(cap, blocked, ...cut);
    chmodSync(blocked, 0o755);
    expect(failed.status).not.toBe(0);
    const [kept] = keptDirs(work);
    expect(kept).toBeDefined();
    expect(readdirSync(join(work, kept!))).toContain("walk.json");
    renameSync(join(work, kept!), to);
  };

  // B198 review 1: the walk being joined is not a dead stage
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "joins a walk kept as .verify-out-recovery inside --out, and clears only marked stages",
    () => {
      const cap = capture();
      const out = join(mkdtempSync(join(tmpdir(), "verify-out-")), "reports");
      mkdirSync(out);
      const recovery = join(out, ".verify-out-recovery");
      keptWalkAt(cap, recovery, "--workers", "2", "--chunks", "3");
      const unmarked = join(out, ".verify-out-x");
      mkdirSync(unmarked);
      writeFileSync(join(unmarked, "mine.txt"), "not a stage\n");
      const marked = join(out, ".verify-out-y");
      mkdirSync(marked);
      writeFileSync(join(marked, STAGE_MARKER), "1\n");
      writeFileSync(join(marked, "gates.json"), '{"half');

      const joined = runner(cap, out, "--chunks", "3", "--join-from", recovery);
      expect(joined.stderr).not.toContain("kept its states");
      expect(joined.stdout).toContain("5/5 contexts");
      expect(joined.status).toBe(0);
      // the walk's own files went with the verdict, and its directory with them
      expect(readdirSync(out).sort()).toEqual([
        ".verify-out-x",
        "gates.json",
        "gates.txt",
        "timing.txt",
      ]);
      expect(readdirSync(unmarked)).toEqual(["mine.txt"]);
    },
    180_000,
  );

  // B198 review 2: another walk's chunk and another scan's part stay
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "leaves a foreign chunk state and an unselected scan's part after joining a one-chunk walk",
    () => {
      const cap = capture();
      const work = mkdtempSync(join(tmpdir(), "verify-work-"));
      const kept = join(work, "kept");
      keptWalkAt(cap, kept, "--workers", "1");
      expect(readdirSync(kept)).toContain("w0.bin");
      writeFileSync(join(kept, "w27.bin"), "another walk's\n");
      writeFileSync(join(kept, "w0.bin.corpusFactScan5.0"), "another scan's\n");

      const out = join(work, "out");
      const joined = runner(cap, out, "--workers", "1", "--join-from", kept);
      expect(joined.stdout).toContain("5/5 contexts");
      expect(joined.status).toBe(0);
      expect(readdirSync(kept).sort()).toEqual([
        "w0.bin.corpusFactScan5.0",
        "w27.bin",
      ]);
    },
    180_000,
  );

  // B198 review 3: the capture is an argument, not a flag
  it("refuses a flag where the capture goes before it touches --out", () => {
    const work = mkdtempSync(join(tmpdir(), "verify-work-"));
    const out = join(work, "reports");
    mkdirSync(out);
    const last = "the last good run\n";
    for (const args of [
      ["--join-from", "--out", out],
      ["--out", out],
      ["--out", out, "--scans", "gates"],
    ]) {
      writeFileSync(join(out, "gates.txt"), last);
      const r = spawnSync(
        process.execPath,
        ["--import", "tsx", join(SCRIPTS, "verify/run.ts"), ...args],
        { cwd: join(__dirname, ".."), encoding: "utf8" },
      );
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr).toContain("usage: verify/run.ts <captureDir>");
      expect(readFileSync(join(out, "gates.txt"), "utf8")).toBe(last);
      expect(readdirSync(out)).toEqual(["gates.txt"]);
      expect(readdirSync(work)).toEqual(["reports"]);
    }
  }, 60_000);
});

describe("verify/argv.ts (T263, B197 review 3 and 4)", () => {
  it("drops the parent's --out by position, not by value", () => {
    expect(
      workerArgv(
        ["--out", "10", "--chunks", "10", "--scans", "gates"],
        "10",
        "2/10",
        "/w/w2.bin",
      ),
    ).toEqual([
      "--out",
      "10",
      "--worker",
      "2/10",
      "--state",
      "/w/w2.bin",
      "--chunks",
      "10",
      "--scans",
      "gates",
    ]);
    expect(
      withoutFlag(["--chunks", "10", "--out", "10", "--freeze"], "--out"),
    ).toEqual(["--chunks", "10", "--freeze"]);
    expect(withoutFlag(["--freeze", "--out"], "--out")).toEqual(["--freeze"]);
  });

  it("reads the value at every place a flag stands", () => {
    expect(operandsOf(["--chunks", "10", "--chunks"], "--chunks")).toEqual([
      "10",
      undefined,
    ]);
    expect(
      operandsOf(["--join-from", "x", "--join-from", ""], "--join-from"),
    ).toEqual(["x", ""]);
    expect(operandsOf(["--out", "o"], "--chunks")).toEqual([]);
  });
});

describe("the walk's own files (T263, B197 review 1 and 2, B198 review 2)", () => {
  const SCANS = ["gates", "corpusFactScan5"];

  it("names the manifests, the chunk states and their parts, nothing else", () => {
    for (const f of [
      "walk.json",
      "split.json",
      "w0.bin",
      "w12.bin",
      "w3.bin.gates.0",
      "w3.bin.corpusFactScan5.17",
    ])
      expect(isWalkFile(f, 13, SCANS), f).toBe(true);
    // a chunk this walk does not have, a scan it did not run
    for (const f of ["w13.bin", "w27.bin", "w27.bin.gates.0", "w03.bin"])
      expect(isWalkFile(f, 13, SCANS), f).toBe(false);
    expect(isWalkFile("w0.bin.corpusFactScan5.0", 1, ["gates"])).toBe(false);
    for (const f of [
      "w0.bin.other.0",
      "w.bin",
      "w0.bin.gates",
      "xw0.bin",
      "capture.sha256",
      "walk.json.bak",
      "s0",
    ])
      expect(isWalkFile(f, 13, SCANS), f).toBe(false);
  });

  it("removes the walk and leaves a directory that holds anything else", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-walk-"));
    for (const f of ["walk.json", "split.json", "w0.bin", "w0.bin.gates.0"])
      writeFileSync(join(dir, f), "x");
    mkdirSync(join(dir, "s0", "context"), { recursive: true });
    writeFileSync(join(dir, "s0", "context", "1-1-1.txt"), "/a\no\n");
    writeFileSync(join(dir, "capture.sha256"), "abc\n");
    // a directory under a walk file's name is not the runner's
    mkdirSync(join(dir, "w1.bin"));
    expect(removeWalk(dir, 1, SCANS)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(["capture.sha256", "s0", "w1.bin"]);
    expect(existsSync(join(dir, "s0", "context", "1-1-1.txt"))).toBe(true);

    const own = mkdtempSync(join(tmpdir(), "verify-walk-"));
    for (const f of ["walk.json", "split.json", "w0.bin", "w0.bin.gates.0"])
      writeFileSync(join(own, f), "x");
    expect(removeWalk(own, 1, SCANS)).toBe(true);
    expect(existsSync(own)).toBe(false);
    expect(removeWalk(own, 1, SCANS)).toBe(true);
  });

  it("hands a worker the recorded cut after the archives changed size", () => {
    const cap = mkdtempSync(join(tmpdir(), "verify-"));
    const context = join(cap, "s0", "context");
    mkdirSync(context, { recursive: true });
    const archive = (i: number) => join(cap, `${i}.txt.gz`);
    for (let i = 1; i <= 6; i++)
      writeFileSync(join(context, `${i}-1-1.txt`), `${archive(i)}\nowner\n`);
    const files = listContextFiles(cap);
    const walkDir = mkdtempSync(join(tmpdir(), "verify-walk-"));
    const recorded = splitContexts(cap, files, 3);
    expect(recorded.map((r) => r.length)).toEqual([2, 2, 2]);
    writeSplit(walkDir, recorded);
    // an archive appears mid-walk: a new cut moves every boundary
    writeFileSync(archive(1), Buffer.alloc(4_000_000));
    const recut = splitContexts(cap, files, 3);
    expect(recut.map((r) => r.length)).not.toEqual([2, 2, 2]);
    for (let k = 0; k < 3; k++)
      expect(readSplitRun(walkDir, k, 3)).toEqual(recorded[k]);
    expect(() => readSplitRun(walkDir, 0, 2)).toThrow(/does not record/);
    expect(() => readSplitRun(walkDir, 3, 3)).toThrow(/does not record/);
  });
});

describe("isInsideDir (T263)", () => {
  it("calls another Windows drive outside, though path.relative returns an absolute path", () => {
    const kept = "C:\\walks\\.verify-abc";
    expect(win32.relative(kept, "D:\\reports\\B195")).toBe("D:\\reports\\B195");
    expect(isInsideDir(kept, "D:\\reports\\B195", win32)).toBe(false);
    expect(isInsideDir(kept, "C:\\reports\\B195", win32)).toBe(false);
    expect(isInsideDir(kept, kept, win32)).toBe(true);
    expect(isInsideDir(kept, `${kept}\\out`, win32)).toBe(true);
    expect(isInsideDir(kept, "C:\\walks\\.verify-abc..x", win32)).toBe(false);
  });

  it("keeps the POSIX answers: itself and below are inside, a sibling is not", () => {
    expect(isInsideDir("/w/.verify-a", "/w/.verify-a", posix)).toBe(true);
    expect(isInsideDir("/w/.verify-a", "/w/.verify-a/out", posix)).toBe(true);
    expect(isInsideDir("/w/.verify-a", "/w/.verify-a/..out", posix)).toBe(true);
    expect(isInsideDir("/w/.verify-a", "/w/out", posix)).toBe(false);
    expect(isInsideDir("/w/.verify-a", "/w", posix)).toBe(false);
  });
});

describe("writeJsonIndent1 (T263)", () => {
  const written = (obj: Record<string, unknown>): string => {
    const p = join(mkdtempSync(join(tmpdir(), "json-")), "o.json");
    writeJsonIndent1(p, obj);
    return readFileSync(p, "utf8");
  };

  it("writes the bytes JSON.stringify(obj, null, 1) returns", () => {
    const cases: Array<Record<string, unknown>> = [
      {
        capture: "/a\nb",
        contexts: 3,
        checked: { "x: y": 2, 中文: 0 },
        vList: [],
        nested: { rows: [{ a: [1, [2, {}]] }], none: [] },
        violations: [
          { check: "c", detail: 'q"\n', n: [1, [2, {}]], u: undefined },
          null,
          [],
          {},
          undefined,
          "s",
          [[1], { k: [] }],
        ],
      },
      { capture: "x", contexts: 0, checked: {}, violations: [] },
      {
        a: undefined,
        b: [undefined, 1],
        c: { d: [] },
        f: () => 1,
        s: Symbol("x"),
        n: null,
        z: 0,
        e: "",
        when: new Date(0),
      },
      // eslint-disable-next-line no-sparse-arrays -- a hole prints as null
      { violations: [, 7, , 8] },
      {},
    ];
    for (const c of cases) expect(written(c)).toBe(JSON.stringify(c, null, 1));
  });

  it("never stringifies a top-level array whole", () => {
    const big = {
      capture: "x",
      checked: { a: 1 },
      violations: Array.from({ length: 5000 }, (_, i) => ({ check: "c", i })),
    };
    const want = JSON.stringify(big, null, 1);
    const real = JSON.stringify;
    const spy = vi
      .spyOn(JSON, "stringify")
      .mockImplementation((v: unknown, ...rest: unknown[]) => {
        const long = (a: unknown) => Array.isArray(a) && a.length > 1000;
        if (
          long(v) ||
          (v && typeof v === "object" && Object.values(v).some(long))
        )
          throw new Error("a whole array stringified");
        return (real as (...a: unknown[]) => string)(v, ...rest);
      });
    try {
      expect(written(big)).toBe(want);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("pickCover", () => {
  it("covers everything, cheapest first, and keeps what it is told to", () => {
    const items = new Map([
      ["big", new Set(["a", "b", "c"])],
      ["small1", new Set(["a", "b"])],
      ["small2", new Set(["c"])],
      ["keep", new Set(["d"])],
    ]);
    const cost = (a: string) => (a === "big" ? 100 : 1);
    expect(pickCover(items, cost, ["keep"]).sort()).toEqual([
      "keep",
      "small1",
      "small2",
    ]);
  });
});

describe("CoverageTracker", () => {
  it("files a kind kept out of the total under its kind, not as a failure of its check", () => {
    const state = {
      checked: new Map([["x", 2]]),
      violations: [
        { check: "x", kind: "info" },
        { check: "x", kind: "real" },
      ],
    };
    const scan = {
      state: () => state,
      inTotal: (_c: string, k: string) => k !== "info",
    } as unknown as IScan;
    const t = new CoverageTracker();
    state.violations.length = 1;
    t.step("a1", [{ name: "s", scan }]);
    state.violations.push({ check: "x", kind: "real" });
    state.checked.set("x", 3);
    t.step("a2", [{ name: "s", scan }]);
    expect(t.rows.map((r) => [r.archive, r.fail])).toEqual([
      ["a1", ["s:x|info"]],
      ["a2", ["s:x", "s:x|real"]],
    ]);
  });

  it("is told the total by every scan that keeps kinds out of it", () => {
    for (const f of readdirSync(SCRIPTS).filter((n) =>
      /^corpusFactScan\d?\.ts$/.test(n),
    )) {
      const src = readFileSync(join(SCRIPTS, f), "utf8");
      if (/OUT_OF_TOTAL|MEASURED_ONLY/.test(src))
        expect(src, f).toMatch(/^ {2,4}inTotal,$/m);
    }
  });
});

/** what a scan's report (and finalize) reads, through the helpers it calls */
function reachableFrom(
  src: ts.SourceFile,
  decls: ts.Statement[],
  roots: string[],
): Set<string> {
  const bodies = new Map<string, ts.Node>();
  for (const st of decls) {
    if (ts.isFunctionDeclaration(st) && st.name) bodies.set(st.name.text, st);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) bodies.set(d.name.text, d);
  }
  const seen = new Set<string>();
  const todo = roots.filter((r) => bodies.has(r));
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && bodies.has(n.text) && !seen.has(n.text)) {
      seen.add(n.text);
      todo.push(n.text);
    }
    ts.forEachChild(n, walk);
  };
  while (todo.length > 0) walk(bodies.get(todo.pop()!)!);
  return seen;
}

/** module-level names written inside a function, not at load */
function writtenLater(decls: ts.Statement[]): Set<string> {
  const names = new Set<string>();
  const MUTATORS = new Set(["push", "set", "add", "delete", "clear"]);
  const base = (e: ts.Expression): string | undefined => {
    while (
      ts.isPropertyAccessExpression(e) ||
      ts.isElementAccessExpression(e) ||
      ts.isNonNullExpression(e)
    )
      e = e.expression;
    return ts.isIdentifier(e) ? e.text : undefined;
  };
  const walk = (n: ts.Node, inFunction: boolean): void => {
    const inFn = inFunction || ts.isFunctionLike(n);
    if (inFn) {
      let target: string | undefined;
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        MUTATORS.has(n.expression.name.text)
      )
        target = base(n.expression.expression);
      else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        target = base(n.left);
      else if (
        (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken ||
          n.operator === ts.SyntaxKind.MinusMinusToken)
      )
        target = base(n.operand);
      if (target) names.add(target);
    }
    ts.forEachChild(n, (c) => walk(c, inFn));
  };
  for (const st of decls) walk(st, false);
  return names;
}

/** per-process lookups rebuilt on demand: they hold no finding */
const PER_PROCESS_CACHES = new Set([
  "aliasCache",
  "familyByName",
  "siblingCache",
  "variantTable",
  "castOfAura",
  "silenceIds",
  "excludeCasterIds",
]);
/** set by `configure` in every process */
const OPTIONS = new Set(["dir", "EXAMPLES", "JSON_OUT", "ONLY"]);

describe("coverageGapsOf (GH #177 item 22)", () => {
  const rows = [
    { archive: "a", hit: ["s:c", "s:d"], fail: ["s:c", "s:c|walkKind"] },
  ];
  it("lists a check no archive counted or failed, as before", () => {
    expect(
      coverageGapsOf(
        rows,
        [
          { id: "s:c", checked: 5, failed: 2 },
          { id: "s:d", checked: 3, failed: 1 },
          { id: "s:e", checked: 1, failed: 0 },
        ],
        [],
      ),
    ).toEqual(["fail s:d", "hit s:e"]);
  });
  it("lists a kind only the merged report filed, though its check failed on an archive", () => {
    expect(
      coverageGapsOf(
        rows,
        [{ id: "s:c", checked: 5, failed: 2 }],
        ["s:c|walkKind", "s:c|reportKind", "s:c|reportKind"],
      ),
    ).toEqual(["fail s:c|reportKind"]);
  });
});

describe("every accumulator a report reads crosses the merge", () => {
  const files = [
    ...[
      "corpusFactScan",
      "corpusFactScan2",
      "corpusFactScan3",
      "corpusFactScan4",
      "corpusFactScan5",
      "fact2Scan",
      "pressFactScan",
      "breakFactScan",
    ].map((f) => `${f}.ts`),
    "verify/gates.ts",
    ...readdirSync(join(SCRIPTS, "scan5"))
      .filter((f) => f.endsWith(".ts") && f !== "ctx.ts")
      .map((f) => `scan5/${f}`),
  ];
  it.each(files)("%s", (file) => {
    const text = readFileSync(join(SCRIPTS, file), "utf8");
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const factory = src.statements.find(
      (s) => ts.isFunctionDeclaration(s) && s.name?.text === "createScan",
    ) as ts.FunctionDeclaration | undefined;
    const decls = [
      ...src.statements,
      ...(factory ? factory.body!.statements : []),
    ];
    const read = reachableFrom(src, decls, ["report", "finalize"]);
    const written = writtenLater(decls);
    const stateDecl = decls
      .filter(ts.isVariableStatement)
      .flatMap((s) => [...s.declarationList.declarations])
      .find((d) => d.name.getText(src) === "state");
    const carried = new Set(
      stateDecl ? (stateDecl.getText(src).match(/\b\w+\b/g) ?? []) : [],
    );
    const lost = [...read].filter(
      (n) =>
        written.has(n) &&
        !carried.has(n) &&
        !PER_PROCESS_CACHES.has(n) &&
        !OPTIONS.has(n),
    );
    expect(lost).toEqual([]);
  });
});
