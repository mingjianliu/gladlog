import { randomBytes } from "crypto";
import * as fs from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { Plugin } from "vite";

// evalHome.ts lives in packages/eval/src; from packages/desktop/dev/review that
// is three hops up then into eval/src. vite.config.mts is Node-side
// esbuild-bundled, so this cross-package relative TS import resolves fine.
import { resolveEvalHome } from "../../../eval/src/evalHome";

const NAME_RE = /^[A-Za-z0-9._-]+$/;

interface ReviewIo {
  readFile(p: string): string | null;
  writeFileAtomic(p: string, data: string): void;
  listDir(p: string): string[];
}

interface ReviewRequest {
  method: string;
  url: string;
  body: string;
}

interface ReviewResponse {
  status: number;
  body: string;
}

function json(status: number, value: unknown): ReviewResponse {
  return { status, body: JSON.stringify(value) };
}

function defaultMatchesDir(): string {
  return (
    process.env.GLADLOG_MATCH_DIR ||
    join(homedir(), "Library/Application Support/gladlog/matches")
  );
}

// Deliberately NOT `new URL(req.url, "http://localhost").pathname`: WHATWG URL
// parsing silently collapses ".." (and its %2e%2e encoding) dot-segments
// before we ever see them, which would turn a traversal attempt into an
// incidental 404 "not found" from routing miss rather than a deliberate 400
// from validation — fragile (depends on parser internals staying that way)
// and the wrong status code. Splitting the raw pathname ourselves keeps ".."
// visible to the explicit name check below.
function splitPath(url: string): string[] {
  const queryIdx = url.indexOf("?");
  const pathname = queryIdx === -1 ? url : url.slice(0, queryIdx);
  return pathname.split("/").filter(Boolean);
}

/** Pure routing logic for the /__review/* dev API — no filesystem access of
 *  its own beyond resolving the eval-home/matches-dir path roots, everything
 *  else goes through the injected io. This is what makes it unit-testable
 *  without a real server. evalHome is resolved lazily, and only inside the
 *  branches that actually need it (list/session/answers) — the match route
 *  only needs matchesDir, so it must keep working on machines with no eval
 *  home at all. */
export function handleReviewRequest(
  req: ReviewRequest,
  io: ReviewIo,
  paths?: { evalHome?: string; matchesDir?: string },
): ReviewResponse {
  const matchesDir = paths?.matchesDir ?? defaultMatchesDir();

  // Resolves evalHome on demand, once per branch that needs it — never
  // called at all by branches (match) that don't.
  function getEvalHome(): string | ReviewResponse {
    if (paths?.evalHome !== undefined) {
      return paths.evalHome;
    }
    try {
      return resolveEvalHome();
    } catch (err) {
      return json(500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const parts = splitPath(req.url); // ["__review", ...]

  if (parts[0] !== "__review") {
    return json(404, { error: "not found" });
  }

  const resource = parts[1];

  if (resource === "list" && req.method === "GET") {
    const evalHome = getEvalHome();
    if (typeof evalHome !== "string") {
      return evalHome;
    }
    const sessionsDir = join(evalHome, "review-sessions");
    const names = io
      .listDir(sessionsDir)
      .filter((f) => f.endsWith(".session.json"))
      .map((f) => f.slice(0, -".session.json".length));
    return json(200, { sessions: names });
  }

  const rawName = parts[2];
  if (
    resource === "session" ||
    resource === "match" ||
    resource === "answers"
  ) {
    if (rawName === undefined) {
      return json(400, { error: "missing name" });
    }
    let name: string;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      return json(400, { error: "invalid name" });
    }
    // NAME_RE alone admits "." and ".." (both made of allowed characters);
    // reject them explicitly before any join — `<matchesDir>/<name>/match.json`
    // with name===".." resolves one level ABOVE matchesDir.
    if (!NAME_RE.test(name) || name === "." || name === "..") {
      return json(400, { error: "invalid name" });
    }

    if (resource === "session" && req.method === "GET") {
      const evalHome = getEvalHome();
      if (typeof evalHome !== "string") {
        return evalHome;
      }
      const p = join(evalHome, "review-sessions", `${name}.session.json`);
      const content = io.readFile(p);
      if (content === null) {
        return json(404, { error: "session not found" });
      }
      return { status: 200, body: content };
    }

    if (resource === "match" && req.method === "GET") {
      const p = join(matchesDir, name, "match.json");
      const content = io.readFile(p);
      if (content === null) {
        return json(404, { error: "match not found" });
      }
      return { status: 200, body: content };
    }

    if (resource === "answers") {
      const evalHome = getEvalHome();
      if (typeof evalHome !== "string") {
        return evalHome;
      }
      const p = join(evalHome, "review-sessions", `${name}.answers.json`);
      if (req.method === "GET") {
        const content = io.readFile(p);
        if (content === null) {
          return json(200, { schemaVersion: 1, name, answers: [] });
        }
        return { status: 200, body: content };
      }
      if (req.method === "POST") {
        io.writeFileAtomic(p, req.body);
        return json(200, { ok: true });
      }
    }
  }

  return json(404, { error: "not found" });
}

function nodeIo(): ReviewIo {
  return {
    readFile(p: string): string | null {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFileAtomic(p: string, data: string): void {
      const dir = dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
      fs.writeFileSync(tmp, data, "utf8");
      fs.renameSync(tmp, p);
    },
    listDir(p: string): string[] {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  };
}

/** vite dev-server plugin: mounts /__review/* on the dev middleware stack.
 *  Dev-only by design — do NOT add configurePreviewServer; visual regression
 *  runs build+preview and must stay unaffected by review mode. */
export function reviewApiPlugin(opts?: {
  evalHome?: string;
  matchesDir?: string;
}): Plugin {
  return {
    name: "gladlog-review-api",
    configureServer(server) {
      const io = nodeIo();
      server.middlewares.use("/__review", (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          // resolveEvalHome() throws if the eval home doesn't exist; that
          // resolution happens lazily inside handleReviewRequest (per
          // request) so a missing eval home never crashes server startup —
          // only individual requests see a 500.
          const result = handleReviewRequest(
            {
              method: req.method || "GET",
              // server.middlewares.use("/__review", ...) strips the mount
              // prefix from req.url, so re-add it for handleReviewRequest's
              // own path parsing.
              url: `/__review${req.url}`,
              body,
            },
            io,
            opts,
          );
          res.statusCode = result.status;
          res.setHeader("content-type", "application/json");
          res.end(result.body);
        });
      });
    },
  };
}
