/**
 * Host half of the graphical MCP configuration plugin.
 *
 * The browser panel talks to this entry over the authenticated
 * `/mcp-gui/api/*` prefix route. Server definitions live in the profile's
 * `mcp-gui/servers.json`; captured credentials live in the credential store
 * and never cross the route.
 */

import { McpGuiController } from './host/controller.js'
import { readJsonBody, sendJson } from './host/util.js'

/** Cordis plugin name. */
export const name = 'mcp-gui'

/** The tool registry, credential store, browser route carrier, and trust fence. */
export const inject = ['tools', 'credentials', 'webServer', 'connection']

/**
 * Mount the management route and load the saved server fleet.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const controller = new McpGuiController(ctx)
  ctx.effect(() => () => { void controller.dispose() }, 'mcp-gui: runtime disposal')
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: '/mcp-gui',
    handler: (req, res) => {
      void controller.handleApi(req, res, { sendJson, readJsonBody })
    },
  })
  ctx.effect(() => disposeRoute, 'mcp-gui: management route')
  await controller.initialize()
  ctx.logger.info('mcp-gui: 图形化外部系统连接面板已挂载（侧边栏 外部系统连接）')
}
