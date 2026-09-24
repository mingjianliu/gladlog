import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  OBS_VERSION,
  OBS_ZIP_BYTES,
  OBS_ZIP_SHA256,
  OBS_ZIP_URL,
  shouldExtract,
} from "../shared/obsAsset";

export interface ObsInstallProgress {
  phase: "downloading" | "verifying" | "extracting" | "done";
  loaded?: number;
  total?: number;
}

export interface ObsAssets {
  root: string; // <userData>/obs/32.2.1
  installed(): boolean;
  /** win32 only — throws "managed recording is Windows-only" elsewhere (复核 M12)。
   * Download (Range resume), verify SHA-256, selectively extract, write
   * .complete marker, DELETE the zip on success (saves 179MB; a reinstall
   * re-downloads — acceptable, it is a rare path). Concurrent calls coalesce. */
  ensureInstalled(onProgress: (p: ObsInstallProgress) => void): Promise<void>;
}

/** Peak disk usage during install: zip (~179MB) + full extracted tree
 * (~489MB) + final selective copy (~115MB) ≈ 783MB (design doc §5.1 review
 * M4). Precheck at a round 1GB before starting any I/O. */
const MIN_FREE_BYTES = 1_073_741_824;

interface CreateObsAssetsDeps {
  userDataDir: string;
  fetchImpl?: typeof fetch;
  /** injected for tests; default = spawnSync("tar", ["-xf", zip, "-C", dest])
   * with a 120s timeout. REASON it is injectable: ubuntu CI's GNU tar cannot
   * read zip (bsdtar on mac/win can) — unit tests stub this and assert the
   * args; the real path runs only on win32 (复核 B7)。 */
  extractImpl?: (zipPath: string, destDir: string) => void;
  /** injected for tests so the guard can be exercised on any host OS without
   * mocking process.platform globally; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** injected for tests: the shared constant OBS_ZIP_SHA256 is the real
   * pinned hash of the real 187MB release, which no test fixture can forge a
   * preimage for. Defaults to OBS_ZIP_SHA256 in production. */
  expectedSha256?: string;
  /** injected for tests to avoid depending on real host free space; defaults
   * to a statfs-based check of the obs directory's volume. */
  diskFreeBytesImpl?: (dir: string) => Promise<number>;
}

async function defaultDiskFreeBytes(dir: string): Promise<number> {
  const st = await statfs(dir);
  return st.bavail * st.bsize;
}

function defaultExtractImpl(zipPath: string, destDir: string): void {
  const result = spawnSync("tar", ["-xf", zipPath, "-C", destDir], {
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ??
      result.stderr?.toString() ??
      `tar exited with code ${String(result.status)}`;
    throw new Error(`OBS package extraction failed: ${detail}`);
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Walk the full extracted tree and move only shouldExtract-approved entries
 * into destRoot, preserving relative structure. Leaves the skipped ~374MB
 * behind in tempDir for the caller to discard. */
function moveApproved(tempDir: string, destRoot: string): void {
  const stack = [tempDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const rel = relative(tempDir, full);
      if (!shouldExtract(rel)) continue;
      const dest = join(destRoot, rel);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(full, dest);
    }
  }
}

export function createObsAssets(deps: CreateObsAssetsDeps): ObsAssets {
  const platform = deps.platform ?? process.platform;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const extractImpl = deps.extractImpl ?? defaultExtractImpl;
  const expectedSha256 = deps.expectedSha256 ?? OBS_ZIP_SHA256;
  const diskFreeBytesImpl = deps.diskFreeBytesImpl ?? defaultDiskFreeBytes;

  const obsDir = join(deps.userDataDir, "obs");
  const root = join(obsDir, OBS_VERSION);
  const downloadDir = join(obsDir, "download");
  const partPath = join(downloadDir, "obs.zip.part");
  const zipPath = join(downloadDir, "obs.zip");
  const tempExtractDir = join(obsDir, "extract-tmp");
  const completeMarker = join(root, ".complete");
  const exePath = join(root, "bin", "64bit", "obs64.exe");

  let pending: Promise<void> | null = null;
  let listeners: Array<(p: ObsInstallProgress) => void> = [];

  function installed(): boolean {
    return existsSync(completeMarker) && existsSync(exePath);
  }

  function broadcast(p: ObsInstallProgress): void {
    for (const l of listeners) l(p);
  }

  async function ensureDiskSpace(): Promise<void> {
    mkdirSync(obsDir, { recursive: true });
    const free = await diskFreeBytesImpl(obsDir);
    if (free < MIN_FREE_BYTES) {
      const haveMb = Math.floor(free / (1024 * 1024));
      throw new Error(
        `Not enough free disk space to install OBS (need at least 1GB, only ${haveMb}MB free); free up space and try again.`,
      );
    }
  }

  async function download(): Promise<void> {
    mkdirSync(downloadDir, { recursive: true });
    const resumeOffset = existsSync(partPath) ? statSync(partPath).size : 0;
    const headers: Record<string, string> =
      resumeOffset > 0 ? { Range: `bytes=${resumeOffset}-` } : {};
    broadcast({ phase: "downloading", loaded: resumeOffset, total: undefined });

    const res = await fetchImpl(OBS_ZIP_URL, { headers });
    if (!res.ok) {
      throw new Error(`Failed to download OBS package: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error("OBS download response had no body");
    }
    const resumed = res.status === 206;
    const startOffset = resumed ? resumeOffset : 0;
    const contentLengthHeader = res.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;
    const total =
      contentLength !== undefined ? startOffset + contentLength : OBS_ZIP_BYTES;

    await new Promise<void>((resolve, reject) => {
      const nodeStream = Readable.fromWeb(res.body as WebReadableStream);
      const ws = createWriteStream(partPath, { flags: resumed ? "a" : "w" });
      let loaded = startOffset;
      nodeStream.on("data", (chunk: Buffer) => {
        loaded += chunk.length;
        broadcast({ phase: "downloading", loaded, total });
      });
      nodeStream.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", resolve);
      nodeStream.pipe(ws);
    });

    renameSync(partPath, zipPath);
  }

  async function verify(): Promise<void> {
    broadcast({ phase: "verifying" });
    const actual = await sha256File(zipPath);
    if (actual !== expectedSha256) {
      unlinkSync(zipPath);
      throw new Error(
        `Downloaded OBS package failed SHA-256 verification (expected ${expectedSha256}, got ${actual}); corrupt file deleted, please retry.`,
      );
    }
  }

  function extractAndInstall(): void {
    broadcast({ phase: "extracting" });
    if (existsSync(tempExtractDir)) {
      rmSync(tempExtractDir, { recursive: true, force: true });
    }
    mkdirSync(tempExtractDir, { recursive: true });
    try {
      extractImpl(zipPath, tempExtractDir);
      mkdirSync(root, { recursive: true });
      moveApproved(tempExtractDir, root);
    } finally {
      // Runs on both success and failure — if extractImpl or moveApproved
      // throws (tar missing/timeout, disk full mid-extract, partial move),
      // the up-to-~489MB full tree must not strand on disk waiting for a
      // retry that may never come (review finding on task-1: the flat
      // sequence previously skipped this on any throw). The head-of-function
      // existsSync/rmSync above is a second guard for a crash between this
      // finally and process death.
      rmSync(tempExtractDir, { recursive: true, force: true });
    }

    writeFileSync(
      completeMarker,
      JSON.stringify({
        version: OBS_VERSION,
        completedAt: new Date().toISOString(),
      }),
    );
    unlinkSync(zipPath);
  }

  async function doInstall(): Promise<void> {
    await ensureDiskSpace();
    await download();
    await verify();
    extractAndInstall();
    broadcast({ phase: "done" });
  }

  return {
    root,
    installed,
    ensureInstalled(
      onProgress: (p: ObsInstallProgress) => void,
    ): Promise<void> {
      listeners.push(onProgress);
      if (platform !== "win32") {
        return Promise.reject(new Error("managed recording is Windows-only"));
      }
      if (!pending) {
        pending = doInstall().finally(() => {
          pending = null;
          listeners = [];
        });
      }
      return pending;
    },
  };
}
