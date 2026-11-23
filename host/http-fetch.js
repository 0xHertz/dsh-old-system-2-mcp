/**
 * A FetchLike implementation over node:http/https with:
 * - per-request header injection (captured login headers),
 * - a single 401 retry after `onUnauthorized()`,
 * - custom CA or verification opt-out for self-signed HTTPS servers,
 * - streaming responses so SSE transports work.
 */

import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { mergeHeaders } from './util.js'

const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 16 * 1024 * 1024

/** Node TLS request options from one normalized server row. */
export function tlsRequestOptions(tls) {
  if (tls?.mode === 'ca' && typeof tls.caPem === 'string' && tls.caPem.includes('-----BEGIN CERTIFICATE-----')) {
    return { ca: [tls.caPem] }
  }
  if (tls?.mode === 'insecure') return { rejectUnauthorized: false }
  return {}
}

/** Convert a Fetch body to a Buffer (JSON-RPC bodies are small). */
async function bodyToBuffer(body) {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (typeof body === 'object' && typeof body.getReader === 'function') {
    const response = new Response(body)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BODY_BYTES) throw new Error('请求体超过 16 MB')
    return buffer
  }
  return Buffer.from(String(body))
}

/** Strip hop-by-hop and transport-managed fields Node sets itself. */
function nodeHeaders(headers) {
  const result = {}
  for (const [name, value] of headers) {
    const lower = name.toLowerCase()
    if (lower === 'host' || lower === 'connection' || lower === 'transfer-encoding' || lower === 'expect') continue
    if (value === '') continue
    result[name] = value
  }
  return result
}

/** Abort rejection shaped like fetch's. */
function abortError(signal) {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

/** Build a Fetch Response from a Node IncomingMessage. */
function responseFromNode(res) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else headers.set(name, String(value))
  }
  const status = res.statusCode ?? 502
  const body = status === 204 || status === 304 ? null : Readable.toWeb(res)
  return new Response(body, { status, statusText: res.statusMessage ?? '', headers })
}

/**
 * One fetch exchange (following redirects) with no auth logic.
 * @param {URL} url
 * @param {{method:string, headers:Headers, body?:Buffer, signal?:AbortSignal}} request
 * @param {object|undefined} tls normalized TLS settings.
 * @param {number} redirects
 * @returns {Promise<Response>}
 */
async function requestOnce(url, request, tls, redirects = 0) {
  if (request.signal?.aborted === true) throw abortError(request.signal)
  const options = {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: request.method,
    headers: nodeHeaders(request.headers),
    ...tlsRequestOptions(tls),
  }
  const client = url.protocol === 'https:' ? https : http
  const response = await new Promise((resolve, reject) => {
    const req = client.request(options, resolve)
    const onAbort = () => req.destroy(abortError(request.signal))
    request.signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', (error) => {
      request.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    req.on('close', () => request.signal?.removeEventListener('abort', onAbort))
    if (request.body !== undefined && request.body.byteLength > 0 && request.method !== 'GET' && request.method !== 'HEAD') {
      req.write(request.body)
    }
    req.end()
  })
  const status = response.statusCode ?? 502
  const location = response.headers.location
  if (location !== undefined && [301, 302, 303, 307, 308].includes(status) && redirects < MAX_REDIRECTS) {
    response.resume()
    let next
    try {
      next = new URL(location, url)
    } catch {
      return responseFromNode(response)
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return responseFromNode(response)
    let method = request.method
    let body = request.body
    let headers = new Headers(request.headers)
    if (status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')) {
      method = 'GET'
      body = undefined
      headers.delete('content-type')
      headers.delete('content-length')
    }
    if (next.origin !== url.origin) {
      headers.delete('authorization')
      headers.delete('cookie')
      headers.delete('proxy-authorization')
    }
    return requestOnce(next, { ...request, method, headers, body }, tls, redirects + 1)
  }
  return responseFromNode(response)
}

/**
 * Perform one fetch-like request.
 * @param {string|URL} input
 * @param {RequestInit} [init]
 * @param {object|undefined} tls
 * @returns {Promise<Response>}
 */
export async function rawFetch(input, init = {}, tls = undefined) {
  const url = input instanceof URL ? new URL(input.href) : new URL(String(input))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`不支持的协议：${url.protocol}`)
  }
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  const body = method === 'GET' || method === 'HEAD' ? undefined : await bodyToBuffer(init.body)
  if (body !== undefined) headers.set('content-length', String(body.byteLength))
  return requestOnce(url, { method, headers, body, signal: init.signal ?? undefined }, tls)
}

/**
 * Wrap rawFetch with header injection, proactive refresh, and one 401 retry.
 * @param {{getHeaders:()=>Record<string,string>, ensureFresh:()=>Promise<void>, onUnauthorized:()=>Promise<boolean>, tls?:object}} options
 * @returns {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>}
 */
export function createAuthFetch(options) {
  return async function authFetch(input, init = {}) {
    let url
    let method
    let baseHeaders
    let body
    let signal = init.signal ?? undefined
    if (typeof Request !== 'undefined' && input instanceof Request) {
      url = new URL(input.url)
      method = input.method
      baseHeaders = new Headers(input.headers)
      signal = signal ?? input.signal
      if (method !== 'GET' && method !== 'HEAD') {
        try {
          body = Buffer.from(await input.clone().arrayBuffer())
        } catch {
          body = undefined
        }
      }
    } else {
      url = input instanceof URL ? new URL(input.href) : new URL(String(input))
      method = (init.method ?? 'GET').toUpperCase()
      baseHeaders = new Headers(init.headers)
      if (method !== 'GET' && method !== 'HEAD') body = await bodyToBuffer(init.body)
    }

    await options.ensureFresh()
    let headers = mergeHeaders(baseHeaders, options.getHeaders())
    headers.set('accept-encoding', 'identity')
    if (body !== undefined) headers.set('content-length', String(body.byteLength))
    let response = await requestOnce(url, { method, headers, body, signal }, options.tls)
    if (response.status === 401) {
      try { await response.body?.cancel() } catch { /* the body may already be closed */ }
      const refreshed = await options.onUnauthorized()
      if (refreshed) {
        headers = mergeHeaders(baseHeaders, options.getHeaders())
        headers.set('accept-encoding', 'identity')
        if (body !== undefined) headers.set('content-length', String(body.byteLength))
        response = await requestOnce(url, { method, headers, body, signal }, options.tls)
      }
    }
    return response
  }
}

/**
 * POST an application/x-www-form-urlencoded form and parse a JSON body.
 * Used for token refresh; it deliberately does not log any value.
 * @returns {Promise<{ok:boolean,status:number,body:any,text:string,headers:Headers}>}
 */
export async function postForm(url, form, tls, options = {}) {
  const body = new URLSearchParams(form).toString()
  const response = await rawFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 20_000),
  }, tls)
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  return { ok: response.ok, status: response.status, body: parsed, text, headers: response.headers }
}
