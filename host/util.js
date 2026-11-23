/** Shared helpers: ids, validation, secret redaction, HTTP bodies, API errors. */

import { createHash, randomBytes } from 'node:crypto'

/** Model-facing server namespace contract (same as dsh-mcp-client). */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** RFC 7230 field-name token. */
export const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Names whose values never leave the Host in clear text. */
const SENSITIVE_NAME = /(?:^|[-_])(?:auth|authorization|api[-_]?key|key|token|secret|session|cookie|password|passwd|credential)(?:$|[-_])/i

const MAX_TOOL_NAME = 64
const INVALID_TOOL_CHARS = /[^A-Za-z0-9_-]/g

/** A stable server id that is also a valid credential-key segment. */
export function newServerId() {
  return `srv-${randomBytes(6).toString('hex')}`
}

/** An unguessable login-capture session id. */
export function newLoginId() {
  return randomBytes(18).toString('hex')
}

/** Whether a header name is secret-shaped and must be stored in the credential store. */
export function isSensitiveHeader(name) {
  return SENSITIVE_NAME.test(name)
}

/** Whether a value looks like a credential even under a harmless header name. */
export function looksSecret(value) {
  if (typeof value !== 'string') return false
  if (/^(?:Bearer|Basic|Token|Digest)\s+/i.test(value)) return true
  return value.length >= 24 && /[A-Za-z0-9+/=_-]{24,}/.test(value)
}

/** Deterministic model-facing tool name; mirrors dsh-mcp-client's contract. */
export function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_TOOL_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_TOOL_NAME) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, MAX_TOOL_NAME - 12 - 1)}_${hash}`
}

/** Displays enough to identify a credential without echoing it. */
export function maskSecret(value) {
  if (typeof value !== 'string' || value === '') return ''
  const scheme = /^(Bearer|Basic|Token|Digest)\s+/i.exec(value)?.[1]
  return scheme === undefined ? '****' : `${scheme} ****`
}

/**
 * Replace every known secret and its URL-encoded form in a string.
 * Values shorter than 4 characters are skipped to avoid destroying normal text.
 */
export function redactSecrets(text, secrets) {
  if (typeof text !== 'string' || text === '') return text
  const values = [...secrets].filter((value) => typeof value === 'string' && value.length >= 4)
  values.sort((a, b) => b.length - a.length)
  let result = text
  for (const value of values) {
    result = result.split(value).join('[redacted]')
    try {
      const encoded = encodeURIComponent(value)
      if (encoded !== value) result = result.split(encoded).join('[redacted]')
    } catch {
      // A malformed Unicode secret still has its literal form redacted above.
    }
  }
  // Do not truncate here: this function is also on the MCP tool-result path.
  // Callers that need a short diagnostic use summarize() explicitly.
  return result
}

/** Expiry (ms since epoch) carried by a JWT, or undefined. */
export function decodeJwtExpiry(token) {
  if (typeof token !== 'string') return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/** A user-facing API failure with a stable code and HTTP status. */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} code stable machine code.
   * @param {string} message user-facing message (already sanitized).
   * @param {object} [details] small JSON details.
   */
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Convert any thrown value into a sanitized ApiError. */
export function toApiError(error, secrets = new Set()) {
  if (error instanceof ApiError) {
    return new ApiError(error.status, error.code, redactSecrets(error.message, secrets), error.details)
  }
  const raw = error instanceof Error ? error.message : String(error)
  return new ApiError(500, 'internal', redactSecrets(raw || '未知错误', secrets))
}

/** Read a bounded JSON object body from a Node request. */
export async function readJsonBody(req, limit = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > limit) {
      req.resume()
      throw new ApiError(413, 'body-too-large', `请求体超过 ${Math.round(limit / 1024)} KB`)
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks, size).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const value = JSON.parse(text)
    return isPlainObject(value) ? value : {}
  } catch {
    throw new ApiError(400, 'bad-json', '请求体不是合法 JSON')
  }
}

/** Send a JSON response without caching. */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

/** Send a plain-text response. */
export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.statusCode = status
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** Whether a value is a non-array object. */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a string field with a fallback. */
export function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** Read a boolean field with a fallback. */
export function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** Trim trailing slashes/stray whitespace from a URL string without parsing. */
export function cleanUrl(value) {
  return asString(value).trim()
}

/** Validate an http(s) URL with no embedded credentials. */
export function validateHttpUrl(value, label) {
  const text = cleanUrl(value)
  if (text === '') return `${label}不能为空`
  let url
  try {
    url = new URL(text)
  } catch {
    return `${label}不是合法 URL`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${label}只支持 http/https`
  if (url.username !== '' || url.password !== '') return `${label}不能包含用户名或密码`
  return undefined
}

/**
 * Normalize one server form input. Secret values are deliberately not part of
 * the normalized server; they are handled by the credential store.
 * @param {unknown} input raw request body.
 * @param {object[]} existingServers servers already stored.
 * @param {object|undefined} previous the server being edited.
 * @returns {{server?: object, errors: string[]}}
 */
export function normalizeServer(input, existingServers, previous) {
  const errors = []
  if (!isPlainObject(input)) return { errors: ['请求内容不合法'] }
  const id = previous?.id ?? (asString(input.id) || newServerId())
  if (!/^srv-[a-z0-9]{8,32}$/.test(id)) errors.push('服务 id 不合法')
  const name = asString(input.name).trim()
  if (name === '') errors.push('服务名不能为空')
  else if (!SERVER_NAME_PATTERN.test(name)) errors.push('服务名只能包含字母、数字、下划线和短横线，长度 1–32')
  else if (existingServers.some((server) => server.id !== id && server.name === name)) errors.push(`服务名 "${name}" 已存在`)

  const transport = asString(input.transport)
  if (!['stdio', 'sse', 'streamable-http'].includes(transport)) errors.push('传输方式必须是 stdio、sse 或 streamable-http')

  const url = cleanUrl(input.url)
  const command = asString(input.command).trim()
  const args = Array.isArray(input.args)
    ? input.args.filter((item) => typeof item === 'string')
    : []
  const cwd = asString(input.cwd).trim()
  if (transport === 'stdio') {
    if (command === '') errors.push('stdio 传输必须填写命令')
  } else if (transport === 'sse' || transport === 'streamable-http') {
    const urlError = validateHttpUrl(url, transport === 'sse' ? 'SSE 地址' : 'HTTP 地址')
    if (urlError !== undefined) errors.push(urlError)
    if (command !== '') errors.push('网络传输不能同时填写本地命令')
  }

  const envKeys = Array.isArray(input.envKeys)
    ? [...new Set(input.envKeys.filter((key) => typeof key === 'string' && key.trim() !== '').map((key) => key.trim()))]
    : []
  for (const key of envKeys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`环境变量名 "${key}" 不合法`)
  }

  const headers = []
  const seenHeaders = new Set()
  if (Array.isArray(input.headers)) {
    for (const entry of input.headers) {
      if (!isPlainObject(entry)) continue
      const headerName = asString(entry.name).trim()
      if (headerName === '') continue
      if (!HEADER_NAME_PATTERN.test(headerName)) {
        errors.push(`请求头名 "${headerName}" 不合法`)
        continue
      }
      const lower = headerName.toLowerCase()
      if (seenHeaders.has(lower)) {
        errors.push(`请求头 "${headerName}" 重复`)
        continue
      }
      seenHeaders.add(lower)
      headers.push({
        name: headerName,
        secret: asBoolean(entry.secret, isSensitiveHeader(headerName) || looksSecret(asString(entry.value))),
      })
    }
  }

  const protocolInput = asString(input.protocolMode)
  const protocolMode = ['auto', 'legacy', '2026-07-28'].includes(protocolInput)
    ? protocolInput
    : (['auto', 'legacy', '2026-07-28'].includes(previous?.protocolMode) ? previous.protocolMode : 'legacy')
  if (transport === 'sse' && protocolMode !== 'legacy') {
    errors.push('SSE 传输只支持 2025 兼容协商，请把“协议协商”设为“兼容 2025”')
  }

  const authInput = isPlainObject(input.auth) ? input.auth : {}
  const authMode = ['none', 'login', 'static'].includes(asString(authInput.mode)) ? asString(authInput.mode) : 'none'
  const loginUrl = cleanUrl(authInput.loginUrl)
  const refreshUrl = cleanUrl(authInput.refreshUrl)
  if (authMode === 'login') {
    if (transport === 'stdio') errors.push('stdio 传输不支持登录捕获，请使用环境变量')
    const loginError = validateHttpUrl(loginUrl, '登录页地址')
    if (loginError !== undefined) errors.push(loginError)
    if (refreshUrl !== '') {
      const refreshError = validateHttpUrl(refreshUrl, '刷新地址')
      if (refreshError !== undefined) errors.push(refreshError)
    }
  } else if (authMode === 'static') {
    if (transport === 'stdio') errors.push('stdio 传输请使用环境变量，不要选择静态令牌')
    if (headers.length === 0) errors.push('静态认证至少需要一个请求头')
  }

  const tokenHeader = asString(authInput.tokenHeader).trim()
  const tokenPrefix = asString(authInput.tokenPrefix)
  if (authMode === 'login') {
    if (tokenHeader !== '' && !HEADER_NAME_PATTERN.test(tokenHeader)) errors.push('令牌请求头名不合法')
    if (tokenHeader === '' && tokenPrefix !== '') errors.push('填写令牌前缀前需要先填写令牌请求头')
    if (Buffer.byteLength(tokenPrefix) > 256) errors.push('令牌前缀超过 256 字节')
    if (/[\r\n]/.test(tokenPrefix)) errors.push('令牌前缀不能包含换行')
  }

  const tlsInput = isPlainObject(input.tls) ? input.tls : {}
  const tlsMode = ['default', 'ca', 'insecure'].includes(asString(tlsInput.mode)) ? asString(tlsInput.mode) : 'default'
  const caPem = asString(tlsInput.caPem).trim()
  if (tlsMode !== 'default' && transport === 'stdio') errors.push('stdio 传输不使用 TLS 设置')
  if (tlsMode === 'ca') {
    if (!caPem.includes('-----BEGIN CERTIFICATE-----')) errors.push('自定义 CA 必须是 PEM 证书（-----BEGIN CERTIFICATE-----）')
    if (Buffer.byteLength(caPem) > 256 * 1024) errors.push('自定义 CA 证书超过 256 KB')
  }

  const loginChanged = previous !== undefined
    && previous.auth?.mode === 'login'
    && authMode === 'login'
    && previous.auth.loginUrl !== loginUrl
  const createdAt = previous?.createdAt ?? Date.now()
  const server = {
    id,
    name,
    enabled: asBoolean(input.enabled, previous?.enabled ?? true),
    transport,
    url: transport === 'stdio' ? '' : url,
    command: transport === 'stdio' ? command : '',
    args: transport === 'stdio' ? args : [],
    cwd: transport === 'stdio' ? cwd : '',
    envKeys: transport === 'stdio' ? envKeys : [],
    protocolMode,
    headers,
    auth: {
      mode: authMode,
      loginUrl: authMode === 'login' ? loginUrl : '',
      refreshUrl: authMode === 'login' ? refreshUrl : '',
      tokenHeader: authMode === 'login' ? tokenHeader : '',
      tokenPrefix: authMode === 'login' ? tokenPrefix : '',
      status: !loginChanged && previous?.auth?.status === 'captured' ? 'captured' : 'none',
      capturedAt: loginChanged ? null : previous?.auth?.capturedAt ?? null,
      expiresAt: loginChanged ? null : previous?.auth?.expiresAt ?? null,
      lastError: '',
    },
    tls: transport === 'stdio' ? { mode: 'default', caPem: '' } : { mode: tlsMode, caPem: tlsMode === 'ca' ? caPem : '' },
    createdAt,
    updatedAt: Date.now(),
  }
  return { server, errors }
}

/**
 * Project a raw header map through one server's auth mode and configured
 * header names. Login mode sends everything captured; other modes send only
 * headers the user explicitly configured on the server.
 * @param {object} server normalized server row.
 * @param {Record<string,string>} values raw stored/captured values.
 * @returns {Record<string,string>} headers the runtime would send.
 */
export function projectHeaders(server, values) {
  const mode = server.auth?.mode ?? 'none'
  if (mode === 'login') return { ...values }
  const configured = new Set((server.headers ?? []).map((header) => header.name.toLowerCase()))
  return Object.fromEntries(Object.entries(values).filter(([name]) => configured.has(name.toLowerCase())))
}

/** Merge Headers-like values; later sources win. */
export function mergeHeaders(...sources) {
  const headers = new Headers()
  for (const source of sources) {
    if (source === undefined || source === null) continue
    for (const [name, value] of new Headers(source)) headers.set(name, value)
  }
  return headers
}

/** Convert a Headers object to a plain object, joining repeated fields. */
export function headersToRecord(headers) {
  const record = {}
  for (const [name, value] of headers) record[name] = value
  return record
}

/** Shorten text for a UI row. */
export function summarize(text, length = 240) {
  const single = String(text ?? '').replace(/\s+/g, ' ').trim()
  return single.length > length ? `${single.slice(0, length)}…` : single
}
