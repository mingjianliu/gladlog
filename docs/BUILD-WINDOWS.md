# Building the Windows installer (`.exe`)

The Windows **NSIS installer** must be built on Windows (macOS can't run NSIS
without Wine, which is deprecated). The macOS side already produces the x64
`.zip`; this doc is only for the installer. Everything is pre-configured — no
edits needed.

## Prerequisites (on the Windows PC)

- **Node.js ≥ 20.11** (the build uses `import.meta.dirname`). Get it from
  https://nodejs.org — the LTS installer is fine.
- **git** (https://git-scm.com) — only needed to unpack the transfer bundle.

## 1. Get the code

You were handed `gladlog.bundle` (a single self-contained git file — no server
needed). Copy it to the Windows PC, then in a terminal (PowerShell or Git Bash):

```bash
git clone gladlog.bundle gladlog
cd gladlog
```

## 2. Install dependencies

```bash
npm ci
```

## 3. Build the installer

```bash
npm -w @gladlog/desktop run package:win
```

This runs `electron-vite build` then `electron-builder --win`, which — per the
committed config — produces the **x64** `nsis` installer and a `zip`.

## 4. Output

Find the artifacts in `packages/desktop/dist-app/`:

- `gladlog Setup 0.0.1.exe` — the installer.
- `gladlog-0.0.1-win.zip` — portable build.

## Notes

- **Unsigned:** without a code-signing certificate, Windows SmartScreen will
  warn on first run ("More info" → "Run anyway"). Signing is optional and needs
  a cert; add it under `build.win.certificateFile` / env vars when you have one.
- The cohort corpus (`reference_vectors.json`) is bundled automatically via
  `extraResources` — the compare feature works in the packaged app.
- The app's log-analysis features are self-contained; **AI compare/analysis
  needs your Anthropic API key entered in the app's settings** at runtime.
- To also stream logs from this PC to your Mac, run the log-pipeline streamer
  here: `npm -w @gladlog/log-pipeline run stream -- --config stream.config.json`
  (see `packages/log-pipeline` for the config shape).
