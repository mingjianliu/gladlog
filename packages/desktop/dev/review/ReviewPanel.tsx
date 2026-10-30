/**
 * Blind-review card UI for the deep-dive-vs-baseline probe workbench.
 *
 * CRITICAL invariant (the whole experiment depends on it): while ANY card in
 * the session is unanswered, the rendered DOM must contain NO source
 * information (`ReviewCard.source`, "深挖"/"现有管线"/"deep"/"baseline") and
 * NO per-evidence verdict badges. Both leak only in the reveal view, shown
 * once every card has an answer. Don't "helpfully" add a source label to the
 * queue view — that's the bias this whole tool exists to keep out.
 */
import { fmtTime } from "@gladlog/analysis";
import { type JSX,useState } from "react";

import type {
  ReviewAnswer,
  ReviewCard,
  ReviewSession,
} from "../../../eval/src/explore/reviewTypes";
import { summarize } from "./summary";

type AnswerDim = "truth" | "awareness" | "actionable" | "adopt" | "impact";

/** Verbatim question wording + option labels — this is the gold-set schema,
 *  do not reword without updating the eval-side consumer of `ReviewAnswer`. */
const QUESTIONS: Array<{
  dim: AnswerDim;
  label: string;
  options: Array<[ReviewAnswer[AnswerDim], string]>;
}> = [
  {
    dim: "truth",
    label: "属实吗",
    options: [
      ["true", "属实"],
      ["partial", "有出入"],
      ["false", "不属实"],
      ["cant-tell", "看不出来"],
    ],
  },
  {
    dim: "awareness",
    label: "打的时候我意识到了吗",
    options: [
      ["knew", "知道"],
      ["vague", "模糊"],
      ["unaware", "完全没意识到"],
    ],
  },
  {
    dim: "actionable",
    label: "建议可执行吗",
    options: [
      ["concrete", "有具体动作"],
      ["generic", "太泛"],
      ["non-actionable", "不可操作"],
    ],
  },
  {
    dim: "adopt",
    label: "下一场会照做吗",
    options: [
      ["yes", "会"],
      ["maybe", "也许"],
      ["no", "不会"],
    ],
  },
  {
    dim: "impact",
    label: "对胜负影响",
    options: [
      ["high", "高"],
      ["med", "中"],
      ["low", "低"],
      ["none", "无关"],
    ],
  },
];

const DIMS: AnswerDim[] = QUESTIONS.map((q) => q.dim);

const SOURCE_LABEL: Record<ReviewCard["source"], string> = {
  deep: "深挖",
  baseline: "现有管线",
};

/** Chinese display label for an internal enum value of one dimension — used
 *  everywhere an answer value reaches the DOM post-reveal, so reviewers never
 *  see raw codes like "knew"/"concrete". */
function optionLabel(dim: AnswerDim, value: string): string {
  const q = QUESTIONS.find((qq) => qq.dim === dim);
  const found = q?.options.find(([v]) => v === value);
  return found ? found[1] : value;
}

type Draft = Partial<Pick<ReviewAnswer, AnswerDim>>;
type CompleteDraft = Required<Pick<ReviewAnswer, AnswerDim>>;

function draftFrom(answer: ReviewAnswer | undefined): Draft {
  if (!answer) return {};
  const { truth, awareness, actionable, adopt, impact } = answer;
  return { truth, awareness, actionable, adopt, impact };
}

function isComplete(draft: Draft): draft is CompleteDraft {
  return DIMS.every((dim) => draft[dim] !== undefined);
}

export function ReviewPanel(props: {
  session: ReviewSession;
  answers: ReviewAnswer[]; // 已有标注(启动读回)
  onSave(answers: ReviewAnswer[]): void; // 每答一题整体回写(POST)
  onSeek(card: ReviewCard): void; // → externalSeek
}): JSX.Element {
  const { session, onSave, onSeek } = props;
  const [index, setIndex] = useState(0);
  const [savedAnswers, setSavedAnswers] = useState<
    Record<string, ReviewAnswer>
  >(() => Object.fromEntries(props.answers.map((a) => [a.cardId, a])));
  const [draft, setDraft] = useState<Draft>(() =>
    draftFrom(savedAnswers[session.cards[0]?.cardId ?? ""]),
  );
  const [note, setNote] = useState<string>(
    () => savedAnswers[session.cards[0]?.cardId ?? ""]?.note ?? "",
  );

  const allAnswered = session.cards.every(
    (c) => savedAnswers[c.cardId] !== undefined,
  );

  if (allAnswered) {
    const orderedAnswers = session.cards
      .map((c) => savedAnswers[c.cardId])
      .filter((a): a is ReviewAnswer => a !== undefined);
    return <RevealView session={session} answers={orderedAnswers} />;
  }

  const card = session.cards[index];

  function goTo(newIndex: number): void {
    setIndex(newIndex);
    const target = session.cards[newIndex];
    setDraft(draftFrom(savedAnswers[target.cardId]));
    setNote(savedAnswers[target.cardId]?.note ?? "");
  }

  function handleNext(): void {
    if (!isComplete(draft)) return;
    const full: ReviewAnswer = {
      cardId: card.cardId,
      truth: draft.truth,
      awareness: draft.awareness,
      actionable: draft.actionable,
      adopt: draft.adopt,
      impact: draft.impact,
      note,
      answeredAt: Date.now(),
    };
    const nextSaved = { ...savedAnswers, [card.cardId]: full };
    setSavedAnswers(nextSaved);
    const orderedAnswers = session.cards
      .map((c) => nextSaved[c.cardId])
      .filter((a): a is ReviewAnswer => a !== undefined);
    onSave(orderedAnswers);
    if (index < session.cards.length - 1) {
      goTo(index + 1);
    }
  }

  return (
    <div className="review-panel">
      <div className="review-progress">
        {index + 1} / {session.cards.length}
      </div>
      <div className="review-claim">{card.claim}</div>
      <button
        type="button"
        className="review-anchor"
        onClick={() => onSeek(card)}
      >
        {fmtTime(card.anchorT)}
      </button>
      <ul className="review-evidence">
        {card.evidence.map((e, i) => (
          <li key={i}>{e.line}</li>
        ))}
      </ul>
      {QUESTIONS.map((q) => (
        <div className="review-question" key={q.dim}>
          <div className="review-question-label">{q.label}</div>
          <div className="review-options">
            {q.options.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  draft[q.dim] === value
                    ? "review-option review-option-selected"
                    : "review-option"
                }
                onClick={() => setDraft((d) => ({ ...d, [q.dim]: value }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <textarea
        className="review-note"
        placeholder="备注(可选)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="review-nav">
        <button
          type="button"
          className="review-prev"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
        >
          上一张
        </button>
        <button
          type="button"
          className="review-next"
          disabled={!isComplete(draft)}
          onClick={handleNext}
        >
          下一张
        </button>
      </div>
    </div>
  );
}

function RevealView(props: {
  session: ReviewSession;
  answers: ReviewAnswer[];
}): JSX.Element {
  const { session, answers } = props;
  const summary = summarize(session, answers);
  const answerByCardId = Object.fromEntries(answers.map((a) => [a.cardId, a]));

  return (
    <div className="review-panel review-reveal">
      <table className="review-summary-table">
        <thead>
          <tr>
            <th></th>
            <th>{SOURCE_LABEL.deep}</th>
            <th>{SOURCE_LABEL.baseline}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>总数</td>
            <td>{summary.bySource.deep.total}</td>
            <td>{summary.bySource.baseline.total}</td>
          </tr>
          <tr>
            <td>已答</td>
            <td>{summary.bySource.deep.answered}</td>
            <td>{summary.bySource.baseline.answered}</td>
          </tr>
          <tr>
            <td>验真新发现</td>
            <td>{summary.bySource.deep.novelValuable}</td>
            <td>{summary.bySource.baseline.novelValuable}</td>
          </tr>
        </tbody>
      </table>
      {/* 各维分布:五问各一张小表,deep vs baseline 按选项文案(非内部枚举码)分布 */}
      <div className="review-dims">
        {QUESTIONS.map((q) => (
          <table className="review-dims-table" key={q.dim}>
            <caption>{q.label}</caption>
            <thead>
              <tr>
                <th></th>
                <th>{SOURCE_LABEL.deep}</th>
                <th>{SOURCE_LABEL.baseline}</th>
              </tr>
            </thead>
            <tbody>
              {q.options.map(([value, label]) => (
                <tr key={value}>
                  <td>{label}</td>
                  <td data-testid={`review-dim-${q.dim}-${value}-deep`}>
                    {summary.bySource.deep.dims[q.dim]?.[value] ?? 0}
                  </td>
                  <td data-testid={`review-dim-${q.dim}-${value}-baseline`}>
                    {summary.bySource.baseline.dims[q.dim]?.[value] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <ul className="review-reveal-list">
        {session.cards.map((c) => {
          const a = answerByCardId[c.cardId];
          return (
            <li key={c.cardId} className="review-reveal-card">
              <span className={`review-source-badge review-source-${c.source}`}>
                {SOURCE_LABEL[c.source]}
              </span>
              <span className="review-claim">{c.claim}</span>
              <ul className="review-evidence">
                {c.evidence.map((e, i) => (
                  <li key={i}>
                    {e.line}{" "}
                    <span
                      className={`review-verdict review-verdict-${e.verdict}`}
                    >
                      {e.verdict}
                    </span>
                  </li>
                ))}
              </ul>
              {a && (
                <div className="review-reveal-answer">
                  {QUESTIONS.map((q) => (
                    <span key={q.dim} className="review-reveal-dim">
                      {q.label}: {optionLabel(q.dim, a[q.dim])}
                    </span>
                  ))}
                  {a.note && <div className="review-reveal-note">{a.note}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
