# gladlog Windows setup guide (AI coach via Claude CLI, no API key)

**English** · [Chinese](setup-windows-claude-cli.zh-CN.md)

> For: Windows 10/11 users with a Claude Pro/Max subscription (or any account that can sign in to Claude Code).
> AI analysis runs through the local Claude CLI, so you don't have to buy a separate Anthropic API key.

## 1. Install gladlog

1. Open <https://github.com/mingjianliu/gladlog/releases/latest>
2. Download `gladlog.Setup.x.x.x.exe` and double-click to install.
   - Windows SmartScreen may warn about an "unknown publisher" → click **More info** → **Run anyway**
     (normal for an open-source project with no paid code signing).

## 2. Install the Claude CLI (Claude Code)

1. Install Node.js first: download the LTS build from <https://nodejs.org> and click through the installer.
2. Open PowerShell (search "powershell" in the Start menu) and run:

   ```powershell
   npm install -g @anthropic-ai/claude-code
   ```

3. Sign in (a browser authorization page opens; log in with your Claude account):

   ```powershell
   claude
   ```

   The first run walks you through signing in. Once you're in, ask it anything to confirm it answers, then `/exit`.

4. Verify the command can be found:

   ```powershell
   where claude
   ```

   Any path in the output is good. gladlog locates it with `where` automatically (`.cmd` wrapper scripts work too).

## 3. Configure gladlog

1. Launch gladlog → follow the first-run wizard to **select your WoW installation folder**
   (usually `C:\Program Files (x86)\World of Warcraft\_retail_`).
2. On the **Settings** page at the top:
   - **Backend** → choose **Claude CLI (local)**. No API key needed.
   - Leave the command blank (it runs `where claude` for you); only fill in a full path if you installed it somewhere unusual.
   - **Language** (the first item on the page) → Chinese or English. You already picked one in the installer; change it here any time.

## 4. Turn on combat logging in-game (critical!)

1. WoW System Settings → Network → tick **Advanced Combat Logging**.
   Without it there are no coordinates and no HP samples — no positioning replay, no death recap, no positioning analysis.
2. Type `/combatlog` before entering the arena. An addon that toggles it for you is recommended
   (AutoCombatLogger, for example, turns it on when you enter an arena).

## 5. Using it

- Finished matches appear in the list on the left automatically (the app watches `Logs\WoWCombatLog*.txt` live).
- For older logs: **Import historical logs…** on the settings page, select as many old `WoWCombatLog*.txt` files as you like; re-imports are deduplicated.
- Open a match → the **AI analysis** tab generates the coaching review (through your locally signed-in Claude, counted against your subscription usage, with no API bill).

## Troubleshooting

| Symptom                                       | Fix                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Replay says "no position data"                | Advanced combat logging was off for that match (see step 4)                                             |
| AI analysis does nothing                      | Run `where claude` in PowerShell and confirm it prints a path; sign in again with `claude`              |
| Statistics page should be split per character | Click **Rebuild match index** once on the Developer page to backfill the character field on old matches |
| SmartScreen blocks the install                | More info → Run anyway                                                                                  |
