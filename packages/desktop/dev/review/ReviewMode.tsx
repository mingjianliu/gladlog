/**
 * `?review=<name>` entry point: fetches one saved review session (Task 5's
 * `buildReviewSession.ts` output) plus its match doc and any prior answers
 * from the dev-only `/__review/*` API (Task 7), and renders the blind-review
 * workbench — the real `MatchReport` on the left, `ReviewPanel` (Task 8) on
 * the right.
 *
 * Deliberately NOT a scene (`dev/scenes.ts`): a review session is an ad hoc
 * named artifact a human built for one experiment run, not a fixed baseline
 * screenshot state, so it must never enter the visual-regression suite.
 */
import { type JSX,useEffect, useState } from "react";

import type {
  ReviewAnswer,
  ReviewCard,
  ReviewSession,
} from "../../../eval/src/explore/reviewTypes";
import { MatchReport } from "../../src/renderer/src/report/components/MatchReport";
import type { StoredMatch } from "../../src/renderer/src/report/derive/types";
import { ReviewPanel } from "./ReviewPanel";

/** `/__review/match/<id>` payload — matchStore.ts's on-disk envelope
 * (`{ schemaVersion, storedAt, kind, data }`). For a `"match"` doc `data` IS
 * the round (already the `StoredMatch` shape `MatchReport` consumes); for a
 * `"shuffle"` doc `data.rounds[roundSeq]` picks one — `roundSeq` is an ARRAY
 * INDEX (default 0), the same semantic `storeAccess.ts`'s `loadLegacyRound`
 * documents server-side. Unlike that eval-side helper, this extraction stops
 * short of `toLegacyMatch`: the browser wants the untouched `StoredMatch`
 * `MatchReport`'s `source` prop expects (the same shape `dev/main.tsx`'s
 * `Harness` feeds it from `dev/local/full-match.json`), not eval's legacy
 * conversion. */
interface MatchDoc {
  schemaVersion: 1;
  storedAt: number;
  kind: "match" | "shuffle";
  data: StoredMatch | { rounds: StoredMatch[] };
}

/** `undefined` when a shuffle's `roundSeq` is out of range (a hand-edited or
 * stale `session.json`) — the caller must treat that the same as any other
 * fetch failure (surface the error banner), not render nothing forever. */
function extractRound(
  doc: MatchDoc,
  roundSeq: number | undefined,
): StoredMatch | undefined {
  if (doc.kind === "shuffle") {
    const rounds = (doc.data as { rounds: StoredMatch[] }).rounds;
    return rounds[roundSeq ?? 0];
  }
  return doc.data as StoredMatch;
}

export function ReviewMode({ name }: { name: string }): JSX.Element {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [answers, setAnswers] = useState<ReviewAnswer[] | null>(null);
  const [source, setSource] = useState<StoredMatch | null>(null);
  const [seek, setSeek] = useState<{
    tSeconds: number;
    unitNames: string[];
    nonce: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session → match doc: sequential (the match fetch needs session.matchId),
  // so both live in one effect chained via .then rather than two independent
  // effects racing on an unset dependency.
  useEffect(() => {
    let cancelled = false;
    fetch(`/__review/session/${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`session fetch failed: ${r.status}`);
        return r.json() as Promise<ReviewSession>;
      })
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        return fetch(`/__review/match/${encodeURIComponent(s.matchId)}`)
          .then((r) => {
            if (!r.ok) throw new Error(`match fetch failed: ${r.status}`);
            return r.json() as Promise<MatchDoc>;
          })
          .then((doc) => {
            if (cancelled) return;
            const round = extractRound(doc, s.roundSeq);
            if (!round) {
              throw new Error(
                `对局数据无效:round 越界(roundSeq=${s.roundSeq ?? 0})`,
              );
            }
            setSource(round);
          });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  // Answers: independent of the session/match fetch, only needs `name`.
  useEffect(() => {
    let cancelled = false;
    fetch(`/__review/answers/${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`answers fetch failed: ${r.status}`);
        return r.json() as Promise<{ answers: ReviewAnswer[] }>;
      })
      .then((doc) => {
        if (!cancelled) setAnswers(doc.answers ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  function handleSave(next: ReviewAnswer[]): void {
    fetch(`/__review/answers/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, name, answers: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`save failed: ${r.status}`);
        setError(null);
      })
      .catch((err) => {
        // Do not swallow: log for the console AND surface a banner — a
        // reviewer who silently loses an answer would poison the gold set.
        console.error("[ReviewMode] failed to save answers", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  function handleSeek(card: ReviewCard): void {
    setSeek({
      tSeconds: card.anchorT,
      unitNames: card.unitNames,
      nonce: Date.now(),
    });
  }

  return (
    <div className="review-mode">
      {error && (
        <div className="review-mode-error" role="alert">
          {error}
        </div>
      )}
      <div className="review-mode-body">
        <div className="review-mode-report">
          {source ? (
            <MatchReport
              source={source}
              matchId={session?.matchId}
              externalSeek={seek}
            />
          ) : (
            <div className="review-mode-loading">加载对局中…</div>
          )}
        </div>
        <div className="review-mode-panel">
          {session && answers ? (
            // key={session.name}: ReviewPanel reads session/answers only in
            // its own useState initializers (Task 8 contract) — remount on a
            // session change instead of relying on prop-driven re-render.
            <ReviewPanel
              key={session.name}
              session={session}
              answers={answers}
              onSave={handleSave}
              onSeek={handleSeek}
            />
          ) : (
            <div className="review-mode-loading">加载评审会话中…</div>
          )}
        </div>
      </div>
    </div>
  );
}
