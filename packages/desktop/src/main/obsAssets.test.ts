import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createObsAssets } from "./obsAssets";

/** Fake payload standing in for the real 187MB OBS zip — extractImpl is
 * stubbed in every test (real tar can't read this), so the bytes never need
 * to look like a real zip. Only its SHA-256 matters, and that is computed
 * locally and injected via expectedSha256 (the real OBS_ZIP_SHA256 is a
 * pinned hash of the real release; no test fixture can forge a preimage for
 * it). */
const ZIP_CONTENT = Buffer.from("fake-obs-zip-payload-".repeat(200));
const ZIP_SHA256 = createHash("sha256").update(ZIP_CONTENT).digest("hex");

interface FixtureServer {
  server: Server;
  port: number;
  requests: IncomingHttpHeaders[];
  close(): Promise<void>;
}

function startFixtureServer(content: Buffer): Promise<FixtureServer> {
  const requests: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    requests.push(req.headers);
    const range = req.headers.range;
    const m = typeof range === "string" ? /^bytes=(\d+)-$/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const slice = content.subarray(start);
      res.writeHead(206, {
        "content-length": String(slice.length),
        "content-range": `bytes ${start}-${content.length - 1}/${content.length}`,
      });
      res.end(slice);
    } else {
      res.writeHead(200, { "content-length": String(content.length) });
      res.end(content);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Points fetchImpl at the local fixture server regardless of the URL the
 * implementation under test passes in (always OBS_ZIP_URL) — this is the
 * "never the real network" seam: only the request path is redirected, the
 * real global fetch still does the actual I/O against localhost. */
function fetchImplFor(port: number): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${port}/obs.zip`, init)) as typeof fetch;
}

/** Stub extractImpl: records the (zipPath, destDir) args it was called with
 * and writes a fake tree into destDir containing a mix of shouldExtract-
 * approved and skipped entries, so the selective-move logic downstream is
 * still exercised for real. */
function makeExtractStub() {
  const calls: Array<{ zipPath: string; destDir: string }> = [];
  const impl = (zipPath: string, destDir: string) => {
    calls.push({ zipPath, destDir });
    mkdirSync(join(destDir, "bin", "64bit"), { recursive: true });
    writeFileSync(join(destDir, "bin", "64bit", "obs64.exe"), "exe");
    writeFileSync(join(destDir, "bin", "64bit", "obs64.pdb"), "pdb");
    mkdirSync(join(destDir, "obs-plugins", "64bit"), { recursive: true });
    writeFileSync(
      join(destDir, "obs-plugins", "64bit", "win-capture.dll"),
      "dll",
    );
    writeFileSync(join(destDir, "obs-plugins", "64bit", "libcef.dll"), "cef");
    mkdirSync(join(destDir, "data", "obs-studio", "locale"), {
      recursive: true,
    });
    writeFileSync(
      join(destDir, "data", "obs-studio", "locale", "zh-CN.ini"),
      "zh",
    );
    writeFileSync(
      join(destDir, "data", "obs-studio", "locale", "fr-FR.ini"),
      "fr",
    );
  };
  return { impl, calls };
}

describe("obsAssets", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), "gladlog-obs-test-"));
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("fresh download → SHA verify → selective extract → .complete written → zip deleted", async () => {
    const fixture = await startFixtureServer(ZIP_CONTENT);
    try {
      const extract = makeExtractStub();
      const assets = createObsAssets({
        userDataDir,
        platform: "win32",
        fetchImpl: fetchImplFor(fixture.port),
        extractImpl: extract.impl,
        expectedSha256: ZIP_SHA256,
      });
      const phases: string[] = [];
      await assets.ensureInstalled((p) => phases.push(p.phase));

      expect(extract.calls).toHaveLength(1);
      expect(extract.calls[0].destDir).not.toBe(assets.root);

      expect(existsSync(join(assets.root, "bin", "64bit", "obs64.exe"))).toBe(
        true,
      );
      expect(existsSync(join(assets.root, "bin", "64bit", "obs64.pdb"))).toBe(
        false,
      );
      expect(
        existsSync(
          join(assets.root, "obs-plugins", "64bit", "win-capture.dll"),
        ),
      ).toBe(true);
      expect(
        existsSync(join(assets.root, "obs-plugins", "64bit", "libcef.dll")),
      ).toBe(false);
      expect(
        existsSync(
          join(assets.root, "data", "obs-studio", "locale", "zh-CN.ini"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(assets.root, "data", "obs-studio", "locale", "fr-FR.ini"),
        ),
      ).toBe(false);

      expect(existsSync(join(assets.root, ".complete"))).toBe(true);
      expect(existsSync(join(userDataDir, "obs", "download", "obs.zip"))).toBe(
        false,
      );
      expect(assets.installed()).toBe(true);
      expect(phases).toContain("downloading");
      expect(phases).toContain("verifying");
      expect(phases).toContain("extracting");
      expect(phases[phases.length - 1]).toBe("done");
    } finally {
      await fixture.close();
    }
  });

  it("SHA-256 mismatch throws a readable error and deletes the corrupt file", async () => {
    const fixture = await startFixtureServer(ZIP_CONTENT);
    try {
      const extract = makeExtractStub();
      const assets = createObsAssets({
        userDataDir,
        platform: "win32",
        fetchImpl: fetchImplFor(fixture.port),
        extractImpl: extract.impl,
        expectedSha256: "0".repeat(64),
      });
      await expect(assets.ensureInstalled(() => {})).rejects.toThrow(
        /sha-256|verification/i,
      );
      expect(existsSync(join(userDataDir, "obs", "download", "obs.zip"))).toBe(
        false,
      );
      expect(assets.installed()).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("cleans up the temp extract dir when extractImpl throws mid-extract", async () => {
    const fixture = await startFixtureServer(ZIP_CONTENT);
    try {
      const tempExtractDir = join(userDataDir, "obs", "extract-tmp");
      const throwingExtract = (_zipPath: string, destDir: string) => {
        // Simulate a partially-populated temp tree before the failure (tar
        // timeout / disk full mid-extract) so the assertion actually
        // exercises "directory existed and had content, then got removed" —
        // not just "was never created".
        mkdirSync(join(destDir, "bin", "64bit"), { recursive: true });
        writeFileSync(join(destDir, "bin", "64bit", "obs64.exe"), "partial");
        throw new Error("simulated tar failure");
      };
      const assets = createObsAssets({
        userDataDir,
        platform: "win32",
        fetchImpl: fetchImplFor(fixture.port),
        extractImpl: throwingExtract,
        expectedSha256: ZIP_SHA256,
      });

      await expect(assets.ensureInstalled(() => {})).rejects.toThrow(
        /simulated tar failure/,
      );

      expect(existsSync(tempExtractDir)).toBe(false);
      expect(assets.installed()).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("resumes a partial download with a Range header", async () => {
    const fixture = await startFixtureServer(ZIP_CONTENT);
    try {
      const downloadDir = join(userDataDir, "obs", "download");
      mkdirSync(downloadDir, { recursive: true });
      const resumeOffset = 37;
      writeFileSync(
        join(downloadDir, "obs.zip.part"),
        ZIP_CONTENT.subarray(0, resumeOffset),
      );

      const extract = makeExtractStub();
      const assets = createObsAssets({
        userDataDir,
        platform: "win32",
        fetchImpl: fetchImplFor(fixture.port),
        extractImpl: extract.impl,
        expectedSha256: ZIP_SHA256,
      });
      await assets.ensureInstalled(() => {});

      expect(fixture.requests).toHaveLength(1);
      expect(fixture.requests[0].range).toBe(`bytes=${resumeOffset}-`);
      expect(assets.installed()).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("coalesces concurrent ensureInstalled calls into a single download", async () => {
    const fixture = await startFixtureServer(ZIP_CONTENT);
    try {
      const extract = makeExtractStub();
      const fetchSpy = vi.fn(fetchImplFor(fixture.port));
      const assets = createObsAssets({
        userDataDir,
        platform: "win32",
        fetchImpl: fetchSpy as unknown as typeof fetch,
        extractImpl: extract.impl,
        expectedSha256: ZIP_SHA256,
      });

      const p1 = assets.ensureInstalled(() => {});
      const p2 = assets.ensureInstalled(() => {});
      await Promise.all([p1, p2]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(extract.calls).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("installed() requires BOTH the .complete marker and the exe", () => {
    const assets = createObsAssets({ userDataDir, platform: "win32" });
    expect(assets.installed()).toBe(false);

    mkdirSync(join(assets.root, "bin", "64bit"), { recursive: true });
    writeFileSync(join(assets.root, "bin", "64bit", "obs64.exe"), "exe");
    expect(assets.installed()).toBe(false); // marker still missing

    writeFileSync(join(assets.root, ".complete"), "{}");
    expect(assets.installed()).toBe(true);
  });

  it("rejects with a Windows-only error on non-win32 platforms (platform injected)", async () => {
    const assets = createObsAssets({ userDataDir, platform: "darwin" });
    await expect(assets.ensureInstalled(() => {})).rejects.toThrow(
      /windows-only/i,
    );
  });
});
