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
perl -pi -e 's/"version": "0\.0\.N"/"version": "0.0.N+1"/' packages/desktop/package.json
# 2. release commit(内容概要写进标题)
git add packages/desktop/package.json
git commit -m "release: v0.0.N+1 —— <这版内容一句话>"
# 3. tag + push(commit 与 tag 都要推)
git tag v0.0.N+1 && git push && git push origin v0.0.N+1
```

## 覆盖已有版本(用户明说「覆盖 N」才做)

版本号不 bump(package.json 已是该版本):

```bash
gh release delete v0.0.N --yes --cleanup-tag
git tag -f v0.0.N HEAD
git push origin v0.0.N
```

提醒用户:已下载旧包的人手里会有同版本号不同内容的二进制;默认应走 +1。

## 看构建 + 验收资产

```bash
sleep 10
RUN=$(gh run list --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $RUN   # 约 10-15 分钟;建议后台跑
gh release view v0.0.X --json assets -q '.assets[].name'
```

必须见到 4 个资产:`gladlog.Setup.0.0.X.exe`、`gladlog-0.0.X-win.zip`、
`gladlog-0.0.X-arm64.dmg`、`gladlog-0.0.X-arm64-mac.zip`。少了 = 某平台
构建挂了,`gh run view $RUN --log-failed` 查。

## 坑(踩过的)

- **版本号绝不复用**(除非用户明确要覆盖):资产同名覆盖后无法区分谁装的哪份。
- electron-builder 配置铁律见 memory/gladlog-packaging-gotchas:pin
  `electronVersion`、别加 `files`、corpus 走 `extraResources`、win `--x64`、
  mac afterSign ad-hoc 签名。
- tag push 后立刻取 latest run 可能抓到上一条 —— `sleep 10` 再取,或用显式 run id。
- CI test workflow 与 build workflow 是两条:test 绿 ≠ build 绿(打包链路差异)。
