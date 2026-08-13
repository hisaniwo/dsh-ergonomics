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
 *      it survives a page refresh.
 *
 *   2. `/new` navigation: when the freshly-executed `/new` command card is
 *      rendered, call `workspaces.startSession()` to actually create and switch
 *      to a new session.
 *
 *   3. `Ctrl+C` termination: pressed in the input box with no text selected,
 *      archive the current session (`workspaces.archiveSession`) — the same as
 *      "ending" it, clearing the view to a new-session state. A real copy
 *      selection is never hijacked.
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

    const inject = ['slots', 'workspaces']

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
      const extractUserText = (node) => {
        if (!node || node.kind !== 'user' || !Array.isArray(node.content)) return ''
        let out = ''
        for (const b of node.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') {
            out += (out ? '\n' : '') + b.text
          }
        }
        return out.trim()
      }

      // Latest input-box facts, fed by the Sentinel render below.
      const current = { sessionId: null, actions: null, draft: '' }

      const onKeyDownGlobal = (e) => {
        const c = current

        // Ctrl+C / Cmd+C → terminate (archive) the current session.
        const isTerminate = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')
        if (isTerminate) {
          if (e.isComposing || e.keyCode === 229) return
          const active = document.activeElement
          if (!active || active.tagName !== 'TEXTAREA') return
          if (!c.sessionId) return
          // Never hijack copy: only terminate when nothing is selected.
          if (typeof active.selectionStart === 'number' && active.selectionEnd !== active.selectionStart) return
          e.preventDefault()
          e.stopPropagation()
          ctx.workspaces.archiveSession(c.sessionId).catch(() => {})
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

        React.useEffect(() => {
          if (sessionId == null) return
          const nodes = (snapshot && snapshot.nodes) || []
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
