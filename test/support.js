import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import vm from 'node:vm'
import { apply } from '../index.js'

/** 测试只在独立临时目录内写入，清理前再次验证绝对路径。 */
export function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-open-in-ide-test-'))
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.match(basename(directory), /^dsh-open-in-ide-test-/u)
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

/** 使用真实宿主路由；不启动窗口助手，文件检查走本机临时文件。 */
export function host(config = {}) {
  const routes = new Map()
  apply({
    connection: { requestRejection: () => undefined },
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
    effect: (setup) => setup(),
    fs: { resolve() { throw new Error('use native filesystem in this fixture') } },
    sessions: { get: () => undefined },
    get: () => undefined,
  }, { focusWindow: false, ...config })
  return async (path, method = 'GET', body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json' } })
    let result
    const res = {
      statusCode: 200,
      setHeader() {},
      end(text = '') { result = { status: this.statusCode, body: text === '' ? null : JSON.parse(text) } },
    }
    await routes.get(path)(req, res)
    return result
  }
}

/** 模拟 DSH 的插槽与浏览器环境，执行整个 client.js 和真实点击回调。 */
export function browser(respond) {
  let definition
  let current
  let catalogue
  let timerId = 0
  const timers = new Map()
  const components = new Map()
  const instances = new Map()
  const handlers = new Set()
  const requests = []
  const h = (tag, props, ...children) => ({ tag, props, children })
  const document = {
    body: {},
    addEventListener(type, handler) { if (type === 'click') handlers.add(handler) },
    removeEventListener(type, handler) { if (type === 'click') handlers.delete(handler) },
  }
  const hook = (create) => {
    const index = current.index++
    if (!(index in current.hooks)) current.hooks[index] = create()
    return current.hooks[index]
  }
  const React = {
    createElement: h,
    useSyncExternalStore: (_subscribe, read) => read(),
    useRef: (value) => hook(() => ({ current: value })),
    useState(value) {
      const state = hook(() => ({ value }))
      return [state.value, (next) => { state.value = next }]
    },
    useCallback: (callback) => callback,
    useEffect(effect, deps) {
      const state = hook(() => ({ deps: undefined }))
      if (state.deps === undefined || deps?.some((value, index) => value !== state.deps[index])) {
        current.effects.push(() => { state.cleanup?.(); state.cleanup = effect() })
        state.deps = deps
      }
    },
  }
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload })
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
    document,
    AbortController,
    localStorage: { getItem: () => null },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (route, options) => {
      const request = { route, options, body: options.body === undefined ? undefined : JSON.parse(options.body) }
      requests.push(request)
      const supplied = respond?.(request, response)
      if (supplied !== undefined) return supplied
      if (route === 'open-in-ide/editors') return response({ ok: true, editors: [{ id: 'vscode', available: true }] })
      return response({ ok: true, path: request.body?.path, editor: 'vscode' })
    },
  }, { filename: 'client.js' })
  definition.factory((name) => name === 'react' ? React : {}).apply({
    effect(setup, name) { if (name === 'open-in-ide: dictionaries') setup() },
    locale: { register(_namespace, value) { catalogue = value.zh }, bind: () => (key) => key },
    slots: {
      inject(_name, register) { register() },
      register(options, component) { components.set(options.id, component) },
    },
  })
  // 使用真实中文词典，验证错误提示的文案而非内部状态字段。
  const translate = (key, params = {}) => (catalogue[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name) => params[name] ?? '')
  function render(id, props = {}) {
    if (!instances.has(id)) instances.set(id, { hooks: [] })
    current = instances.get(id)
    current.index = 0
    current.effects = []
    const tree = components.get(id)({ t: translate, ...props })
    for (const effect of current.effects) effect()
    return tree
  }
  return {
    requests,
    render,
    response,
    settle: () => new Promise(setImmediate),
    mountBridge() { render('open-in-ide', { sessionId: 'test-session' }) },
    toast() { return render('open-in-ide-toast') },
    fireTimers(ms) {
      let fired = 0
      for (const [id, timer] of timers) {
        if (timer.ms !== ms) continue
        timers.delete(id)
        timer.callback()
        fired++
      }
      assert.ok(fired > 0, `no timer with timeout ${ms}`)
    },
    click(label, options = {}) {
      const button = {
        nodeType: 1, tagName: 'BUTTON', className: '_fileMention_dsh123', disabled: false,
        textContent: label, parentElement: document.body,
        getAttribute: () => 'D:/test/src/index.vue',
        closest(selector) { return selector === 'button' ? this : null },
      }
      const event = {
        button: 0, defaultPrevented: false, target: button,
        preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, ...options,
      }
      for (const handler of handlers) handler(event)
      return event
    },
  }
}
