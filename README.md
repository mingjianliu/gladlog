# gladlog

WoW 竞技场战斗日志分析桌面应用:解析本地战斗日志、浏览战报、AI 复盘分析。本地优先,无账号、无上传。

从零编写(from scratch)。技术栈:Electron + React + TypeScript(Vite)。

## 状态

早期开发中。路线图见 [docs/specs/2026-07-10-clean-rewrite-roadmap-design.md](docs/specs/2026-07-10-clean-rewrite-roadmap-design.md):

- [x] 子项目 0:自有代码合规审计(在私有工作仓完成)
- [x] 子项目 1:战斗日志 parser 库
- [x] 子项目 2:桌面壳(Electron + Vite)
- [x] 子项目 3:战报 UI
- [ ] 子项目 4:AI 分析 + eval 体系(4a 应用内 AI 分析 ✅;4b eval 工具链待做)
- [ ] 子项目 5:游戏数据管线

## License

MIT — 见 [LICENSE](LICENSE)。
