// 用法(repo 根): node_modules/.bin/tsx packages/desktop/scripts/make-report-fixture.mjs \
//   --log <combatlog.txt> --out packages/desktop/test/fixtures/report-match.json \
//   [--kind shuffle --round 0] [--keep-names]
// 读取真实日志 → GladLogParser → 取第一个 match(或 shuffle 第 N 回合)→ 剥 rawLines
// → 玩家名脱敏(--keep-names 跳过;仅用于 gitignored 的 dev/local 压测样本,
//    CN/特殊字符原名本身就是渲染边界测试对象)→ 写 JSON。
import { readFileSync, writeFileSync } from "fs";
import { GladLogParser } from "../../parser/src/index.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const logPath = arg("log");
const outPath = arg("out");
const kind = arg("kind") ?? "match";
const roundIdx = Number(arg("round") ?? 0);
if (!logPath || !outPath) {
  console.error(
    "usage: tsx make-report-fixture.mjs --log <combatlog.txt> --out <fixture.json> [--kind shuffle --round N] [--keep-names]",
  );
  process.exit(1);
}

const parser = new GladLogParser({ timezone: "UTC" });
let match = null;
parser.on(kind === "shuffle" ? "shuffle" : "match", (m) => {
  if (!match) match = m;
});
for (const line of readFileSync(logPath, "utf-8").split("\n"))
  parser.push(line);
parser.end();
if (!match) {
  console.error(`no ${kind} produced from log`);
  process.exit(1);
}

// shuffle:取指定回合(StoredShuffleRound 形状,与 matchStore 存盘一致)
const picked =
  kind === "shuffle"
    ? (() => {
        const r = match.rounds?.[roundIdx];
        if (!r) {
          console.error(`shuffle has no round ${roundIdx}`);
          process.exit(1);
        }
        return r;
      })()
    : match;

const { rawLines: _rawLines, ...data } = picked;
let text = JSON.stringify(data, null, 1);
if (!flag("keep-names")) {
  // 脱敏:每个 Player 单位的名字(Name-Realm)全局替换为 PlayerA-Test 等
  const players = Object.values(data.units).filter((u) => u.kind === "Player");
  players.forEach((u, i) => {
    const alias = `Player${String.fromCharCode(65 + i)}-Test`;
    text = text.split(JSON.stringify(u.name).slice(1, -1)).join(alias);
  });
  console.log(`${players.length} players sanitized`);
}
writeFileSync(outPath, text);
console.log(`wrote ${outPath}: ${text.length} bytes`);
