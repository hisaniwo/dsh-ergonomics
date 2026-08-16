/**
 * dsh-ergonomics — Client half (built web bundle).
 *
 * This is the `./client` artifact DSH loads for the web shell. It registers
 * itself with the client module system via `window.__ModuleLoader__.load(...)`;
 * the factory returns the Cordis plugin object `{ inject, apply }`.
 *
 * Three features live here:
 *
 *   1. Input-box history: `↑` recalls the previous submitted content and `↓`
 *      moves forward. Returning to the latest position restores the draft the
 *      user was typing but had not submitted yet (blank when there is none).
 *      History is per-session and rebuilt from the conversation trajectory, so
 *      it survives a page refresh. When the box holds several lines (visual
 *      lines, including soft-wrapped ones), the keys first move the caret
 *      through the text: `↑` recalls history only on the first visual line and
 *      `↓` advances it only on the last one.
 *
 *   2. `/new` navigation: when the freshly-executed `/new` command card is
 *      rendered, call `workspaces.startSession()` to actually create and switch
 *      to a new session.
 *
 *   3. `Esc` interrupt: pressed in the input box while the session is running,
 *      stop the active generation (`session.cancel()`) — the Web counterpart of
 *      the CLI's Ctrl+C. When nothing is running the key is left untouched.
 *
 *   4. `Ctrl+U` discard: pressed in the input box, delete everything before the
 *      caret — the readline-style "unix-line-discard" habit from the terminal,
 *      handy for scrapping a half-typed prompt (with a multi-line box it clears
 *      all text before the caret, not just the current line).
 *
 * Differences from the dynamic-plugin form: `React` arrives via
 * `require("react")` (not an ambient symbol), and CSS is injected inside
 * `apply` with a `ctx.effect` cleanup (not the dynamic runner's `styles`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-ergonomics',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    const inject = ['slots', 'workspaces', 'sessions']

    function apply(ctx) {
      // CSS for the /new command card, tied to this plugin's fiber.
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-ergonomics')
        style.textContent =
          '.dsh-ergonomics-new-session-card{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;' +
          'background:var(--dsw-color-bg-secondary,rgba(128,128,128,.12));color:var(--dsw-color-text-secondary,inherit);font-size:13px}'
        document.head.appendChild(style)
        return () => style.remove()
      })

      // Per-session history, kept in this plugin's closure.
      const historyBySession = new Map()
      const getHistory = (id) => {
        let h = historyBySession.get(id)
        if (!h) {
          h = { entries: [], index: 0, staging: null }
          historyBySession.set(id, h)
        }
        return h
      }

      // Join the text blocks of a user message node into one trimmed string.
      // Accepts both the current chat-node shape (`data.content`, from
      // `snapshot.chat.nodes`) and the older flat shape (`content`).
      const extractUserText = (node) => {
        if (!node || node.kind !== 'user') return ''
        const content = node.data && Array.isArray(node.data.content)
          ? node.data.content
          : (Array.isArray(node.content) ? node.content : null)
        if (!content) return ''
        let out = ''
        for (const b of content) {
          if (b && b.type === 'text' && typeof b.text === 'string') {
            out += (out ? '\n' : '') + b.text
          }
        }
        return out.trim()
      }

      // Visual line index of a textarea caret, measured through a width-matched
      // mirror element: textareas soft-wrap, so logical '\n' lines and the
      // visual lines the user sees can differ a lot. Returns the 0-based line
      // holding the caret and the total number of visual lines.
      const caretVisualLines = (el, pos) => {
        const cs = getComputedStyle(el)
        const lineHeight = parseFloat(cs.lineHeight)
        const lh = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 24
        const padL = parseFloat(cs.paddingLeft) || 0
        const padR = parseFloat(cs.paddingRight) || 0
        const bL = parseFloat(cs.borderLeftWidth) || 0
        const bR = parseFloat(cs.borderRightWidth) || 0
        const width = Math.max(20, el.clientWidth - padL - padR - bL - bR)
        const mirror = document.createElement('div')
        mirror.style.cssText = [
          'position:absolute', 'visibility:hidden', 'left:-9999px', 'top:0',
          'white-space:pre-wrap', 'word-break:break-word', 'overflow-wrap:break-word',
          'box-sizing:content-box', 'padding:0', 'border:0',
          'width:' + width + 'px',
          'font-family:' + cs.fontFamily,
          'font-size:' + cs.fontSize,
          'font-weight:' + cs.fontWeight,
          'font-style:' + cs.fontStyle,
          'letter-spacing:' + cs.letterSpacing,
          'line-height:' + cs.lineHeight,
        ].join(';')
        document.body.appendChild(mirror)
        try {
          const value = el.value || ''
          const pre = document.createElement('span')
          pre.textContent = value.slice(0, pos)
          const caretMark = document.createElement('span')
          caretMark.textContent = '\u200b'
          mirror.appendChild(pre)
          mirror.appendChild(caretMark)
          const above = Math.round(caretMark.offsetTop / lh)
          pre.textContent = value
          const tail = document.createElement('span')
          tail.textContent = '\u200b'
          mirror.appendChild(tail)
          const total = Math.round(tail.offsetTop / lh) + 1
          return { above, total }
        } finally {
          mirror.remove()
        }
      }

      // Latest input-box facts, fed by the Sentinel render below.
      const current = { sessionId: null, actions: null, draft: '', running: false }

      const onKeyDownGlobal = (e) => {
        const c = current

        // Esc → interrupt (stop) the running generation.
        if (e.key === 'Escape') {
          if (e.isComposing || e.keyCode === 229) return
          const active = document.activeElement
          if (!active || active.tagName !== 'TEXTAREA') return
          if (!c.sessionId) return
          // Only steal Esc when a generation is actually running; otherwise let
          // it fall through to normal browser/UI behavior.
          if (!c.running) return
          e.preventDefault()
          e.stopPropagation()
          const binding = ctx.sessions && ctx.sessions.binding(c.sessionId)
          if (binding && binding.session) binding.session.cancel().catch(() => {})
          return
        }

        // Ctrl+U (not Cmd+U — that stays the browser's "view source") →
        // delete everything before the caret, CLI "unix-line-discard" style.
        if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
            (e.key === 'u' || e.key === 'U')) {
          if (e.isComposing || e.keyCode === 229) return
          const active = document.activeElement
          if (!active || active.tagName !== 'TEXTAREA') return
          if (!c.sessionId || !c.actions) return
          const start = active.selectionStart
          if (typeof start !== 'number' || start <= 0) return
          const value = (typeof active.value === 'string') ? active.value : (c.draft || '')
          const after = value.slice(start)
          e.preventDefault()
          e.stopPropagation()
          c.actions.setDraft(after)
          c.draft = after
          // Park the caret at the start right away, and again after the next
          // paint, in case the framework re-renders the controlled textarea.
          active.selectionStart = active.selectionEnd = 0
          requestAnimationFrame(() => {
            if (document.activeElement === active) {
              active.selectionStart = active.selectionEnd = 0
            }
          })
          return
        }

        const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown'
        if (isArrow) {
          if (e.isComposing) return
        } else {
          if (e.isComposing || e.keyCode === 229) return
          return
        }
        const active = document.activeElement
        if (!active || active.tagName !== 'TEXTAREA') return
        if (!c.sessionId || !c.actions) return
        const d = (typeof active.value === 'string') ? active.value : (c.draft || '')
        const caret = e.key === 'ArrowUp' ? active.selectionStart : active.selectionEnd
        const pos = (typeof caret === 'number' && caret >= 0) ? caret : 0
        // Visual-line gate: the caret's line is measured against the actual
        // wrapped rendering, so soft-wrapped paragraphs behave like the user
        // sees them — ↑ recalls history only on the first visual line and ↓
        // advances it only on the last one.
        let lines = null
        try {
          lines = caretVisualLines(active, pos)
        } catch (err) {
          lines = null
        }
        const onFirstLine = lines ? lines.above === 0 : d.lastIndexOf('\n', pos - 1) === -1
        const onLastLine = lines ? lines.above >= lines.total - 1 : d.indexOf('\n', pos) === -1
        if ((e.key === 'ArrowUp' && !onFirstLine) || (e.key === 'ArrowDown' && !onLastLine)) return
        const hist = getHistory(c.sessionId)

        if (e.key === 'ArrowUp') {
          const n = hist.entries.length
          if (n === 0) return
          if (hist.index === 0 && d.trim() !== '' && d !== hist.entries[n - 1]) hist.staging = d
          // Skip entries equal to the current text so every press is visible.
          let t = hist.index + 1
          while (t <= n && hist.entries[n - t] === d) t += 1
          if (t > n) return
          hist.index = t
          e.preventDefault()
          e.stopPropagation()
          const next = hist.entries[n - t]
          c.actions.setDraft(next)
          c.draft = next
        } else if (e.key === 'ArrowDown') {
          if (hist.index === 0) return
          hist.index = Math.max(0, hist.index - 1)
          // index k maps to entries[n - k]; index 0 is the latest (staging || '').
          const target = hist.index === 0
            ? (hist.staging || '')
            : hist.entries[hist.entries.length - hist.index]
          e.preventDefault()
          e.stopPropagation()
          c.actions.setDraft(target)
          c.draft = target
        }
      }

      ctx.effect(() => {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('keydown', onKeyDownGlobal, true)
          return () => window.removeEventListener('keydown', onKeyDownGlobal, true)
        }
      })

      // Invisible slot entry: reads the current session/input and rebuilds the
      // history from the conversation trajectory on every render.
      const Sentinel = (props) => {
        const sessionId = props.sessionId || (props.session && props.session.sessionId)
        const snapshot = props.session || (typeof props.useSession === 'function' ? props.useSession((s) => s) : undefined)
        const input = props.input || (typeof props.useInput === 'function' ? props.useInput((s) => s) : undefined)
        const inputActions = props.inputActions
        const draft = (input && input.draft) || ''

        current.sessionId = sessionId || null
        current.actions = inputActions || null
        current.draft = draft
        current.running = !!(snapshot && snapshot.running)

        React.useEffect(() => {
          if (sessionId == null) return
          // Current shells keep chat nodes in `snapshot.chat.nodes` (a Map of
          // `{kind, data, visibility, ...}`); older shells exposed a flat
          // `snapshot.nodes` array instead. Prefer the Map when present.
          const chatNodes = snapshot && snapshot.chat && snapshot.chat.nodes
          const nodes = chatNodes && typeof chatNodes.values === 'function'
            ? [...chatNodes.values()].filter((n) => n && n.visibility !== 'hidden')
            : ((snapshot && snapshot.nodes) || [])
          const hist = getHistory(sessionId)
          const fresh = []
          let prev = null
          for (const n of nodes) {
            if (!n || n.kind !== 'user') continue
            const text = extractUserText(n)
            if (!text || text === prev) continue
            prev = text
            fresh.push(text)
          }
          if (fresh.length > 50) fresh.splice(0, fresh.length - 50)
          const grew = fresh.length > hist.entries.length
          hist.entries = fresh
          if (grew) {
            hist.index = 0
            hist.staging = null
          } else if (hist.index > hist.entries.length) {
            hist.index = hist.entries.length
          }
        }, [snapshot, sessionId])

        return null
      }

      // `/new` command card → create & switch to a new session.
      // Only freshly-executed nodes trigger, so replaying an old command after a
      // page refresh or plugin update does not unexpectedly start a new session.
      const firedCommandIds = new Set()
      const RECENT_MS = 120000
      const NewSessionRow = (props) => {
        const node = props.node
        const firedRef = React.useRef(false)
        React.useEffect(() => {
          if (firedRef.current) return
          const cmdId = node && node.commandId
          if (cmdId == null) return
          const outcome = node.outcome
          if (!outcome || outcome.kind !== 'success') return
          if (typeof node.time !== 'number' || Date.now() - node.time > RECENT_MS) return
          if (firedCommandIds.has(cmdId)) return
          firedCommandIds.add(cmdId)
          firedRef.current = true
          ctx.workspaces.startSession()
        }, [node])
        return React.createElement('div', { className: 'dsh-ergonomics-new-session-card' },
          React.createElement('span', null, '已创建新会话'))
      }

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'input-history', order: 1000 },
        (props) => React.createElement(Sentinel, props),
      ))
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'input-history-backup', order: 1000 },
        (props) => React.createElement(Sentinel, props),
      ))
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
        { name: 'conversation.chat.commandview', key: 'new' },
        (props) => React.createElement(NewSessionRow, props),
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
