---
name: release
description: Cut or overwrite a gladlog release build. Use when asked to 出包/打包/release/cut a build/覆盖某版本 — tag-driven GitHub Actions build (win x64 + mac arm64), version bump policy, asset verification.
---

# gladlog release 流程

发布 = 打 `v*` tag → `.github/workflows/build.yml` 在 GitHub runner 原生出
win x64(zip+nsis)+ mac arm64(zip+dmg),自动挂到 GitHub Release。
本地不需要 electron-builder / Wine。

## 前置检查

1. 工作树干净、`origin/main` 已同步(`git status --short` 为空;有未推提交先推)。
2. 最近一次 test.yml CI 是绿的 —— tag 构建不会重跑测试,别给红 commit 出包。

## 正常发版(版本号 +1)

```bash
# 1. bump(只有 packages/desktop/package.json 一处)
perl -pi -e 's/"version": "0\.1\.N"/"version": "0.1.N+1"/' packages/desktop/package.json
# 2. changelog(见下节「changelog 规范」):在根 CHANGELOG.md 顶部插入本版一节
#    材料 = git log v0.1.N..HEAD --oneline --no-merges,逐改动列 commit 哈希
# 3. release commit(bump + changelog 同一个 commit,内容概要写进标题)
git add packages/desktop/package.json CHANGELOG.md
git commit -m "release: v0.1.N+1 —— <这版内容一句话>"
# 4. tag + push(commit 与 tag 都要推)
git tag v0.1.N+1 && git push && git push origin v0.1.N+1
```

## changelog 规范(每次发版必写,用户点名的流程)

- 位置:仓库根 `CHANGELOG.md`,新版本一节插在最顶(倒序)。
- 节结构:`## v0.1.X (YYYY-MM-DD)`(zh-CN 版括号前不空格:`## v0.1.X(YYYY-MM-DD)`) + 一句来源概述 + 按产品面分组
  (事件表/AI 分析/战报/回放/全局……按实际改动定),**每条改动前缀对应
  commit 短哈希**(反引号包裹);release bump/CI 修复/文档类归「其他」。
- 口径 = `git log v<prev>..v<new> --oneline --no-merges` 全集:每个 commit
  都要能在 changelog 里找到归属,不许静默漏(一个 commit 跨多面时可拆到
  多条,各自标同一哈希)。
- 写给用户而不是写给 git:说行为变化(「死亡行高亮 + 回顾直达」),不说
  实现细节;短句、破折号、不用 emoji(全站文案口吻)。
- **双语**:`CHANGELOG.md` 是英文正本,`CHANGELOG.zh-CN.md` 同步一节(Bilingual Docs Rule);
  GitHub Release 的 notes 用**英文**节。2026-08-27 v0.1.30 因为挂了中文节且被截断被用户点名,
  挂完 `gh release view vX --json body -q .body | wc -c` 与 awk 抽出的节字数对一下。
- 构建绿、资产验收后,把本节内容同步挂到 GitHub Release:
  ```bash
  awk '/^## v0\.1\.X/{f=1; next} /^## v/{f=0} f' CHANGELOG.md > /tmp/notes.md
  gh release edit v0.1.X --notes-file /tmp/notes.md
  ```
- 坑:行首别写裸 `+`(markdown 格式化器会把它当列表符重排,改用「与/加」)。

## 覆盖已有版本(用户明说「覆盖 N」才做)

版本号不 bump(package.json 已是该版本):

```bash
gh release delete v0.1.N --yes --cleanup-tag
git tag -f v0.1.N HEAD
git push origin v0.1.N
```

**硬规矩:除非用户明说「覆盖 N」,一律走 +1,不许覆盖。** 0.1.20 起客户端带
自动更新,而更新判据是版本号 —— 覆盖 vN 之后,已装 vN 的机器版本号相同、
永远收不到这次修复,用户手里是旧内容却以为自己是最新版,且没有任何提示。
覆盖前必须先告诉用户这个后果并拿到确认。

## 看构建 + 验收资产

```bash
sleep 10
RUN=$(gh run list --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $RUN   # 约 10-15 分钟;建议后台跑
gh run view $RUN --json headSha,conclusion,jobs -q '.headSha + " " + .conclusion'
gh release view v0.1.X --json assets -q '.assets[].name'
```

**`gh run watch` 退出 0 不等于构建绿**(2026-08-11 误报事故):后台 watcher 可能对着
另一条 run 或提前退出。所以上面第三行是必需的 —— `headSha` 必须等于你打 tag 的那个
commit,`conclusion` 必须是 `success`,两样都对上了才算数。

必须见到下列 7 个资产,逐字符核对:

- `gladlog.Setup.0.1.X.exe` —— 安装包
- `gladlog.Setup.0.1.X.exe.blockmap` —— 差分下载用
- `gladlog-0.1.X-win.zip` —— 免安装版
- `latest.yml` —— **自动更新的命门**,漏传的后果是所有 Windows 客户端静默检查失败
- `gladlog-0.1.X-arm64.dmg`
- `gladlog-0.1.X-arm64-mac.zip`
- `latest-mac.yml` —— mac 侧同款,当前 mac 不启用自动更新,留着以备将来买证书

少了 = 某平台构建挂了,`gh run view $RUN --log-failed` 查。
另外还会带上 mac 侧的 `*-arm64.dmg.blockmap` / `*-arm64-mac.zip.blockmap`,
有无都不影响(mac 不走自动更新),不作硬门。

**再加一条名字一致性核对**(比比对 sha512 更早暴露问题):

```bash
gh release download v0.1.X -p latest.yml -D /tmp/relcheck --clobber
grep -E '^\s*(path|url):' /tmp/relcheck/latest.yml
gh release view v0.1.X --json assets -q '.assets[].name'
```

`latest.yml` 里的 `path` / `files[].url` 必须与资产列表里的名字**逐字符相同**。
对不上就是 404:客户端能读到 latest.yml、能算出新版本、然后下载失败,
而这一切在 Release 页面上看起来完全正常。

## 坑(踩过的)

- **版本号绝不复用**(除非用户明确要覆盖):资产同名覆盖后无法区分谁装的哪份。
- electron-builder 配置铁律见 memory/gladlog-packaging-gotchas:pin
  `electronVersion`、别加 `files`、corpus 走 `extraResources`、win x64 由 `build.win.target[].arch` 配置决定(不再用 CLI `--x64`)、
  mac afterSign ad-hoc 签名。
- tag push 后立刻取 latest run 可能抓到上一条 —— `sleep 10` 再取,或用显式 run id。
- CI test workflow 与 build workflow 是两条:test 绿 ≠ build 绿(打包链路差异)。
- **tag 前 CI 必须绿**(2026-07-25 实践):commit → 按 headSha 等 test.yml 完成
  → 才 bump+tag;红的先修,基础设施红(npm/electron 下载 504)直接
  `gh run rerun <id> --failed`。
- 开着 PR 的分支每次 push 出 push+pull_request **双 run**,别把另一条的红
  当成新问题。
- **tag push 没触发 run 时,别重推 tag**(重推不一定重新投递,还会把 tag 历史搅乱)。
  先确认确实没有:`gh run list --workflow build.yml --limit 5 --json headSha,event,databaseId`;
  真没有就用等价的手工投递 `gh workflow run build.yml --ref v0.1.X` —— 与 tag push 走同一个
  workflow、同一份产物。先跑一次确认它能出 run、能出资产,再考虑要不要补别的。
- 同日快速迭代时,被叠代的版本照常发但告知用户跳过装新的(0.1.7→0.1.8 先例);
  版本号绝不回收。
