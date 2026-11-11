import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { host, temporaryDirectory } from './support.js'

/** Git 集成只操作独立临时仓库，远端也在同一临时目录，不访问网络。 */
function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return result.stdout.trim()
}

function commit(directory, name, text) {
  writeFileSync(join(directory, name), text)
  git(directory, 'add', '--', name)
  git(directory, '-c', 'user.name=Plugin Test', '-c', 'user.email=plugin-test@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=', 'commit', '-m', 'test fixture')
}

function repository(t) {
  const root = temporaryDirectory(t)
  const remote = join(root, 'remote.git')
  const local = join(root, 'local')
  const peer = join(root, 'peer')
  git(root, 'init', '--bare', '--initial-branch=main', '--template=', remote)
  git(root, 'init', '--initial-branch=main', '--template=', local)
  commit(local, 'package.json', JSON.stringify({ name: 'dsh-open-in-ide', version: '0.3.4' }))
  git(local, 'remote', 'add', 'origin', remote)
  git(local, '-c', 'core.hooksPath=', 'push', '-u', 'origin', 'main')
  git(root, 'clone', '--template=', remote, peer)
  return { local, peer, remote, route: host({ updateDirectory: local, updateRepository: remote }) }
}

test('宿主更新检查正确报告缺失 origin、缺失远程分支与游离 HEAD', async (t) => {
  for (const state of ['no-origin', 'remote-branch-missing', 'detached-head']) {
    await t.test(state, async (t) => {
      const { local, route } = repository(t)
      if (state === 'no-origin') git(local, 'remote', 'remove', 'origin')
      if (state === 'remote-branch-missing') git(local, 'checkout', '-b', 'local-only')
      if (state === 'detached-head') git(local, 'checkout', '--detach')
      const checked = await route('/open-in-ide/update')
      assert.equal(checked.body.reason, state)
      assert.equal(checked.body.updateAvailable, false)
      const updated = await route('/open-in-ide/update', 'POST')
      assert.equal(updated.body.ok, false)
      assert.equal(updated.body.applied, false)
      assert.equal(updated.body.reason, state)
    })
  }
})

test('宿主拒绝更新分叉仓库，保留本地提交', async (t) => {
  const { local, peer, route } = repository(t)
  commit(local, 'local.txt', 'local change')
  commit(peer, 'remote.txt', 'remote change')
  git(peer, '-c', 'core.hooksPath=', 'push', 'origin', 'main')
  const before = git(local, 'rev-parse', 'HEAD')
  const checked = await route('/open-in-ide/update')
  assert.equal(checked.body.ahead, 1)
  assert.equal(checked.body.behind, 1)
  assert.equal(checked.body.reason, 'diverged')
  const updated = await route('/open-in-ide/update', 'POST')
  assert.equal(updated.body.reason, 'diverged')
  assert.equal(updated.body.applied, false)
  assert.equal(git(local, 'rev-parse', 'HEAD'), before)
})

test('干净仓库可快进更新，有未提交内容时拒绝更新', async (t) => {
  const { local, peer, route } = repository(t)
  commit(peer, 'package.json', JSON.stringify({ name: 'dsh-open-in-ide', version: '0.3.5' }))
  git(peer, '-c', 'core.hooksPath=', 'push', 'origin', 'main')
  const checked = await route('/open-in-ide/update')
  assert.equal(checked.body.updateAvailable, true)
  assert.equal(checked.body.ahead, 0)
  const original = readFileSync(join(local, 'package.json'), 'utf8')
  writeFileSync(join(local, 'package.json'), original + '\n')
  assert.equal((await route('/open-in-ide/update', 'POST')).body.reason, 'dirty-working-tree')
  writeFileSync(join(local, 'package.json'), original)
  const updated = await route('/open-in-ide/update', 'POST')
  assert.equal(updated.body.ok, true)
  assert.equal(updated.body.applied, true)
  assert.equal(updated.body.latest, '0.3.5')
  assert.equal(git(local, 'rev-parse', 'HEAD'), git(peer, 'rev-parse', 'HEAD'))
})

// 用无副作用的捕获启动器代替真实 IDE，验证 CMD 和批处理二次转发后的实际参数。
test('Windows 批处理启动保留特殊路径、引号和尾部反斜杠', { skip: process.platform !== 'win32' }, async (t) => {
  const root = temporaryDirectory(t)
  const directory = join(root, '中文 空格 %DSH_TEST_EXPAND% & ! ^ (dir)')
  mkdirSync(directory)
  const command = join(directory, 'capture.cmd')
  const output = join(root, 'argv.json')
  const script = join(directory, 'capture.cjs')
  const file = join(directory, 'file %DSH_TEST_EXPAND% & ! ^ (1).vue')
  writeFileSync(file, '')
  writeFileSync(script, '// 捕获传给编辑器的实际参数，不打开任何窗口。\nrequire("node:fs").writeFileSync(process.env.DSH_TEST_OUTPUT, JSON.stringify(process.argv.slice(2)))\n')
  writeFileSync(command, '@echo off\r\nsetlocal\r\n"%DSH_TEST_NODE%" "%~dp0capture.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n')
  const saved = Object.fromEntries(['DSH_TEST_NODE', 'DSH_TEST_OUTPUT', 'DSH_TEST_EXPAND'].map((name) => [name, process.env[name]]))
  Object.assign(process.env, { DSH_TEST_NODE: process.execPath, DSH_TEST_OUTPUT: output, DSH_TEST_EXPAND: 'must-not-expand' })
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const extraArgs = ['--label=a"b', '--quoted=a\\"b', directory + '\\']
  const route = host({ command, extraArgs, openProjectFolder: false })
  const result = await route('/open-in-ide/open', 'POST', { path: file, line: 405, column: 7 })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [...extraArgs, '--goto', `${file}:405:7`])
})

// 编译真实助手源码，验证编辑器进程晚于助手出现时仍能被下一轮轮询发现。
test('Windows 置前助手等待冷启动期间新出现的进程', { skip: process.platform !== 'win32' }, async (t) => {
  const compiler = ['Framework64', 'Framework'].map((name) => join(process.env.WINDIR, 'Microsoft.NET', name, 'v4.0.30319', 'csc.exe')).find(existsSync)
  if (compiler === undefined) return t.skip('C# compiler unavailable')
  const directory = temporaryDirectory(t)
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8').match(/const FOCUS_HELPER_SOURCE = String\.raw`([\s\S]*?)\n`/u)[1]
  const sourcePath = join(directory, 'focus.cs')
  const helper = join(directory, 'focus.exe')
  const late = join(directory, 'late-' + randomUUID().slice(0, 8) + '.exe')
  writeFileSync(sourcePath, source)
  const compiled = spawnSync(compiler, ['/nologo', `/out:${helper}`, sourcePath], { encoding: 'utf8', windowsHide: true, timeout: 25_000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  copyFileSync(helper, late)
  const started = performance.now()
  const first = spawn(helper, ['-ProcessNameList', basename(late), '-PollMs', '20', '-TimeoutMs', '900'], { windowsHide: true })
  let output = ''
  first.stdout.on('data', (chunk) => { output += chunk })
  const completed = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', resolve) })
  let second
  let secondCompleted
  const timer = setTimeout(() => {
    second = spawn(late, ['-ProcessNameList', 'DshMissing-' + randomUUID(), '-TimeoutMs', '1600'], { windowsHide: true, stdio: 'ignore' })
    secondCompleted = new Promise((resolve, reject) => { second.on('error', reject); second.on('close', resolve) })
  }, 200)
  try {
    assert.equal(await completed, 0)
    assert.ok(performance.now() - started >= 800, 'must wait for late process instead of returning immediately')
    assert.equal(JSON.parse(output).reason, 'no-window')
  } finally {
    clearTimeout(timer)
    if (first.exitCode === null) { first.kill(); await completed }
    if (second !== undefined) { second.kill(); await secondCompleted }
  }
})
