/**
 * Host half of the `open-in-ide` bundle.
 *
 * Two routes:
 * - `GET /open-in-ide/editors` scans this host for the supported IDEs and
 *   reports which ones it can launch; the Settings → General row lists only
 *   those.
 * - `POST /open-in-ide/open` receives `{ sessionId, path, line, column,
 *   editor }`, resolves the path in the Session's workspace, then launches the
 *   selected editor at the referenced line. A directory is opened as a workspace
 *   folder instead.
 *
 * Two editor families are supported, each with its own launcher contract:
 * - VS Code family (VS Code, VS Code Insiders, Cursor, Windsurf):
 *   `--goto <path>:<line>:<column>`
 * - JetBrains family (IntelliJ IDEA, PyCharm, WebStorm, GoLand, CLion, PhpStorm,
 *   Rider, RubyMine, DataGrip, RustRover): `--line <line> <path>`
 *
 * Security: both routes are fenced by the composition's `connection` service
 * first (Host/Origin trust plus browser authentication), and the open route
 * validates its body at the wire. Launching only ever uses an executable this
 * host resolved: the browser names an editor id from a fixed set, never a
 * command line.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Absolute route path; the browser half fetches its document-relative form. */
const ROUTE_PATH = '/open-in-ide/open'
/** GET route path serving the IDEs detected on this host. */
const EDITORS_PATH = '/open-in-ide/editors'
/** Editor used when neither the request nor the row config names one. */
const DEFAULT_EDITOR = 'vscode'

/** Launcher contract of one editor family. */
const KIND_VSCODE = 'vscode'
const KIND_JETBRAINS = 'jetbrains'

/** VS Code family ids, in preference order. */
const VSCODE_EDITOR_ORDER = ['vscode', 'vscode-insiders', 'cursor', 'windsurf']

/**
 * JetBrains products this plugin can launch, in preference order.
 * `winFolders` match the versioned install-directory names under
 * `%ProgramFiles%\JetBrains`; `toolbox` prefixes match JetBrains Toolbox app
 * directories and launcher scripts; `macApps` are the `.app` bundle names;
 * `linuxPaths` are guessed launcher scripts (PATH names are always appended).
 */
const JETBRAINS_PRODUCTS = [
  {
    id: 'idea',
    label: 'IntelliJ IDEA',
    cli: 'idea',
    winExe: 'idea64.exe',
    winFolders: ['IntelliJ IDEA'],
    toolbox: ['idea-u', 'idea-c', 'intellij idea'],
    macApps: ['IntelliJ IDEA', 'IntelliJ IDEA CE'],
    linuxPaths: ['/opt/idea/bin/idea.sh', '/usr/bin/idea', '/snap/bin/intellij-idea-ultimate'],
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    cli: 'pycharm',
    winExe: 'pycharm64.exe',
    winFolders: ['PyCharm'],
    toolbox: ['pycharm', 'py', 'pc'],
    macApps: ['PyCharm', 'PyCharm CE'],
    linuxPaths: ['/opt/pycharm/bin/pycharm.sh', '/usr/bin/pycharm'],
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    cli: 'webstorm',
    winExe: 'webstorm64.exe',
    winFolders: ['WebStorm'],
    toolbox: ['webstorm', 'ws'],
    macApps: ['WebStorm'],
    linuxPaths: ['/opt/webstorm/bin/webstorm.sh', '/usr/bin/webstorm'],
  },
  {
    id: 'goland',
    label: 'GoLand',
    cli: 'goland',
    winExe: 'goland64.exe',
    winFolders: ['GoLand'],
    toolbox: ['goland', 'go'],
    macApps: ['GoLand'],
    linuxPaths: ['/opt/goland/bin/goland.sh', '/usr/bin/goland'],
  },
  {
    id: 'clion',
    label: 'CLion',
    cli: 'clion',
    winExe: 'clion64.exe',
    winFolders: ['CLion'],
    toolbox: ['clion', 'cl'],
    macApps: ['CLion'],
    linuxPaths: ['/opt/clion/bin/clion.sh', '/usr/bin/clion'],
  },
  {
    id: 'phpstorm',
    label: 'PhpStorm',
    cli: 'phpstorm',
    winExe: 'phpstorm64.exe',
    winFolders: ['PhpStorm'],
    toolbox: ['phpstorm', 'ps'],
    macApps: ['PhpStorm'],
    linuxPaths: ['/opt/phpstorm/bin/phpstorm.sh', '/usr/bin/phpstorm'],
  },
  {
    id: 'rider',
    label: 'Rider',
    cli: 'rider',
    winExe: 'rider64.exe',
    winFolders: ['Rider'],
    toolbox: ['rider', 'rd'],
    macApps: ['Rider'],
    linuxPaths: ['/opt/rider/bin/rider.sh', '/usr/bin/rider'],
  },
  {
    id: 'rubymine',
    label: 'RubyMine',
    cli: 'rubymine',
    winExe: 'rubymine64.exe',
    winFolders: ['RubyMine'],
    toolbox: ['rubymine', 'rm'],
    macApps: ['RubyMine'],
    linuxPaths: ['/opt/rubymine/bin/rubymine.sh', '/usr/bin/rubymine'],
  },
  {
    id: 'datagrip',
    label: 'DataGrip',
    cli: 'datagrip',
    winExe: 'datagrip64.exe',
    winFolders: ['DataGrip'],
    toolbox: ['datagrip', 'dg'],
    macApps: ['DataGrip'],
    linuxPaths: ['/opt/datagrip/bin/datagrip.sh', '/usr/bin/datagrip'],
  },
  {
    id: 'rustrover',
    label: 'RustRover',
    cli: 'rustrover',
    winExe: 'rustrover64.exe',
    winFolders: ['RustRover'],
    toolbox: ['rustrover', 'rr'],
    macApps: ['RustRover'],
    linuxPaths: ['/opt/rustrover/bin/rustrover.sh', '/usr/bin/rustrover'],
  },
]

/** JetBrains ids, in preference order. */
const JETBRAINS_IDS = JETBRAINS_PRODUCTS.map((product) => product.id)
/** Every editors id this plugin can launch, in preference order. */
const EDITOR_ORDER = [...VSCODE_EDITOR_ORDER, ...JETBRAINS_IDS]
const EDITOR_IDS = new Set(EDITOR_ORDER)

/** Windows process names per VS Code-family id, used to raise the IDE window. */
const EDITOR_WINDOW_PROCESSES = {
  vscode: ['Code.exe'],
  'vscode-insiders': ['Code - Insiders.exe'],
  cursor: ['Cursor.exe'],
  windsurf: ['Windsurf.exe'],
}
/** macOS application names used by `osascript … activate`. */
const EDITOR_MAC_APPS = {
  vscode: 'Visual Studio Code',
  'vscode-insiders': 'Visual Studio Code - Insiders',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
}
/** Where the Windows focus helper script lives between clicks. */
const FOCUS_SCRIPT_PATH = join(tmpdir(), 'dsh-open-in-ide-focus.ps1')

/**
 * Files and directories that mark a project root while walking up from a file.
 * `.git`/`.hg` win over the rest, so a repository root is preferred over a
 * nested package manifest.
 */
const DEFAULT_PROJECT_MARKERS = [
  '.git',
  '.hg',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'pubspec.yaml',
  'CMakeLists.txt',
]

/** Request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024
/** Longest path accepted from the browser. */
const MAX_PATH_LENGTH = 4096
/** Largest line/column number accepted; the editor rejects absurd targets too. */
const MAX_POSITION = 10_000_000
/** Environment names never handed to a launched editor. */
const SENSITIVE_ENV = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION_ID)/i

/** Services this plugin needs; activating without one would leave it half-wired. */
export const inject = ['webServer', 'connection', 'subprocess', 'fs', 'sessions']

/** One explicit failure carrying the HTTP status the route should answer. */
class RouteError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Read the raw row config defensively: the plugin ships no Config schema. */
function normalizeConfig(input) {
  const value = typeof input === 'object' && input !== null ? input : {}
  const extraArgs = Array.isArray(value.extraArgs)
    ? value.extraArgs.filter((entry) => typeof entry === 'string')
    : []
  const watch = Number(value.launchWatchMs)
  const focusDelay = Number(value.focusDelayMs)
  const editor = typeof value.editor === 'string' ? value.editor.trim() : ''
  const markers = Array.isArray(value.projectMarkers)
    ? value.projectMarkers.filter((entry) => typeof entry === 'string' && entry !== '' && !/[\\/]/u.test(entry))
    : []
  return {
    command: typeof value.command === 'string' ? value.command.trim() : '',
    commandKind: value.commandKind === KIND_JETBRAINS ? KIND_JETBRAINS : KIND_VSCODE,
    editor: EDITOR_IDS.has(editor) ? editor : DEFAULT_EDITOR,
    extraArgs,
    focusDelayMs: Number.isFinite(focusDelay) ? Math.max(0, Math.min(5000, Math.trunc(focusDelay))) : 350,
    focusWindow: value.focusWindow !== false,
    openProjectFolder: value.openProjectFolder !== false,
    projectMarkers: markers.length > 0 ? markers : DEFAULT_PROJECT_MARKERS,
    reuseWindow: value.reuseWindow === true,
    launchWatchMs: Number.isFinite(watch) ? Math.max(250, Math.min(60_000, Math.trunc(watch))) : 2000,
  }
}

/** POSIX absolute path or Windows drive/UNC path. */
function isAbsolutePath(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

/** JSON response helper (live facts; never cached). */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling. */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Validate one open request body at the wire. */
function parseBody(text) {
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { sessionId, path, cwd, line, column, editor } = body
  if (typeof path !== 'string') return null
  const trimmed = path.trim()
  if (trimmed === '' || trimmed.length > MAX_PATH_LENGTH) return null
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  const position = (value) => {
    if (value === undefined || value === null) return undefined
    if (!Number.isInteger(value) || value < 1 || value > MAX_POSITION) return null
    return value
  }
  const parsedLine = position(line)
  const parsedColumn = position(column)
  if (parsedLine === null || parsedColumn === null) return null
  return {
    sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
    path: trimmed,
    cwd: typeof cwd === 'string' && cwd !== '' && cwd.length <= MAX_PATH_LENGTH ? cwd : null,
    line: parsedLine,
    column: parsedColumn,
    editor: typeof editor === 'string' && EDITOR_IDS.has(editor) ? editor : null,
  }
}

/** Windows argv quoting for a `cmd.exe /d /s /c` command line. */
function quoteCmdArg(value) {
  return '"' + String(value).replace(/"/g, '""') + '"'
}

/**
 * Build the full `cmd.exe /s /c` command string. The extra outer quotes make
 * `/s` strip exactly one wrapper, leaving the correctly quoted launcher call.
 */
function buildCmdLine(command, args) {
  return '"' + [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ') + '"'
}

/** Child environment: inherit the caller's, minus credential-looking names. */
function childEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key === 'ELECTRON_RUN_AS_NODE') continue
    if (SENSITIVE_ENV.test(key)) continue
    env[key] = value
  }
  return env
}

/**
 * Launch the editor detached from this process: no stdio pipe, outliving dsh.
 * Launch success is decoupled from process lifetime — a launcher still running
 * when the watch window closes counts as launched; a spawn error or a nonzero
 * exit inside the window is a failure.
 * @returns a promise resolving once the launch is counted successful.
 */
function launchEditor(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const windowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
    const spawnOptions = {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnvironment(),
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
    }
    let child
    try {
      child = windowsScript
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', buildCmdLine(command, args)], {
          ...spawnOptions,
          windowsVerbatimArguments: true,
        })
        : spawn(command, args, spawnOptions)
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    const settle = (finish, value) => {
      if (settled) return
      settled = true
      clearTimeout(watch)
      child.unref()
      finish(value)
    }
    const watch = setTimeout(() => settle(resolvePromise), options.watchMs)
    child.on('error', (error) => settle(reject, error))
    child.on('exit', (code, signal) => {
      if (code === 0) settle(resolvePromise)
      else settle(reject, new Error(`editor launcher exited with code ${String(code)}, signal ${String(signal)}`))
    })
  })
}

/**
 * Windows helper that raises the editor window. Windows denies foreground
 * changes to processes without foreground rights (a background host launching
 * the editor CLI), so the script restores a minimized window, retries with a
 * synthetic ALT press to unlock the foreground lock, and finally falls back to
 * `SwitchToThisWindow`. It prints one JSON line.
 */
const FOCUS_SCRIPT = String.raw`param(
  [string]$ProcessNameList = '',
  [string]$TitleHintList = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DshWindowFocus
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    public static List<IntPtr> Handles(IntPtr ignored)
    {
        var list = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => { list.Add(hWnd); return true; }, IntPtr.Zero);
        return list;
    }

    public static string TitleOf(IntPtr hWnd)
    {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return string.Empty;
        var buffer = new StringBuilder(length + 1);
        GetWindowText(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    public static uint ProcessOf(IntPtr hWnd)
    {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        return pid;
    }

    public static bool Focus(IntPtr hWnd)
    {
        if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
        SetForegroundWindow(hWnd);
        if (GetForegroundWindow() == hWnd) return true;
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(hWnd);
        if (GetForegroundWindow() == hWnd) return true;
        SwitchToThisWindow(hWnd, true);
        return GetForegroundWindow() == hWnd;
    }
}
'@

$names = @{}
foreach ($name in ($ProcessNameList -split ';')) {
  $trimmed = $name.Trim()
  if ($trimmed -eq '') { continue }
  $base = [System.IO.Path]::GetFileNameWithoutExtension($trimmed)
  Get-Process -Name $base -ErrorAction SilentlyContinue | ForEach-Object { $names[[int]$_.Id] = $true }
}

$candidates = New-Object System.Collections.ArrayList
foreach ($handle in [DshWindowFocus]::Handles([IntPtr]::Zero)) {
  if (-not [DshWindowFocus]::IsWindowVisible($handle)) { continue }
  $processId = [DshWindowFocus]::ProcessOf($handle)
  if (-not $names.ContainsKey([int]$processId)) { continue }
  $title = [DshWindowFocus]::TitleOf($handle)
  if ([string]::IsNullOrWhiteSpace($title)) { continue }
  [void]$candidates.Add([pscustomobject]@{ Handle = $handle; Title = $title; ProcessId = [int]$processId })
}

if ($candidates.Count -eq 0) {
  Write-Output '{"found":false,"focused":false,"reason":"no-window"}'
  exit 0
}

$hints = @()
foreach ($hint in ($TitleHintList -split '\|')) {
  $trimmed = $hint.Trim()
  if ($trimmed -ne '') { $hints += $trimmed.ToLowerInvariant() }
}

$target = $null
$bestScore = 0
foreach ($candidate in $candidates) {
  $title = $candidate.Title.ToLowerInvariant()
  $score = 0
  foreach ($hint in $hints) { if ($title.Contains($hint)) { $score += 1 } }
  if ($score -gt $bestScore) { $bestScore = $score; $target = $candidate }
}
if ($null -eq $target) { $target = $candidates | Select-Object -First 1 }

$focused = [DshWindowFocus]::Focus($target.Handle)
[pscustomobject]@{
  found = $true
  focused = [bool]$focused
  candidates = $candidates.Count
  score = $bestScore
} | ConvertTo-Json -Compress
`

/** Resolve after `ms` milliseconds. */
function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

/** Run one short helper command, capturing stdout; resolves with exit status. */
function runHelper(command, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: childEnvironment(),
      })
    } catch {
      resolvePromise({ status: null, stdout: '' })
      return
    }
    let stdout = ''
    let settled = false
    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ status, stdout })
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish(null)
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', () => finish(null))
    child.on('exit', (code) => finish(code))
  })
}

/** Write the focus helper script once and keep it current. */
function ensureFocusScript() {
  try {
    let current
    try {
      current = readFileSync(FOCUS_SCRIPT_PATH, 'utf8')
    } catch {
      current = undefined
    }
    if (current !== FOCUS_SCRIPT) writeFileSync(FOCUS_SCRIPT_PATH, FOCUS_SCRIPT, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Parse the helper's last JSON line. */
function parseFocusResult(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/u)
  const line = lines.filter((entry) => entry.trim().startsWith('{')).pop()
  if (line === undefined) return undefined
  try {
    const parsed = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Process names whose windows belong to the selected editor. */
function windowProcessNames(editor, command) {
  const known = EDITOR_WINDOW_PROCESSES[editor]
  if (known !== undefined) return known
  const product = JETBRAINS_PRODUCTS.find((entry) => entry.id === editor)
  if (product !== undefined) return [product.winExe]
  const base = basename(command).toLowerCase()
  if (base === 'code.cmd' || base === 'code' || base === 'code.exe') return ['Code.exe']
  if (base === 'code-insiders.cmd' || base === 'code-insiders' || base === 'code-insiders.exe') return ['Code - Insiders.exe']
  if (base === 'cursor.cmd' || base === 'cursor' || base === 'cursor.exe') return ['Cursor.exe']
  if (base === 'windsurf.cmd' || base === 'windsurf' || base === 'windsurf.exe') return ['Windsurf.exe']
  return base.endsWith('.exe') ? [basename(command)] : []
}

/** macOS application names for one editor id. */
function editorAppNames(editor) {
  const known = EDITOR_MAC_APPS[editor]
  if (known !== undefined) return [known]
  const product = JETBRAINS_PRODUCTS.find((entry) => entry.id === editor)
  return product === undefined ? [] : product.macApps
}

/** Windows: restore and raise the editor window, matching by title hints. */
async function focusWindowsEditor(editor, command, hints, config) {
  const names = windowProcessNames(editor, command)
  if (names.length === 0 || !ensureFocusScript()) return undefined
  const titleHints = hints.filter((hint) => typeof hint === 'string' && hint !== '').join('|')
  let seen
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await delay(attempt === 0 ? config.focusDelayMs : 700)
    const result = await runHelper('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      FOCUS_SCRIPT_PATH,
      '-ProcessNameList',
      names.join(';'),
      '-TitleHintList',
      titleHints,
    ], 6000)
    seen = parseFocusResult(result.stdout)
    if (seen?.focused === true) return true
    if (seen?.found === true && attempt >= 1) break
  }
  return seen?.focused === true
}

/** macOS: ask the application to activate. */
async function focusMacEditor(editor) {
  for (const app of editorAppNames(editor)) {
    const result = await runHelper('osascript', ['-e', `tell application "${app.replace(/"/g, '\\"')}" to activate`], 3000)
    if (result.status === 0) return true
  }
  return undefined
}

/** Linux: best-effort raise through the usual window tools. */
async function focusLinuxEditor(hints) {
  const hint = hints.find((entry) => typeof entry === 'string' && entry !== '')
  if (hint === undefined) return undefined
  const attempts = [
    ['wmctrl', ['-a', hint]],
    ['xdotool', ['search', '--name', hint, 'windowactivate']],
  ]
  for (const [command, args] of attempts) {
    const result = await runHelper(command, args, 2500)
    if (result.status === 0) return true
  }
  return undefined
}

/** Bring the selected editor's window to the foreground after a launch. */
async function focusEditorWindow(editor, command, hints, config) {
  try {
    if (process.platform === 'win32') return await focusWindowsEditor(editor, command, hints, config)
    if (process.platform === 'darwin') return await focusMacEditor(editor)
    return await focusLinuxEditor(hints)
  } catch {
    return undefined
  }
}

/** Direct child directory names, or [] when the path is not a readable directory. */
function readDirectories(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Windows standalone installs: `%ProgramFiles%\JetBrains\<Product 2024.3>\bin\<exe>`.
 * The product directory is versioned, so the root is scanned by prefix.
 */
function windowsInstallCandidates(root, folders, exe) {
  const candidates = []
  for (const name of readDirectories(root)) {
    const lower = name.toLowerCase()
    if (!folders.some((prefix) => lower.startsWith(prefix.toLowerCase()))) continue
    const launch = join(root, name, 'bin', exe)
    if (existsSync(launch)) candidates.push(launch)
  }
  return candidates
}

/**
 * JetBrains Toolbox installs:
 * `%LOCALAPPDATA%\JetBrains\Toolbox\apps\<app>\ch-<n>\<version>\bin\<exe>`.
 * App directory names vary across Toolbox versions, so prefix matching is used.
 */
function toolboxAppCandidates(appsRoot, tokens, exe) {
  const candidates = []
  for (const appName of readDirectories(appsRoot)) {
    const lower = appName.toLowerCase()
    if (!tokens.some((token) => lower.startsWith(token))) continue
    for (const channel of readDirectories(join(appsRoot, appName))) {
      if (!/^ch-\d+$/iu.test(channel)) continue
      for (const version of readDirectories(join(appsRoot, appName, channel))) {
        const launch = join(appsRoot, appName, channel, version, 'bin', exe)
        if (existsSync(launch)) candidates.push(launch)
      }
    }
  }
  return candidates
}

/** Candidate launchers for one JetBrains product on this platform. */
function jetBrainsCandidates(product) {
  const candidates = []
  const home = homedir()
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (typeof localAppData === 'string' && localAppData !== '') {
      const toolboxRoot = join(localAppData, 'JetBrains', 'Toolbox')
      for (const extension of ['cmd', 'bat']) {
        candidates.push(join(toolboxRoot, 'scripts', `${product.cli}.${extension}`))
      }
      candidates.push(
        ...toolboxAppCandidates(join(toolboxRoot, 'apps'), product.toolbox, product.winExe),
      )
    }
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (typeof root !== 'string' || root === '') continue
      candidates.push(...windowsInstallCandidates(join(root, 'JetBrains'), product.winFolders, product.winExe))
    }
    // PATH names last: Toolbox script directories are commonly added to PATH.
    candidates.push(product.cli, product.winExe.replace(/\.exe$/u, ''))
    return candidates
  }
  if (process.platform === 'darwin') {
    for (const app of product.macApps) {
      candidates.push(`/Applications/${app}.app/Contents/MacOS/${product.cli}`)
      candidates.push(join(home, 'Applications', `${app}.app`, 'Contents', 'MacOS', product.cli))
    }
    candidates.push(product.cli)
    return candidates
  }
  // Linux: Toolbox launcher scripts, guessed install paths, then PATH.
  candidates.push(
    join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts', product.cli),
    ...product.linuxPaths,
    product.cli,
  )
  return candidates
}

/** VS Code family macOS launcher candidates for one bundle spelling. */
function macVscodeCandidates(appName, cli) {
  const home = homedir()
  return [
    `/Applications/${appName}.app/Contents/Resources/app/bin/${cli}`,
    join(home, 'Applications', `${appName}.app`, 'Contents', 'Resources', 'app', 'bin', cli),
  ]
}

/**
 * Candidate CLIs for one editor id on this platform, in preference order.
 * A bare name at the end of each list is resolved through the composition's
 * PATH, which is the last-resort locator.
 */
function editorCandidates(editor) {
  const product = JETBRAINS_PRODUCTS.find((entry) => entry.id === editor)
  if (product !== undefined) return jetBrainsCandidates(product)

  const candidates = []
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter((root) => typeof root === 'string' && root !== '')
    switch (editor) {
      case 'vscode':
        for (const root of roots) candidates.push(join(root, 'Microsoft VS Code', 'bin', 'code.cmd'))
        for (const root of roots) candidates.push(join(root, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'))
        candidates.push('code')
        break
      case 'vscode-insiders':
        for (const root of roots) candidates.push(join(root, 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'))
        for (const root of roots) candidates.push(join(root, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'))
        candidates.push('code-insiders')
        break
      case 'cursor':
        for (const root of roots) {
          candidates.push(join(root, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'))
          candidates.push(join(root, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'))
          candidates.push(join(root, 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'))
        }
        candidates.push('cursor')
        break
      case 'windsurf':
        for (const root of roots) {
          candidates.push(join(root, 'Programs', 'Windsurf', 'bin', 'windsurf.cmd'))
          candidates.push(join(root, 'Windsurf', 'bin', 'windsurf.cmd'))
        }
        candidates.push('windsurf')
        break
      default:
        break
    }
    return candidates
  }
  if (process.platform === 'darwin') {
    switch (editor) {
      case 'vscode':
        candidates.push(...macVscodeCandidates('Visual Studio Code', 'code'), 'code')
        break
      case 'vscode-insiders':
        candidates.push(...macVscodeCandidates('Visual Studio Code - Insiders', 'code-insiders'), 'code-insiders')
        break
      case 'cursor':
        candidates.push(...macVscodeCandidates('Cursor', 'cursor'), 'cursor')
        break
      case 'windsurf':
        candidates.push(...macVscodeCandidates('Windsurf', 'windsurf'), 'windsurf')
        break
      default:
        break
    }
    return candidates
  }
  switch (editor) {
    case 'vscode':
      candidates.push('/usr/bin/code', '/usr/share/code/bin/code', '/snap/bin/code', '/opt/visual-studio-code/bin/code', 'code')
      break
    case 'vscode-insiders':
      candidates.push('/usr/bin/code-insiders', '/usr/share/code-insiders/bin/code-insiders', '/snap/bin/code-insiders', 'code-insiders')
      break
    case 'cursor':
      candidates.push('/usr/share/cursor/bin/cursor', '/opt/cursor/bin/cursor', 'cursor')
      break
    case 'windsurf':
      candidates.push('/usr/share/windsurf/bin/windsurf', '/opt/windsurf/bin/windsurf', 'windsurf')
      break
    default:
      break
  }
  return candidates
}

/**
 * Resolve one candidate into a launchable executable path, or undefined.
 * An explicit path is accepted only when it exists; a bare name goes through
 * the composition's PATH resolver.
 */
async function resolveCandidate(ctx, candidate) {
  if (isAbsolutePath(candidate)) return existsSync(candidate) ? candidate : undefined
  try {
    return await ctx.subprocess.resolveExecutable(candidate)
  } catch {
    return undefined
  }
}

/** Launcher contract of one editor id. */
function editorKind(editor) {
  return JETBRAINS_IDS.includes(editor) ? KIND_JETBRAINS : KIND_VSCODE
}

function editorLabelOf(editor) {
  const product = JETBRAINS_PRODUCTS.find((entry) => entry.id === editor)
  if (product !== undefined) return product.label
  switch (editor) {
    case 'vscode':
      return 'Visual Studio Code'
    case 'vscode-insiders':
      return 'VS Code Insiders'
    case 'cursor':
      return 'Cursor'
    case 'windsurf':
      return 'Windsurf'
    default:
      return editor
  }
}

/** Resolve one editor id to its launcher on this host, or undefined. */
async function resolveEditorCommand(ctx, editor) {
  for (const candidate of editorCandidates(editor)) {
    const resolved = await resolveCandidate(ctx, candidate)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** Resolve one editor id on this host, or throw the route's failure. */
async function resolveEditor(ctx, editor) {
  const command = await resolveEditorCommand(ctx, editor)
  if (command !== undefined) return command
  throw new RouteError(
    502,
    'editor-not-found',
    `no ${editorLabelOf(editor)} launcher was found on this host; pick another IDE in Settings → General or set config.command`,
  )
}

/**
 * The editor this click launches, with provenance for errors and the response.
 * Precedence: an explicit `command` in the row config (with its `commandKind`),
 * then the IDE chosen in the browser (Settings → General), then the row config
 * `editor`, then VS Code.
 */
async function resolveLauncher(ctx, config, requestedEditor) {
  if (config.command !== '') {
    const resolved = await resolveCandidate(ctx, config.command)
    if (resolved === undefined) {
      throw new RouteError(502, 'editor-not-found', `configured editor command was not found: ${config.command}`)
    }
    return { command: resolved, configured: true, editor: 'custom', kind: config.commandKind }
  }
  const editor = requestedEditor ?? config.editor
  const command = await resolveEditor(ctx, editor)
  return { command, configured: false, editor, kind: editorKind(editor) }
}

/**
 * Find the project root a file belongs to: the nearest VCS root, or else the
 * nearest project manifest, walking up from the file's directory. Returns
 * undefined when no marker is found, in which case the editor opens the file
 * without a folder argument.
 */
function projectRootOf(filePath, markers) {
  const manifestMarkers = markers.filter((marker) => marker !== '.git' && marker !== '.hg')
  const vcsMarkers = markers.filter((marker) => marker === '.git' || marker === '.hg')
  let directory = dirname(filePath)
  let nearestManifest
  for (let depth = 0; depth < 24; depth += 1) {
    for (const marker of vcsMarkers) {
      if (existsSync(join(directory, marker))) return directory
    }
    if (nearestManifest === undefined) {
      for (const marker of manifestMarkers) {
        if (existsSync(join(directory, marker))) {
          nearestManifest = directory
          break
        }
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return nearestManifest
}

/**
 * Build the launcher arguments for one editor family.
 * VS Code family: `--goto <path>:<line>[:<column>]`, plus the project folder so
 * a window without that folder opens the project instead of dropping a loose
 * file into the most recent window.
 * JetBrains family: `--line <line> <path>` (no column support); the IDE manages
 * projects itself, so no folder argument is added.
 * A configured `command` follows the same families through `commandKind`.
 */
function launchArgs(kind, target, line, column, config, projectRoot) {
  const args = [...config.extraArgs]
  if (kind === KIND_JETBRAINS) {
    if (target.type === 'file' && line !== undefined) args.push('--line', String(line))
    args.push(target.processPath)
    return args
  }
  if (config.reuseWindow) args.push('--reuse-window')
  if (target.type === 'file' && line !== undefined) {
    args.push('--goto', column === undefined ? `${target.processPath}:${line}` : `${target.processPath}:${line}:${column}`)
  } else {
    args.push(target.processPath)
  }
  if (projectRoot !== undefined && target.type === 'file') args.push(projectRoot)
  return args
}

/** Resolve the workspace directory a click belongs to. */
function workspaceDirectoryOf(ctx, sessionId, bodyCwd) {
  if (sessionId !== null) {
    const session = ctx.sessions?.get?.(sessionId)
    if (session !== undefined) {
      const working = ctx.get?.('workingDirectory')
      if (working !== undefined) {
        try {
          return working.get(session)
        } catch {
          /* fall through to the header value */
        }
      }
      if (typeof session.header?.cwd === 'string') return session.header.cwd
    }
  }
  if (bodyCwd !== null && isAbsolutePath(bodyCwd)) return bodyCwd
  return undefined
}

/**
 * Inspect the clicked target through the composition filesystem first (it maps
 * paths for the session's execution world), falling back to this process's own
 * filesystem when the provider cannot resolve the path.
 */
async function inspectTarget(ctx, absolutePath) {
  try {
    const fs = ctx.fs
    const target = await fs.resolve(absolutePath)
    const info = await fs.stat(target)
    if (info === undefined) return { exists: false }
    return { exists: true, type: info.type, processPath: fs.processPath(target) }
  } catch {
    try {
      const stats = statSync(absolutePath)
      return {
        exists: true,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        processPath: absolutePath,
      }
    } catch {
      return { exists: false }
    }
  }
}

/** Register the POST route that opens a path, and the GET route listing detected IDEs. */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)

  /** Answer an untrusted/unauthenticated request; true when it was rejected. */
  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection({ headers: req.headers })
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  /**
   * Which supported IDEs this host can launch. Probing is cheap (existence
   * checks plus in-process PATH lookups), so every request reflects installs and
   * removals without a restart.
   */
  const editorsSnapshot = async () => {
    const editors = []
    for (const id of EDITOR_ORDER) {
      const command = await resolveEditorCommand(ctx, id)
      editors.push({ id, available: command !== undefined })
    }
    return editors
  }

  /** GET: the IDEs detected on this host so the settings row can list them. */
  const listEditors = async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('allow', 'GET')
      res.end()
      return
    }
    sendJson(res, 200, { ok: true, editors: await editorsSnapshot() })
  }

  const open = async (req, res) => {
    if (rejected(req, res)) return
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    if (String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
      return
    }
    let text
    try {
      text = await readBoundedBody(req)
    } catch {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body unreadable' })
      return
    }
    if (text === null) {
      sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
      return
    }
    const body = parseBody(text)
    if (body === null) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: 'body must be JSON with string "path" and optional line/column' })
      return
    }

    const workspace = workspaceDirectoryOf(ctx, body.sessionId, body.cwd)
    let absolutePath
    if (isAbsolutePath(body.path)) {
      absolutePath = body.path
    } else if (workspace !== undefined) {
      absolutePath = resolve(workspace, body.path)
    } else {
      sendJson(res, 400, {
        ok: false,
        code: 'path-not-resolvable',
        message: `cannot resolve the relative path "${body.path}" without a known workspace root`,
      })
      return
    }

    const target = await inspectTarget(ctx, absolutePath)
    if (!target.exists) {
      sendJson(res, 404, { ok: false, code: 'not-found', message: `no such file or folder: ${absolutePath}` })
      return
    }

    let launcher
    try {
      launcher = await resolveLauncher(ctx, config, body.editor)
    } catch (error) {
      if (error instanceof RouteError) {
        sendJson(res, error.status, { ok: false, code: error.code, message: error.message })
        return
      }
      throw error
    }

    // Open the file together with its project folder so VS Code opens (or
    // reuses) the project window instead of dropping a loose file into the last
    // active window. JetBrains manages projects itself, so it gets no folder.
    const projectRoot = config.openProjectFolder && target.type === 'file' && launcher.kind === KIND_VSCODE
      ? projectRootOf(target.processPath, config.projectMarkers)
      : undefined
    const args = launchArgs(launcher.kind, target, body.line, body.column, config, projectRoot)
    const startDirectory = target.type === 'directory' ? target.processPath : dirname(target.processPath)
    const cwd = existsSync(startDirectory) ? startDirectory : undefined
    try {
      await launchEditor(launcher.command, args, { watchMs: config.launchWatchMs, cwd })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.('open-in-ide: launch failed: ' + reason)
      sendJson(res, 502, { ok: false, code: 'launch-failed', message: `failed to launch the editor: ${reason}` })
      return
    }

    // A detached launch from a background host has no foreground rights, so the
    // editor can open behind the current window. Raise it explicitly.
    let focused
    if (config.focusWindow) {
      const hints = [basename(target.processPath)]
      if (projectRoot !== undefined) {
        const projectName = basename(projectRoot)
        if (projectName !== '' && !hints.includes(projectName)) hints.push(projectName)
      }
      if (workspace !== undefined) {
        const workspaceName = basename(workspace)
        if (workspaceName !== '' && !hints.includes(workspaceName)) hints.push(workspaceName)
      }
      focused = await focusEditorWindow(launcher.editor, launcher.command, hints, config)
    }

    sendJson(res, 200, {
      ok: true,
      path: target.processPath,
      type: target.type,
      line: body.line ?? null,
      column: body.column ?? null,
      project: projectRoot ?? null,
      editor: launcher.editor,
      kind: launcher.kind,
      launcher: launcher.command,
      focused: focused ?? null,
    })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: open }), `open-in-ide: POST ${ROUTE_PATH}`)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: EDITORS_PATH, handler: listEditors }), `open-in-ide: GET ${EDITORS_PATH}`)
}
