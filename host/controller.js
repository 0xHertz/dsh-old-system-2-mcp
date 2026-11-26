/** Management controller: document, credential records, runtimes, login capture, API. */

import { dataDirectory, loadDocument, saveDocument } from './store.js'
import { AuthState, groupCredentialKeyFor } from './credentials.js'
import { McpRuntime, probeServerConfig } from './mcp-runtime.js'
import { LoginCaptureManager } from './login-capture.js'
import {
  ApiError, asString, isPlainObject, maskSecret, normalizeGroup, normalizeServer, projectHeaders, redactSecrets, summarize, toApiError,
} from './util.js'

const MAX_VALUE_BYTES = 16 * 1024

/** Case-insensitive header lookup over a plain record. */
function headerValue(headers, name) {
  if (headers === undefined) return undefined
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

/** Mask a Cookie request header while keeping its cookie names visible. */
function maskCookie(value) {
  if (typeof value !== 'string' || value === '') return ''
  return value.split(';').map((part) => {
    const index = part.indexOf('=')
    return index > 0 ? `${part.slice(0, index).trim()}=****` : '****'
  }).join('; ')
}

/** One plugin instance's complete management state. */
export class McpGuiController {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   */
  constructor(ctx) {
    this.ctx = ctx
    this.logger = ctx.logger
    this.document = { version: 2, groups: [], servers: [] }
    this.dataDir = ''
    this.runtimes = new Map()
    this.auths = new Map()
    this.groupAuths = new Map()
    this.operation = Promise.resolve()
    this.disposed = false
    this.loginManager = new LoginCaptureManager({
      logger: this.logger,
      onCapture: (serverId, capture) => this.onCapture(serverId, capture),
      redact: (text) => this.redact(text),
    })
  }

  /** Redact every secret this controller has seen. */
  redact(text) {
    return redactSecrets(String(text ?? ''), this.allSecrets())
  }

  /** Union of all runtimes' known secret values. */
  allSecrets() {
    const secrets = new Set()
    for (const auth of this.auths.values()) {
      for (const value of auth.secrets()) secrets.add(value)
    }
    for (const auth of this.groupAuths.values()) {
      for (const value of auth.secrets()) secrets.add(value)
    }
    return secrets
  }

  /** Serialize mutations. */
  serialize(operation) {
    const next = this.operation.then(operation, operation)
    this.operation = next.catch(() => {})
    return next
  }

  /** Load the document and start enabled servers in the background. */
  async initialize() {
    this.dataDir = dataDirectory()
    this.document = await loadDocument(this.dataDir)
    this.logger.info(`mcp-gui: 已加载 ${this.document.servers.length} 个 MCP 服务定义、${this.document.groups.length} 个组（${this.dataDir}）`)
    void this.startEnabled()
  }

  /** Load every credential state and start every enabled server. */
  async startEnabled() {
    for (const group of this.document.groups) {
      try {
        await this.ensureGroupAuth(group)
      } catch (error) {
        this.logger.warn(this.redact(`mcp-gui 组(${group.name}): 凭据加载失败：${error instanceof Error ? error.message : String(error)}`))
      }
    }
    const tasks = this.document.servers.map(async (server) => {
      try {
        await this.ensureAuth(server)
        if (server.enabled !== false) await this.ensureRuntime(server)
      } catch (error) {
        this.logger.warn(this.redact(`mcp-gui(${server.name}): 启动失败：${error instanceof Error ? error.message : String(error)}`))
      }
    })
    await Promise.allSettled(tasks)
  }

  /** Find one stored server. */
  findServer(id) {
    return this.document.servers.find((server) => server.id === id)
  }

  /** Ensure the credential state exists. */
  async ensureAuth(server) {
    const existing = this.auths.get(server.id)
    if (existing !== undefined) {
      existing.server = server
      return existing
    }
    const auth = new AuthState({ ctx: this.ctx, server, redact: (text) => this.redact(text) })
    await auth.load()
    this.auths.set(server.id, auth)
    return auth
  }

  /** Ensure one runtime exists and starts. */
  async ensureRuntime(server) {
    if (this.disposed || server.enabled === false) return undefined
    const group = server.groupId ? this.findGroup(server.groupId) : undefined
    if (server.groupId && group === undefined) throw new Error(`所属组 ${server.groupId} 不存在`)
    const auth = group === undefined ? await this.ensureAuth(server) : await this.ensureGroupAuth(group)
    const serviceAuth = group === undefined ? undefined : await this.ensureAuth(server)
    const extraHeaders = group === undefined ? undefined : () => this.serviceHeaderValues(server, serviceAuth)
    const existing = this.runtimes.get(server.id)
    if (existing !== undefined && existing.server === server) return existing
    if (existing !== undefined) {
      await existing.stop()
      this.runtimes.delete(server.id)
    }
    const runtime = new McpRuntime({ ctx: this.ctx, server, auth, extraHeaders })
    this.runtimes.set(server.id, runtime)
    void runtime.start()
    return runtime
  }

  /** Reconnect grouped services whose auth just became usable or invalid. */
  async refreshGroupMembers(group, force = false) {
    for (const server of this.document.servers.filter((entry) => entry.groupId === group.id)) {
      if (server.enabled === false) continue
      if (force) {
        await this.stopRuntime(server.id)
        await this.ensureRuntime(server)
        continue
      }
      const runtime = this.runtimes.get(server.id)
      if (runtime === undefined) await this.ensureRuntime(server)
      else if (['auth-required', 'error', 'closed', 'reconnecting'].includes(runtime.status.state)) await runtime.restart()
    }
  }

  /** Configured non-auth headers for one grouped service. */
  serviceHeaderValues(server, auth) {
    const values = {}
    const raw = auth?.rawHeaders() ?? {}
    for (const header of server.headers ?? []) {
      const value = headerValue(raw, header.name)
      if (typeof value === 'string' && value !== '') values[header.name] = value
    }
    return values
  }

  /** Stop one runtime. */
  async stopRuntime(id) {
    const runtime = this.runtimes.get(id)
    if (runtime === undefined) return
    this.runtimes.delete(id)
    await runtime.stop()
  }

  /** A server-like object used to bind one group's shared AuthState. */
  groupAuthServer(group) {
    return { id: group.id, name: group.name, auth: group.auth, headers: group.headers, tls: group.tls }
  }

  /** Find one stored group. */
  findGroup(id) {
    return this.document.groups.find((group) => group.id === id)
  }

  /** Ensure one group's shared credential state exists. */
  async ensureGroupAuth(group) {
    const existing = this.groupAuths.get(group.id)
    if (existing !== undefined) {
      existing.server = this.groupAuthServer(group)
      return existing
    }
    const auth = new AuthState({
      ctx: this.ctx,
      server: this.groupAuthServer(group),
      redact: (text) => this.redact(text),
      key: groupCredentialKeyFor(group.id),
    })
    await auth.load()
    this.groupAuths.set(group.id, auth)
    return auth
  }

  /** Auth summary shared by a service or a group. */
  authViewFor(owner, auth, recordKey) {
    const mode = owner.auth?.mode ?? 'none'
    const projectedHeaders = auth?.requestHeaders() ?? {}
    const projectedHeader = (name) => Object.entries(projectedHeaders)
      .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
    const configuredHeaders = (owner.headers ?? []).filter((header) => {
      const value = headerValue(auth?.headers, header.name)
      return typeof value === 'string' && value !== ''
    })
    const staticReady = mode === 'static' && configuredHeaders.length > 0
    const loginCaptured = mode === 'login' && (owner.auth?.status === 'captured' || auth?.meta !== undefined)
    const status = mode === 'none'
      ? 'none'
      : mode === 'static'
        ? (staticReady ? 'captured' : 'none')
        : auth?.needsLogin === true ? 'expired' : loginCaptured ? 'captured' : 'none'
    const customTokenValue = typeof owner.auth?.tokenHeader === 'string' && owner.auth.tokenHeader !== ''
      ? projectedHeader(owner.auth.tokenHeader)
      : undefined
    return {
      mode,
      loginUrl: owner.auth?.loginUrl ?? '',
      refreshUrl: owner.auth?.refreshUrl ?? '',
      tokenHeader: owner.auth?.tokenHeader ?? '',
      tokenPrefix: owner.auth?.tokenPrefix ?? '',
      status,
      capturedAt: owner.auth?.capturedAt ?? null,
      expiresAt: mode === 'login' ? (auth?.meta?.expiresAt ?? owner.auth?.expiresAt) : undefined,
      hasRefreshToken: mode === 'login' && auth?.canRefresh() === true,
      masked: maskSecret(projectedHeader('authorization') ?? projectedHeader('cookie') ?? customTokenValue ?? ''),
      headerNames: Object.keys(projectedHeaders),
      lastError: this.redact(auth?.lastError || owner.auth?.lastError || ''),
      capturedHeaders: Object.entries(auth?.rawHeaders() ?? {}).map(([name, value]) => ({
        name,
        masked: name.toLowerCase() === 'cookie' ? maskCookie(value) : maskSecret(value),
        length: typeof value === 'string' ? value.length : 0,
      })),
      tokenType: auth?.meta?.tokenType,
      accessTokenMasked: maskSecret(auth?.meta?.accessToken ?? ''),
      refreshTokenPresent: typeof auth?.meta?.refreshToken === 'string' && auth.meta.refreshToken !== '',
      clientId: auth?.meta?.clientId,
      scope: auth?.meta?.scope,
      source: auth?.meta?.source,
      recordKey,
    }
  }

  /** Public server view without secret values. */
  serverView(server) {
    const auth = this.auths.get(server.id)
    const group = server.groupId ? this.findGroup(server.groupId) : undefined
    const effectiveOwner = group === undefined ? server : this.groupAuthServer(group)
    const effectiveAuth = group === undefined ? auth : this.groupAuths.get(group.id)
    const authView = this.authViewFor(
      effectiveOwner,
      effectiveAuth,
      group === undefined ? `mcp-gui/${server.id}` : `mcp-gui/group/${group.id}`,
    )
    const ownAuth = group === undefined ? undefined : this.authViewFor(server, auth, `mcp-gui/${server.id}`)
    const runtime = this.runtimes.get(server.id)
    const live = runtime?.statusView()
    const headers = server.headers.map((header) => {
      const value = headerValue(auth?.headers, header.name)
      return {
        name: header.name,
        secret: header.secret === true,
        set: typeof value === 'string' && value !== '',
        ...(header.secret === true ? {} : { value: value ?? '' }),
      }
    })
    return {
      id: server.id,
      name: server.name,
      groupId: server.groupId ?? '',
      groupName: group?.name ?? '',
      enabled: server.enabled !== false,
      transport: server.transport,
      protocolMode: server.protocolMode ?? 'legacy',
      protocolVersion: live?.protocolVersion,
      url: server.url,
      command: server.command,
      args: [...(server.args ?? [])],
      cwd: server.cwd,
      envKeys: [...(server.envKeys ?? [])],
      envSet: Object.fromEntries((server.envKeys ?? []).map((key) => [key, typeof auth?.env[key] === 'string' && auth.env[key] !== ''])),
      headers,
      auth: authView,
      ...(ownAuth === undefined ? {} : { ownAuth }),
      tls: {
        mode: server.tls.mode,
        hasCa: typeof server.tls.caPem === 'string' && server.tls.caPem !== '',
        caPem: server.tls.caPem,
      },
      status: live ?? {
        state: server.enabled === false ? 'disabled' : 'idle',
        toolCount: 0,
        tools: [],
        lastError: '',
        needsLogin: false,
        authError: '',
      },
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    }
  }

  /** Public group view without secret values. */
  groupView(group) {
    const auth = this.groupAuths.get(group.id)
    const headers = group.headers.map((header) => {
      const value = headerValue(auth?.headers, header.name)
      return {
        name: header.name,
        secret: header.secret === true,
        set: typeof value === 'string' && value !== '',
        ...(header.secret === true ? {} : { value: value ?? '' }),
      }
    })
    const members = this.document.servers
      .filter((server) => server.groupId === group.id)
      .map((server) => {
        const runtime = this.runtimes.get(server.id)
        const live = runtime?.statusView()
        return {
          id: server.id,
          name: server.name,
          enabled: server.enabled !== false,
          state: live?.state ?? (server.enabled === false ? 'disabled' : 'idle'),
          toolCount: live?.toolCount ?? 0,
        }
      })
    return {
      id: group.id,
      name: group.name,
      headers,
      auth: this.authViewFor(this.groupAuthServer(group), auth, `mcp-gui/group/${group.id}`),
      tls: {
        mode: group.tls.mode,
        hasCa: typeof group.tls.caPem === 'string' && group.tls.caPem !== '',
        caPem: group.tls.caPem,
      },
      serviceCount: members.length,
      members,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    }
  }

  /** Complete state for the panel. */
  state() {
    return {
      groups: this.document.groups.map((group) => this.groupView(group)),
      servers: this.document.servers.map((server) => this.serverView(server)),
      loginSessions: this.loginManager.list(),
    }
  }

  /** Save header/env values from one form onto an AuthState. */
  async applySecretForm(server, input, auth) {
    const headerValues = {}
    if (Array.isArray(input.headerValues)) {
      for (const entry of input.headerValues) {
        if (!isPlainObject(entry)) continue
        const name = asString(entry.name).trim()
        if (name === '') continue
        const value = asString(entry.value)
        if (value === '') continue
        if (Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new ApiError(400, 'secret-too-large', `请求头 ${name} 的值超过 16 KB`)
        headerValues[name] = value
      }
    }
    if (isPlainObject(input.headerValues)) {
      for (const [name, value] of Object.entries(input.headerValues)) {
        if (typeof value !== 'string' || value === '') continue
        if (Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new ApiError(400, 'secret-too-large', `请求头 ${name} 的值超过 16 KB`)
        headerValues[name] = value
      }
    }
    await auth.setHeaderValues(headerValues)
    await auth.pruneHeaders([...server.headers.map((header) => header.name), 'Authorization', 'Cookie', server.auth.tokenHeader].filter((name) => name !== ''))
    if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)

    const envValues = {}
    if (isPlainObject(input.envValues)) {
      for (const [name, value] of Object.entries(input.envValues)) {
        if (typeof value !== 'string') continue
        if (Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new ApiError(400, 'secret-too-large', `环境变量 ${name} 的值超过 16 KB`)
        envValues[name] = value
      }
    }
    await auth.setEnvironment(envValues)
    await auth.pruneEnvironment(server.envKeys)
    if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
  }

  /** Create or update one server. */
  async saveServer(input) {
    return this.serialize(async () => {
      const serverInput = isPlainObject(input.server) ? input.server : {}
      const previous = typeof serverInput.id === 'string' ? this.findServer(serverInput.id) : undefined
      const { server, errors } = normalizeServer(serverInput, this.document.servers, previous)
      if (errors.length > 0) throw new ApiError(400, 'invalid-server', errors.join('；'), { errors })
      if (server.groupId !== '') {
        if (this.findGroup(server.groupId) === undefined) throw new ApiError(400, 'group-not-found', '所属组不存在')
        if (server.transport === 'stdio') throw new ApiError(400, 'group-stdio', 'stdio 服务不能加入组，请使用单独认证')
      }
      const auth = previous === undefined
        ? new AuthState({ ctx: this.ctx, server, redact: (text) => this.redact(text) })
        : await this.ensureAuth(previous)
      auth.server = server
      await auth.load()
      const loginChanged = previous !== undefined
        && previous.auth?.mode === 'login'
        && server.auth.mode === 'login'
        && previous.auth.loginUrl !== server.auth.loginUrl
      const groupChanged = previous !== undefined && (previous.groupId ?? '') !== (server.groupId ?? '')
      if (loginChanged) {
        this.loginManager.cancelForServer(server.id)
        await auth.resetCapture()
        if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
        server.auth.status = 'none'
        server.auth.capturedAt = null
        server.auth.expiresAt = null
      }
      await this.applySecretForm(server, input, auth)
      if (groupChanged) {
        await auth.resetCapture()
        if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
        server.auth.status = 'none'
        server.auth.capturedAt = null
        server.auth.expiresAt = null
      }
      if (server.auth.mode === 'login' && server.auth.tokenHeader !== '' && !groupChanged) {
        await auth.applyConfiguredToken()
        if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
      }
      if (server.groupId === '' && !groupChanged && server.auth.mode === 'static') {
        const configured = new Set(server.headers.map((header) => header.name.toLowerCase()))
        const present = Object.keys(auth.headers).filter((name) => configured.has(name.toLowerCase()) && auth.headers[name] !== '')
        if (present.length === 0) throw new ApiError(400, 'missing-token', '静态认证至少需要一个已填写的请求头值')
      }
      if (server.auth.mode === 'login' && server.auth.capturedAt === null) {
        server.auth.status = 'none'
      }
      const index = this.document.servers.findIndex((entry) => entry.id === server.id)
      if (index === -1) this.document.servers.push(server)
      else this.document.servers[index] = server
      await saveDocument(this.document, this.dataDir)
      this.auths.set(server.id, auth)
      await this.stopRuntime(server.id)
      if (server.enabled !== false) await this.ensureRuntime(server)
      this.logger.info(this.redact(`mcp-gui: 已保存 MCP 服务 "${server.name}"`))
      return this.serverView(server)
    })
  }

  /** Delete one server and its credential record. */
  async deleteServer(id) {
    return this.serialize(async () => {
      const server = this.findServer(id)
      if (server === undefined) throw new ApiError(404, 'not-found', '服务不存在')
      await this.stopRuntime(id)
      const auth = await this.ensureAuth(server)
      try {
        await auth.clear()
      } catch (error) {
        if (server.enabled !== false) await this.ensureRuntime(server)
        throw error
      }
      this.auths.delete(id)
      this.document.servers = this.document.servers.filter((entry) => entry.id !== id)
      await saveDocument(this.document, this.dataDir)
      this.logger.info(this.redact(`mcp-gui: 已删除 MCP 服务 "${server.name}"`))
      return { id }
    })
  }

  /** Create or update one MCP group. */
  async saveGroup(input) {
    return this.serialize(async () => {
      const groupInput = isPlainObject(input.group) ? input.group : input
      const previous = typeof groupInput.id === 'string' ? this.findGroup(groupInput.id) : undefined
      const { group, errors } = normalizeGroup(groupInput, this.document.groups, previous)
      if (errors.length > 0) throw new ApiError(400, 'invalid-group', errors.join('；'), { errors })
      const auth = previous === undefined
        ? new AuthState({
            ctx: this.ctx,
            server: this.groupAuthServer(group),
            redact: (text) => this.redact(text),
            key: groupCredentialKeyFor(group.id),
          })
        : await this.ensureGroupAuth(previous)
      auth.server = this.groupAuthServer(group)
      await auth.load()
      const loginChanged = previous !== undefined
        && previous.auth?.mode === 'login'
        && group.auth.mode === 'login'
        && previous.auth.loginUrl !== group.auth.loginUrl
      if (loginChanged) {
        this.loginManager.cancelForServer(group.id)
        await auth.resetCapture()
        if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
        group.auth.status = 'none'
        group.auth.capturedAt = null
        group.auth.expiresAt = null
      }
      await this.applySecretForm(this.groupAuthServer(group), input, auth)
      if (group.auth.mode === 'login' && group.auth.tokenHeader !== '') {
        await auth.applyConfiguredToken()
        if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
      }
      if (group.auth.mode === 'static') {
        const configured = new Set(group.headers.map((header) => header.name.toLowerCase()))
        const present = Object.keys(auth.headers).filter((name) => configured.has(name.toLowerCase()) && auth.headers[name] !== '')
        if (present.length === 0) throw new ApiError(400, 'missing-token', '组静态认证至少需要一个已填写的请求头值')
      }
      if (auth.lastError !== '') throw new ApiError(500, 'secret-store', auth.lastError)
      if (group.auth.mode === 'login' && group.auth.capturedAt === null) group.auth.status = 'none'
      const index = this.document.groups.findIndex((entry) => entry.id === group.id)
      if (index === -1) this.document.groups.push(group)
      else this.document.groups[index] = group
      await saveDocument(this.document, this.dataDir)
      this.groupAuths.set(group.id, auth)
      await this.refreshGroupMembers(group, loginChanged)
      this.logger.info(this.redact(`mcp-gui: 已保存 MCP 组 "${group.name}"`))
      return this.groupView(group)
    })
  }

  /** Delete one MCP group. Members must be moved out first. */
  async deleteGroup(id) {
    return this.serialize(async () => {
      const group = this.findGroup(id)
      if (group === undefined) throw new ApiError(404, 'not-found', '组不存在')
      const members = this.document.servers.filter((server) => server.groupId === id)
      if (members.length > 0) {
        throw new ApiError(400, 'group-in-use', `组内还有 ${members.length} 个服务，请先将它们移出该组`)
      }
      this.loginManager.cancelForServer(id)
      const auth = await this.ensureGroupAuth(group)
      await auth.clear()
      this.groupAuths.delete(id)
      this.document.groups = this.document.groups.filter((entry) => entry.id !== id)
      await saveDocument(this.document, this.dataDir)
      this.logger.info(this.redact(`mcp-gui: 已删除 MCP 组 "${group.name}"`))
      return { id }
    })
  }

  /** Begin a browser login capture for one group. */
  async startGroupLogin(id) {
    const group = this.findGroup(id)
    if (group === undefined) throw new ApiError(404, 'not-found', '组不存在')
    if (group.auth.mode !== 'login') throw new ApiError(400, 'not-login', '该组没有配置登录捕获')
    if (group.auth.loginUrl === '') throw new ApiError(400, 'missing-login-url', '请先填写组登录页地址')
    return this.loginManager.start({ server: this.groupAuthServer(group), loginUrl: group.auth.loginUrl })
  }

  /** Enable or disable one server without deleting it. */
  async setEnabled(id, enabled) {
    return this.serialize(async () => {
      const server = this.findServer(id)
      if (server === undefined) throw new ApiError(404, 'not-found', '服务不存在')
      server.enabled = enabled === true
      server.updatedAt = Date.now()
      await saveDocument(this.document, this.dataDir)
      if (server.enabled) {
        await this.ensureRuntime(server)
      } else {
        await this.stopRuntime(id)
      }
      return this.serverView(server)
    })
  }

  /** Test a saved server or a draft form without persisting anything. */
  async probe(input) {
    const draft = isPlainObject(input.server) ? input.server : undefined
    const id = asString(input.id) || asString(draft?.id)
    const previous = id === '' ? undefined : this.findServer(id)
    let server
    if (draft !== undefined) {
      const { server: normalized, errors } = normalizeServer(draft, this.document.servers, previous)
      if (errors.length > 0) throw new ApiError(400, 'invalid-server', errors.join('；'), { errors })
      server = normalized
    } else {
      if (previous === undefined) throw new ApiError(404, 'not-found', '服务不存在')
      server = previous
    }
    const group = server.groupId ? this.findGroup(server.groupId) : undefined
    if (server.groupId && group === undefined) throw new ApiError(400, 'group-not-found', '所属组不存在')
    if (group !== undefined && server.transport === 'stdio') {
      throw new ApiError(400, 'group-stdio', 'stdio 服务不能加入组，请使用单独认证')
    }

    const secrets = new Set()
    const existingAuth = previous === undefined ? undefined : await this.ensureAuth(previous)
    if (existingAuth !== undefined) {
      for (const value of existingAuth.secrets()) secrets.add(value)
    }
    const groupAuth = group === undefined ? undefined : await this.ensureGroupAuth(group)
    if (groupAuth !== undefined) {
      for (const value of groupAuth.secrets()) secrets.add(value)
    }
    let headers = {}
    let env = {}
    let getHeaders
    let ensureFresh
    let onUnauthorized
    if (groupAuth !== undefined) {
      await groupAuth.ensureFresh()
      const values = draft !== undefined
        ? this.collectHeaderValues(input, secrets)
        : this.serviceHeaderValues(server, existingAuth)
      headers = { ...groupAuth.requestHeaders(), ...values }
      getHeaders = () => ({ ...groupAuth.requestHeaders(), ...values })
      ensureFresh = () => groupAuth.ensureFresh()
      onUnauthorized = () => groupAuth.refresh()
    } else if (draft === undefined) {
      if (existingAuth !== undefined) {
        await existingAuth.ensureFresh()
        headers = existingAuth.requestHeaders()
        env = existingAuth.environment()
        getHeaders = () => existingAuth.requestHeaders()
        ensureFresh = () => existingAuth.ensureFresh()
        onUnauthorized = () => existingAuth.refresh()
      }
    } else {
      const values = this.collectHeaderValues(input, secrets)
      const build = () => projectHeaders(server, { ...(existingAuth?.rawHeaders() ?? {}), ...values })
      headers = build()
      env = this.formEnv(server, input, existingAuth, secrets)
      if (existingAuth !== undefined) {
        getHeaders = build
        if (server.auth.mode === 'login') {
          ensureFresh = () => existingAuth.ensureFresh()
          onUnauthorized = () => existingAuth.refresh()
        }
      }
    }

    const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1_000, Math.min(120_000, Number(input.timeoutMs))) : 30_000
    const result = await probeServerConfig({
      server,
      headers,
      env,
      timeoutMs,
      ...(getHeaders === undefined ? {} : { getHeaders, ensureFresh, onUnauthorized }),
    })
    const redact = (text) => redactSecrets(text, secrets)
    return {
      ...result,
      message: redact(result.message),
      toolNames: (result.toolNames ?? []).map((name) => redact(name)),
      serverName: server.name,
      transport: server.transport,
    }
  }

  /** Collect non-empty header values from an edit-form body. */
  collectHeaderValues(input, secrets) {
    const values = {}
    const apply = (name, value) => {
      if (typeof value !== 'string' || value === '') return
      values[name] = value
      secrets.add(value)
    }
    if (Array.isArray(input.headerValues)) {
      for (const entry of input.headerValues) {
        if (!isPlainObject(entry)) continue
        const name = asString(entry.name).trim()
        if (name !== '') apply(name, entry.value)
      }
    }
    if (isPlainObject(input.headerValues)) {
      for (const [name, value] of Object.entries(input.headerValues)) apply(name, value)
    }
    return values
  }

  /** Environment for a draft form, merging kept values. */
  formEnv(server, input, existingAuth, secrets) {
    const values = {}
    if (existingAuth !== undefined) {
      for (const [name, value] of Object.entries(existingAuth.environment())) values[name] = value
    }
    if (isPlainObject(input.envValues)) {
      for (const [name, value] of Object.entries(input.envValues)) {
        if (typeof value !== 'string') continue
        values[name] = value
        secrets.add(value)
      }
    }
    const allowed = new Set(server.envKeys)
    return Object.fromEntries(Object.entries(values).filter(([name]) => allowed.has(name)))
  }

  /** Begin a browser login capture. */
  async startLogin(id) {
    const server = this.findServer(id)
    if (server === undefined) throw new ApiError(404, 'not-found', '服务不存在')
    if (server.groupId !== '') throw new ApiError(400, 'group-auth', '组内服务请在组上统一登录')
    if (server.auth.mode !== 'login') throw new ApiError(400, 'not-login', '该服务没有配置登录捕获')
    if (server.auth.loginUrl === '') throw new ApiError(400, 'missing-login-url', '请先填写登录页地址')
    const result = await this.loginManager.start({ server, loginUrl: server.auth.loginUrl })
    return result
  }

  /** Read one login capture session plus the current server auth summary. */
  loginStatus(id) {
    const status = this.loginManager.status(id)
    const group = this.findGroup(status.serverId)
    const server = group === undefined ? this.findServer(status.serverId) : undefined
    return {
      ...status,
      auth: group !== undefined ? this.groupView(group).auth : (server === undefined ? undefined : this.serverView(server).auth),
    }
  }

  /** Ask the capture session to save its current cookies. */
  async completeLogin(id) {
    await this.loginManager.complete(id)
    return this.loginStatus(id)
  }

  /** Drop a login capture session. */
  cancelLogin(id) {
    this.loginManager.cancel(id)
    return { id }
  }

  /** Persist captured credentials and make them live. */
  async onCapture(serverId, capture) {
    const group = this.findGroup(serverId)
    if (group !== undefined) {
      if (typeof capture.loginUrl === 'string' && capture.loginUrl !== group.auth.loginUrl) {
        throw new Error('登录页地址已变更，已丢弃旧会话的捕获')
      }
      const groupAuth = await this.ensureGroupAuth(group)
      await groupAuth.applyCapture(capture)
      if (groupAuth.lastError !== '') throw new Error(groupAuth.lastError)
      group.auth.status = 'captured'
      group.auth.capturedAt = capture.source === 'manual' ? Date.now() : (capture.capturedAt ?? Date.now())
      group.auth.expiresAt = groupAuth.meta?.expiresAt ?? group.auth.expiresAt
      group.auth.lastError = ''
      group.updatedAt = Date.now()
      await saveDocument(this.document, this.dataDir)
      await this.refreshGroupMembers(group)
      this.logger.info(this.redact(`mcp-gui 组(${group.name}): 已保存登录捕获的认证信息`))
      return this.groupView(group)
    }
    const server = this.findServer(serverId)
    if (server === undefined) throw new Error('服务已被删除')
    if (typeof capture.loginUrl === 'string' && capture.loginUrl !== server.auth.loginUrl) {
      throw new Error('登录页地址已变更，已丢弃旧会话的捕获')
    }
    const auth = await this.ensureAuth(server)
    await auth.applyCapture(capture)
    if (auth.lastError !== '') throw new Error(auth.lastError)
    server.auth.status = 'captured'
    server.auth.capturedAt = capture.source === 'manual' ? Date.now() : (capture.capturedAt ?? Date.now())
    server.auth.expiresAt = auth.meta?.expiresAt ?? server.auth.expiresAt
    server.auth.lastError = ''
    server.updatedAt = Date.now()
    await saveDocument(this.document, this.dataDir)
    const runtime = this.runtimes.get(serverId)
    if (runtime === undefined) {
      if (server.enabled !== false) await this.ensureRuntime(server)
    } else if (['auth-required', 'error', 'closed', 'reconnecting'].includes(runtime.status.state)) {
      await runtime.restart()
    }
    this.logger.info(this.redact(`mcp-gui(${server.name}): 已保存登录捕获的认证信息`))
    return this.serverView(server)
  }

  /** Handle one HTTP request under /mcp-gui. */
  async handleApi(req, res, helpers) {
    const { sendJson, readJsonBody } = helpers
    const rejection = this.ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      sendJson(res, rejection, { error: { code: 'unauthorized', message: '需要先登录 DSH Web' } })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/mcp-gui/, '')
    try {
      if (req.method === 'GET' && path === '/api/state') {
        sendJson(res, 200, { ok: true, ...this.state() })
        return
      }
      if (req.method === 'POST' && path === '/api/groups') {
        const body = await readJsonBody(req)
        const group = await this.saveGroup(body)
        sendJson(res, 200, { ok: true, group })
        return
      }
      if (req.method === 'POST' && path === '/api/groups/delete') {
        const body = await readJsonBody(req)
        const result = await this.deleteGroup(asString(body.id))
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && path === '/api/groups/login/start') {
        const body = await readJsonBody(req)
        const result = await this.startGroupLogin(asString(body.id))
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && path === '/api/servers') {
        const body = await readJsonBody(req)
        const server = await this.saveServer(body)
        sendJson(res, 200, { ok: true, server })
        return
      }
      if (req.method === 'POST' && path === '/api/servers/delete') {
        const body = await readJsonBody(req)
        const result = await this.deleteServer(asString(body.id))
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && path === '/api/servers/enable') {
        const body = await readJsonBody(req)
        const server = await this.setEnabled(asString(body.id), body.enabled === true)
        sendJson(res, 200, { ok: true, server })
        return
      }
      if (req.method === 'POST' && path === '/api/probe') {
        const body = await readJsonBody(req)
        const result = await this.probe(body)
        sendJson(res, 200, { ok: true, probe: result })
        return
      }
      if (req.method === 'POST' && path === '/api/login/start') {
        const body = await readJsonBody(req)
        const result = await this.startLogin(asString(body.id))
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      if (req.method === 'GET' && path === '/api/login/status') {
        const id = url.searchParams.get('id') ?? ''
        const status = this.loginStatus(id)
        sendJson(res, 200, { ok: true, status })
        return
      }
      if (req.method === 'POST' && path === '/api/login/complete') {
        const body = await readJsonBody(req)
        const status = await this.completeLogin(asString(body.id))
        sendJson(res, 200, { ok: true, status })
        return
      }
      if (req.method === 'POST' && path === '/api/login/cancel') {
        const body = await readJsonBody(req)
        const result = this.cancelLogin(asString(body.id))
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      sendJson(res, 404, { error: { code: 'not-found', message: '接口不存在' } })
    } catch (error) {
      const apiError = toApiError(error, this.allSecrets())
      if (apiError.status >= 500) this.logger.warn(`mcp-gui: ${summarize(apiError.message, 500)}`)
      sendJson(res, apiError.status, {
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.details === undefined ? {} : { details: apiError.details }),
        },
      })
    }
  }

  /** Stop every runtime and close the capture listener. */
  async dispose() {
    this.disposed = true
    await this.loginManager.dispose()
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.allSettled(runtimes.map((runtime) => runtime.stop()))
  }
}
