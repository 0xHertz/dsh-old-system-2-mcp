/**
 * MCP connection runtime: owns one SDK Client per managed server, registers
 * its tools on ctx.tools, reconnects with backoff, and executes calls through
 * the injected auth fetch.
 */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { AuthState } from './credentials.js'
import { createAuthFetch } from './http-fetch.js'
import { publicToolName, redactSecrets, summarize } from './util.js'

/** SDK modules resolved lazily from the plugin or the DSH installation. */
let sdkCache

/** Resolve one package, first locally, then from the running DSH installation. */
function resolvePackage(name) {
  const candidates = [createRequire(import.meta.url)]
  // The running dsh process is started through a bin symlink; its real path
  // sits inside the installation and resolves the SDK from the sibling
  // node_modules even when DSH_INSTALL_DIR is absent from process.env.
  const argvEntry = process.argv[1]
  if (typeof argvEntry === 'string' && argvEntry !== '') {
    try { candidates.push(createRequire(realpathSync(argvEntry))) } catch { /* not a file */ }
    try { candidates.push(createRequire(argvEntry)) } catch { /* not a file */ }
  }
  const installDir = process.env.DSH_INSTALL_DIR
  if (installDir !== undefined && installDir !== '') candidates.push(createRequire(join(installDir, 'package.json')))
  let lastError
  for (const resolver of candidates) {
    try {
      return resolver(name)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`无法加载 MCP SDK 模块 ${name}：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/** Load the MCP SDK once. */
export function loadSdk() {
  if (sdkCache !== undefined) return sdkCache
  const client = resolvePackage('@modelcontextprotocol/client')
  const stdio = resolvePackage('@modelcontextprotocol/client/stdio')
  sdkCache = { ...client, StdioClientTransport: stdio.StdioClientTransport, getDefaultEnvironment: stdio.getDefaultEnvironment }
  return sdkCache
}

/** SDK protocol negotiation options for one normalized server row. */
export function versionNegotiationFor(server) {
  if (server.transport === 'sse') return { mode: 'legacy' }
  const mode = server.protocolMode ?? 'legacy'
  if (mode === '2026-07-28') return { mode: { pin: '2026-07-28' } }
  if (mode === 'auto') return { mode: 'auto' }
  return { mode: 'legacy' }
}

/** Backoff delays for an outage. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
const CALL_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 30_000

/** MCP result blocks to model text. */
function mcpResultText(result) {
  const parts = []
  for (const block of result?.content ?? []) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push(`[图片${block.mimeType ? ` ${block.mimeType}` : ''}]`)
    else if (block.type === 'audio') parts.push(`[音频${block.mimeType ? ` ${block.mimeType}` : ''}]`)
    else if (block.type === 'resource_link') parts.push(`[资源链接${block.name ? ` ${block.name}` : ''}${block.uri ? ` <${block.uri}>` : ''}]`)
    else if (block.type === 'resource' && block.resource !== null && typeof block.resource === 'object') {
      parts.push(block.resource.text ?? `[资源 ${block.resource.uri ?? ''}]`)
    }
  }
  if (result?.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent))
    } catch {
      // Non-serializable structured content is already represented by text blocks.
    }
  }
  return parts.join('\n').trim() === '' ? '(MCP 工具没有返回内容)' : parts.join('\n')
}

/** TLS/certificate error codes worth a targeted hint. */
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
])

/** Classify an error into a stage and a user-facing message. */
export function classifyError(error, stageHint = 'connect', redact = (text) => text) {
  const chain = []
  let current = error
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    const text = current instanceof Error ? current.message : String(current)
    if (text !== '') chain.push(text)
    current = current instanceof Error ? current.cause : undefined
  }
  const message = chain.join(' → ')
  const codes = []
  current = error
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (typeof current.code === 'string') codes.push(current.code)
    current = current instanceof Error ? current.cause : undefined
  }
  const combined = redact(`${codes.join(' ')} ${message}`)
  const name = error instanceof Error ? error.name : ''
  const status = error instanceof Error ? error.status ?? error.statusCode : undefined
  const lower = combined.toLowerCase()

  if (codes.some((code) => TLS_CODES.has(code)) || /certificate|tls|ssl/i.test(combined)) {
    const hint = /self signed|self-signed|unable to verify|depth_zero/i.test(combined)
      ? '服务端使用了自签证书。请把服务端证书粘贴到「自定义 CA」，或临时勾选「跳过证书校验（不安全）」。'
      : 'TLS 证书校验失败。请检查证书域名、有效期和证书链。'
    return { stage: 'tls', code: 'TLS_CERTIFICATE', message: summarize(`${combined}\n${hint}`, 800) }
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|401|403/.test(lower)) {
    const scope = /insufficient_scope|invalid_scope|scope/i.test(combined)
      ? '上游返回 scope 不匹配；请确认登录页申请的权限范围包含该 MCP 服务所需 scope。'
      : ''
    return { stage: 'auth', code: 'AUTH_REJECTED', message: summarize(`${combined}\n认证被拒绝。请重新登录捕获认证信息，或检查静态请求头。${scope}`, 800) }
  }
  if (/invalid_client|client_secret|client_id/.test(lower)) {
    return { stage: 'auth', code: 'INVALID_CLIENT', message: summarize(`${combined}\n登录接口拒绝了 client_id/client_secret。`, 800) }
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].some((code) => codes.includes(code))) {
    return { stage: 'connect', code: 'CONNECT_FAILED', message: summarize(combined, 800) }
  }
  if (name === 'AbortError' || name === 'TimeoutError' || /aborted|timeout|timed out/i.test(combined)) {
    return { stage: 'connect', code: 'TIMEOUT', message: summarize(`${combined}\n连接或操作超时。`, 800) }
  }
  return {
    stage: stageHint,
    code: 'MCP_FAILED',
    message: summarize(combined,
      800),
  }
}

/** Build an SDK transport for one normalized server row. */
function buildTransport({ server, auth, logger, redact, signal }) {
  const sdk = loadSdk()
  const headers = auth.requestHeaders()
  const authFetch = createAuthFetch({
    getHeaders: () => auth.requestHeaders(),
    ensureFresh: () => auth.ensureFresh(),
    onUnauthorized: () => auth.onUnauthorized(),
    tls: server.tls,
  })
  if (signal?.aborted === true) throw new Error('连接已取消')
  if (server.transport === 'stdio') {
    const env = { ...sdk.getDefaultEnvironment(), ...auth.environment() }
    const transport = new sdk.StdioClientTransport({
      command: server.command,
      args: server.args,
      env,
      ...(server.cwd === '' ? {} : { cwd: server.cwd }),
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text !== '') logger.debug(redact(`stdio stderr: ${text}`))
    })
    return transport
  }
  if (server.transport === 'sse') {
    return new sdk.SSEClientTransport(new URL(server.url), {
      fetch: authFetch,
      requestInit: { headers },
    })
  }
  return new sdk.StreamableHTTPClientTransport(new URL(server.url), {
    fetch: authFetch,
    requestInit: { headers },
  })
}

/** One managed server's live connection and registrations. */
export class McpRuntime {
  /**
   * @param {object} options
   * @param {import('@deepseek-ai/cordis').Context} options.ctx
   * @param {object} options.server normalized server row.
   * @param {import('./credentials.js').AuthState} options.auth
   */
  constructor({ ctx, server, auth }) {
    this.ctx = ctx
    this.server = server
    this.auth = auth
    this.disposed = false
    this.client = undefined
    this.transport = undefined
    this.controller = undefined
    this.toolDisposers = new Map()
    this.toolInfo = new Map()
    this.reconnectTimer = undefined
    this.reconnectAttempts = 0
    this.starting = undefined
    this.closing = false
    this.generation = 0
    this.status = {
      state: 'connecting',
      toolCount: 0,
      tools: [],
      lastError: '',
      connectedAt: undefined,
      attempt: 0,
      protocolVersion: undefined,
      serverInfo: undefined,
    }
    this.logger = ctx.logger
  }

  /** Every secret this runtime has seen, including old rotations. */
  secrets() {
    return this.auth.secrets()
  }

  /** Redact secrets from text. */
  redact(text) {
    return redactSecrets(text, this.secrets())
  }

  /** Lifecycle-safe status snapshot for the management API. */
  statusView() {
    return {
      state: this.disposed ? 'closed' : this.status.state,
      toolCount: this.status.toolCount,
      tools: [...this.status.tools],
      lastError: this.redact(this.status.lastError),
      connectedAt: this.status.connectedAt,
      attempt: this.status.attempt,
      protocolVersion: this.status.protocolVersion,
      serverInfo: this.status.serverInfo,
      needsLogin: this.auth.needsLogin,
      authError: this.redact(this.auth.lastError),
    }
  }

  /** Start or restart the connection. */
  async start() {
    if (this.disposed) return
    if (this.starting !== undefined) return this.starting
    this.starting = this.doStart().finally(() => { this.starting = undefined })
    return this.starting
  }

  /** Internal start with one connect + list + registration generation. */
  async doStart() {
    if (this.disposed) return
    await this.closeCurrent(false)
    if (this.disposed) return
    this.status.state = 'connecting'
    this.status.lastError = ''
    this.controller = new AbortController()
    const generation = this.generation
    let client
    let transport
    try {
      await this.auth.load()
      transport = buildTransport({
        server: this.server,
        auth: this.auth,
        logger: this.logger,
        redact: (text) => this.redact(text),
        signal: this.controller.signal,
      })
      const sdk = loadSdk()
      client = new sdk.Client(
        { name: 'dsh-mcp-gui', version: '1.0.0' },
        {
          versionNegotiation: versionNegotiationFor(this.server),
          listChanged: {
            tools: {
              onChanged: (error, tools) => {
                if (error !== undefined) {
                  this.logger.warn(this.redact(`mcp-gui(${this.server.name}): 工具列表刷新失败：${error instanceof Error ? error.message : String(error)}`))
                  return
                }
                void this.applyTools(tools, generation)
              },
            },
          },
        },
      )
      this.client = client
      this.transport = transport
      transport.onclose = () => this.handleClose()
      transport.onerror = (error) => {
        this.status.lastError = this.redact(error instanceof Error ? error.message : String(error))
      }
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, this.controller.signal)
      const listed = await withTimeout(client.listTools(undefined, { cacheMode: 'refresh' }), CONNECT_TIMEOUT_MS, this.controller.signal)
      await this.applyTools(listed.tools, generation)
      const version = client.getServerVersion()
      this.status.serverInfo = version === undefined ? undefined : { name: version.name, version: version.version }
      this.status.protocolVersion = this.transport?.protocolVersion ?? client.protocolVersion
      if (this.reconnectTimer !== undefined) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = undefined
      }
      this.status.state = 'connected'
      this.status.connectedAt = Date.now()
      this.status.attempt = 0
      this.reconnectAttempts = 0
      this.logger.info(`mcp-gui(${this.server.name}): 已连接，${this.status.toolCount} 个工具`)
    } catch (error) {
      const classified = classifyError(error, 'connect', (text) => this.redact(text))
      this.status.state = this.auth.needsLogin || classified.stage === 'auth' ? 'auth-required' : 'error'
      this.status.lastError = classified.message
      this.logger.warn(`mcp-gui(${this.server.name}): ${classified.message}`)
      const authFailure = classified.stage === 'auth' || this.auth.needsLogin
      await this.closeCurrent(false)
      if (authFailure) {
        this.status.state = 'auth-required'
      } else {
        this.scheduleReconnect()
      }
    }
  }

  /** Register one tool-list generation. */
  async applyTools(tools, generation) {
    if (this.disposed) return
    if (generation !== undefined && generation !== this.generation) return
    if (this.controller?.signal.aborted === true) return
    const definitions = []
    const seen = new Set()
    for (const tool of tools ?? []) {
      if (tool === null || typeof tool !== 'object' || typeof tool.name !== 'string') continue
      const publicName = publicToolName(this.server.name, tool.name)
      if (seen.has(publicName)) {
        this.logger.warn(`mcp-gui(${this.server.name}): 服务端重复列出工具 "${tool.name}"，本轮工具注册跳过`)
        return
      }
      seen.add(publicName)
      definitions.push({ tool, publicName, definition: this.createToolDefinition(tool, publicName) })
    }
    for (const dispose of this.toolDisposers.values()) dispose()
    this.toolDisposers.clear()
    this.toolInfo.clear()
    const registered = new Map()
    try {
      for (const entry of definitions) {
        const dispose = this.ctx.tools.register(entry.definition)
        registered.set(entry.publicName, dispose)
        this.toolInfo.set(entry.publicName, { rawName: entry.tool.name, tool: entry.tool })
      }
      this.toolDisposers = registered
      this.status.toolCount = registered.size
      this.status.tools = [...registered.keys()]
    } catch (error) {
      for (const dispose of registered.values()) dispose()
      this.toolDisposers.clear()
      this.toolInfo.clear()
      this.status.toolCount = 0
      this.status.tools = []
      this.status.lastError = this.redact(`工具注册失败：${error instanceof Error ? error.message : String(error)}`)
      this.logger.error(`mcp-gui(${this.server.name}): ${this.status.lastError}`)
    }
  }

  /** Build the ctx.tools registration for one upstream tool. */
  createToolDefinition(tool, publicName) {
    const serverName = this.server.name
    const inputSchema = tool.inputSchema !== null && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} }
    return {
      name: publicName,
      description: `${serverName}: ${tool.description ?? tool.name}`,
      parameters: inputSchema,
      timeoutMs: CALL_TIMEOUT_MS,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        const client = this.client
        if (client === undefined) throw new Error(`MCP 服务 "${serverName}" 当前未连接`)
        const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
        const signals = [exec.signal, timeout]
        if (this.controller !== undefined) signals.push(this.controller.signal)
        const signal = AbortSignal.any(signals)
        try {
          const result = await client.callTool(
            { name: tool.name, arguments: args },
            { signal, timeout: CALL_TIMEOUT_MS, toolDefinition: tool },
          )
          const text = this.redact(mcpResultText(result))
          if (result.isError === true) throw new Error(text)
          return text
        } catch (error) {
          const classified = classifyError(error, 'call', (value) => this.redact(value))
          if (classified.stage === 'auth') {
            this.auth.needsLogin = true
            this.auth.lastError = classified.message
            this.status.state = 'auth-required'
            this.status.lastError = classified.message
          }
          throw new Error(classified.message, { cause: error })
        }
      },
    }
  }

  /** Close the socket but keep tool registrations (used by reconnect). */
  async closeCurrent(unregister) {
    this.closing = true
    this.generation += 1
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    const client = this.client
    this.client = undefined
    const transport = this.transport
    this.transport = undefined
    const controller = this.controller
    this.controller = undefined
    controller?.abort()
    if (client !== undefined) {
      try {
        await withTimeout(client.close(), 5_000)
      } catch {
        // A failed close still releases the local handle.
      }
    }
    if (transport !== undefined) {
      try {
        await withTimeout(transport.close(), 5_000)
      } catch {
        // Transport closure is best effort.
      }
    }
    if (unregister) {
      for (const dispose of this.toolDisposers.values()) dispose()
      this.toolDisposers.clear()
      this.toolInfo.clear()
      this.status.toolCount = 0
      this.status.tools = []
    }
    this.closing = false
  }

  /** A lost connection schedules one reconnect attempt with backoff. */
  handleClose() {
    if (this.disposed || this.closing) return
    if (this.status.state === 'connected') {
      this.status.state = 'reconnecting'
      this.status.lastError = '连接已断开，正在重连'
    }
    this.scheduleReconnect()
  }

  /** Schedule the next attempt, or give up after the budget. */
  scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== undefined) return
    const attempt = this.reconnectAttempts
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      this.status.state = 'error'
      this.status.lastError = this.status.lastError || '重连次数已用尽'
      return
    }
    const delay = RECONNECT_DELAYS_MS[attempt]
    this.reconnectAttempts += 1
    this.status.attempt = this.reconnectAttempts
    this.status.state = 'reconnecting'
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.disposed) void this.start()
    }, delay)
  }

  /** Restart the connection after a manual test or auth change. */
  async restart() {
    if (this.disposed) return
    this.reconnectAttempts = 0
    await this.closeCurrent(true)
    await this.start()
  }

  /** Stop permanently and unregister every tool. */
  async stop() {
    this.disposed = true
    this.status.state = 'closed'
    await this.closeCurrent(true)
  }
}

/** Await a promise with a deadline and an outer abort signal. */
function withTimeout(promise, timeoutMs, outerSignal) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onAbort)
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error(`操作超时（${timeoutMs} ms）`)), timeoutMs)
    const onAbort = () => finish(reject, new Error('操作已取消'))
    if (outerSignal?.aborted === true) {
      onAbort()
      return
    }
    outerSignal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

/**
 * Probe one server without registering tools or touching a live runtime.
 * @param {{server:object, headers:Record<string,string>, env:Record<string,string>, timeoutMs?:number}} options
 */
export async function probeServerConfig({ server, headers, env, timeoutMs = 30_000, ensureFresh = async () => {}, onUnauthorized = async () => false, getHeaders }) {
  const started = Date.now()
  const redact = (text) => redactSecrets(text, new Set([
    ...Object.values(headers ?? {}),
    ...Object.values(env ?? {}),
  ]))
  const sdk = loadSdk()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let client
  let transport
  try {
    const auth = {
      requestHeaders: getHeaders ?? (() => ({ ...headers })),
      ensureFresh,
      onUnauthorized,
      environment: () => ({ ...env }),
    }
    transport = buildTransport({
      server,
      auth,
      logger: { debug: () => {} },
      redact,
      signal: controller.signal,
    })
    client = new sdk.Client({ name: 'dsh-mcp-gui-probe', version: '1.0.0' }, { versionNegotiation: versionNegotiationFor(server) })
    await withTimeout(client.connect(transport), timeoutMs, controller.signal)
    const listed = await withTimeout(client.listTools(undefined, { cacheMode: 'refresh' }), timeoutMs, controller.signal)
    const version = client.getServerVersion()
    const toolNames = (listed.tools ?? []).map((tool) => tool.name)
    const protocolVersion = transport?.protocolVersion ?? client.protocolVersion
    if (toolNames.length === 0) {
      return {
        ok: false,
        stage: 'list',
        code: 'NO_TOOLS',
        message: '连接成功，但服务没有列出任何 tools，不计为通过。',
        toolNames,
        protocolVersion,
        serverInfo: version === undefined ? undefined : { name: version.name, version: version.version },
        durationMs: Date.now() - started,
      }
    }
    return {
      ok: true,
      stage: 'done',
      code: 'OK',
      message: '连接成功',
      toolNames,
      protocolVersion,
      serverInfo: version === undefined ? undefined : { name: version.name, version: version.version },
      durationMs: Date.now() - started,
    }
  } catch (error) {
    const classified = classifyError(error, client === undefined ? 'connect' : 'list', redact)
    return {
      ok: false,
      stage: classified.stage,
      code: classified.code,
      message: classified.message,
      durationMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    if (client !== undefined) {
      try {
        await withTimeout(client.close(), 5_000)
      } catch {
        // Probe cleanup is best effort; the caller reports connection success.
      }
    }
    if (transport !== undefined) {
      try {
        await withTimeout(transport.close(), 5_000)
      } catch {
        // Transport closure is best effort.
      }
    }
  }
}
