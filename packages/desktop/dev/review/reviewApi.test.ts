import { describe, expect, it } from "vitest";

import { handleReviewRequest } from "./reviewApi";

function memIo(files: Record<string, string> = {}) {
  return {
    files,
    readFile: (p: string) => files[p] ?? null,
    writeFileAtomic: (p: string, d: string) => {
      files[p] = d;
    },
    listDir: (p: string) =>
      Object.keys(files)
        .filter((f) => f.startsWith(p))
        .map((f) => f.slice(p.length + 1)),
  };
}

// Fixed, fake path roots — never real filesystem paths. handleReviewRequest's
// io is fully in-memory (memIo above), so these strings only ever serve as
// key prefixes; nothing here touches disk. Passing them explicitly (rather
// than omitting the third `paths` arg) keeps these tests hermetic: without
// them, evalHome falls back to the real resolveEvalHome(), which reads
// $GLADLOG_EVAL_HOME / ~/code/gladlog-eval-private off the actual machine —
// present on this dev box but absent on fresh CI runners, so omitting it
// here would make the suite pass locally and fail red in CI.
const PATHS = { evalHome: "/fake-eval-home", matchesDir: "/fake-matches-dir" };

describe("handleReviewRequest", () => {
  it("answers roundtrip: POST then GET returns the same doc", () => {
    const io = memIo();
    const doc = JSON.stringify({ schemaVersion: 1, name: "exp1", answers: [] });
    expect(
      handleReviewRequest(
        { method: "POST", url: "/__review/answers/exp1", body: doc },
        io,
        PATHS,
      ).status,
    ).toBe(200);
    const got = handleReviewRequest(
      { method: "GET", url: "/__review/answers/exp1", body: "" },
      io,
      PATHS,
    );
    expect(JSON.parse(got.body)).toEqual(JSON.parse(doc));
  });
  it("missing session is 404", () => {
    expect(
      handleReviewRequest(
        { method: "GET", url: "/__review/session/nope", body: "" },
        memIo(),
        PATHS,
      ).status,
    ).toBe(404);
  });
  it("path traversal name is 400", () => {
    expect(
      handleReviewRequest(
        { method: "GET", url: "/__review/session/..%2Fx", body: "" },
        memIo(),
        PATHS,
      ).status,
    ).toBe(400);
  });
  it("literal .. as the match id is 400, not a directory escape", () => {
    const io = memIo({ "/fake-matches-dir/../secret.json": "leaked" });
    const res = handleReviewRequest(
      { method: "GET", url: "/__review/match/..", body: "" },
      io,
      PATHS,
    );
    expect(res.status).toBe(400);
  });
  it("match route works with no eval home available at all", () => {
    const io = memIo({
      "/fake-matches-dir/m1/match.json": JSON.stringify({ id: "m1" }),
    });
    // Deliberately omit evalHome from paths — the match route must not call
    // resolveEvalHome() at all, so this must succeed regardless of whether
    // this machine happens to have a gladlog-eval-private checkout.
    const res = handleReviewRequest(
      { method: "GET", url: "/__review/match/m1", body: "" },
      io,
      { matchesDir: "/fake-matches-dir" },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: "m1" });
  });
});
