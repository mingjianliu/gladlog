/**
 * Recorder simulator -- drive the managed-OBS recording path on Windows
 * WITHOUT playing an arena match, then audit the chunks it produced.
 *
 *   npm run recorder:sim --workspace=packages/desktop -- run    [options]
 *   npm run recorder:sim --workspace=packages/desktop -- verify [options]
 *
 * The recorder reacts to exactly two outside signals:
 *   1. the WoW process being up (wowProcessWatch.ts polls `tasklist` for
 *      Wow.exe / WowClassic.exe / WowT.exe) -> continuous recording starts;
 *   2. ARENA_MATCH_START / ARENA_MATCH_END lines arriving in a
 *      WoWCombatLog*.txt under <wowDirectory>/Logs -> the match-open split
 *      (only when the log is <=3 s late), the match-end split, and the idle
 *      60 s splits in between.
 *
 * `run` fakes (2) by replaying real arena matches out of an existing combat
 * log into a NEW WoWCombatLog file, with every timestamp shifted onto the
 * wall clock and each line appended at the moment its new timestamp says
 * (plus an optional deliberate lag). Optionally it fakes (1) too with a
 * renamed copy of node.exe called Wow.exe -- then game_capture has nothing to
 * hook and the video is black, but every split / association decision still
 * runs. With the real WoW client sitting idle in town instead, the capture
 * path (4K fit, audio) is exercised as well -- only the picture won't show
 * the match, because nobody is playing it.
 *
 * `verify` reads the manifest `run` wrote plus the app's recordings.ndjson
 * and prints, per simulated match, which chunk(s) carry it, how much lobby
 * sits before it in its file, whether its opening is missing, and each
 * chunk's real mp4 duration (read from the file's own mvhd/mehd box -- no
 * ffmpeg needed).
 *
 * Throwaway-style probe like obsGateCheck.ts: no app code is imported, so it
 * can't drift the product; the constants it checks against are restated
 * below with their source location.
 */
import { type ChildProcess,execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

// Restated product constants (checked against, never driving the product):
/** recorder.ts IDLE_SPLIT_MS */
const IDLE_SPLIT_S = 60;
/** recorder.ts MATCH_OPEN_SPLIT_MAX_LAG_MS */
const OPEN_SPLIT_MAX_LAG_MS = 3_000;
/** videoTime.ts PRE_ROLL_S */
const PRE_ROLL_S = 3;

const argv = process.argv.slice(2);
const cmd = argv[0];
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function num(name: string, dflt: number): number {
  const v = opt(name);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${name} must be a number, got "${v}"`);
  return n;
}
function die(msg: string): never {
  console.error(`[recorder-sim] ${msg}`);
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- settings --

interface AppSettings {
  wowDirectory?: string | null;
  recordingEnabled?: boolean;
  recordingMode?: string;
  recordingDirectory?: string | null;
}

/** The packaged app's userData is %APPDATA%\gladlog (productName); a dev run
 * (`npm run dev`) may use the package name instead. Return every candidate
 * that has a settings.json. */
function userDataCandidates(): string[] {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const macSupport = join(homedir(), "Library", "Application Support");
  const roots = [appData, macSupport];
  const names = ["gladlog", "@gladlog/desktop", "@gladlog\\desktop"];
  const out: string[] = [];
  for (const r of roots)
    for (const n of names) {
      const d = join(r, n);
      if (existsSync(join(d, "settings.json")) && !out.includes(d)) out.push(d);
    }
  return out;
}

function loadSettings(): { userData: string; s: AppSettings } | null {
  const override = opt("user-data");
  const dirs = override ? [override] : userDataCandidates();
  for (const d of dirs) {
    try {
      const s = JSON.parse(
        readFileSync(join(d, "settings.json"), "utf-8"),
      ) as AppSettings;
      return { userData: d, s };
    } catch {
      /* try next */
    }
  }
  return null;
}

/** detectWowDir.ts resolveLogsDir: <dir>/Logs when it exists, else <dir>. */
function resolveLogsDir(wowDir: string): string {
  const logs = join(wowDir, "Logs");
  return existsSync(logs) ? logs : wowDir;
}

// --------------------------------------------------------- log extraction --

const TS_SEP = "  ";

/** Parse the leading "M/D/YYYY HH:MM:SS.ffff[+-tz]" of a combat-log line into
 * a wall-clock-free ms count (only differences are ever used, so the
 * timezone suffix is irrelevant here). */
function lineMs(line: string): number | null {
  const sep = line.indexOf(TS_SEP);
  if (sep < 0) return null;
  const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/.exec(
    line.slice(0, sep),
  );
  if (!m) return null;
  const frac = m[7]!.padEnd(3, "0").slice(0, 3);
  return Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, +m[6]!, +frac);
}

function eventName(line: string): string {
  const sep = line.indexOf(TS_SEP);
  if (sep < 0) return "";
  const rest = line.slice(sep + TS_SEP.length);
  const c = rest.indexOf(",");
  return c < 0 ? rest : rest.slice(0, c);
}

interface SrcMatch {
  file: string;
  bracket: string;
  lines: string[];
  /** source ms of each line, relative to the ARENA_MATCH_START line */
  rel: number[];
  durationMs: number;
}

/** ARENA_MATCH_START,instanceId,unk,bracket,isRated */
function bracketOf(startLine: string): string {
  const parts = startLine.slice(startLine.indexOf(TS_SEP) + 2).split(",");
  return parts[3] ?? "?";
}

async function extractMatches(
  files: string[],
  want: number,
  maxMatchMs: number,
  allowShuffle: boolean,
): Promise<{ header: string | null; matches: SrcMatch[] }> {
  let header: string | null = null;
  const matches: SrcMatch[] = [];
  for (const file of files) {
    if (matches.length >= want) break;
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let cur: { lines: string[]; t0: number; bracket: string } | null = null;
    for await (const raw of rl) {
      const line = raw.replace(/\r$/, "");
      const ev = eventName(line);
      if (ev === "COMBAT_LOG_VERSION" && header === null) header = line;
      if (ev === "ARENA_MATCH_START") {
        const t0 = lineMs(line);
        cur =
          t0 === null ? null : { lines: [line], t0, bracket: bracketOf(line) };
        continue;
      }
      if (!cur) continue;
      cur.lines.push(line);
      const t = lineMs(line);
      if (t !== null && t - cur.t0 > maxMatchMs) {
        cur = null; // too long (or never closed) -- skip it
        continue;
      }
      if (ev === "ARENA_MATCH_END") {
        const isShuffle = /shuffle/i.test(cur.bracket);
        if (!isShuffle || allowShuffle) {
          const rel = cur.lines.map((l) => {
            const ms = lineMs(l);
            return ms === null ? NaN : ms - cur!.t0;
          });
          // a line without a parseable stamp inherits its predecessor's
          for (let i = 0; i < rel.length; i++)
            if (Number.isNaN(rel[i])) rel[i] = i === 0 ? 0 : rel[i - 1]!;
          matches.push({
            file,
            bracket: cur.bracket,
            lines: cur.lines,
            rel,
            durationMs: rel[rel.length - 1]!,
          });
        }
        cur = null;
        if (matches.length >= want) {
          rl.close();
          break;
        }
      }
    }
  }
  return { header, matches };
}

/** Format an epoch ms as the combat log does, in this machine's local time,
 * with an explicit "+-H" offset suffix (parser/src/l1/timestamp.ts reads it
 * as hours) so the parsed instant is unambiguous whatever the app's timezone
 * handling does. */
function fmtStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const offH = -d.getTimezoneOffset() / 60;
  const off = `${offH >= 0 ? "+" : "-"}${Math.abs(offH)}`;
  return (
    `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${ms}0${off}`
  );
}

function restamp(line: string, epochMs: number): string {
  const sep = line.indexOf(TS_SEP);
  return sep < 0 ? line : fmtStamp(epochMs) + line.slice(sep);
}

function logFileName(now: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `WoWCombatLog-${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `${String(now.getFullYear()).slice(2)}_${p2(now.getHours())}` +
    `${p2(now.getMinutes())}${p2(now.getSeconds())}.txt`
  );
}

// ---------------------------------------------------------------- fake WoW --

function isWowRunning(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("tasklist", [], { encoding: "utf-8" });
    return ["Wow.exe", "WowClassic.exe", "WowT.exe"].some((n) =>
      out.includes(n),
    );
  } catch {
    return false;
  }
}

function startFakeWow(): ChildProcess {
  if (process.platform !== "win32")
    die("--fake-wow only makes sense on Windows (tasklist probe)");
  const dir = join(tmpdir(), "gladlog-recorder-sim");
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, "Wow.exe");
  copyFileSync(process.execPath, exe);
  const child = spawn(exe, ["-e", "setInterval(()=>{},1<<30)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return child;
}

// --------------------------------------------------------------------- run --

interface ManifestMatch {
  index: number;
  bracket: string;
  sourceFile: string;
  /** epoch ms written into the ARENA_MATCH_START / END lines */
  startMs: number;
  endMs: number;
  /** extra delay applied to WRITING this match's lines */
  lagMs: number;
}
interface Manifest {
  createdAt: number;
  logFile: string;
  userData: string | null;
  recordingsDir: string | null;
  fakeWow: boolean;
  matches: ManifestMatch[];
}

async function cmdRun(): Promise<void> {
  const settings = loadSettings();
  if (settings) {
    const s = settings.s;
    console.log(`[recorder-sim] app settings: ${settings.userData}`);
    console.log(
      `  recordingEnabled=${s.recordingEnabled} recordingMode=${s.recordingMode} wowDirectory=${s.wowDirectory}`,
    );
    if (!s.recordingEnabled)
      console.warn(
        "  !! recordingEnabled is false -- the app will record nothing",
      );
    if (s.recordingMode !== "managed")
      console.warn("  !! recordingMode is not 'managed'");
  } else {
    console.warn(
      "[recorder-sim] no gladlog settings.json found (pass --user-data)",
    );
  }

  const logsDir =
    opt("logs-dir") ??
    (settings?.s.wowDirectory
      ? resolveLogsDir(settings.s.wowDirectory)
      : undefined);
  if (!logsDir || !existsSync(logsDir))
    die(`logs dir not found (${logsDir}); pass --logs-dir <WoW>\\Logs`);

  const source = opt("source") ?? logsDir;
  let files: string[];
  if (statSync(source).isDirectory()) {
    files = readdirSync(source)
      .filter((n) => n.includes("WoWCombatLog") && n.endsWith(".txt"))
      .map((n) => join(source, n))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs); // newest first
  } else files = [source];
  if (files.length === 0) die(`no WoWCombatLog*.txt under ${source}`);

  const want = num("matches", 2);
  const maxMatchMs = num("max-match-s", 420) * 1000;
  const { header, matches } = await extractMatches(
    files,
    want,
    maxMatchMs,
    flag("allow-shuffle"),
  );
  if (matches.length === 0)
    die(
      "no complete arena match (ARENA_MATCH_START..END) found in the source " +
        "within --max-match-s; point --source at a log that has one",
    );
  if (matches.length < want)
    console.warn(`[recorder-sim] only found ${matches.length}/${want} matches`);

  const leadS = num("lead-s", 90);
  const gapS = num("gap-s", 75);
  /** comma list, one per match; the last value repeats */
  const lags = (opt("lag-ms") ?? "0").split(",").map(Number);

  const outFile = join(logsDir, logFileName(new Date()));
  const t0 = Date.now() + leadS * 1000;
  type Row = { at: number; text: string };
  const schedule: Row[] = [];
  const manifest: Manifest = {
    createdAt: Date.now(),
    logFile: outFile,
    userData: settings?.userData ?? null,
    recordingsDir: settings
      ? settings.s.recordingDirectory?.trim() ||
        join(settings.userData, "recordings")
      : null,
    fakeWow: flag("fake-wow"),
    matches: [],
  };
  let cursor = t0;
  matches.forEach((m, i) => {
    const lagMs = lags[Math.min(i, lags.length - 1)] ?? 0;
    m.lines.forEach((l, j) => {
      const stamp = cursor + m.rel[j]!;
      schedule.push({ at: stamp + lagMs, text: restamp(l, stamp) });
    });
    manifest.matches.push({
      index: i + 1,
      bracket: m.bracket,
      sourceFile: basename(m.file),
      startMs: cursor,
      endMs: cursor + m.durationMs,
      lagMs,
    });
    cursor += m.durationMs + gapS * 1000;
  });
  schedule.sort((a, b) => a.at - b.at);

  const manifestPath =
    opt("manifest") ?? join(tmpdir(), "gladlog-recorder-sim", "manifest.json");
  mkdirSync(join(manifestPath, ".."), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`[recorder-sim] writing ${outFile}`);
  console.log(`[recorder-sim] manifest ${manifestPath}`);
  for (const m of manifest.matches)
    console.log(
      `  match ${m.index} ${m.bracket.padEnd(14)} ${new Date(m.startMs).toLocaleTimeString()} -> ` +
        `${new Date(m.endMs).toLocaleTimeString()} (${Math.round((m.endMs - m.startMs) / 1000)} s, write lag ${m.lagMs} ms)`,
    );
  const totalS = Math.round(
    (cursor - gapS * 1000 + 30_000 - Date.now()) / 1000,
  );
  console.log(`[recorder-sim] runs ~${totalS} s. Keep the gladlog app open.`);

  let fake: ChildProcess | null = null;
  if (flag("dry-run")) {
    /* no process faking in a self-test */
  } else if (flag("fake-wow")) {
    if (isWowRunning())
      console.log(
        "[recorder-sim] WoW already running -- not starting a fake one",
      );
    else {
      fake = startFakeWow();
      console.log(`[recorder-sim] fake Wow.exe started (pid ${fake.pid})`);
    }
  } else if (process.platform === "win32" && !isWowRunning()) {
    console.warn(
      "[recorder-sim] !! no WoW process found -- managed recording will not start. " +
        "Start WoW (idle in town is fine) or pass --fake-wow",
    );
  }
  const cleanup = () => {
    if (fake && !fake.killed) fake.kill();
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  writeFileSync(outFile, header ? restamp(header, Date.now()) + "\r\n" : "");
  if (flag("dry-run")) {
    // Self-test only: everything at once, no pacing, no fake WoW.
    appendFileSync(outFile, schedule.map((r) => r.text + "\r\n").join(""));
    console.log("[recorder-sim] --dry-run: wrote every line immediately");
    return;
  }
  let i = 0;
  let lastPrint = 0;
  while (i < schedule.length) {
    const now = Date.now();
    let chunk = "";
    while (i < schedule.length && schedule[i]!.at <= now) {
      chunk += schedule[i]!.text + "\r\n";
      i++;
    }
    if (chunk) appendFileSync(outFile, chunk);
    if (now - lastPrint > 5000) {
      lastPrint = now;
      process.stdout.write(`\r[recorder-sim] ${i}/${schedule.length} lines   `);
    }
    await sleep(100);
  }
  console.log(
    `\n[recorder-sim] all lines written; holding 30 s for the end split`,
  );
  await sleep(30_000);
  if (fake) {
    console.log("[recorder-sim] stopping fake Wow.exe (recording should stop)");
    cleanup();
    await sleep(15_000);
  }
  console.log(
    `[recorder-sim] done. Next: npm run recorder:sim -- verify --manifest "${manifestPath}"`,
  );
}

// ------------------------------------------------------------------ verify --

/** The managed OBS's own log that was still being written after the sim
 * started: <userData>/obs/<version>/config/obs-studio/logs/*.txt (portable
 * mode). The app usually launched OBS before `run`, so the file is picked by
 * last-write time (>= the sim start), not by creation time. */
function newestManagedObsLog(
  userData: string | null,
  sinceMs: number,
): string | null {
  if (!userData) return null;
  const obsRoot = join(userData, "obs");
  if (!existsSync(obsRoot)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const ver of readdirSync(obsRoot)) {
    const logs = join(obsRoot, ver, "config", "obs-studio", "logs");
    if (!existsSync(logs)) continue;
    for (const f of readdirSync(logs)) {
      if (!f.endsWith(".txt")) continue;
      const p = join(logs, f);
      const mtime = statSync(p).mtimeMs;
      if (mtime >= sinceMs && (!best || mtime > best.mtime))
        best = { path: p, mtime };
    }
  }
  return best?.path ?? null;
}

/** Real duration (s) of an mp4 from its own boxes: mvhd, or mvex/mehd for a
 * fragmented file whose mvhd says 0. null when neither is readable. */
function mp4DurationS(path: string): number | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(16);
    const readBox = (
      pos: number,
    ): { type: string; size: number; hdr: number } | null => {
      if (pos + 8 > size) return null;
      readSync(fd, head, 0, 16, pos);
      let sz = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      let hdr = 8;
      if (sz === 1) {
        sz = Number(head.readBigUInt64BE(8));
        hdr = 16;
      } else if (sz === 0) sz = size - pos;
      if (sz < hdr) return null;
      return { type, size: sz, hdr };
    };
    let pos = 0;
    while (pos < size) {
      const b = readBox(pos);
      if (!b) break;
      if (b.type === "moov") {
        const buf = Buffer.alloc(Math.min(b.size, 1 << 20));
        readSync(fd, buf, 0, buf.length, pos);
        let timescale = 0;
        let dur = 0;
        const walk = (start: number, end: number) => {
          let q = start;
          while (q + 8 <= end) {
            const sz = buf.readUInt32BE(q);
            const type = buf.toString("latin1", q + 4, q + 8);
            if (sz < 8) break;
            if (type === "mvhd") {
              const v = buf[q + 8];
              timescale =
                v === 1 ? buf.readUInt32BE(q + 28) : buf.readUInt32BE(q + 20);
              dur =
                v === 1
                  ? Number(buf.readBigUInt64BE(q + 32))
                  : buf.readUInt32BE(q + 24);
            } else if (type === "mvex") walk(q + 8, Math.min(q + sz, end));
            else if (type === "mehd" && dur === 0) {
              const v = buf[q + 8];
              dur =
                v === 1
                  ? Number(buf.readBigUInt64BE(q + 12))
                  : buf.readUInt32BE(q + 12);
            }
            q += sz;
          }
        };
        walk(b.hdr, Math.min(b.size, buf.length));
        return timescale > 0 && dur > 0 ? dur / timescale : null;
      }
      pos += b.size;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

interface Chunk {
  videoPath: string;
  startedAt: number;
  stoppedAt: number | null;
  matchIds: string[];
}

function cmdVerify(): void {
  const manifestPath =
    opt("manifest") ?? join(tmpdir(), "gladlog-recorder-sim", "manifest.json");
  if (!existsSync(manifestPath)) die(`manifest not found: ${manifestPath}`);
  const man = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const recDir = opt("recordings-dir") ?? man.recordingsDir;
  if (!recDir) die("pass --recordings-dir");
  const ndjson = join(recDir, "recordings.ndjson");
  if (!existsSync(ndjson))
    die(`no recordings.ndjson in ${recDir} -- nothing was recorded`);
  const all: Chunk[] = readFileSync(ndjson, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as Chunk;
      } catch {
        return null;
      }
    })
    .filter((c): c is Chunk => c !== null);
  const lastEnd = man.matches[man.matches.length - 1]!.endMs;
  const chunks = all
    .filter(
      (c) =>
        (c.stoppedAt ?? Infinity) >= man.createdAt - 5 * 60_000 &&
        c.startedAt <= lastEnd + 5 * 60_000,
    )
    .sort((a, b) => a.startedAt - b.startedAt);

  const t = (ms: number) => new Date(ms).toLocaleTimeString();
  const s = (ms: number) => (ms / 1000).toFixed(1);
  console.log(`recordings dir: ${recDir}`);
  console.log(`chunks in the sim window: ${chunks.length}\n`);
  console.log("CHUNKS");
  for (const c of chunks) {
    const exists = existsSync(c.videoPath);
    const bytes = exists ? statSync(c.videoPath).size : 0;
    const wall = c.stoppedAt === null ? null : c.stoppedAt - c.startedAt;
    const real = exists ? mp4DurationS(c.videoPath) : null;
    console.log(
      `  ${t(c.startedAt)} -> ${c.stoppedAt === null ? "(open)" : t(c.stoppedAt)}  ` +
        `wall=${wall === null ? "?" : s(wall) + "s"}  mp4=${real === null ? (exists ? "?(not finalized / fragmented)" : "?") : real.toFixed(1) + "s"}  ` +
        `${(bytes / 1e6).toFixed(1)}MB  matches=${c.matchIds.length}  ${exists ? "" : "!! FILE MISSING "}${basename(c.videoPath)}`,
    );
  }

  console.log("\nMATCHES");
  let fails = 0;
  const flagFail = (msg: string) => {
    fails++;
    return `FAIL ${msg}`;
  };
  for (const m of man.matches) {
    const overlapping = chunks.filter(
      (c) => c.startedAt <= m.endMs && (c.stoppedAt ?? Infinity) >= m.startMs,
    );
    const lines: string[] = [];
    // The match-OPEN split can only land AFTER the start (it fires when the
    // START line is read, and only while that read is <= OPEN_SPLIT_MAX_LAG_MS
    // late), so the first <= 3 s of the match sit at the end of the previous
    // chunk by design -- the Video tab shows them as "缺头 N 秒". That is the
    // open split working, not "a split happened mid-match".
    let covering = overlapping;
    const openSplitIntoMatch =
      overlapping.length > 1 &&
      overlapping[1]!.startedAt > m.startMs &&
      overlapping[1]!.startedAt - m.startMs <= OPEN_SPLIT_MAX_LAG_MS;
    if (openSplitIntoMatch) {
      covering = overlapping.slice(1);
      lines.push(
        `ok   open split landed ${s(covering[0]!.startedAt - m.startMs)} s after the start ` +
          `(first seconds stay in the previous chunk, by design <= ${OPEN_SPLIT_MAX_LAG_MS / 1000} s)`,
      );
    }
    if (covering.length === 0)
      lines.push(flagFail("no chunk overlaps this match"));
    else if (covering.length > 1)
      lines.push(
        flagFail(
          `split across ${covering.length} chunks (a split happened mid-match)`,
        ),
      );
    const c = covering[0];
    if (c) {
      // with the open split absorbed above, the head of the carrying chunk is
      // the split's own lag -- never "lobby", and not "opening missing" either
      const headS = openSplitIntoMatch ? 0 : (m.startMs - c.startedAt) / 1000;
      // the END is carried by the LAST covering chunk (differs from c when
      // the match was split mid-way, which is already its own FAIL above)
      const last = covering[covering.length - 1]!;
      const tailS =
        last.stoppedAt === null ? null : (last.stoppedAt - m.endMs) / 1000;
      if (headS < 0)
        lines.push(
          flagFail(
            `opening missing: chunk starts ${(-headS).toFixed(1)} s after the match`,
          ),
        );
      else if (headS > IDLE_SPLIT_S + 5)
        lines.push(
          flagFail(
            `lobby before match ${headS.toFixed(1)} s > ${IDLE_SPLIT_S} s bound`,
          ),
        );
      else
        lines.push(
          `ok   lobby before match ${headS.toFixed(1)} s` +
            (m.lagMs <= OPEN_SPLIT_MAX_LAG_MS
              ? headS > PRE_ROLL_S + 3
                ? "  (note: lag was within the open-split gate, a split near 0 s was expected)"
                : ""
              : "  (lag above gate: no open split expected)"),
        );
      if (tailS === null) lines.push(flagFail("chunk never closed"));
      else if (tailS < 0)
        lines.push(
          flagFail(
            `end missing: chunk stops ${(-tailS).toFixed(1)} s before match end`,
          ),
        );
      else lines.push(`ok   chunk ends ${tailS.toFixed(1)} s after match end`);
      if (covering.every((k) => k.matchIds.length === 0))
        lines.push(
          flagFail(
            "no covering chunk has matchIds -- not associated with the parsed match (Video tab will be empty)",
          ),
        );
      else if (c.matchIds.length === 0)
        lines.push(
          flagFail(
            "the match is associated with a chunk that does not carry its start (Video tab starts late)",
          ),
        );
      if (!existsSync(c.videoPath))
        lines.push(flagFail("video file missing on disk"));
      else {
        const real = mp4DurationS(c.videoPath);
        const wall =
          c.stoppedAt === null ? null : (c.stoppedAt - c.startedAt) / 1000;
        if (real !== null && wall !== null && Math.abs(real - wall) > 3)
          lines.push(
            flagFail(
              `mp4 is ${real.toFixed(1)} s but the index says ${wall.toFixed(1)} s`,
            ),
          );
      }
    }
    console.log(
      `  match ${m.index} ${m.bracket} ${t(m.startMs)}-${t(m.endMs)} lag=${m.lagMs}ms`,
    );
    for (const l of lines) console.log(`    ${l}`);
  }
  // Picture check (Windows field run 2026-11-12 22:05: a launch whose OBS never
  // got the capture source recorded 16 min of black video + audio, and every
  // timing check above still passed). The managed OBS log that was being
  // written during the sim must show the source being created and WoW hooked.
  console.log("\nPICTURE (managed OBS log)");
  const obsLog = newestManagedObsLog(man.userData, man.createdAt);
  if (!obsLog) {
    console.log("    ?    no managed OBS log written during the sim window");
  } else {
    const text = readFileSync(obsLog, "utf-8");
    const created = /added source 'gladlog-capture' \(game_capture\)/.test(text);
    const hooked =
      /\[game-capture: 'gladlog-capture'\][^\n]*capture successful/.test(text);
    console.log(`    log  ${obsLog}`);
    if (!created)
      console.log(
        `    ${flagFail("capture source 'gladlog-capture' was never created -- the video is black")}`,
      );
    else if (man.fakeWow)
      console.log("    ok   capture source created (fake WoW: nothing to hook, black is expected)");
    else if (!hooked)
      console.log(
        `    ${flagFail("capture source created but WoW was never hooked -- the video is black")}`,
      );
    else console.log("    ok   capture source created and WoW hooked");
  }

  const short = chunks.filter(
    (c) => c.stoppedAt !== null && c.stoppedAt - c.startedAt < 10_000,
  );
  console.log(
    `\nshort chunks (<10 s): ${short.length}` +
      (short.length
        ? "  <- candidates for the 'only a few seconds' symptom"
        : ""),
  );
  console.log(`\nRESULT: ${fails === 0 ? "PASS" : `${fails} FAIL`}`);
  if (fails) process.exitCode = 2;
}

// -------------------------------------------------------------------- main --

if (cmd === "run") void cmdRun();
else if (cmd === "verify") cmdVerify();
else
  die(
    "usage: recorderSim.ts run [--source <log|dir>] [--logs-dir <dir>] [--matches 2] " +
      "[--lead-s 90] [--gap-s 75] [--lag-ms 0,8000] [--max-match-s 420] [--allow-shuffle] " +
      "[--fake-wow] [--manifest <path>] [--user-data <dir>]\n" +
      "       recorderSim.ts verify [--manifest <path>] [--recordings-dir <dir>]",
  );
