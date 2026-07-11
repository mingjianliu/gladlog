// 用法(repo 根): node_modules/.bin/tsx packages/desktop/scripts/make-report-fixture.mjs \
//   --log <combatlog.txt> --out packages/desktop/test/fixtures/report-match.json
// 读取真实日志 → GladLogParser → 取第一个 match 事件 → 剥 rawLines → 玩家名脱敏 → 写 JSON。
import { readFileSync, writeFileSync } from "fs";
import { GladLogParser } from "../../parser/src/index.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};
const logPath = arg("log");
const outPath = arg("out");
if (!logPath || !outPath) {
  console.error(
    "usage: tsx make-report-fixture.mjs --log <combatlog.txt> --out <fixture.json>",
  );
  process.exit(1);
}

const parser = new GladLogParser({ timezone: "UTC" });
let match = null;
parser.on("match", (m) => {
  if (!match) match = m;
});
for (const line of readFileSync(logPath, "utf-8").split("\n"))
  parser.push(line);
parser.end();
if (!match) {
  console.error("no match produced from log");
  process.exit(1);
}

const { rawLines, ...data } = match;
let text = JSON.stringify(data, null, 1);
// 脱敏:每个 Player 单位的名字(Name-Realm)全局替换为 PlayerA-Test 等
const players = Object.values(data.units).filter((u) => u.kind === "Player");
players.forEach((u, i) => {
  const alias = `Player${String.fromCharCode(65 + i)}-Test`;
  text = text.split(JSON.stringify(u.name).slice(1, -1)).join(alias);
});
writeFileSync(outPath, text);
console.log(
  `wrote ${outPath}: ${players.length} players sanitized, ${text.length} bytes`,
);
