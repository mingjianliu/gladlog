# /release-gladlog — cut a gladlog desktop release

Build and publish a versioned release of the desktop app (Windows `.exe` + macOS
`.dmg`) via GitHub CI. Argument: the target version, e.g. `0.0.3` (no `v`). If
omitted, bump the patch of the current `packages/desktop/package.json` version.

This encodes the flow + the traps in memory `gladlog-packaging-gotchas`. Do the
steps in order; stop and report if any gate fails.

## 1. Pre-flight — everything green

From the repo root:

```
npm run typecheck
npx eslint . 2>/dev/null | grep -c "  error"   # must be 0
```

Then the suites that matter for a desktop release (at least):

```
( cd packages/desktop && npx vitest run )       # all pass
```

If anything fails, STOP — do not release a red tree.

## 2. Bump the version

Set `packages/desktop/package.json` `version` to the target `X.Y.Z` (this is
what names the installers — a mismatch ships `0.0.1-*` files in a `vX.Y.Z`
release). Also confirm `build.electronVersion` still matches the installed
electron (`node -e "console.log(require('./node_modules/electron/package.json').version)"`).

```
git add packages/desktop/package.json
git commit -m "chore(desktop): bump version to X.Y.Z"
git push origin main
```

## 3. Create the release (tags → triggers CI)

Write a short changelog. ALWAYS include the macOS note (unsigned build):

```
gh release create vX.Y.Z --title "gladlog X.Y.Z" --notes "<one-paragraph changelog>

## Windows (x64)
- \`gladlog Setup X.Y.Z.exe\` — installer. SmartScreen → **More info → Run anyway**.

## macOS (Apple Silicon)
Not notarized. On first open drag **gladlog.app** to /Applications, then **right-click → Open** (or run \`xattr -cr /Applications/gladlog.app\`).

_Installers are built and attached by CI a few minutes after this tag._"
```

The `v*` tag push triggers `.github/workflows/build.yml`, which builds Windows

- macOS natively (no local Wine) and attaches the installers to this release.
  The macOS `afterSign` hook gives a clean ad-hoc signature, so the download needs
  only `xattr -cr` (no re-sign, no "damaged").

## 4. Watch the build, verify assets

```
RID=$(gh run list --workflow=build.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
gh run view "$RID" --json jobs -q '.jobs[] | .name + ": " + .conclusion'   # both success
gh release view vX.Y.Z --json assets -q '.assets[].name'                    # X.Y.Z-named exe + dmg + zips
```

The macOS job finishes before Windows — a transient "only mac" on the release
is just the Windows job still compiling, not a failure.

## 5. Report

Give the user the direct, login-free download links:

- Windows: `https://github.com/mingjianliu/gladlog/releases/download/vX.Y.Z/gladlog.Setup.X.Y.Z.exe`
- macOS: `https://github.com/mingjianliu/gladlog/releases/download/vX.Y.Z/gladlog-X.Y.Z-arm64.dmg`
- Release page: `https://github.com/mingjianliu/gladlog/releases/tag/vX.Y.Z`

## If it goes wrong

- **Wrong version in filenames** → step 2 was skipped; bump, then `gh release delete vX.Y.Z --yes --cleanup-tag` and re-run from step 3.
- **electron-builder "version is a range"** → set `build.electronVersion`.
- **macOS "damaged" persists** → the `afterSign` hook or build config regressed; verify `packages/desktop/build/afterSign.cjs` exists and `build.afterSign` points at it. Per-machine fix: `xattr -cr <app> && codesign --force --deep --sign - <app>`.
- Only real "just works, no warnings" fix on either OS is a paid signing cert (macOS notarization / Windows code-signing); wire the secrets into the CI workflow when available.
