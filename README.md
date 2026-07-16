# gladlog

WoW 竞技场战斗日志分析桌面应用:解析本地战斗日志,浏览战报、2D 回放与跨场战绩,并用 AI 做逐场复盘教练。**本地优先 —— 无账号、无上传,AI 分析可选。**

> Local-first World of Warcraft arena log analyzer with replay and AI coaching, built from scratch with Electron + React + TypeScript. All data stays on your machine.

## 功能

- **战报** —— 伤害/治疗/承伤榜、全队 HP 曲线、打断/被控/驱散统计表;点死亡标记看死前 10 秒回顾(承伤流、可用未按的保命技、队友漏给的外部)。
- **2D 回放** —— 真实竞技场小地图上的走位重演:血条与 HP 数字、真读条条(金=完成/红=被掐)、障碍物、dampening 指示、GCD 泳道(每人一列的技能流,带技能图标);空格/方向键操控,0.5×–4× 变速。
- **AI 复盘**(可选)—— 结构化 findings:每条结论都引用可验证的对局事件,点「回放此刻」直接跳到那一秒亲眼看;支持中文/English 回复;可标记「已跟进/还在犯」。
- **战绩** —— 跨场统计:胜率、评分曲线、对阵各敌方阵容胜率、分地图胜率、「最常犯的问题」聚合。
- **诚实性是硬指标** —— 从 parser 差分预言机到 prompt 覆盖门到 UI 数据忠实性测试,整条链路有确定性验证(见 [可验证性路线图](docs/verifiability-roadmap.md))。

## 安装

从 [Releases](https://github.com/mingjianliu/gladlog/releases) 下载对应平台安装包(Windows x64 / macOS)。

## 快速上手

1. 打开应用 → 「选择 WoW 目录」(自动定位战斗日志并开始监控);
2. 游戏内开启战斗记录(建议开启**高级战斗日志**,否则无坐标/HP,回放与部分分析不可用);
3. 打一场竞技场,战报自动出现;历史日志用「导入历史日志…」一次性回灌。

AI 分析需要在「设置」里配置 Anthropic API key(不配也能用全部本地功能)。

详细说明见 **[用户手册](docs/user-guide.md)**。

## 隐私

所有对局数据存在本机(应用数据目录)。只有你主动点「分析」时,该场对局的文本摘要才会发送给你自己配置的 AI 服务;不发送则没有任何网络上传(地图底图与技能图标从公共 CDN 加载)。

## 开发

```bash
npm ci
npm run dev            # Electron 开发模式
npm run dev:ui         # 纯浏览器 report UI 测试台(最快的 UI 迭代环)
npm test --workspaces  # 全部测试
```

架构、纪律与工作流见 **[开发者指南](docs/developer-guide.md)**。

## License

MIT — 见 [LICENSE](LICENSE)。
