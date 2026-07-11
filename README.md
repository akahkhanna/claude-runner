# 🐹 Claude Runner

**Your Claude usage limits, watched by a hamster. Codex too.**

A tiny floating desktop widget that sits in the corner of your screen and shows your Claude session/weekly usage in real time. No browser tab. No clicking around settings pages. Just a hamster on a wheel — in 2D or full 3D.

The hamster runs faster when you're burning through tokens. It sprints near the limit, collapses and **snores** when you hit it, then springs back to life with a chime when your session resets.

If you also use OpenAI's Codex CLI, Claude Runner shows those limits too — same widget, zero extra config.

## Why?

Claude doesn't tell you when your limits reset. There's no countdown. No notification. What most people do: refresh every few minutes and hope. What Claude Runner does: shows you exactly where you stand, sounds a chime when you're back, and entertains you while you wait.

## Install

```bash
git clone https://github.com/akahkhanna/claude-runner.git
cd claude-runner
npm install
npm start
```

A small floating window appears in the top-right corner of your screen. That's it.

> **First time?** Try `npm run dev` first — it runs with simulated data so you can see the hamster in action without needing Claude Code credentials.

## Requirements

- **Node.js 18+**
- **Claude Code** installed and logged in (`claude login`)
- macOS, Windows, or Linux
- *(Optional)* **Codex CLI** logged in — for the Codex limits section

## How it works

Claude Runner reads your existing Claude Code OAuth token (from macOS Keychain or `~/.claude/.credentials.json`) and polls the Anthropic usage API every 3 minutes. If a Codex install is detected (`~/.codex/auth.json`), it polls the ChatGPT backend usage endpoint the same way — refreshing the OAuth token automatically when it expires, without ever writing to Codex's credential file.

No sign-up. No API keys. No backend. Everything stays on your machine.

```
macOS Keychain  → OAuth token → api.anthropic.com/api/oauth/usage      → 🐹
~/.codex/auth.json → OAuth token → chatgpt.com/backend-api/wham/usage  → ⬡
```

## The hamster

Toggle between **2D** (hand-drawn SVG) and **3D** (Three.js, running in a wire wheel) with the button in the header. Both react to your usage:

| Your usage   | What the hamster does                                                     |
| ------------ | ------------------------------------------------------------------------- |
| 0–20%        | Easy trot, happy eyes, little smile                                       |
| 20–60%       | Jogging, legs pumping, steady pace                                        |
| 60–90%       | Running hard, mouth open, panting                                         |
| 90–99%       | Full sprint, sweat drops, determined eyebrows 🔥                           |
| 100% (limit) | Collapsed on side, tongue out, Zzz, stars circling, **snores audibly** 💤  |
| Limit resets | Springs back up, sparkles everywhere, ascending chime 🎵                   |

The wheel doubles as a usage gauge — the coloured arc fills as usage climbs. Green → yellow → red.

### Burn rate

The hamster's speed reflects how fast you're consuming tokens *right now*, not just your current percentage. Burning through a conversation quickly? The hamster sprints. Idle for a while? It slows to a trot. A badge shows 🔥 FAST, ⚡ MED, or nothing when you're cruising.

### Sound

- **Snoring** — a low rhythmic rumble when the hamster is collapsed at the limit
- **Victory chime** — ascending C-E-G-C when your session resets
- Toggle with the 🔔 button

## The widget

- **Always on top** — floats above your other windows
- **Draggable** — grab the header bar to reposition
- **System tray** — yellow dot hides to tray, click tray icon to restore
- **Big countdown** — large monospaced timer showing exactly when your session resets
- **Session + weekly bars** — both limits visible at a glance
- **Scoped model limits** — models with their own weekly caps (e.g. Fable) get a dedicated bar
- **Codex section** — OpenAI 5h + weekly bars with reset countdowns, shown automatically when Codex CLI is installed
- **Plan badge** — shows your plan tier (Pro, Max, Team)
- **LIVE / STALE / DEMO badge** — LIVE means fresh data; STALE means real data that couldn't be refreshed (e.g. rate limited — the widget backs off and recovers automatically); DEMO means simulated
- **Auto-sizing** — the window fits its content exactly, no dead space

## Playing nice with the API

Claude Runner is a usage monitor, so it tries hard not to *be* a usage problem:

- **Single-instance lock** — launching it twice focuses the existing window instead of stacking pollers
- **Refresh debounce** — manual refreshes are capped at one per 30 seconds
- **429 backoff** — if the API rate-limits, the widget honours `Retry-After`, serves the last good data with a STALE badge, and retries when the window clears

## Credentials

**Claude** — read the same way Claude Code stores them:

| Platform    | Location                                                                                             | Status                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **macOS**   | Keychain → `"Claude Code-credentials"` → `claudeAiOauth.accessToken`                                 | ✅ Tested                                                                           |
| **Windows** | Windows Credential Manager (via PowerShell), falls back to `%USERPROFILE%\.claude\.credentials.json` | 🔶 Implemented, needs testing — [feedback wanted](https://github.com/akahkhanna/claude-runner/issues) |
| **WSL**     | `~/.claude/.credentials.json`                                                                        | 🔶 Should work via file fallback                                                    |
| **Linux**   | `~/.claude/.credentials.json`                                                                        | 🔶 Should work via file fallback                                                    |
| **Env var** | `CLAUDE_CODE_OAUTH_TOKEN`                                                                            | ✅ Works everywhere                                                                 |

**Codex** — `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) on all platforms, created by `codex login`. Expired access tokens are refreshed in memory via OpenAI's OAuth endpoint; Claude Runner never modifies the auth file. No Codex install → the section simply doesn't appear.

If no Claude credentials are found, the widget falls back to demo mode with simulated data.

### Credentials not detected? (Windows / Linux)

If live mode shows "DEMO" instead of "LIVE", set the token manually:

```bash
# 1. Get your token
claude auth status   # confirms you're logged in

# 2. Find where Claude Code stores it
cat ~/.claude/.credentials.json   # Linux
type %USERPROFILE%\.claude\.credentials.json   # Windows

# 3. If the file exists, Claude Runner should read it automatically.
#    If not, set the env var and restart:
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-your-token-here"
npm start
```

If you figure out where your platform stores the token, please open an issue or PR — we'd love to support it natively.

## Configuration

| Variable            | Default     | What it does                    |
| ------------------- | ----------- | ------------------------------- |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Custom Claude config directory  |
| `CODEX_HOME`        | `~/.codex`  | Custom Codex config directory   |
| `--mock` flag       | off         | Force demo mode (`npm run dev`) |

## Privacy

- Talks **only** to: `api.anthropic.com` (Claude usage), and — *only if Codex CLI is installed* — `chatgpt.com` (Codex usage) and `auth.openai.com` (Codex token refresh)
- Uses your **existing** CLI OAuth tokens (never asks for credentials, never writes to credential files)
- **Zero telemetry** — no analytics, no tracking, no phoning home
- **Fully local** — no database, no accounts, no backend
- **Open source** — read every line

Debug note: raw usage responses (utilization percentages and reset times, no tokens) are written to your system temp directory (`claude-runner-usage.json`, `codex-runner-usage.json`) to help diagnose API shape changes.

## Built with

- [Electron](https://www.electronjs.org/) — cross-platform desktop shell
- [React 19](https://react.dev/) + [Three.js](https://threejs.org/) — renderer and the 3D hamster
- [esbuild](https://esbuild.github.io/) — bundling
- Web Audio API — snoring and chime synthesis
- The Anthropic and ChatGPT usage APIs (undocumented, community-discovered — may change without notice)

## Contributing

PRs welcome. Some ideas:

- [ ] Record a demo GIF for the README
- [ ] Test Windows Credential Manager reading on a real Windows machine
- [ ] Linux keyring support (libsecret)
- [ ] Native notifications via ntfy.sh / Pushover when limits reset
- [ ] Customisable hamster skins
- [ ] A second hamster for Codex 🐹🐹
- [ ] VS Code extension variant
- [ ] Homebrew formula

## Acknowledgements

Inspired by the gap in the Claude ecosystem — none of the existing usage trackers had any personality. Built by [Akash Khanna](https://github.com/akahkhanna).

## License

MIT
