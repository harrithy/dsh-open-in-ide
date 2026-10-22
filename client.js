window.__ModuleLoader__.load({
  id: 'dsh-open-in-ide',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Dictionary namespace owned by this package. */
    const NS = 'open-in-ide'
    /** Document-relative routes the host half registers. */
    const ROUTE = 'open-in-ide/open'
    const EDITORS_ROUTE = 'open-in-ide/editors'
    /** The shipped file-reference chip's CSS-module class (`_fileMention_<hash>`). */
    const MENTION_CLASS = /(?:^|[\s_-])fileMention(?:[\s_-]|$)/
    /** Labels longer than this are not file references. */
    const MAX_LABEL_LENGTH = 512
    /** Browser-side preference: which editor opens file links. */
    const EDITOR_STORAGE_KEY = 'dsh.open-in-ide.editor'
    /** Key used by the plugin before its rename; read once for migration. */
    const LEGACY_EDITOR_STORAGE_KEY = 'dsh.open-in-vscode.editor'
    /** The default: Visual Studio Code, as the shipped preference. */
    const DEFAULT_EDITOR = 'vscode'
    /** Editors this plugin can launch; ids are validated again on the Host. */
    const EDITORS = [
      { id: 'vscode', labelKey: 'editor.vscode', fallback: 'Visual Studio Code' },
      { id: 'vscode-insiders', labelKey: 'editor.vscodeInsiders', fallback: 'VS Code Insiders' },
      { id: 'cursor', labelKey: 'editor.cursor', fallback: 'Cursor' },
      { id: 'windsurf', labelKey: 'editor.windsurf', fallback: 'Windsurf' },
      { id: 'idea', labelKey: 'editor.idea', fallback: 'IntelliJ IDEA' },
      { id: 'pycharm', labelKey: 'editor.pycharm', fallback: 'PyCharm' },
      { id: 'webstorm', labelKey: 'editor.webstorm', fallback: 'WebStorm' },
      { id: 'goland', labelKey: 'editor.goland', fallback: 'GoLand' },
      { id: 'clion', labelKey: 'editor.clion', fallback: 'CLion' },
      { id: 'phpstorm', labelKey: 'editor.phpstorm', fallback: 'PhpStorm' },
      { id: 'rider', labelKey: 'editor.rider', fallback: 'Rider' },
      { id: 'rubymine', labelKey: 'editor.rubymine', fallback: 'RubyMine' },
      { id: 'datagrip', labelKey: 'editor.datagrip', fallback: 'DataGrip' },
      { id: 'rustrover', labelKey: 'editor.rustrover', fallback: 'RustRover' },
    ]

    /** Message catalogue for this package's own namespace. */
    const EN = {
      'toast.opening': 'Opening {target} in {editor}…',
      'toast.opened': 'Opened {target} in {editor}',
      'toast.failed': 'Could not open in {editor}: {message}',
      'settings.title': 'IDE for file links',
      'settings.description': 'Which installed IDE opens file references in the conversation. Visual Studio Code by default, otherwise the first detected IDE.',
      'settings.noneShort': 'No IDE detected',
      'settings.none': 'No supported IDE was found on this machine. Install VS Code, Cursor, Windsurf, or a JetBrains IDE.',
      'editor.custom': 'Custom (config.command)',
      'editor.vscode': 'Visual Studio Code',
      'editor.vscodeInsiders': 'VS Code Insiders',
      'editor.cursor': 'Cursor',
      'editor.windsurf': 'Windsurf',
      'editor.idea': 'IntelliJ IDEA',
      'editor.pycharm': 'PyCharm',
      'editor.webstorm': 'WebStorm',
      'editor.goland': 'GoLand',
      'editor.clion': 'CLion',
      'editor.phpstorm': 'PhpStorm',
      'editor.rider': 'Rider',
      'editor.rubymine': 'RubyMine',
      'editor.datagrip': 'DataGrip',
      'editor.rustrover': 'RustRover',
    }
    const ZH = {
      'toast.opening': '正在 {editor} 中打开 {target}…',
      'toast.opened': '已在 {editor} 中打开 {target}',
      'toast.failed': '无法在 {editor} 中打开：{message}',
      'settings.title': '打开文件的 IDE',
      'settings.description': '点击对话中的文件引用时用哪个 IDE 打开；默认 Visual Studio Code，没有则用扫描到的第一个。',
      'settings.noneShort': '未检测到 IDE',
      'settings.none': '本机未扫描到受支持的 IDE，请安装 VS Code、Cursor、Windsurf 或 JetBrains 系列 IDE。',
      'editor.custom': '自定义（config.command）',
      'editor.vscode': 'Visual Studio Code',
      'editor.vscodeInsiders': 'VS Code Insiders',
      'editor.cursor': 'Cursor',
      'editor.windsurf': 'Windsurf',
      'editor.idea': 'IntelliJ IDEA',
      'editor.pycharm': 'PyCharm',
      'editor.webstorm': 'WebStorm',
      'editor.goland': 'GoLand',
      'editor.clion': 'CLion',
      'editor.phpstorm': 'PhpStorm',
      'editor.rider': 'Rider',
      'editor.rubymine': 'RubyMine',
      'editor.datagrip': 'DataGrip',
      'editor.rustrover': 'RustRover',
    }

    /** Package styling; only theme tokens are used so light/dark follow the host. */
    const CSS = [
      // Toast (frame-wide status line)
      '.dsh-oii-toast{',
      'position:fixed;top:40px;left:50%;z-index:1100;transform:translateX(-50%);',
      'display:flex;align-items:center;gap:10px;width:max-content;',
      'max-width:min(640px,calc(100vw - 48px));padding:10px 14px;',
      'border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-toast-bg);',
      'color:var(--dsw-alias-toast-label);font-size:13px;line-height:20px;',
      'box-shadow:var(--dsw-shadow-lv3);pointer-events:none;',
      'animation:dsh-oii-toast-in 160ms ease-out}',
      '.dsh-oii-toast[data-kind=error]{box-shadow:0 0 0 1px var(--dsw-alias-state-error-primary),var(--dsw-shadow-lv3)}',
      '.dsh-oii-toast-icon{flex:none;display:grid;place-items:center;color:var(--dsw-alias-state-success-primary)}',
      '.dsh-oii-toast[data-kind=info] .dsh-oii-toast-icon{color:var(--dsw-alias-label-secondary)}',
      '.dsh-oii-toast[data-kind=error] .dsh-oii-toast-icon{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-oii-toast-text{min-width:0}',
      '@keyframes dsh-oii-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%)}}',
      '@media (prefers-reduced-motion:reduce){.dsh-oii-toast{animation:none}}',
      // General-settings preference row (copied from the shipped PreferenceRow)
      '.dsh-oii-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
      '.dsh-oii-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
      '.dsh-oii-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.dsh-oii-desc{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;line-height:18px}',
      '.dsh-oii-selector{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);',
      'height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;',
      'align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}',
      '.dsh-oii-selector:hover,.dsh-oii-selector[aria-expanded=true]{',
      'background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--dsw-alias-bg-layer-2))}',
      '.dsh-oii-selector:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '.dsh-oii-chevron{flex:none;color:var(--dsw-alias-label-secondary)}',
      // Anchored menu
      '.dsh-oii-menu{position:fixed;z-index:1200;display:flex;flex-direction:column;gap:2px;',
      'min-width:180px;max-height:min(420px,calc(100vh - 96px));overflow-y:auto;padding:4px;',
      'border:.5px solid var(--dsw-alias-border-l1);',
      'border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);',
      'box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent)}',
      '.dsh-oii-menuItem{display:flex;align-items:center;justify-content:space-between;gap:10px;',
      'padding:7px 10px;border:none;border-radius:var(--dsw-radius-md);background:transparent;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:start;cursor:pointer}',
      '.dsh-oii-menuItem:hover,.dsh-oii-menuItem:focus-visible{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);outline:none}',
      '.dsh-oii-check{flex:none;color:var(--dsw-alias-brand-primary)}',
    ].join('')

    /** Insert this package's stylesheet once; returns its remover. */
    function insertStyles() {
      const id = 'dsh-open-in-ide/client.css'
      const selector = 'style[data-plugin-css=' + JSON.stringify(id) + ']'
      if (document.querySelector(selector) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-open-in-ide'
      tag.dataset.pluginCss = id
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /** Translate with whichever bound translator the caller has; fall back to the key. */
    function translate(t, key, params) {
      if (typeof t !== 'function') return key
      try {
        return params === undefined ? t(key) : t(key, params)
      } catch {
        return key
      }
    }

    // ── editor preference store ──────────────────────────────────────────

    /**
     * Read the persisted editor id, falling back to VS Code. The legacy key of
     * the plugin's former name is read once so an existing choice survives the
     * rename; the next change persists under the current key.
     */
    function readStoredEditor() {
      for (const key of [EDITOR_STORAGE_KEY, LEGACY_EDITOR_STORAGE_KEY]) {
        try {
          const stored = localStorage.getItem(key)
          if (typeof stored === 'string' && EDITORS.some((entry) => entry.id === stored)) return stored
        } catch {
          /* private mode or storage disabled: keep the default */
        }
      }
      return DEFAULT_EDITOR
    }

    let currentEditor = readStoredEditor()
    const editorListeners = new Set()

    function subscribeEditor(listener) {
      editorListeners.add(listener)
      return () => {
        editorListeners.delete(listener)
      }
    }

    function readEditor() {
      return currentEditor
    }

    function writeEditor(next) {
      if (!EDITORS.some((entry) => entry.id === next) || next === currentEditor) return
      currentEditor = next
      try {
        localStorage.setItem(EDITOR_STORAGE_KEY, next)
      } catch {
        /* keep the in-memory choice when storage is unavailable */
      }
      for (const listener of editorListeners) listener()
    }

    /** Display name of one editor id, translated when a translator is present. */
    function editorLabel(t, id) {
      if (id === 'custom') {
        const custom = translate(t, 'editor.custom')
        return custom === 'editor.custom' ? 'Custom (config.command)' : custom
      }
      const entry = EDITORS.find((candidate) => candidate.id === id) ?? EDITORS[0]
      const translated = translate(t, entry.labelKey)
      return translated === entry.labelKey ? entry.fallback : translated
    }

    // ── installed-IDE discovery store ────────────────────────────────────

    /** Detection state: idle while nothing asked, then loading → ready/error. */
    const discovery = { listeners: new Set(), state: { status: 'idle', available: [] } }
    let discoveryStarted = false

    function subscribeDiscovery(listener) {
      discovery.listeners.add(listener)
      return () => {
        discovery.listeners.delete(listener)
      }
    }

    function readDiscovery() {
      return discovery.state
    }

    function publishDiscovery(state) {
      discovery.state = state
      for (const listener of discovery.listeners) listener()
    }

    /**
     * Adopt the detected set: keep a choice that is installed, otherwise fall
     * back to VS Code and then to the first detected IDE.
     */
    function reconcileEditor(available) {
      if (available.length === 0) return
      if (available.includes(currentEditor)) return
      writeEditor(available.includes(DEFAULT_EDITOR) ? DEFAULT_EDITOR : available[0])
    }

    /** Ask the Host once per page which supported IDEs it can launch. */
    function ensureDiscovery() {
      if (discoveryStarted) return
      discoveryStarted = true
      publishDiscovery({ status: 'loading', available: [] })
      fetch(EDITORS_ROUTE, { headers: { accept: 'application/json' } })
        .then(async (response) => {
          let payload = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          if (!response.ok || payload === null || !Array.isArray(payload.editors)) {
            throw new Error(`detection failed: HTTP ${String(response.status)}`)
          }
          const available = payload.editors
            .filter((entry) => entry !== null && typeof entry === 'object' && entry.available === true)
            .map((entry) => entry.id)
            .filter((id) => EDITORS.some((candidate) => candidate.id === id))
          publishDiscovery({ status: 'ready', available })
          reconcileEditor(available)
        })
        .catch(() => {
          // Detection is an enhancement: the full list stays selectable.
          publishDiscovery({ status: 'error', available: [] })
        })
    }

    // ── toast store ──────────────────────────────────────────────────────

    const toastListeners = new Set()
    let toastValue = null
    let toastTimer = null

    function publishToast(next) {
      toastValue = next
      for (const listener of toastListeners) listener()
    }

    function subscribeToast(listener) {
      toastListeners.add(listener)
      return () => {
        toastListeners.delete(listener)
      }
    }

    function readToast() {
      return toastValue
    }

    function showToast(kind, text) {
      if (toastTimer !== null) clearTimeout(toastTimer)
      const toast = { kind, text }
      publishToast(toast)
      toastTimer = setTimeout(() => {
        toastTimer = null
        if (toastValue === toast) publishToast(null)
      }, kind === 'error' ? 7000 : 3200)
    }

    /** Dispose the stores' timers and listeners. */
    function disposeStores() {
      if (toastTimer !== null) clearTimeout(toastTimer)
      toastTimer = null
      toastValue = null
      toastListeners.clear()
      editorListeners.clear()
      discovery.listeners.clear()
      discovery.state = { status: 'idle', available: [] }
      discoveryStarted = false
    }

    // ── click target reading ─────────────────────────────────────────────

    /** Walk up from the event target to the shipped file-reference chip. */
    function mentionButtonOf(node) {
      let element = node !== null && typeof node === 'object' && node.nodeType === 1 ? node : null
      while (element !== null && element !== document.body) {
        if (element.tagName === 'BUTTON' && isMentionButton(element)) return element
        element = element.parentElement
      }
      return null
    }

    function isMentionButton(element) {
      const className = typeof element.className === 'string' ? element.className : ''
      return MENTION_CLASS.test(className) && element.disabled !== true
    }

    /**
     * Read the path and optional position a chip stands for.
     * The shipped chip keeps the authored path in `title` (its click closure
     * holds the destination's `#L<n>` line, which React does not expose to the
     * DOM); the visible label usually repeats `:line` or `:line:column`.
     */
    function targetOf(button) {
      const title = (button.getAttribute('title') ?? '').trim()
      const label = (button.textContent ?? '').trim()
      let path = title
      if (path === '') {
        if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return null
        if (!/[\\/]/.test(label) || /[\r\n]/.test(label)) return null
        path = label
      }
      return { path, ...positionOf(label) }
    }

    /** Parse a trailing `#L12`, `:12`, or `:12:4` from the visible label. */
    function positionOf(label) {
      if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return {}
      const range = /#L(\d+)(?:-L?\d+)?$/.exec(label)
      if (range !== null) {
        const line = Number(range[1])
        return line > 0 ? { line } : {}
      }
      const position = /:(\d+)(?::(\d+))?$/.exec(label)
      if (position !== null) {
        const line = Number(position[1])
        if (!(line > 0)) return {}
        const column = position[2] === undefined ? undefined : Number(position[2])
        return column !== undefined && column > 0 ? { line, column } : { line }
      }
      return {}
    }

    /** Short human label for a toast: base name plus the requested line. */
    function displayTarget(target) {
      const name = target.path.split(/[\\/]/).pop() || target.path
      return target.line === undefined ? name : `${name}:${target.line}`
    }

    // ── icons ────────────────────────────────────────────────────────────

    function CheckIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3 8.5 6.2 11.5 13 4.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    function AlertIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 2.2 14.4 13.4H1.6L8 2.2Z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { d: 'M8 6.2v3.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    function ChevronIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', className: 'dsh-oii-chevron', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4 6l4 4 4-4',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    function SelectedIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', className: 'dsh-oii-check', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3 8.5 6.2 11.5 13 4.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    // ── views ────────────────────────────────────────────────────────────

    /** Frame-wide status line for a click that is being carried out. */
    function ToastView() {
      const toast = React.useSyncExternalStore(subscribeToast, readToast, readToast)
      if (toast === null) return null
      return h('div', {
        className: 'dsh-oii-toast',
        'data-kind': toast.kind,
        role: toast.kind === 'error' ? 'alert' : 'status',
      },
      h('span', { className: 'dsh-oii-toast-icon' }, toast.kind === 'error' ? h(AlertIcon) : h(CheckIcon)),
      h('span', { className: 'dsh-oii-toast-text' }, toast.text))
    }

    /**
     * General-settings row: pick the IDE that opens file references.
     * Mirrors the shipped two-column preference row and its anchored menu.
     */
    function EditorRow(props) {
      const t = props.t ?? props.translate
      const editor = React.useSyncExternalStore(subscribeEditor, readEditor, readEditor)
      const detected = React.useSyncExternalStore(subscribeDiscovery, readDiscovery, readDiscovery)
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const selectorRef = React.useRef(null)
      const menuRef = React.useRef(null)

      React.useEffect(() => {
        ensureDiscovery()
      }, [])

      // Ready detection narrows the list to installed IDEs; loading and failure
      // keep every supported IDE selectable.
      const options = detected.status === 'ready'
        ? EDITORS.filter((entry) => detected.available.includes(entry.id))
        : EDITORS
      const noEditors = detected.status === 'ready' && options.length === 0

      const closeMenu = React.useCallback((restoreFocus) => {
        setOpen(false)
        if (restoreFocus === true) selectorRef.current?.focus({ preventScroll: true })
      }, [])

      const openMenu = React.useCallback(() => {
        const element = selectorRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        setAnchor({
          top: Math.round(rect.bottom + 6),
          right: Math.max(12, Math.round(window.innerWidth - rect.right)),
          minWidth: Math.max(180, Math.round(rect.width)),
        })
        setOpen(true)
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const menu = menuRef.current
          const selector = selectorRef.current
          if (menu !== null && event.target instanceof Node && menu.contains(event.target)) return
          if (selector !== null && event.target instanceof Node && selector.contains(event.target)) return
          closeMenu(false)
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          closeMenu(true)
        }
        const onViewportChange = () => closeMenu(false)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onViewportChange)
        window.addEventListener('scroll', onViewportChange, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onViewportChange)
          window.removeEventListener('scroll', onViewportChange, true)
        }
      }, [open, closeMenu])

      const selectedLabel = noEditors ? translate(t, 'settings.noneShort') : editorLabel(t, editor)
      const description = noEditors
        ? translate(t, 'settings.description') + ' ' + translate(t, 'settings.none')
        : translate(t, 'settings.description')
      const selector = h('button', {
        ref: selectorRef,
        type: 'button',
        className: 'dsh-oii-selector',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-label': translate(t, 'settings.title'),
        disabled: noEditors,
        onClick: () => {
          if (noEditors) return
          if (open) closeMenu(false)
          else openMenu()
        },
      }, selectedLabel, h(ChevronIcon))

      const menu = open && anchor !== null
        ? ReactDOM.createPortal(
          h('div', {
            ref: menuRef,
            className: 'dsh-oii-menu',
            role: 'menu',
            style: { top: anchor.top + 'px', right: anchor.right + 'px', minWidth: anchor.minWidth + 'px' },
            onKeyDown: (event) => {
              const items = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])]
              const index = items.indexOf(document.activeElement)
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                const next = items[(index + step + items.length) % items.length]
                next?.focus()
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
              }
            },
          },
          options.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': entry.id === editor,
            className: 'dsh-oii-menuItem',
            onClick: () => {
              writeEditor(entry.id)
              closeMenu(true)
            },
          }, h('span', null, editorLabel(t, entry.id)), entry.id === editor ? h(SelectedIcon) : null))),
          document.body,
        )
        : null

      return [
        h('div', { key: 'row', className: 'dsh-oii-row' },
          h('div', { className: 'dsh-oii-rowText' },
            h('div', { className: 'dsh-oii-title' }, translate(t, 'settings.title')),
            h('div', { className: 'dsh-oii-desc' }, description)),
          selector),
        menu,
      ]
    }

    /**
     * Invisible bridge installed with the current Session: a capture-phase click
     * listener that redirects file-reference chips to the selected IDE.
     */
    function LinkBridge(props) {
      const sessionId = props.sessionId
      // The renderer binds `t` from the registration's `locale`; `translate`
      // is this package's own bound translator, kept as a fallback.
      const t = props.t ?? props.translate
      const useSessions = props.useSessions
      const editor = React.useSyncExternalStore(subscribeEditor, readEditor, readEditor)
      const cwd = typeof useSessions === 'function'
        ? useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd))
        : undefined
      const latest = React.useRef({ sessionId, cwd, t, editor })
      latest.current = { sessionId, cwd, t, editor }

      React.useEffect(() => {
        ensureDiscovery()
        const onClick = (event) => {
          if (event.defaultPrevented) return
          if (event.button !== 0) return
          // Modified clicks keep the shipped behavior (in-app preview).
          if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return
          const button = mentionButtonOf(event.target)
          if (button === null) return
          const target = targetOf(button)
          if (target === null) return
          event.preventDefault()
          event.stopPropagation()
          const { sessionId: session, cwd: workspace, t: translateNow, editor: editorId } = latest.current
          const display = displayTarget(target)
          const editorName = editorLabel(translateNow, editorId)
          showToast('info', translate(translateNow, 'toast.opening', { target: display, editor: editorName }))
          const body = { sessionId: session ?? null, path: target.path, editor: editorId }
          if (workspace !== undefined) body.cwd = workspace
          if (target.line !== undefined) body.line = target.line
          if (target.column !== undefined) body.column = target.column
          fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).then(async (response) => {
            let payload = null
            try {
              payload = await response.json()
            } catch {
              payload = null
            }
            if (!response.ok) {
              const message = payload !== null && typeof payload.message === 'string'
                ? payload.message
                : `HTTP ${String(response.status)}`
              throw new Error(message)
            }
            const openedIn = payload !== null && typeof payload.editor === 'string'
              ? editorLabel(translateNow, payload.editor)
              : editorName
            showToast('ok', translate(translateNow, 'toast.opened', { target: display, editor: openedIn }))
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            showToast('error', translate(translateNow, 'toast.failed', { editor: editorName, message }))
          })
        }
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('click', onClick, true)
        }
      }, [])

      return null
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'open-in-ide: dictionaries')
        const translateNow = ctx.locale.bind(NS)
        ctx.effect(insertStyles, 'open-in-ide: styles')
        ctx.effect(disposeStores, 'open-in-ide: stores')

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'open-in-ide',
          order: 100,
          locale: NS,
          inject: () => ({ translate: translateNow }),
        }, LinkBridge))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'open-in-ide-toast',
          order: 10,
          locale: NS,
        }, ToastView))

        // General settings row: which IDE opens file references (default VS Code).
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'open-in-ide-editor',
          order: 18,
          locale: NS,
          inject: () => ({ translate: translateNow }),
        }, EditorRow))
      },
    }
  },
})
