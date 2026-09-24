import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  ARRAY_PAGE_SIZE,
  childrenOf,
  isContainer,
  type JsonChild,
} from "./jsonNode";

/**
 * Lazily expanding JSON tree. **Only expanded nodes reach the DOM** — see
 * the notes in jsonNode.ts; that is this component's sole reason to exist
 * (the old implementation stringified the whole doc into a <pre> and froze
 * the renderer process).
 */
interface JsonTreeProps {
  root: unknown;
  /** Currently selected (the target of the right pane's copy-node action) */
  selectedPath: string;
  onSelect(path: string, value: unknown): void;
  /** Paths hit by the search: highlighted */
  hits?: readonly string[];
  /**
   * Paths the outside asks to expand to (the ancestor chain of a search
   * hit); merged into the expanded set whenever it changes
   */
  autoExpand?: readonly string[];
}

export function JsonTree({
  root,
  selectedPath,
  onSelect,
  hits,
  autoExpand,
}: JsonTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(
    () => new Map<string, number>(),
  );

  // Switched match: reset all collapse state and page numbers, otherwise
  // the previous match's paths stay attached to the new document.
  //
  // Done during render (React's "adjust state when a prop changes" pattern),
  // NOT in a useEffect([root]): that effect also ran on mount as a passive
  // effect, and a click landing between the mount commit and the passive
  // flush was silently undone — React flushes pending passive effects before
  // rendering the click's update, so the hook queue read [toggle → {path},
  // reset → {}] and the node stayed collapsed. That was the GH #26 flaky
  // ledger's devpanel record (CI snapshot: aria-expanded="false" after the
  // click); pinned by test/devpanel.jsonTree.race.test.tsx.
  const [prevRoot, setPrevRoot] = useState<unknown>(root);
  if (prevRoot !== root) {
    setPrevRoot(root);
    setExpanded(new Set<string>());
    setPages(new Map<string, number>());
  }

  useEffect(() => {
    if (!autoExpand || autoExpand.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of autoExpand) next.add(p);
      return next;
    });
  }, [autoExpand]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const setPage = useCallback((path: string, page: number) => {
    setPages((prev) => new Map(prev).set(path, page));
  }, []);

  const hitSet = useMemo(() => new Set(hits ?? []), [hits]);

  return (
    <div className="dev-json-tree" data-testid="dev-json-tree">
      <Rows
        value={root}
        basePath=""
        depth={0}
        expanded={expanded}
        toggle={toggle}
        pages={pages}
        setPage={setPage}
        hits={hitSet}
        selectedPath={selectedPath}
        onSelect={onSelect}
      />
    </div>
  );
}

interface RowsProps {
  value: unknown;
  basePath: string;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle(path: string): void;
  pages: ReadonlyMap<string, number>;
  setPage(path: string, page: number): void;
  hits: ReadonlySet<string>;
  selectedPath: string;
  onSelect(path: string, value: unknown): void;
}

function Rows(props: RowsProps) {
  const { value, basePath, depth, expanded, pages } = props;
  const page = childrenOf(value, basePath, pages.get(basePath) ?? 0);

  return (
    <>
      {page.pages > 1 && (
        <PageBar
          depth={depth}
          total={page.total}
          page={page.page}
          pages={page.pages}
          onGo={(p) => props.setPage(basePath, p)}
        />
      )}
      {page.children.map((c) => (
        <Fragment key={c.path}>
          <Row {...props} child={c} />
          {expanded.has(c.path) && isContainer(c.kind) && (
            <Rows
              {...props}
              value={c.value}
              basePath={c.path}
              depth={depth + 1}
            />
          )}
        </Fragment>
      ))}
    </>
  );
}

function Row({
  child,
  depth,
  expanded,
  toggle,
  hits,
  selectedPath,
  onSelect,
}: RowsProps & { child: JsonChild }) {
  const container = isContainer(child.kind);
  const open = expanded.has(child.path);
  const cls = [
    "dev-node",
    `k-${child.kind}`,
    selectedPath === child.path ? "sel" : "",
    hits.has(child.path) ? "hit" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Expand and select are two sibling <button>s, not "a button nested
  // inside a div onClick" — the latter is not keyboard operable, and
  // nested buttons are invalid HTML (axe flags it red in dev scenarios).
  return (
    <div
      className={cls}
      data-node-path={child.path}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      {container ? (
        <button
          type="button"
          className="dev-node-toggle"
          aria-expanded={open}
          aria-label={`${open ? "折叠" : "展开"} ${child.path}`}
          onClick={() => toggle(child.path)}
        >
          {open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="dev-node-toggle ph" aria-hidden="true" />
      )}
      <button
        type="button"
        className="dev-node-key"
        onClick={() => onSelect(child.path, child.value)}
      >
        {child.key}
      </button>
      {child.summary !== null ? (
        <span className="dev-node-sum">{child.summary}</span>
      ) : (
        <span className="dev-node-val">{child.preview}</span>
      )}
    </div>
  );
}

function PageBar({
  depth,
  total,
  page,
  pages,
  onGo,
}: {
  depth: number;
  total: number;
  page: number;
  pages: number;
  onGo(p: number): void;
}) {
  const from = page * ARRAY_PAGE_SIZE;
  const to = Math.min(total, from + ARRAY_PAGE_SIZE);
  return (
    <div
      className="dev-node-pager"
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      data-testid="dev-node-pager"
    >
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onGo(page - 1)}
      >
        ‹
      </button>
      <span>
        {from}–{to - 1} / {total}
      </span>
      <button
        type="button"
        disabled={page >= pages - 1}
        onClick={() => onGo(page + 1)}
      >
        ›
      </button>
    </div>
  );
}
