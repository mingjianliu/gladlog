import type { ElementType, ReactNode } from "react";

/** Minimal Markdown renderer for the coach-chat bubbles (2026-09-30).

 * Before this existed the coach answer was rendered as plain text
 * (`{m.content}` in CoachChatCard), so whatever the model emitted — `**bold**`,
 * `## heading`, `| table |` — reached the user as literal characters.
 *
 * It emits React nodes rather than an HTML string, so there is no
 * `dangerouslySetInnerHTML` anywhere in the path: nothing can be injected and
 * no sanitizer dependency is needed. Raw HTML blocks and images are
 * deliberately unsupported.
 *
 * Supported subset (what a coaching answer actually uses): headings, bold,
 * italic, inline code, fenced code, ordered/unordered lists, tables,
 * blockquotes, horizontal rules.
 *
 * One deliberate design point: every plain-text leaf goes through `rich`
 * (inlineRich.makeRichText), so spell/spec names still render as SpellInline
 * icons — otherwise adding Markdown would have cost us the rich-text rendering
 * that the findings side already has.
 */

/** Leaf-text renderer, produced by inlineRich.makeRichText */
export type RichTextFn = (text: string) => ReactNode;

type Block =
  | { kind: "code"; code: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; body: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "p"; text: string };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Inline tokens, most specific first. Source kept as a string because the
 * regex carries state (lastIndex) and renderInline recurses mid-scan. */
const INLINE_SRC = [
  "(`+)([\\s\\S]*?)\\1", // `inline code`
  "\\*\\*([\\s\\S]+?)\\*\\*", // **bold**
  "\\*([^*\\n]+?)\\*", // *italic*
  "(?<![\\w])_([^_\\n]+?)_(?![\\w])", // _italic_ (not inside snake_case words)
  "\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)", // [label](url)
].join("|");

/** Nesting cap for inline recursion: pathological input cannot blow the stack */
const MAX_INLINE_DEPTH = 3;

/** Split one table row: `| a | b |` → ["a", "b"] */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** A table starts at a line containing `|` whose next line is the `|---|` rule */
function isTableStart(lines: string[], i: number): boolean {
  if (!lines[i]!.includes("|")) return false;
  const next = lines[i + 1];
  return next !== undefined && next.includes("|") && TABLE_SEP.test(next);
}

/** Line stream → block stream, preserving source order. Newlines inside a block
 * survive because the bubble itself sets white-space: pre-wrap. */
function parseBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (may be missing — harmless)
      blocks.push({ kind: "code", code: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2]!,
      });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]!);
      i += 2; // header row + separator row
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|"))
        rows.push(splitRow(lines[i++]!));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const body: string[] = [quote[1]!];
      i++;
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]!);
        if (!q) break;
        body.push(q[1]!);
        i++;
      }
      blocks.push({ kind: "quote", body: body.join("\n") });
      continue;
    }
    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = UL.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = OL.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: consume until the next blank line or the next block starter.
    const body: string[] = [line];
    i++;
    const startsBlock = (idx: number) =>
      HEADING.test(lines[idx]!) ||
      FENCE.test(lines[idx]!) ||
      UL.test(lines[idx]!) ||
      OL.test(lines[idx]!) ||
      QUOTE.test(lines[idx]!) ||
      isTableStart(lines, idx);
    while (i < lines.length && lines[i]!.trim() !== "" && !startsBlock(i))
      body.push(lines[i++]!);
    blocks.push({ kind: "p", text: body.join("\n") });
  }
  return blocks;
}

/** Only http(s) survives: a `javascript:` URL must never reach an href */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Inline body below the depth cap stops being parsed and falls through to rich */
function wrap(body: string, rich: RichTextFn, depth: number): ReactNode {
  return depth >= MAX_INLINE_DEPTH
    ? rich(body)
    : renderInline(body, rich, depth + 1);
}

/** Inline Markdown (`code`, **bold**, *italic*, _italic_, [link](url)) → nodes */
function renderInline(text: string, rich: RichTextFn, depth = 0): ReactNode[] {
  const re = new RegExp(INLINE_SRC, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(rich(text.slice(last, m.index)));
    last = m.index + m[0].length;
    if (m[2] !== undefined) {
      out.push(
        <code key={key++} className="coach-md-code">
          {m[2].trim()}
        </code>,
      );
    } else if (m[3] !== undefined) {
      out.push(<strong key={key++}>{wrap(m[3], rich, depth)}</strong>);
    } else if (m[4] !== undefined || m[5] !== undefined) {
      out.push(<em key={key++}>{wrap(m[4] ?? m[5]!, rich, depth)}</em>);
    } else {
      const href = safeHref(m[7] ?? "");
      out.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noreferrer">
            {rich(m[6] ?? "")}
          </a>
        ) : (
          rich(m[0])
        ),
      );
    }
  }
  if (last < text.length) out.push(rich(text.slice(last)));
  return out;
}

function renderBlock(b: Block, rich: RichTextFn, key: string): ReactNode {
  switch (b.kind) {
    case "code":
      return (
        <pre key={key} className="coach-md-pre">
          <code>{b.code}</code>
        </pre>
      );
    case "heading": {
      // h1/h2 have no business inside a chat bubble: start at h3.
      const Tag = `h${Math.min(b.level + 2, 6)}` as ElementType;
      return (
        <Tag key={key} className="coach-md-h">
          {rich(b.text)}
        </Tag>
      );
    }
    case "hr":
      return <hr key={key} className="coach-md-hr" />;
    case "ul":
      return (
        <ul key={key} className="coach-md-list">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it, rich)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="coach-md-list">
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it, rich)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote key={key} className="coach-md-quote">
          {renderBlocks(b.body, rich, key)}
        </blockquote>
      );
    case "table":
      return (
        <table key={key} className="coach-md-table">
          <thead>
            <tr>
              {b.head.map((c, j) => (
                <th key={j}>{rich(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, j) => (
              <tr key={j}>
                {row.map((c, k) => (
                  <td key={k}>{renderInline(c, rich)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return (
        <p key={key} className="coach-md-p">
          {renderInline(b.text, rich)}
        </p>
      );
  }
}

/** Block stream → nodes; blockquote bodies recurse through the same path */
function renderBlocks(
  src: string,
  rich: RichTextFn,
  keyBase: string,
): ReactNode[] {
  return parseBlocks(src).map((b, i) => renderBlock(b, rich, `${keyBase}-${i}`));
}

/** Render a short Markdown passage as React nodes.
 * Without `rich` it degrades to plain text — usable outside a report context,
 * just without the spell icons. */
export function renderMarkdown(text: string, rich?: RichTextFn): ReactNode {
  const render: RichTextFn = rich ?? ((t: string) => t);
  return <div className="coach-chat-md">{renderBlocks(text, render, "md")}</div>;
}
