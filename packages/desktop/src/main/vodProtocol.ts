import { protocol } from "electron";
import { createReadStream, statSync } from "fs";
import { extname } from "path";
import { Readable } from "stream";

import { parseRange, VOD_SCHEME,vodUrlToPath } from "../shared/vod";

/** Must be called before app ready (at the top level of index.ts). */
export function registerVodScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VOD_SCHEME,
      privileges: {
        standard: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
};

/** Called inside whenReady. isServable only admits files the recording index
 * knows about -- a privileged scheme must never become an arbitrary local file
 * read. */
export function handleVodProtocol(isServable: (path: string) => boolean): void {
  protocol.handle(VOD_SCHEME, (req) => {
    try {
      const path = vodUrlToPath(req.url);
      if (!path || !isServable(path))
        return new Response("forbidden", { status: 403 });
      const size = statSync(path).size;
      const range = parseRange(req.headers.get("range"), size);
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      const stream = Readable.toWeb(
        createReadStream(path, { start, end }),
      ) as ReadableStream;
      return new Response(stream, {
        status: range ? 206 : 200,
        headers: {
          "content-type": MIME[extname(path).toLowerCase()] ?? "video/mp4",
          "accept-ranges": "bytes",
          "content-length": String(end - start + 1),
          ...(range
            ? { "content-range": `bytes ${start}-${end}/${size}` }
            : {}),
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
