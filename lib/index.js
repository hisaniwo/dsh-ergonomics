/**
 * dsh-ergonomics — Host half.
 *
 * Registers the `/new` chat command. The command itself only returns a
 * success outcome; the actual "create and switch to a new session" navigation
 * happens in the Client half (see `client.js`), because the browser UI owns
 * session navigation.
 *
 * This is a standard Cordis plugin object. When loaded from a composition it
 * is consumed exactly like any other DSH plugin (`name` / `inject` / `apply`).
 */

export const name = 'ergonomics'

export const inject = ['commands']

export function apply(ctx) {
  ctx.commands.register({
    name: 'new',
    description: '新建一个会话',
    handler: () => ({ kind: 'success', text: '已创建新会话' }),
  })
}
