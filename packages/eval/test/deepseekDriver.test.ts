import { describe, expect,it } from "vitest";

import {
  buildJudgeMessages,
  buildResponderMessages,
  parseScoreObject,
  RESPONDER_SYSTEM_PROMPT,
} from "../src/family/deepseekDriver";

describe("buildResponderMessages", () => {
  it("carries the coaching prompt through unmodified as the user turn", () => {
    const prompt = "=== MATCH TIMELINE ===\nfoo bar baz";
    const messages = buildResponderMessages(prompt);
    const user = messages.find((m) => m.role === "user");
    expect(user?.content).toBe(prompt);
  });

  it("prepends a system message with the coach persona + English instruction", () => {
    const messages = buildResponderMessages("prompt text");
    expect(messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining("World of Warcraft arena coach"),
    });
    // Must match the S-arm corpus's language (English) so the D-arm
    // response's language doesn't out its family to the blind judge.
    expect(messages[0].content).toContain("Respond in English.");
    expect(messages[0].content).not.toContain("Simplified Chinese");
  });

  it("returns exactly system + user, in that order", () => {
    const messages = buildResponderMessages("x");
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  // Drift guard (fix round 2): RESPONDER_SYSTEM_PROMPT is a literal copy of
  // production's buildCoachSystemPrompt("en") (see the comment above that
  // export in deepseekDriver.ts for why it's a copy, not an import). A copy
  // with no test tying it back to the source is exactly the kind of
  // duplicated-fact rot CLAUDE.md's shared-predicate rule warns about --
  // this pins the two together with exact equality (not toContain) so a
  // future product wording change fails loudly here instead of silently
  // drifting. Dynamic import mirrors the one existing precedent for
  // borrowing from desktop/src/main/ai.ts from inside packages/eval:
  // packages/eval/scripts/modelFormatAudit.ts:148-151.
  it('matches production\'s buildCoachSystemPrompt("en") exactly', async () => {
    const { buildCoachSystemPrompt } =
      (await import("../../desktop/src/main/ai")) as typeof import("../../desktop/src/main/ai");
    expect(RESPONDER_SYSTEM_PROMPT).toBe(buildCoachSystemPrompt("en"));
  });
});

describe("buildJudgeMessages", () => {
  const rubric = "Score accuracy 1-5 and sufficiency 1-5.";
  const prompt = "=== MATCH TIMELINE ===\nsome events here";
  const response = "Coach reply text goes here.";

  it("embeds rubric, prompt, and response into a single message", () => {
    const messages = buildJudgeMessages(rubric, prompt, response);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain(rubric);
    expect(messages[0].content).toContain(prompt);
    expect(messages[0].content).toContain(response);
  });

  it("instructs the judge to output only JSON", () => {
    const messages = buildJudgeMessages(rubric, prompt, response);
    expect(messages[0].content).toMatch(/only.*json|json.*only/i);
  });

  it("never mentions which model produced the response (blind judging)", () => {
    const messages = buildJudgeMessages(rubric, prompt, response);
    const content = messages[0].content.toLowerCase();
    expect(content).not.toContain("deepseek");
    expect(content).not.toContain("sonnet");
    expect(content).not.toContain("claude");
  });
});

describe("parseScoreObject", () => {
  it("parses clean JSON", () => {
    const raw = '{"accuracy":4,"sufficiency":5}';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 4, sufficiency: 5 });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const raw = '```json\n{"accuracy":3,"notes":"ok"}\n```';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 3, notes: "ok" });
  });

  it("parses JSON wrapped in a plain ``` fence (no language tag)", () => {
    const raw = '```\n{"accuracy":2}\n```';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 2 });
  });

  it("parses JSON preceded by leading prose", () => {
    const raw = 'Here is my evaluation:\n{"accuracy":5,"sufficiency":4}';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 5, sufficiency: 4 });
  });

  it("parses JSON followed by trailing noise", () => {
    const raw = '{"accuracy":1,"sufficiency":2}\nHope that helps!';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 1, sufficiency: 2 });
  });

  it("parses JSON with both leading prose and a fence", () => {
    const raw =
      'Sure, here you go:\n```json\n{"accuracy":4}\n```\nLet me know if you need more.';
    expect(parseScoreObject(raw)).toEqual({ accuracy: 4 });
  });

  it("returns null for invalid JSON with no recoverable candidate", () => {
    expect(parseScoreObject("not json at all, sorry")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(parseScoreObject('{"accuracy":4,"sufficiency":')).toBeNull();
  });

  it("returns null for a top-level array (contract violation: object expected)", () => {
    expect(parseScoreObject("[1,2,3]")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseScoreObject("")).toBeNull();
  });

  it("returns null for a bare primitive", () => {
    expect(parseScoreObject("42")).toBeNull();
  });

  // Known limitation (pinned, not silent): brace-slicing takes the FIRST
  // "{" to the LAST "}" in the payload. A well-formed leading object
  // followed by trailing prose that itself contains an unrelated brace pair
  // makes the slice span both -- the result is not valid JSON as one
  // object, so this returns null instead of recovering the valid leading
  // object. Same class of limitation the array version
  // (parseModelJsonArray) accepts for the same reason: cheap and correct
  // for the overwhelmingly common "one JSON blob plus surrounding text"
  // case, at the cost of this narrower one. If judge output starts coming
  // back malformed in a way that traces to this, that's the first place to
  // look.
  it("known limitation: an unrelated brace pair in trailing prose defeats brace-slicing", () => {
    const raw = '{"accuracy":4} note: legacy config used {oldFormat} here';
    expect(parseScoreObject(raw)).toBeNull();
  });
});
