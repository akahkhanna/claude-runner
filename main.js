const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const MOCK_MODE = process.argv.includes('--mock');
const POLL_INTERVAL = 180_000;
const WIN_WIDTH = 280;
const WIN_HEIGHT = 440;

let mainWindow = null;
let tray = null;
let pollTimer = null;

// ═══════════════════════════════════════════
//  Window
// ═══════════════════════════════════════════
function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: WIN_WIDTH, height: WIN_HEIGHT,
    x: screenW - WIN_WIDTH - 20, y: 60,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: true,
    vibrancy: 'under-window', visualEffectState: 'active', roundedCorners: true,
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
function getClaudeVersion() {
  try {
    const o = execSync('claude --version', { timeout: 5000, encoding: 'utf-8' }).trim();
    const m = o.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : '2.1.0';
  } catch { return '2.1.0'; }
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

  // Per-model from limits array
  const models = [];
  if (Array.isArray(raw.limits)) {
    for (const lim of raw.limits) {
      if (lim.kind === 'session') {
        session.severity = lim.severity; // normal, warning, critical
        session.isActive = lim.is_active;
      }
      if (lim.scope?.model?.display_name) {
        models.push({
          id: lim.scope.model.display_name.toLowerCase(),
          name: lim.scope.model.display_name,
          pct: lim.percent ?? 0,
          severity: lim.severity,
        });
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
    models: [],
    plan: 'demo',
    tier: '',
    mock: true,
  };
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
    } else {
      try {
        const raw = await fetchUsageAPI(cred.token);
        usage = parseUsage(raw, cred.plan, cred.tier);
        console.log(`  ✓  Session: ${usage.session.pct}%, Weekly: ${usage.weekly.pct}%, Plan: ${usage.plan}`);
      } catch (err) {
        console.log(`  ✗  ${err.message}`);
        usage = mockUsage();
        usage.error = err.message;
      }
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage-update', usage);
  }
}

// ═══════════════════════════════════════════
//  IPC
// ═══════════════════════════════════════════
ipcMain.handle('refresh', async () => { await poll(); });
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
