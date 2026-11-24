/**
 * GH #228: acceptanceCapture reads archived logs line by line off the Buffer
 * instead of one whole-file string (V8's string limit is 536,870,888 chars;
 * one wide 12.1.x log decompresses to 569,766,147 bytes). These pin that the
 * new walk is the old `text.split("\n")` exactly, and that the raw-streams
 * file pass built line by line is the one built from the text.
 */
import {
  parseRawStreamsAbsolute,
  rawStreamsAbsoluteCollector,
} from "@gladlog/analysis/src/utils/rawStreams";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { gzipSync } from "zlib";

import { roundRawStreams } from "../src/corpus/appCandidates";
import { forEachLogLine, readLogBytes } from "../src/corpus/logLines";

const GUID = "Player-57-0E0CB0B6";
const castSuccess = (ts: string, mana: number) =>
  `7/19/2026 ${ts}-4  SPELL_CAST_SUCCESS,${GUID},"Minilay-Illidan-US",0x511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,${GUID},0000000000000000,612340,612340,3012,2896,2605,2385,0,0,0,${mana},20000,0,1278.80,1721.48,0,4.8195,298`;
const castFailed = (ts: string, reason: string) =>
  `7/19/2026 ${ts}-4  SPELL_CAST_FAILED,${GUID},"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,"${reason}"`;
const BASE_MS = Date.UTC(2026, 6, 19, 8, 10, 46, 833);

function linesOf(buf: Buffer): string[] {
  const out: string[] = [];
  forEachLogLine(buf, (l) => out.push(l));
  return out;
}

const LOG = [
  castFailed("04:10:47.150", "尚未恢复"),
  castSuccess("04:10:47.267", 10000),
  "not a combat log line — 中文 and ü",
  castFailed("04:10:47.612", "法力值不足") + "\r",
  castSuccess("04:10:47.900", 8000) + "\r",
].join("\n");

describe("forEachLogLine (GH #228)", () => {
  it.each([
    ["empty", ""],
    ["one line, no newline", "abc"],
    ["closing newline", "a\nb\n"],
    ["only newlines", "\n\n"],
    ["CRLF + multi-byte", "﻿ä\r\n中文\r\n😀"],
    ["a log", LOG],
  ])("%s: same lines as toString().split", (_name, text) => {
    const buf = Buffer.from(text, "utf8");
    expect(linesOf(buf)).toEqual(buf.toString("utf8").split("\n"));
  });

  it("invalid UTF-8 cut by a newline decodes the same way", () => {
    const buf = Buffer.from([0x61, 0xe4, 0xb8, 0x0a, 0xad, 0x62, 0xff]);
    expect(linesOf(buf)).toEqual(buf.toString("utf8").split("\n"));
  });
});

describe("readLogBytes (GH #228)", () => {
  it("gunzips .gz, reads anything else as is", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-loglines-"));
    writeFileSync(join(dir, "a.txt.gz"), gzipSync(Buffer.from(LOG)));
    writeFileSync(join(dir, "b.txt"), LOG);
    expect(readLogBytes(join(dir, "a.txt.gz")).toString("utf8")).toBe(LOG);
    expect(readLogBytes(join(dir, "b.txt")).toString("utf8")).toBe(LOG);
    expect(() => readLogBytes(join(dir, "missing.gz"))).toThrow();
  });
});

describe("rawStreamsAbsoluteCollector (GH #228)", () => {
  it.each([
    ["empty", ""],
    ["one newline", "\n"],
    ["a log", LOG],
    ["a log with closing newline", LOG + "\n"],
  ])("%s: same pass as parseRawStreamsAbsolute(text)", (_name, text) => {
    const c = rawStreamsAbsoluteCollector();
    forEachLogLine(Buffer.from(text, "utf8"), (l) => c.push(l));
    expect(c.result()).toEqual(parseRawStreamsAbsolute(text));
  });

  it("the log's pass carries its samples (not vacuous)", () => {
    const c = rawStreamsAbsoluteCollector();
    forEachLogLine(Buffer.from(LOG), (l) => c.push(l));
    const r = c.result();
    expect(r.available).toBe(true);
    expect(r.mana).toHaveLength(2);
    expect(r.failed.map((f) => f.reason)).toEqual(["尚未恢复", "法力值不足"]);
  });

  it("roundRawStreams: the pre-made pass gives the round the text gives", () => {
    const combat = { startTime: BASE_MS, endTime: BASE_MS + 30_000 } as never;
    const fromText = roundRawStreams(combat, LOG);
    const c = rawStreamsAbsoluteCollector();
    forEachLogLine(Buffer.from(LOG), (l) => c.push(l));
    const fromPass = roundRawStreams(combat, c.result());
    expect(fromPass).toEqual(fromText);
    expect(fromPass!.castFailed).toHaveLength(2);
  });
});
