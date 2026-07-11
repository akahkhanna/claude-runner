const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const MOCK_MODE = process.argv.includes('--mock');
const POLL_INTERVAL = 180_000;
const WIN_WIDTH = 280;
const WIN_HEIGHT = 470;

// Single instance — multiple copies of this app each polling the usage
// endpoint on the same token is a fast route to a 429
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

let mainWindow = null;
let tray = null;
let pollTimer = null;
let lastGoodUsage = null;
let claudeBackoffUntil = 0;

// ═══════════════════════════════════════════
//  Window
// ═══════════════════════════════════════════
function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: WIN_WIDTH, height: WIN_HEIGHT,
    x: screenW - WIN_WIDTH - 20, y: 60,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ═══════════════════════════════════════════
//  Tray
// ═══════════════════════════════════════════
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgklEQVR42mL4////8/AwAI/AL+hc2rNAAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Claude Runner 🐹');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => {
      if (mainWindow?.isVisible()) mainWindow.hide();
      else { mainWindow?.show(); mainWindow?.focus(); }
    }},
    { label: 'Refresh Now', click: () => poll() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}

// ═══════════════════════════════════════════
//  Credentials
//  macOS: Keychain → "Claude Code-credentials"
//         Token at: creds.claudeAiOauth.accessToken
//  Linux/Windows: ~/.claude/.credentials.json
// ═══════════════════════════════════════════
let cachedClaudeVersion = null;
function getClaudeVersion() {
  if (cachedClaudeVersion) return cachedClaudeVersion;
  try {
    const o = execSync('claude --version', { timeout: 5000, encoding: 'utf-8' }).trim();
    const m = o.match(/(\d+\.\d+\.\d+)/);
    cachedClaudeVersion = m ? m[1] : '2.1.0';
  } catch { cachedClaudeVersion = '2.1.0'; }
  return cachedClaudeVersion;
}

function readCredentials() {
  // 1. macOS Keychain
  if (process.platform === 'darwin') {
    try {
      const user = os.userInfo().username;
      const raw = execSync(
        `security find-generic-password -s "Claude Code-credentials" -a "${user}" -w`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (raw) {
        const creds = JSON.parse(raw);
        const token = creds.claudeAiOauth?.accessToken;
        if (token) {
          return {
            token,
            plan: creds.claudeAiOauth.subscriptionType || 'unknown',
            tier: creds.claudeAiOauth.rateLimitTier || '',
            expiresAt: creds.claudeAiOauth.expiresAt,
          };
        }
      }
    } catch (e) {
      console.log('  ⚠  Keychain read failed:', e.message?.slice(0, 80));
    }
  }

  // 2. Windows Credential Manager (native Windows, non-WSL)
  if (process.platform === 'win32') {
    try {
      // Read from Windows Credential Manager via PowerShell + CredRead P/Invoke
      const psScript = `
$sig = @'
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr credential);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob;
  public int Persist; public int AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
'@
Add-Type -MemberDefinition $sig -Namespace Win32 -Name CredMan
$targets = @('Claude Code-credentials', 'Claude Code', 'claude-code-credentials')
foreach ($t in $targets) {
  $ptr = [IntPtr]::Zero
  if ([Win32.CredMan]::CredRead($t, 1, 0, [ref]$ptr)) {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.CredMan+CREDENTIAL])
    $blob = New-Object byte[] $cred.CredentialBlobSize
    [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blob, 0, $cred.CredentialBlobSize)
    [System.Text.Encoding]::Unicode.GetString($blob)
    [Win32.CredMan]::CredFree($ptr)
    break
  }
}`.replace(/\n/g, '; ');
      const raw = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
        encoding: 'utf-8', timeout: 10000
      }).trim();
      if (raw && raw.startsWith('{')) {
        const creds = JSON.parse(raw);
        const token = creds.claudeAiOauth?.accessToken;
        if (token) {
          return {
            token,
            plan: creds.claudeAiOauth.subscriptionType || 'unknown',
            tier: creds.claudeAiOauth.rateLimitTier || '',
            expiresAt: creds.claudeAiOauth.expiresAt,
          };
        }
      }
    } catch (e) {
      console.log('  ⚠  Windows Credential Manager read failed, trying file fallback');
    }
  }

  // 3. Flat file (~/.claude/.credentials.json) — Linux, WSL, and fallback
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const credPath = path.join(configDir, '.credentials.json');
  try {
    if (fs.existsSync(credPath)) {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      // Might be same nested structure or flat
      if (creds.claudeAiOauth?.accessToken) {
        return {
          token: creds.claudeAiOauth.accessToken,
          plan: creds.claudeAiOauth.subscriptionType || 'unknown',
          tier: creds.claudeAiOauth.rateLimitTier || '',
          expiresAt: creds.claudeAiOauth.expiresAt,
        };
      }
      const token = creds.oauth_access_token || creds.accessToken || creds.token;
      if (token) return { token, plan: 'unknown', tier: '' };
    }
  } catch {}

  // 4. Env var
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { token: process.env.CLAUDE_CODE_OAUTH_TOKEN, plan: 'unknown', tier: '' };
  }

  return null;
}

// ═══════════════════════════════════════════
//  API: GET /api/oauth/usage
// ═══════════════════════════════════════════
function fetchUsageAPI(token) {
  const version = getClaudeVersion();
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': `claude-code/${version}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Bad JSON')); }
        } else {
          if (res.statusCode === 429) {
            const rl = Object.entries(res.headers)
              .filter(([k]) => k === 'retry-after' || k.startsWith('x-ratelimit') || k.includes('anthropic-ratelimit'))
              .map(([k, v]) => `${k}=${v}`).join(', ');
            console.log(`  📛 429 headers: ${rl || '(none exposed)'}`);
            const err = new Error(`HTTP 429: ${body.slice(0, 120)}`);
            err.retryAfter = parseInt(res.headers['retry-after'], 10) || null;
            return reject(err);
          }
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ═══════════════════════════════════════════
//  Parse usage response
//  Actual shape:
//    five_hour.utilization (0-100)
//    five_hour.resets_at   (ISO string)
//    seven_day.utilization
//    seven_day.resets_at
//    limits[] → {kind, percent, severity, resets_at, scope, is_active}
// ═══════════════════════════════════════════
function parseUsage(raw, plan, tier) {
  const session = {
    pct: raw.five_hour?.utilization ?? 0,
    resetAt: raw.five_hour?.resets_at ?? null,
    severity: null,
  };
  const weekly = {
    pct: raw.seven_day?.utilization ?? 0,
    resetAt: raw.seven_day?.resets_at ?? null,
  };

  // Per-model: merge top-level seven_day_<model> keys + limits[] scoped entries
  const models = [];
  const seen = new Set();

  // Top-level seven_day_<model> keys — parse generically, don't hard-code names
  const palette = { fable: '#34D399', opus: '#C084FC', sonnet: '#60A5FA', haiku: '#FBBF24', cowork: '#2DD4BF' };
  for (const key of Object.keys(raw)) {
    const m2 = key.match(/^seven_day_(\w+)$/);
    if (!m2) continue;
    const m = raw[key];
    if (m && typeof m === 'object' && m.utilization != null) {
      const id = m2[1].toLowerCase();
      const name = id.charAt(0).toUpperCase() + id.slice(1);
      models.push({ id, name, pct: m.utilization, resetAt: m.resets_at, color: palette[id] || '#8B5CF6' });
      seen.add(id);
    }
  }

  // Scoped models from limits array
  if (Array.isArray(raw.limits)) {
    for (const lim of raw.limits) {
      if (lim.kind === 'session') {
        session.severity = lim.severity;
        session.isActive = lim.is_active;
      }
      const dn = lim.scope?.model?.display_name;
      if (dn && !seen.has(dn.toLowerCase())) {
        models.push({
          id: dn.toLowerCase(), name: dn,
          pct: lim.percent ?? 0, resetAt: lim.resets_at,
          color: palette[dn.toLowerCase()] || '#8B5CF6',
        });
        seen.add(dn.toLowerCase());
      }
    }
  }

  return {
    session,
    weekly,
    models,
    plan: plan || 'unknown',
    tier: tier || '',
    mock: false,
  };
}

// ═══════════════════════════════════════════
//  Mock data
// ═══════════════════════════════════════════
function mockUsage() {
  const elapsed = (Date.now() / 1000) % 300;
  return {
    session: {
      pct: Math.round(Math.min(100, (elapsed / 300) * 120) * 10) / 10,
      resetAt: new Date(Date.now() + 5 * 3600000 - elapsed * 1000).toISOString(),
    },
    weekly: {
      pct: Math.round((35 + Math.sin(Date.now() / 60000) * 15) * 10) / 10,
      resetAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    },
    models: [
      { id: 'opus', name: 'Opus', pct: Math.round((45 + Math.sin(Date.now()/40000)*20)), color: '#C084FC' },
      { id: 'sonnet', name: 'Sonnet', pct: Math.round((28 + Math.sin(Date.now()/55000)*12)), color: '#60A5FA' },
      { id: 'fable', name: 'Fable', pct: Math.round((12 + Math.sin(Date.now()/70000)*8)), color: '#34D399' },
    ],
    plan: 'demo',
    tier: '',
    mock: true,
  };
}

// ═══════════════════════════════════════════
//  Codex (OpenAI) — ~/.codex/auth.json + wham/usage
// ═══════════════════════════════════════════
function readCodexCredentials() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const p = path.join(home, 'auth.json');
  try {
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const token = j.tokens?.access_token || j.access_token;
    const accountId = j.tokens?.account_id || j.account_id || null;
    const refreshToken = j.tokens?.refresh_token || j.refresh_token || null;
    if (token) return { token, accountId, refreshToken };
  } catch {}
  return null;
}

function fetchCodexUsage(cred) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': `Bearer ${cred.token}`,
      'Content-Type': 'application/json',
    };
    if (cred.accountId) headers['ChatGPT-Account-Id'] = cred.accountId;
    const req = https.request('https://chatgpt.com/backend-api/wham/usage', { method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Codex: bad JSON')); }
        } else if (res.statusCode === 401) {
          reject(new Error('Codex: token expired — run `codex login`'));
        } else {
          reject(new Error(`Codex HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Codex: timeout')); });
    req.end();
  });
}

function parseCodexUsage(raw) {
  // Field names vary across backend versions — normalize defensively
  const rl = raw.rate_limit || raw.rate_limits || raw;
  const prim = rl.primary_window || rl.primary || raw.five_hour_limit;
  const sec = rl.secondary_window || rl.secondary || raw.weekly_limit;
  const norm = (w) => {
    if (!w || typeof w !== 'object') return { pct: 0, resetAt: null };
    const pct = w.used_percent ?? w.utilization ?? w.percent_used ?? 0;
    let resetAt = w.resets_at ?? null;
    const secs = w.resets_in_seconds ?? w.reset_after_seconds;
    if (!resetAt && secs != null) resetAt = new Date(Date.now() + secs * 1000).toISOString();
    // resets_at may be epoch seconds rather than ISO
    if (typeof resetAt === 'number') resetAt = new Date(resetAt * 1000).toISOString();
    return { pct: Math.round(pct * 10) / 10, resetAt };
  };
  return { session: norm(prim), weekly: norm(sec) };
}

// Codex CLI's public OAuth client id (from openai/codex source).
// If refresh starts failing with invalid_client, this has rotated — check the codex repo.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
let codexTokenCache = null; // { token, expiresAt } — in-memory only, never written to codex's auth.json
let lastGoodCodex = null;

function refreshCodexToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'openid profile email',
    });
    const req = https.request('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const j = JSON.parse(b);
            if (j.access_token) return resolve({ token: j.access_token, expiresIn: j.expires_in || 3600 });
            reject(new Error('Codex refresh: no access_token in response'));
          } catch { reject(new Error('Codex refresh: bad JSON')); }
        } else {
          reject(new Error(`Codex refresh HTTP ${res.statusCode}: ${b.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Codex refresh: timeout')); });
    req.write(body);
    req.end();
  });
}

async function pollCodex() {
  const cred = readCodexCredentials();
  if (!cred) return null; // no Codex install — section stays hidden

  // Prefer in-memory refreshed token if still valid
  let token = (codexTokenCache && codexTokenCache.expiresAt > Date.now())
    ? codexTokenCache.token : cred.token;

  const attempt = async (t) => {
    const raw = await fetchCodexUsage({ token: t, accountId: cred.accountId });
    try { fs.writeFileSync(path.join(os.tmpdir(), 'codex-runner-usage.json'), JSON.stringify(raw, null, 2)); } catch {}
    return parseCodexUsage(raw);
  };

  try {
    const parsed = await attempt(token);
    console.log(`  ✓  Codex — Session: ${parsed.session.pct}%, Weekly: ${parsed.weekly.pct}%`);
    lastGoodCodex = parsed;
    return parsed;
  } catch (err) {
    // 401 → try one refresh-and-retry cycle
    if (/expired|401/.test(err.message) && cred.refreshToken) {
      try {
        const fresh = await refreshCodexToken(cred.refreshToken);
        codexTokenCache = { token: fresh.token, expiresAt: Date.now() + (fresh.expiresIn - 60) * 1000 };
        console.log('  ↻  Codex token refreshed');
        const parsed = await attempt(fresh.token);
        console.log(`  ✓  Codex — Session: ${parsed.session.pct}%, Weekly: ${parsed.weekly.pct}%`);
        lastGoodCodex = parsed;
        return parsed;
      } catch (e2) {
        console.log(`  ✗  ${e2.message}`);
        return lastGoodCodex ? { ...lastGoodCodex, stale: true } : { error: e2.message };
      }
    }
    console.log(`  ✗  ${err.message}`);
    return lastGoodCodex ? { ...lastGoodCodex, stale: true } : { error: err.message };
  }
}

// ═══════════════════════════════════════════
//  Poll
// ═══════════════════════════════════════════
async function poll() {
  let usage;

  if (MOCK_MODE) {
    usage = mockUsage();
  } else {
    const cred = readCredentials();
    if (!cred) {
      console.log('  ⚠  No credentials — demo mode');
      usage = mockUsage();
    } else if (Date.now() < claudeBackoffUntil) {
      // Rate limited — serve last good data, skip the network call
      console.log(`  ⏸  Backing off until ${new Date(claudeBackoffUntil).toLocaleTimeString()}`);
      usage = lastGoodUsage
        ? { ...lastGoodUsage, stale: true }
        : { ...mockUsage(), error: 'rate limited' };
    } else {
      try {
        const raw = await fetchUsageAPI(cred.token);
        // Dump raw response for debugging — inspect with: cat /tmp/claude-runner-usage.json
        try { fs.writeFileSync(path.join(os.tmpdir(), 'claude-runner-usage.json'), JSON.stringify(raw, null, 2)); } catch {}
        console.log('  📦 Raw API keys:', Object.keys(raw).join(', '));
        if (raw.limits) console.log('  📦 Limits models:', raw.limits.map(l => `${l.kind}:${l.scope?.model?.display_name ?? '–'}:${l.percent ?? '?'}%`).join(', '));
        usage = parseUsage(raw, cred.plan, cred.tier);
        console.log(`  ✓  Session: ${usage.session.pct}%, Weekly: ${usage.weekly.pct}%, Plan: ${usage.plan}`);
        console.log(`  ✓  Models parsed: ${usage.models.map(m => `${m.name}:${m.pct}%`).join(', ') || 'none'}`);
        lastGoodUsage = usage;
      } catch (err) {
        console.log(`  ✗  ${err.message}`);
        if (/HTTP 429/.test(err.message)) {
          const waitMs = err.retryAfter ? (err.retryAfter + 5) * 1000 : 10 * 60_000;
          claudeBackoffUntil = Date.now() + waitMs;
          console.log(`  ⏸  429 — backing off ${Math.round(waitMs / 60000)} min${err.retryAfter ? ' (server retry-after)' : ' (default)'}`);
        }
        // Serve stale-but-real data over fake demo data
        usage = lastGoodUsage
          ? { ...lastGoodUsage, stale: true, error: err.message }
          : { ...mockUsage(), error: err.message };
      }
    }
  }

  usage.codex = MOCK_MODE
    ? { session: { pct: 41, resetAt: new Date(Date.now() + 2.2 * 3600000).toISOString() },
        weekly: { pct: 67, resetAt: new Date(Date.now() + 2 * 86400000).toISOString() } }
    : await pollCodex();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage-update', usage);
  }
}

// ═══════════════════════════════════════════
//  IPC
// ═══════════════════════════════════════════
let lastManualRefresh = 0;
ipcMain.handle('refresh', async () => {
  const now = Date.now();
  if (now - lastManualRefresh < 30_000) {
    console.log('  ⏸  Refresh debounced (30s min between manual refreshes)');
    return;
  }
  lastManualRefresh = now;
  await poll();
});
ipcMain.handle('resize', (_e, h) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const height = Math.max(200, Math.min(800, Math.round(h)));
  if (b.height !== height) mainWindow.setBounds({ ...b, height });
});
ipcMain.handle('close', () => { app.quit(); });
ipcMain.handle('minimize', () => { mainWindow?.hide(); });

// ═══════════════════════════════════════════
//  App lifecycle
// ═══════════════════════════════════════════
app.whenReady().then(async () => {
  createWindow();
  createTray();
  console.log('');
  console.log('  🐹 Claude Runner');
  console.log(`  ── ${MOCK_MODE ? '🎭 demo' : '🔑 live'} mode`);
  console.log(`  ── Claude Code ${getClaudeVersion()}`);
  console.log('');
  await poll();
  pollTimer = setInterval(poll, POLL_INTERVAL);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!mainWindow) createWindow(); else mainWindow.show();
});
app.on('before-quit', () => { if (pollTimer) clearInterval(pollTimer); });
