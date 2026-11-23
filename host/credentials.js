/** Credential records and runtime auth refresh for one managed MCP server. */

import { decodeJwtExpiry, projectHeaders } from './util.js'
import { postForm } from './http-fetch.js'

/** Refresh this long before the advertised expiry. */
const EXPIRY_SKEW_MS = 60_000

/** Credential-key scope owned by this plugin. */
export const CREDENTIAL_SCOPE = 'mcp-gui'

/** Build the record key for one server. */
export function credentialKeyFor(serverId) {
  return `${CREDENTIAL_SCOPE}/${serverId}`
}

/** Drop values JSON cannot represent (undefined, functions, symbols, non-finite numbers). */
function jsonSafe(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((entry) => jsonSafe(entry)).filter((entry) => entry !== undefined)
  }
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    const cleaned = jsonSafe(entry)
    if (cleaned !== undefined) result[key] = cleaned
  }
  return result
}

/** Delete a header case-insensitively (Node lowercases incoming names). */
function deleteHeader(headers, name) {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) delete headers[key]
}

/** The empty payload shape. */
function emptyPayload() {
  return { headers: {}, env: {}, auth: undefined }
}

/** Normalize a stored record payload. */
function normalizePayload(record) {
  if (record === undefined || record === null || typeof record !== 'object') return emptyPayload()
  if (record.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return emptyPayload()
  const payload = record.payload
  return {
    headers: isStringMap(payload.headers) ? { ...payload.headers } : {},
    env: isStringMap(payload.env) ? { ...payload.env } : {},
    auth: isPlainAuth(payload.auth) ? { ...payload.auth } : undefined,
  }
}

function isStringMap(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function isPlainAuth(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a payload carries anything worth storing. */
function isEmptyPayload(payload) {
  return Object.keys(payload.headers).length === 0
    && Object.keys(payload.env).length === 0
    && payload.auth === undefined
}

/**
 * One server's secret record plus its live auth state.
 * The runtime's fetch closure reads `headers` on every request, so a capture
 * or refresh reaches the next request without rebuilding the connection.
 */
export class AuthState {
  /**
   * @param {object} options
   * @param {import('@deepseek-ai/cordis').Context} options.ctx
   * @param {object} options.server normalized server row.
   * @param {(text: string) => string} [options.redact]
   */
  constructor({ ctx, server, redact = (text) => text }) {
    this.ctx = ctx
    this.server = server
    this.key = credentialKeyFor(server.id)
    this.redact = redact
    this.headers = {}
    this.env = {}
    this.meta = undefined
    this.loaded = false
    this.needsLogin = false
    this.lastError = ''
    this.knownSecrets = new Set()
    this.refreshing = undefined
  }

  /** Load the stored record into memory. */
  async load() {
    const provider = this.ctx.get('credentials')
    if (provider === undefined) {
      this.loaded = true
      return
    }
    try {
      const record = await provider.readRecord(this.key)
      const payload = normalizePayload(record)
      this.headers = payload.headers
      this.env = payload.env
      this.meta = payload.auth
      if (this.meta !== undefined && this.server.auth?.refreshUrl && !this.meta.refreshUrl) {
        this.meta = { ...this.meta, refreshUrl: this.server.auth.refreshUrl }
      }
      this.remember(payload)
    } catch (error) {
      this.lastError = this.redact(`读取凭据失败：${error instanceof Error ? error.message : String(error)}`)
    }
    this.loaded = true
  }

  /** Header values the current auth mode actually sends. */
  requestHeaders() {
    return projectHeaders(this.server, this.headers)
  }

  /** Every stored header value, before mode projection. */
  rawHeaders() {
    return { ...this.headers }
  }

  /** Environment values for a stdio child. */
  environment() {
    return { ...this.env }
  }

  /** Keep every value ever seen for error redaction. */
  remember(payload) {
    const add = (value) => {
      if (typeof value === 'string' && value.length >= 4) this.knownSecrets.add(value)
    }
    for (const value of Object.values(payload.headers ?? {})) add(value)
    for (const value of Object.values(payload.env ?? {})) add(value)
    if (payload.auth !== undefined) {
      add(payload.auth.accessToken)
      add(payload.auth.refreshToken)
    }
  }

  /** Every secret value this state has seen. */
  secrets() {
    return this.knownSecrets
  }

  /** Whether a silent refresh is configured. */
  canRefresh() {
    return typeof this.meta?.refreshToken === 'string' && this.meta.refreshToken !== ''
      && this.refreshUrl() !== ''
  }

  /** Effective refresh endpoint: the form field wins over captured metadata. */
  refreshUrl() {
    if (typeof this.server?.auth?.refreshUrl === 'string' && this.server.auth.refreshUrl !== '') {
      return this.server.auth.refreshUrl
    }
    if (typeof this.meta?.refreshUrl === 'string') return this.meta.refreshUrl
    return ''
  }

  /** Whether the current token is at or near its advertised expiry. */
  isExpiring() {
    const expiresAt = this.meta?.expiresAt
    return typeof expiresAt === 'number' && Date.now() >= expiresAt - EXPIRY_SKEW_MS
  }

  /** Refresh proactively when an expiry is known and refresh material exists. */
  async ensureFresh() {
    if (!this.isExpiring() || !this.canRefresh()) return
    try {
      await this.refresh()
    } catch {
      // A proactive failure must not block the request: the token may still
      // work, and a 401 will trigger the single retry path.
    }
  }

  /** Try a silent refresh once; concurrent callers share one attempt. */
  async refresh() {
    if (!this.canRefresh()) return false
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = (async () => {
      const form = {
        grant_type: 'refresh_token',
        refresh_token: this.meta.refreshToken,
      }
      if (typeof this.meta.clientId === 'string' && this.meta.clientId !== '') form.client_id = this.meta.clientId
      let response
      try {
        response = await postForm(this.refreshUrl(), form, this.server.tls)
      } catch (error) {
        this.needsLogin = true
        this.lastError = this.redact(`刷新认证失败：${error instanceof Error ? error.message : String(error)}`)
        return false
      }
      const body = response.body
      const accessToken = typeof body?.access_token === 'string' && body.access_token !== ''
        ? body.access_token
        : typeof body?.token === 'string' && body.token !== '' ? body.token : undefined
      if (!response.ok || accessToken === undefined) {
        this.needsLogin = true
        const detail = typeof body?.error_description === 'string'
          ? body.error_description
          : typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`
        this.lastError = this.redact(`刷新认证失败：${detail}`)
        return false
      }
      const tokenHeader = typeof this.server.auth?.tokenHeader === 'string' ? this.server.auth.tokenHeader : ''
      const tokenPrefix = typeof this.server.auth?.tokenPrefix === 'string' ? this.server.auth.tokenPrefix : ''
      const tokenType = typeof body.token_type === 'string' && body.token_type !== ''
        ? body.token_type
        : this.meta?.tokenType ?? /^([A-Za-z]+)\s+/.exec(this.headers.Authorization ?? '')?.[1]
      this.meta = {
        ...this.meta,
        accessToken,
        ...(tokenType === undefined ? {} : { tokenType }),
        refreshToken: typeof body.refresh_token === 'string' && body.refresh_token !== ''
          ? body.refresh_token
          : this.meta.refreshToken,
        expiresAt: expiryFrom(body, accessToken),
      }
      this.headers = { ...this.headers }
      if (tokenHeader !== '') {
        if (!/^authorization$/i.test(tokenHeader)) deleteHeader(this.headers, 'authorization')
        deleteHeader(this.headers, tokenHeader)
        this.headers[tokenHeader] = `${tokenPrefix}${accessToken}`
      } else if (tokenType !== undefined) {
        deleteHeader(this.headers, 'authorization')
        this.headers.Authorization = `${tokenType} ${accessToken}`
      }
      this.needsLogin = false
      this.lastError = ''
      this.remember({ headers: this.headers, env: this.env, auth: this.meta })
      await this.persist()
      if (this.lastError !== '') throw new Error(this.lastError)
      return true
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = undefined
    }
  }

  /** One 401 retry: refresh if possible. */
  async onUnauthorized() {
    if (!this.canRefresh()) {
      this.needsLogin = true
      this.lastError = '认证已过期，需要重新登录'
      return false
    }
    const refreshed = await this.refresh()
    if (!refreshed) this.needsLogin = true
    return refreshed
  }

  /**
   * Merge captured login credentials into the record.
   * @param {{headers?:Record<string,string>, accessToken?:string, tokenType?:string, refreshToken?:string, refreshUrl?:string, expiresIn?:number, expiresAt?:number, clientId?:string, source?:string}} capture
   */
  async applyCapture(capture) {
    const configuredTokenHeader = typeof this.server.auth?.tokenHeader === 'string' ? this.server.auth.tokenHeader : ''
    const headers = { ...this.headers }
    for (const name of Object.keys(headers)) {
      if (/^(?:authorization|cookie)$/i.test(name)) delete headers[name]
      else if (configuredTokenHeader !== '' && name.toLowerCase() === configuredTokenHeader.toLowerCase()) delete headers[name]
    }
    for (const [name, value] of Object.entries(capture.headers ?? {})) {
      if (typeof value === 'string' && value !== '') headers[name] = value
    }
    const configuredTokenPrefix = typeof this.server.auth?.tokenPrefix === 'string' ? this.server.auth.tokenPrefix : ''
    if (typeof capture.accessToken === 'string' && capture.accessToken !== '') {
      if (configuredTokenHeader !== '') {
        headers[configuredTokenHeader] = `${configuredTokenPrefix}${capture.accessToken}`
      } else if (typeof capture.tokenType === 'string' && capture.tokenType !== '' && headers.Authorization === undefined) {
        headers.Authorization = `${capture.tokenType} ${capture.accessToken}`
      }
    }
    const accessToken = typeof capture.accessToken === 'string' && capture.accessToken !== ''
      ? capture.accessToken
      : tokenFromHeaders(headers)
    if (configuredTokenHeader !== '' && accessToken !== undefined) {
      if (!/^authorization$/i.test(configuredTokenHeader)) delete headers.Authorization
      headers[configuredTokenHeader] = `${configuredTokenPrefix}${accessToken}`
    }
    const tokenType = typeof capture.tokenType === 'string' && capture.tokenType !== ''
      ? capture.tokenType
      : /^([A-Za-z]+)\s+/.exec(headers.Authorization ?? '')?.[1]
    const expiresAt = typeof capture.expiresAt === 'number'
      ? capture.expiresAt
      : typeof capture.expiresIn === 'number'
        ? Date.now() + capture.expiresIn * 1000
        : accessToken !== undefined ? decodeJwtExpiry(accessToken) : undefined
    const auth = accessToken !== undefined || typeof capture.refreshToken === 'string'
      ? {
          accessToken,
          ...(tokenType === undefined ? {} : { tokenType }),
          refreshToken: typeof capture.refreshToken === 'string' && capture.refreshToken !== ''
            ? capture.refreshToken
            : this.meta?.refreshToken,
          refreshUrl: typeof capture.refreshUrl === 'string' && capture.refreshUrl !== ''
            ? capture.refreshUrl
            : this.meta?.refreshUrl,
          expiresAt,
          clientId: typeof capture.clientId === 'string' && capture.clientId !== ''
            ? capture.clientId
            : this.meta?.clientId,
          scope: typeof capture.scope === 'string' && capture.scope !== ''
            ? capture.scope
            : this.meta?.scope,
          source: capture.source ?? 'login',
        }
      : this.meta
    this.headers = headers
    this.meta = auth
    this.needsLogin = false
    this.lastError = ''
    this.remember({ headers, env: this.env, auth })
    await this.persist()
  }

  /** Apply a configured token header to an already captured access token. */
  async applyConfiguredToken() {
    const accessToken = this.meta?.accessToken
    const header = typeof this.server.auth?.tokenHeader === 'string' ? this.server.auth.tokenHeader : ''
    if (typeof accessToken !== 'string' || accessToken === '' || header === '') return
    const prefix = typeof this.server.auth?.tokenPrefix === 'string' ? this.server.auth.tokenPrefix : ''
    if (!/^authorization$/i.test(header)) deleteHeader(this.headers, 'authorization')
    deleteHeader(this.headers, header)
    this.headers = { ...this.headers, [header]: `${prefix}${accessToken}` }
    const scheme = prefix.trim()
    if (/^[A-Za-z]+$/.test(scheme)) this.meta = { ...this.meta, tokenType: scheme }
    this.remember({ headers: this.headers, env: this.env, auth: this.meta })
    await this.persist()
  }

  /**
   * Replace configured header values from the edit form.
   * @param {Record<string,string>} values header name to value; an absent name keeps its old value.
   */
  async setHeaderValues(values) {
    this.headers = { ...this.headers, ...values }
    this.remember({ headers: this.headers, env: this.env, auth: this.meta })
    await this.persist()
  }

  /** Drop header values whose names are no longer configured. */
  async pruneHeaders(names) {
    const keep = new Set(names.map((name) => name.toLowerCase()))
    this.headers = Object.fromEntries(Object.entries(this.headers).filter(([name]) => keep.has(name.toLowerCase())))
    await this.persist()
  }

  /** Replace stdio environment values. */
  async setEnvironment(values) {
    this.env = { ...this.env, ...values }
    this.remember({ headers: this.headers, env: this.env, auth: this.meta })
    await this.persist()
  }

  /** Drop environment values whose names are no longer configured. */
  async pruneEnvironment(names) {
    const keep = new Set(names)
    this.env = Object.fromEntries(Object.entries(this.env).filter(([name]) => keep.has(name)))
    await this.persist()
  }

  /**
   * Forget captured Authorization/Cookie and auth metadata while preserving
   * unrelated configured headers and environment values. Used when the login
   * URL changes so credentials from the old page never follow the new one.
   */
  async resetCapture() {
    const headers = { ...this.headers }
    deleteHeader(headers, 'authorization')
    deleteHeader(headers, 'cookie')
    const tokenHeader = typeof this.server.auth?.tokenHeader === 'string' ? this.server.auth.tokenHeader : ''
    if (tokenHeader !== '' && !/^(?:authorization|cookie)$/i.test(tokenHeader)) deleteHeader(headers, tokenHeader)
    this.headers = headers
    this.meta = undefined
    this.needsLogin = false
    this.lastError = ''
    await this.persist()
  }

  /** Delete the stored record; a provider failure is reported, not hidden. */
  async clear() {
    const provider = this.ctx.get('credentials')
    if (provider === undefined) throw new Error('凭据服务不可用，无法删除已保存的认证信息')
    await provider.deleteRecord(this.key)
    this.headers = {}
    this.env = {}
    this.meta = undefined
    this.needsLogin = false
    this.lastError = ''
  }

  /** Write the complete payload, or remove an empty record. */
  async persist() {
    const provider = this.ctx.get('credentials')
    if (provider === undefined) return
    const auth = this.meta === undefined ? undefined : jsonSafe(this.meta)
    const payload = {
      headers: jsonSafe(this.headers) ?? {},
      env: jsonSafe(this.env) ?? {},
      ...(auth === undefined || Object.keys(auth).length === 0 ? {} : { auth }),
    }
    try {
      if (isEmptyPayload(payload)) await provider.deleteRecord(this.key)
      else await provider.modifyRecord(this.key, async () => ({ kind: 'grant', payload }))
      this.lastError = ''
    } catch (error) {
      this.lastError = this.redact(`保存凭据失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Compute an absolute expiry from a token response. */
export function expiryFrom(body, accessToken) {
  const expiresIn = typeof body?.expires_in === 'number' || typeof body?.expires_in === 'string'
    ? Number(body.expires_in)
    : Number.NaN
  if (Number.isFinite(expiresIn)) return Date.now() + Math.max(0, expiresIn) * 1000
  const expiresAt = typeof body?.expires_at === 'number' || typeof body?.expires_at === 'string'
    ? Number(body.expires_at)
    : Number.NaN
  if (Number.isFinite(expiresAt)) return expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt
  return decodeJwtExpiry(accessToken)
}

/** Extract a bearer token from captured headers. */
function tokenFromHeaders(headers) {
  const value = headers.Authorization
  if (typeof value !== 'string') return undefined
  const match = /^(?:Bearer|Token)\s+(.+)$/i.exec(value)
  return match?.[1]
}
