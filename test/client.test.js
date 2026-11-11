import assert from 'node:assert/strict'
import test from 'node:test'
import { browser } from './support.js'

// 验证真实点击请求包含起始行，原有格式、列号和无位置标签继续有效。
test('DSH 文件标签解析与修饰键行为', async () => {
  const ui = browser()
  ui.mountBridge()
  const cases = [
    [':405-L412', { line: 405 }], [':405–L412', { line: 405 }],
    [':L405-L412', { line: 405 }], ['src/index.vue:405-L412', { line: 405 }],
    ['：405-L412', { line: 405 }], [':405 - L412', { line: 405 }],
    [':405-412', { line: 405 }], [':405–412', { line: 405 }],
    ['#L405-L412', { line: 405 }], ['#L405', { line: 405 }],
    ['index.vue:405:7', { line: 405, column: 7 }],
    ['第 405 行', { line: 405 }], ['第 405–412 行', { line: 405 }],
    ['lines 405–412', { line: 405 }], ['index.vue', {}],
    [':0-L412', {}], [':405-L', {}], [':405-L412oops', {}],
  ]
  for (const [label, position] of cases) {
    ui.click(label)
    await ui.settle()
    assert.deepEqual(ui.requests.at(-1).body, {
      sessionId: 'test-session', path: 'D:/test/src/index.vue', editor: 'vscode', ...position,
    }, label)
    assert.equal(ui.toast().props['data-kind'], 'ok')
  }
  for (const options of [{ altKey: true }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
    const count = ui.requests.length
    assert.equal(ui.click(':405-L412', options).defaultPrevented, false)
    assert.equal(ui.requests.length, count)
  }
})

// HTTP 成功不能替代业务成功，HTML、空结果和失败对象都必须显示失败。
test('无效或失败的打开响应不会显示成功', async (t) => {
  for (const payload of [null, {}, { ok: false, message: 'denied' }, { ok: true }]) {
    await t.test(JSON.stringify(payload), async () => {
      const ui = browser((request, response) => request.route.endsWith('/open') ? response(payload) : undefined)
      ui.mountBridge()
      ui.click(':405-L412')
      await ui.settle()
      assert.equal(ui.toast().props['data-kind'], 'error')
    })
  }
  const ui = browser((request) => request.route.endsWith('/open') ? {
    ok: true, status: 200, json: async () => { throw new SyntaxError('HTML') },
  } : undefined)
  ui.mountBridge()
  ui.click(':405-L412')
  await ui.settle()
  assert.match(ui.toast().children[1].children[0], /无效响应/u)
})

// 合并重复点击，超时后释放锁并允许用户再次点击；不自动重发打开请求。
test('打开请求去重、超时提示及超时后重试', async () => {
  let first = true
  const ui = browser((request, response) => {
    if (!request.route.endsWith('/open')) return undefined
    if (!first) return response({ ok: true, path: request.body.path, editor: 'vscode' })
    first = false
    return new Promise((_resolve, reject) => request.options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  })
  ui.mountBridge()
  ui.click(':405-L412')
  ui.click(':405-L412')
  assert.equal(ui.requests.filter((request) => request.route.endsWith('/open')).length, 1)
  ui.fireTimers(65_000)
  await ui.settle()
  assert.match(ui.toast().children[1].children[0], /请求超时/u)
  ui.click(':405-L412')
  await ui.settle()
  assert.equal(ui.requests.filter((request) => request.route.endsWith('/open')).length, 2)
  assert.equal(ui.toast().props['data-kind'], 'ok')
})

// 超时也覆盖已收到响应头、但响应体一直未结束的场景。
test('响应体挂起时仍能超时退出', async () => {
  const ui = browser((request) => request.route.endsWith('/open') ? {
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => request.options.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  } : undefined)
  ui.mountBridge()
  ui.click(':405-L412')
  await ui.settle()
  ui.fireTimers(65_000)
  await ui.settle()
  assert.match(ui.toast().children[1].children[0], /请求超时/u)
})

// 第一次探测失败后，设置页提供重试入口，并只保留本机检测到的编辑器。
test('编辑器探测失败后可通过设置页重试', async () => {
  let scans = 0
  const ui = browser((request, response) => {
    if (!request.route.endsWith('/editors')) return undefined
    scans++
    if (scans <= 2) throw new Error('temporary failure')
    return response({ ok: true, editors: [{ id: 'cursor', available: true }] })
  })
  ui.mountBridge()
  await ui.settle()
  ui.render('open-in-ide-editor')
  await ui.settle()
  const row = ui.render('open-in-ide-editor')[0]
  assert.equal(row.children[1].children[0], '重新检测')
  row.children[1].props.onClick()
  await ui.settle()
  const ready = ui.render('open-in-ide-editor')[0]
  assert.equal(scans, 3)
  assert.equal(ready.children[2].children[0], 'Cursor')
})

// 缺少远端、远程分支或分叉时必须解释原因，并禁止执行不可快进的更新。
test('更新界面区分检查失败、分叉和可快进状态', async (t) => {
  const cases = [
    [{ reason: 'no-origin' }, /未配置 origin/u, '重新检查'],
    [{ reason: 'remote-branch-missing' }, /不存在当前分支/u, '重新检查'],
    [{ reason: 'diverged', ahead: 1, behind: 1, updateAvailable: true }, /已分叉/u, '重新检查'],
    [{ reason: 'detached-head' }, /未处于分支/u, '重新检查'],
    [{ reason: 'git-failed' }, /无法检查/u, '重新检查'],
    [{ ahead: 0, behind: 1, updateAvailable: true, latest: '0.3.5' }, /发现新版本/u, '更新到 0.3.5'],
    [{ reason: 'up-to-date' }, /已是最新/u, '重新检查'],
  ]
  for (const [state, description, button] of cases) {
    await t.test(state.reason ?? 'fast-forward', async () => {
      const ui = browser((request, response) => request.route.startsWith('open-in-ide/update') ? response({
        ok: true, mode: 'git', current: '0.3.4', updateAvailable: false, dirty: false, ...state,
      }) : undefined)
      ui.render('open-in-ide-update')
      await ui.settle()
      const row = ui.render('open-in-ide-update')
      assert.match(row.children[0].children[1].children[0], description)
      assert.equal(row.children[1].children[0], button)
    })
  }
})
