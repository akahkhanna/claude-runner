# 🐹 Claude Runner

**Your Claude usage limits, watched by a hamster.**

A tiny floating desktop widget that sits in the corner of your screen and shows your Claude session/weekly usage in real time. No browser tab. No clicking around settings pages. Just a hamster on a wheel.

The hamster runs faster when you're burning through tokens. It sprints near the limit, collapses and **snores** when you hit it, then springs back to life with a chime when your session resets.

<!-- TODO: Add a GIF/video of the widget in action -->
<!-- ![Claude Runner Demo](docs/demo.gif) -->

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

## How it works

Claude Runner reads your existing Claude Code OAuth token (from macOS Keychain or `~/.claude/.credentials.json`) and polls the Anthropic usage API every 3 minutes. No sign-up. No API keys. No backend. Everything stays on your machine.

```
macOS Keychain → OAuth token → api.anthropic.com/api/oauth/usage → 🐹
```

## The hamster

| Your usage     | What the hamster does                                      |
|----------------|-----------------------------------------------------------|
| 0–20%          | Easy trot, happy eyes, little smile                        |
| 20–60%         | Jogging, legs pumping, steady pace                         |
| 60–90%         | Running hard, mouth open, panting                          |
| 90–99%         | Full sprint, sweat drops, determined eyebrows 🔥            |
| 100% (limit)   | Collapsed on side, tongue out, Zzz, stars circling, **snores audibly** 💤 |
| Limit resets   | Springs back up, sparkles everywhere, ascending chime 🎵    |

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
- **Plan badge** — shows your plan tier (Pro, Max, Team)
- **Live / Demo badge** — so you know if you're seeing real data

## Credentials

Claude Runner reads credentials the same way Claude Code stores them:

| Platform        | Location                                              | Status |
|-----------------|-------------------------------------------------------|--------|
| **macOS**       | Keychain → `"Claude Code-credentials"` → `claudeAiOauth.accessToken` | ✅ Tested |
| **Windows**     | Windows Credential Manager (via PowerShell), falls back to `%USERPROFILE%\.claude\.credentials.json` | 🔶 Implemented, needs testing — [feedback wanted](../../issues) |
| **WSL**         | `~/.claude/.credentials.json`                         | 🔶 Should work via file fallback |
| **Linux**       | `~/.claude/.credentials.json`                         | 🔶 Should work via file fallback |
| **Env var**     | `CLAUDE_CODE_OAUTH_TOKEN`                              | ✅ Works everywhere |

If no credentials are found, it falls back to demo mode with simulated data.

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

| Variable             | Default     | What it does                    |
|----------------------|-------------|--------------------------------|
| `PORT` (browser ver) | `3456`      | Server port                    |
| `CLAUDE_CONFIG_DIR`  | `~/.claude` | Custom Claude config directory |
| `--mock` flag        | off         | Force demo mode (`npm run dev`) |

## Privacy

- Talks **only** to `api.anthropic.com`
- Uses your **existing** Claude Code OAuth token (never asks for credentials)
- **Zero telemetry** — no analytics, no tracking, no phoning home
- **Fully local** — no database, no accounts, no backend
- **Open source** — read every line

## Built with

- [Electron](https://www.electronjs.org/) — cross-platform desktop shell
- Vanilla JS + SVG — no frameworks in the renderer
- Web Audio API — snoring and chime synthesis
- The Anthropic usage API (undocumented, community-discovered)

## Contributing

PRs welcome. Some ideas:

- [ ] Record a demo GIF for the README
- [ ] Integrate 3D mode (`experiments/claude-runner-3d.jsx` — Three.js hamster, needs GLTF model for production quality)
- [ ] Test Windows Credential Manager reading on a real Windows machine
- [ ] Linux keyring support (libsecret)
- [ ] Native notifications via ntfy.sh / Pushover when limits reset
- [ ] Customisable hamster skins
- [ ] VS Code extension variant
- [ ] Homebrew formula

## Acknowledgements

Inspired by the gap in the Claude ecosystem — none of the existing usage trackers had any personality. Built by [Akash Khanna](https://github.com/akahkhanna).

## License

MIT
