/**
 * Browser login capture.
 *
 * Each capture session runs a loopback HTTP proxy that serves the login page
 * from a local origin. Relative URLs, redirects, forms, fetch and XHR are
 * proxied so the Host can observe the request headers, cookies and token
 * responses produced by the real login flow. Captured values are handed to the
 * credential store; they are never returned to the page or written to logs.
 */

import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { newLoginId, redactSecrets, summarize } from './util.js'
import { tlsRequestOptions } from './http-fetch.js'

const SESSION_TTL_MS = 15 * 60 * 1000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_HTML_BYTES = 8 * 1024 * 1024
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 10

/** Base64url without padding, for path/query encoded targets. */
function encodeBase64Url(text) {
  return Buffer.from(text, 'utf8').toString('base64url')
}

/** Decode a base64url segment. */
function decodeBase64Url(text) {
  return Buffer.from(text, 'base64url').toString('utf8')
}

/** Whether a host is loopback, private, link-local, CGNAT, multicast, or mapped. */
export function isPrivateHost(hostname) {
  let host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length)
    if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)) {
      const [high, low] = tail.split(':').map((part) => Number.parseInt(part, 16))
      host = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
    } else {
      host = tail
    }
  }
  if (host.includes(':') && (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match === null) return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
  const [a, b] = [Number(match[1]), Number(match[2])]
  return a === 0 || a === 127 || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a >= 224 && a <= 239)
}

/** Decode one compressed upstream body; unknown encodings pass through. */
function decodeBody(buffer, encoding) {
  switch (String(encoding ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return gunzipSync(buffer)
    case 'deflate':
      return inflateSync(buffer)
    case 'br':
      return brotliDecompressSync(buffer)
    default:
      return buffer
  }
}

/** Pick the charset from the header, falling back to a meta charset in the first bytes. */
function charsetFrom(contentType, buffer) {
  const header = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(String(contentType ?? ''))
  if (header?.[1] !== undefined) return header[1].toLowerCase()
  const head = buffer.subarray(0, 4096).toString('latin1')
  const meta = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(head)
  return meta?.[1]?.toLowerCase()
}

/** Decode text using the declared charset; unknown charsets fall back to UTF-8. */
function decodeText(buffer, contentType) {
  const charset = charsetFrom(contentType, buffer)
  if (charset === undefined || charset === 'utf-8' || charset === 'utf8') return buffer.toString('utf8')
  const label = /^(?:gb2312|gbk|x-gbk)$/.test(charset) ? 'gbk' : charset
  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

/** Force one Content-Type to UTF-8 after the proxy re-encodes the text. */
function withUtf8(contentType) {
  const type = String(contentType ?? 'text/html')
  if (/charset\s*=/i.test(type)) return type.replace(/charset\s*=\s*["']?[^;"'\s]+/i, 'charset=utf-8')
  return `${type}; charset=utf-8`
}

/** Read a bounded request body. */
async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

/** Parse one Set-Cookie line. */
function parseSetCookie(line) {
  const parts = String(line).split(';')
  const first = parts.shift() ?? ''
  const index = first.indexOf('=')
  if (index <= 0) return undefined
  const name = first.slice(0, index).trim()
  const value = first.slice(index + 1).trim()
  if (name === '') return undefined
  let path = '/'
  let expires
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=')
    const key = rawKey.trim().toLowerCase()
    const attribute = rest.join('=').trim()
    if (key === 'path' && attribute.startsWith('/')) path = attribute
    else if (key === 'max-age') {
      const seconds = Number(attribute)
      if (Number.isFinite(seconds)) expires = Date.now() + seconds * 1000
    } else if (key === 'expires') {
      const time = Date.parse(attribute)
      if (Number.isFinite(time)) expires = time
    }
  }
  return { name, value, path, expires }
}

/** Cookies for one upstream origin, as a Cookie header value. */
function cookieHeaderFor(session, origin) {
  const jar = session.cookies.get(origin)
  if (jar === undefined) return undefined
  const now = Date.now()
  const pairs = []
  for (const [name, cookie] of jar) {
    if (cookie.expires !== undefined && cookie.expires <= now) {
      jar.delete(name)
      continue
    }
    pairs.push(`${name}=${cookie.value}`)
  }
  return pairs.length === 0 ? undefined : pairs.join('; ')
}

/** Store every Set-Cookie from one upstream response. */
function storeCookies(session, origin, headers) {
  const raw = headers['set-cookie']
  if (raw === undefined) return
  const lines = Array.isArray(raw) ? raw : [raw]
  let jar = session.cookies.get(origin)
  if (jar === undefined) {
    jar = new Map()
    session.cookies.set(origin, jar)
  }
  for (const line of lines) {
    const parsed = parseSetCookie(line)
    if (parsed !== undefined) jar.set(parsed.name, parsed)
  }
}

/** Rewrite a forwarded Set-Cookie so the browser keeps it on this session's proxy path. */
function browserSetCookie(line, prefix) {
  const parts = String(line).split(';')
  const first = parts.shift() ?? ''
  const kept = []
  for (const part of parts) {
    const key = part.split('=')[0].trim().toLowerCase()
    if (['domain', 'secure', 'partitioned', 'samesite', 'path', 'expires', 'max-age'].includes(key)) continue
    kept.push(part.trim())
  }
  return [first, `Path=${prefix}/`, 'SameSite=Lax', ...kept].filter((part) => part !== '').join('; ')
}

/** One upstream HTTP request without redirect handling. */
function upstreamRequest(url, { method, headers, body, tls }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port === '' ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      ...tlsRequestOptions(tls),
    }, resolve)
    request.on('error', reject)
    if (body !== undefined && body.byteLength > 0 && method !== 'GET' && method !== 'HEAD') request.write(body)
    request.end()
  })
}

/** Guess the charset-limited textual body type. */
function isHtmlType(contentType) {
  return typeof contentType === 'string' && /text\/html/i.test(contentType)
}

function isInspectableText(contentType) {
  return typeof contentType === 'string' && /(?:application|text)\/(?:json|[^;]*\+json|x-www-form-urlencoded|xml|plain)/i.test(contentType)
}

/** Extract token fields from a parsed JSON value. */
function extractFromJson(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return {}
  const capture = {}
  const assign = (key, raw) => {
    if (key === 'access_token' || key === 'accessToken') capture.accessToken = String(raw)
    else if (key === 'refresh_token' || key === 'refreshToken') capture.refreshToken = String(raw)
    else if (key === 'id_token' || key === 'idToken') capture.idToken = String(raw)
    else if (key === 'token_type' || key === 'tokenType') capture.tokenType = String(raw)
    else if (key === 'expires_in' || key === 'expiresIn') {
      const seconds = Number(raw)
      if (Number.isFinite(seconds)) capture.expiresIn = seconds
    } else if (key === 'expires_at' || key === 'expiresAt') {
      const numeric = Number(raw)
      if (Number.isFinite(numeric)) capture.expiresAt = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    } else if (key === 'client_id' || key === 'clientId') capture.clientId = String(raw)
    else if (key === 'scope') capture.scope = String(raw)
    else if (key === 'token' && typeof raw === 'string' && raw.length >= 16) capture.accessToken = raw
    else if (key === 'error') capture.error = String(raw)
    else if (key === 'error_description' || key === 'errorDescription') capture.errorDescription = String(raw)
  }
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number') assign(key, raw)
  }
  for (const raw of Object.values(value)) {
    if (raw !== null && typeof raw === 'object') {
      const nested = extractFromJson(raw, depth + 1)
      for (const [key, entry] of Object.entries(nested)) if (capture[key] === undefined) capture[key] = entry
    }
  }
  return capture
}

/** Extract token fields from a URL query or fragment. */
function extractFromUrl(url) {
  const capture = {}
  for (const [key, raw] of url.searchParams) {
    if (key === 'access_token' || key === 'token') capture.accessToken = raw
    else if (key === 'refresh_token') capture.refreshToken = raw
    else if (key === 'id_token') capture.idToken = raw
    else if (key === 'token_type') capture.tokenType = raw
    else if (key === 'expires_in') capture.expiresIn = Number(raw)
    else if (key === 'client_id') capture.clientId = raw
    else if (key === 'scope') capture.scope = raw
    else if (key === 'error') capture.error = raw
    else if (key === 'error_description') capture.errorDescription = raw
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : ''
  if (hash !== '') {
    for (const [key, raw] of new URLSearchParams(hash)) {
      if (key === 'access_token' || key === 'token') capture.accessToken = raw
      else if (key === 'refresh_token') capture.refreshToken = raw
      else if (key === 'id_token') capture.idToken = raw
      else if (key === 'token_type') capture.tokenType = raw
      else if (key === 'expires_in') capture.expiresIn = Number(raw)
      else if (key === 'error') capture.error = raw
      else if (key === 'error_description') capture.errorDescription = raw
    }
  }
  return capture
}

/** The injected page script: URL rewriting, header capture, storage scan, banner. */
function injectedScript(baseOrigin) {
  const base = JSON.stringify(baseOrigin).replace(/</g, '\\u003c')
  const endpoint = JSON.stringify('/_dsh/capture').replace(/</g, '\\u003c')
  return `(() => {
  'use strict';
  const BASE = ${base};
  const P = location.origin;
  const CAPTURE = ${endpoint};
  const reported = new Set();
  let banner;
  function ui(text) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'dsh-login-capture';
      banner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111827;color:#fff;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:320px';
      (document.body || document.documentElement).appendChild(banner);
    }
    banner.textContent = text;
  }
  function abs(u) {
    try { return new URL(u, location.href); } catch { return null; }
  }
  function proxied(u) {
    const url = abs(u);
    if (!url) return u;
    if (url.origin === P) return url.href;
    if (url.origin === BASE) return url.pathname + url.search + url.hash;
    return '/__abs/' + btoa(url.origin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') + url.pathname + url.search + url.hash;
  }
  function report(payload) {
    const key = JSON.stringify(payload);
    if (reported.has(key)) return;
    reported.add(key);
    try {
      fetch(CAPTURE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: key, keepalive: true })
        .then(() => ui('DSH 已捕获认证信息，可以关闭此页'))
        .catch(() => {});
    } catch {}
  }
  function reportHeaders(headers) {
    try {
      const h = new Headers(headers || {});
      const authorization = h.get('authorization');
      if (authorization) report({ authorization });
      const cookie = h.get('cookie');
      if (cookie) report({ cookie });
    } catch {}
  }
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (input instanceof Request) {
        const target = proxied(input.url);
        reportHeaders(input.headers);
        if (init && init.headers) reportHeaders(init.headers);
        input = new Request(target, input);
      } else {
        const target = proxied(String(input));
        if (init && init.headers) reportHeaders(init.headers);
        input = target;
      }
    } catch {}
    return originalFetch.apply(this, arguments.length >= 2 ? [input, init] : [input]);
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { arguments[1] = proxied(String(url)); } catch {}
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (/^authorization$/i.test(name)) report({ authorization: String(value) });
      if (/^cookie$/i.test(name)) report({ cookie: String(value) });
    } catch {}
    return xhrSet.apply(this, arguments);
  };
  const formSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    try { if (this.action) this.action = proxied(this.action); } catch {}
    return formSubmit.apply(this, arguments);
  };
  const windowOpen = window.open;
  window.open = function (url) {
    try {
      if (url) arguments[0] = proxied(String(url));
    } catch {}
    return windowOpen.apply(this, arguments);
  };
  function scanStorage() {
    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          const value = key === null ? null : store.getItem(key);
          if (!value || value.length < 16) continue;
          if (/token|auth|jwt|access|refresh|session/i.test(key || '')) report({ storage: { [key]: value } });
          else if (/^(?:eyJ|Bearer\\s|Basic\\s)/.test(value) || /"?(?:access_token|refresh_token|token)"?\\s*[:=]/i.test(value)) report({ storage: { [key]: value } });
        }
      } catch {}
    }
    try {
      if (document.cookie) report({ cookie: document.cookie });
    } catch {}
    for (const param of [location.search, location.hash]) {
      try {
        for (const [key, value] of new URLSearchParams(param.replace(/^#/, ''))) {
          if (/^(?:access_token|token|id_token|refresh_token)$/i.test(key) && value.length >= 16) report({ urlToken: value });
        }
      } catch {}
    }
  }
  const interval = setInterval(scanStorage, 1000);
  window.addEventListener('load', scanStorage);
  document.addEventListener('DOMContentLoaded', scanStorage);
  scanStorage();
  ui('DSH 登录捕获中，请在此页完成登录');
  window.addEventListener('beforeunload', () => clearInterval(interval));
})();`
}

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'poster', 'formaction', 'data-src', 'xlink:href'])

/** Rewrite `url()` references inside one CSS text or style attribute. */
function rewriteCssUrls(css, unbase) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, quote, value) => `url(${quote}${unbase(value)}${quote})`)
}

/** Rewrite one `srcset` value. */
function rewriteSrcset(value, unbase) {
  return value.split(',').map((part) => {
    const pieces = part.trim().split(/\s+/)
    if (pieces[0] !== undefined) pieces[0] = unbase(pieces[0])
    return pieces.join(' ')
  }).join(', ')
}

/** Find the closing `>` of a start tag while respecting attribute quotes. */
function findTagEnd(html, start) {
  let quote = ''
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i]
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return i
  }
  return -1
}

/**
 * Rewrite one start tag's URL attributes without touching attribute values
 * that are not URLs. A real quote-aware scanner is used instead of a regex over
 * the whole document, so inline JavaScript such as `src="..."` or `1 < 2`
 * inside a <script> body is never corrupted.
 */
function rewriteTagAttributes(tag, unbase) {
  if (/^<\s*meta\b/i.test(tag) && /\bhttp-equiv\s*=\s*["']?\s*content-security-policy/i.test(tag)) return ''
  if (/^<\s*meta\b/i.test(tag)) {
    tag = tag
      .replace(/(\bcharset\s*=\s*["']?)([^"'\s/>]+)/gi, '$1utf-8')
      .replace(/(\bcontent\s*=\s*["'][^"']*charset\s*=\s*)([^;"']+)/gi, '$1utf-8')
  }
  const nameMatch = /^<\s*([a-zA-Z][^\s/>]*)/.exec(tag)
  if (nameMatch === null) return tag
  let index = nameMatch[0].length
  let output = tag.slice(0, index)
  while (index < tag.length) {
    const spaceStart = index
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    output += tag.slice(spaceStart, index)
    if (index >= tag.length) break
    if (tag[index] === '>' || tag[index] === '/') {
      output += tag.slice(index)
      break
    }
    const attrStart = index
    while (index < tag.length && !/[\s=/>]/.test(tag[index])) index += 1
    const attrName = tag.slice(attrStart, index)
    if (attrName === '') {
      output += tag[index]
      index += 1
      continue
    }
    output += attrName
    const gapStart = index
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    output += tag.slice(gapStart, index)
    if (tag[index] !== '=') continue
    output += '='
    index += 1
    const valueSpaceStart = index
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    output += tag.slice(valueSpaceStart, index)
    if (index >= tag.length) break
    const lower = attrName.toLowerCase()
    if (tag[index] === '"' || tag[index] === "'") {
      const quote = tag[index]
      output += quote
      index += 1
      const valueStart = index
      while (index < tag.length && tag[index] !== quote) index += 1
      const value = tag.slice(valueStart, index)
      if (index < tag.length) index += 1
      const rewritten = URL_ATTRIBUTES.has(lower)
        ? unbase(value)
        : lower === 'srcset' ? rewriteSrcset(value, unbase)
          : lower === 'style' ? rewriteCssUrls(value, unbase)
            : value
      output += rewritten + quote
    } else {
      const valueStart = index
      while (index < tag.length && !/[\s>]/.test(tag[index])) index += 1
      const value = tag.slice(valueStart, index)
      output += URL_ATTRIBUTES.has(lower)
        ? unbase(value)
        : lower === 'srcset' ? rewriteSrcset(value, unbase)
          : value
    }
  }
  return output
}

/** Rewrite URLs inside HTML start tags, scripts, style blocks and comments safely. */
function rewriteHtml(html, baseOrigin) {
  const unbase = (raw) => {
    const value = raw.trim()
    if (value === '' || value.startsWith('#') || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('blob:')) return raw
    if (value.startsWith('/') && !value.startsWith('//')) return value
    let url
    try {
      if (/^\/\//.test(value)) url = new URL(value, baseOrigin)
      else if (/^https?:\/\//i.test(value)) url = new URL(value)
      else return raw
    } catch {
      return raw
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw
    if (url.origin === baseOrigin) return `${url.pathname}${url.search}${url.hash}`
    return `/__abs/${encodeBase64Url(url.origin)}${url.pathname}${url.search}${url.hash}`
  }
  let result = ''
  let index = 0
  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      result += html.slice(index)
      break
    }
    result += html.slice(index, next)
    index = next
    if (html.startsWith('<!--', index)) {
      const close = html.indexOf('-->', index + 4)
      if (close === -1) {
        result += html.slice(index)
        break
      }
      result += html.slice(index, close + 3)
      index = close + 3
      continue
    }
    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      const close = html.indexOf('>', index + 2)
      if (close === -1) {
        result += html.slice(index)
        break
      }
      result += html.slice(index, close + 1)
      index = close + 1
      continue
    }
    if (html[index + 1] === '/') {
      const close = html.indexOf('>', index + 2)
      if (close === -1) {
        result += html.slice(index)
        break
      }
      result += html.slice(index, close + 1)
      index = close + 1
      continue
    }
    const nameMatch = /^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(index))
    if (nameMatch === null) {
      result += '<'
      index += 1
      continue
    }
    const tagEnd = findTagEnd(html, index)
    if (tagEnd === -1) {
      result += html.slice(index)
      break
    }
    const name = nameMatch[1].toLowerCase()
    result += rewriteTagAttributes(html.slice(index, tagEnd + 1), unbase)
    index = tagEnd + 1
    if (name !== 'script' && name !== 'style') continue
    const closePattern = new RegExp(`</${name}\\s*>`, 'ig')
    closePattern.lastIndex = index
    const closeMatch = closePattern.exec(html)
    if (closeMatch === null) {
      result += html.slice(index)
      break
    }
    const content = html.slice(index, closeMatch.index)
    result += name === 'style' ? rewriteCssUrls(content, unbase) : content
    result += closeMatch[0]
    index = closeMatch.index + closeMatch[0].length
  }
  return result
}

/** The capture manager. */
export class LoginCaptureManager {
  /**
   * @param {{logger:object, onCapture:(serverId:string, capture:object)=>Promise<void>, redact:(text:string)=>string}} options
   */
  constructor({ logger, onCapture, redact }) {
    this.logger = logger
    this.onCapture = onCapture
    this.redact = redact
    this.sessions = new Map()
    this.cleanup = setInterval(() => this.expireSessions(), 60_000)
    this.cleanup.unref?.()
  }

  /** Close one session's loopback listener. */
  closeSession(session) {
    const server = session.server
    session.server = undefined
    if (server !== undefined) server.close()
  }

  /** Drop abandoned sessions. */
  expireSessions() {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(id)
        this.closeSession(session)
        this.logger.debug(`mcp-gui: 登录捕获会话 ${id} 已过期`)
      }
    }
  }

  /**
   * Begin a capture session.
   * @param {{server:object, loginUrl:string}} options
   * @returns {Promise<{id:string,url:string}>}
   */
  async start({ server, loginUrl }) {
    const login = new URL(loginUrl)
    if (login.protocol !== 'http:' && login.protocol !== 'https:') throw new Error('登录页只支持 http/https')
    const id = newLoginId()
    const session = {
      id,
      serverId: server.id,
      loginUrl,
      baseOrigin: login.origin,
      initialHost: login.hostname,
      allowPrivate: isPrivateHost(login.hostname),
      cookies: new Map(),
      tls: server.tls,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'waiting',
      error: '',
      loginAttempted: false,
      capturedAt: undefined,
      lastAuthorization: '',
      lastCookie: '',
      headerNames: [],
      requests: [],
      accessToken: '',
      scope: '',
      expiresAt: undefined,
      server: undefined,
      port: 0,
      url: '',
    }
    const listener = http.createServer((req, res) => { void this.handleSession(req, res, session) })
    await new Promise((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', () => {
        listener.off('error', reject)
        resolve()
      })
    })
    session.server = listener
    session.port = listener.address().port
    listener.on('error', (error) => {
      this.logger.warn(`mcp-gui 登录捕获代理（${session.id}）：${error instanceof Error ? error.message : String(error)}`)
    })
    const proxyUrl = `http://127.0.0.1:${session.port}${login.pathname}${login.search}${login.hash}`
    session.url = proxyUrl
    this.sessions.set(id, session)
    return { id, url: proxyUrl }
  }

  /** Read one session or throw a 404-ish error. */
  session(id) {
    const session = this.sessions.get(id)
    if (session === undefined) throw new Error('登录捕获会话不存在或已过期')
    session.lastActivity = Date.now()
    return session
  }

  /** Redact this session's captured values before any text leaves the proxy. */
  redactSession(session, text) {
    const secrets = new Set([
      session.lastAuthorization,
      session.lastCookie,
      session.accessToken,
      session.refreshToken,
    ])
    for (const jar of session.cookies.values()) {
      for (const cookie of jar.values()) secrets.add(cookie.value)
    }
    return this.redact(redactSecrets(String(text ?? ''), secrets))
  }

  /** Record one proxied request for the diagnostics view (path only, no query). */
  recordRequest(session, entry) {
    if (!Array.isArray(session.requests)) session.requests = []
    session.requests.push({
      at: Date.now(),
      method: entry.method ?? 'GET',
      path: entry.path ?? '/',
      status: entry.status ?? 0,
      contentType: entry.contentType ?? '',
      ...(entry.error === undefined ? {} : { error: this.redactSession(session, entry.error) }),
    })
    if (session.requests.length > 50) session.requests.splice(0, session.requests.length - 50)
  }

  /** Public status without secret values. */
  status(id) {
    const session = this.session(id)
    return {
      id: session.id,
      serverId: session.serverId,
      status: session.status,
      error: this.redactSession(session, session.error),
      capturedAt: session.capturedAt,
      headerNames: [...session.headerNames],
      accessTokenSet: session.accessToken !== '',
      expiresAt: session.expiresAt,
      requests: Array.isArray(session.requests) ? session.requests.slice(-20) : [],
    }
  }

  /** Use the current cookie jar / last observed header as the credential. */
  async complete(id) {
    const session = this.session(id)
    await this.captureFromSession(session, { source: 'manual', force: true })
    return this.status(id)
  }

  /** List active sessions without secret values. */
  list() {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      serverId: session.serverId,
      status: session.status,
      capturedAt: session.capturedAt,
      createdAt: session.createdAt,
      error: this.redactSession(session, session.error),
    }))
  }

  /** Cancel every capture session belonging to one managed server. */
  cancelForServer(serverId) {
    for (const [id, session] of this.sessions) {
      if (session.serverId !== serverId) continue
      this.sessions.delete(id)
      this.closeSession(session)
    }
  }

  /** Cancel one session. */
  cancel(id) {
    const session = this.sessions.get(id)
    if (session === undefined) return
    this.sessions.delete(id)
    this.closeSession(session)
  }

  /** Close every session and its listener. */
  async dispose() {
    if (this.cleanup !== undefined) clearInterval(this.cleanup)
    this.cleanup = undefined
    for (const session of this.sessions.values()) this.closeSession(session)
    this.sessions.clear()
  }

  /** Route one request for this session's own loopback listener. */
  async handleSession(req, res, session) {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${session.port}`)
      res.setHeader('cache-control', 'no-store')
      session.lastActivity = Date.now()
      if (url.pathname === '/_dsh/status') return this.json(res, 200, this.status(session.id))
      if (url.pathname === '/_dsh/complete') {
        await this.captureFromSession(session, { source: 'manual', force: true })
        return this.json(res, 200, this.status(session.id))
      }
      if (url.pathname === '/_dsh/capture' && req.method === 'POST') {
        const body = await readBody(req, MAX_BODY_BYTES)
        try {
          await this.acceptBrowserReport(session, JSON.parse(body.toString('utf8')))
        } catch {
          return this.json(res, 400, { error: 'bad json' })
        }
        res.statusCode = 204
        return res.end()
      }
      return await this.proxy(req, res, url, session, url.pathname)
    } catch (error) {
      const message = this.redactSession(session, error instanceof Error ? error.message : String(error))
      this.logger.warn(`mcp-gui 登录捕获代理：${message}`)
      if (!res.headersSent) this.json(res, 502, { error: message })
      else res.destroy()
    }
  }

  /** Accept a report from the injected page script. */
  async acceptBrowserReport(session, payload) {
    if (payload === null || typeof payload !== 'object') return
    const capture = {}
    if (typeof payload.authorization === 'string' && payload.authorization !== '') capture.authorization = payload.authorization
    if (typeof payload.cookie === 'string' && payload.cookie !== '') capture.cookie = payload.cookie
    if (typeof payload.urlToken === 'string' && payload.urlToken !== '') capture.accessToken = payload.urlToken
    if (payload.storage !== null && typeof payload.storage === 'object') {
      for (const value of Object.values(payload.storage)) {
        if (typeof value !== 'string') continue
        if (/^eyJ/.test(value)) capture.accessToken = value
        else {
          const parsed = safeJson(value)
          if (parsed !== undefined) Object.assign(capture, extractFromJson(parsed))
        }
      }
    }
    await this.captureFromSession(session, { ...capture, source: 'page' })
  }

  /** Merge captured fields, persist through the callback, and update status. */
  async captureFromSession(session, capture) {
    const cookieAllowed = capture.force === true || session.loginAttempted === true || typeof capture.cookie === 'string'
      && (capture.authorization !== undefined || capture.accessToken !== undefined)
    let cookie = capture.cookie
    if (cookieAllowed) {
      if (typeof cookie !== 'string' || cookie === '') cookie = cookieHeaderFor(session, session.baseOrigin)
      if (typeof cookie === 'string' && cookie !== '') session.lastCookie = cookie
    }
    if (typeof capture.authorization === 'string' && capture.authorization !== '') {
      session.lastAuthorization = capture.authorization
      const match = /^(?:Bearer|Token)\s+(.+)$/i.exec(capture.authorization)
      if (match?.[1] !== undefined) session.accessToken = match[1]
    }
    if (typeof capture.accessToken === 'string' && capture.accessToken !== '') {
      session.accessToken = capture.accessToken
      if (capture.authorization === undefined && typeof capture.tokenType === 'string' && capture.tokenType !== '') {
        session.lastAuthorization = `${capture.tokenType} ${capture.accessToken}`
      }
    }
    if (typeof capture.refreshToken === 'string' && capture.refreshToken !== '') session.refreshToken = capture.refreshToken
    if (typeof capture.clientId === 'string' && capture.clientId !== '') session.clientId = capture.clientId
    if (typeof capture.scope === 'string' && capture.scope !== '') session.scope = capture.scope
    if (typeof capture.expiresIn === 'number' && Number.isFinite(capture.expiresIn)) session.expiresAt = Date.now() + capture.expiresIn * 1000
    if (typeof capture.expiresAt === 'number' && Number.isFinite(capture.expiresAt)) session.expiresAt = capture.expiresAt
    if (typeof capture.refreshUrl === 'string' && capture.refreshUrl !== '') session.refreshUrl = capture.refreshUrl
    if (typeof capture.error === 'string' && capture.error !== '') {
      session.error = this.redactSession(session, capture.errorDescription === undefined ? capture.error : `${capture.error}: ${capture.errorDescription}`)
      session.status = 'error'
    }
    const headers = {}
    if (session.lastAuthorization !== '') headers.Authorization = session.lastAuthorization
    if (cookieAllowed && session.lastCookie !== '') headers.Cookie = session.lastCookie
    const hasCredential = Object.keys(headers).length > 0 || typeof capture.accessToken === 'string'
    if (!hasCredential) return
    session.status = 'captured'
    session.capturedAt = Date.now()
    session.headerNames = Object.keys(headers)
    try {
      await this.onCapture(session.serverId, {
        headers,
        accessToken: session.accessToken || undefined,
        tokenType: typeof capture.tokenType === 'string' && capture.tokenType !== ''
          ? capture.tokenType
          : /^([A-Za-z]+)\s+/.exec(session.lastAuthorization)?.[1],
        refreshToken: session.refreshToken,
        refreshUrl: session.refreshUrl,
        expiresAt: session.expiresAt,
        clientId: session.clientId,
        scope: session.scope,
        source: capture.source ?? 'login',
        loginUrl: session.loginUrl,
      })
      session.error = ''
    } catch (error) {
      session.status = 'error'
      session.error = this.redactSession(session, error instanceof Error ? error.message : String(error))
    }
  }

  /** Reject private targets unless the configured login page was itself private. */
  async assertAllowedTarget(url, session) {
    if (session.allowPrivate) return
    if (isPrivateHost(url.hostname)) throw new Error('登录页请求了内网地址，已阻止')
    const literal = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(literal) !== 0) return
    let records = []
    try {
      records = await lookup(literal, { all: true })
    } catch {
      throw new Error('登录页域名无法解析，已阻止')
    }
    for (const record of records) {
      if (isPrivateHost(record.address)) throw new Error('登录页域名解析到内网地址，已阻止')
    }
  }

  /** Proxy one upstream request with redirects, cookies and HTML rewriting. */
  async proxy(req, res, url, session, rest) {
    const absolute = /^\/__abs\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(rest)
    let target
    if (absolute !== null) {
      try {
        target = new URL(decodeBase64Url(absolute[1]) + (absolute[2] ?? '/') + url.search)
      } catch {
        return this.json(res, 400, { error: '无效的代理地址' })
      }
    } else {
      target = new URL(`${session.baseOrigin}${rest}${url.search}`)
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return this.json(res, 403, { error: '只代理 http/https' })
    try {
      await this.assertAllowedTarget(target, session)
    } catch (error) {
      return this.json(res, 403, { error: error instanceof Error ? error.message : '目标地址被阻止' })
    }

    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req, MAX_BODY_BYTES)
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase()
      if (['host', 'connection', 'content-length', 'accept-encoding', 'cookie'].includes(lower)) continue
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    headers['accept-encoding'] = 'identity'
    const proxyOrigin = `http://127.0.0.1:${session.port}`
    // The browser page's origin is the upstream login origin, not the target
    // asset/API origin. Cross-origin CDNs and APIs often check Origin/Referer
    // against the page, so rewrite to session.baseOrigin rather than target.origin.
    if (req.headers.origin !== undefined) {
      headers.origin = req.headers.origin === proxyOrigin ? session.baseOrigin : req.headers.origin
    }
    if (req.headers.referer !== undefined) {
      try {
        const referer = new URL(req.headers.referer)
        if (referer.origin === proxyOrigin) {
          const crossOrigin = /^\/__abs\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(referer.pathname)
          if (crossOrigin !== null) {
            headers.referer = `${decodeBase64Url(crossOrigin[1])}${crossOrigin[2] ?? '/'}${referer.search}`
          } else {
            headers.referer = `${session.baseOrigin}${referer.pathname}${referer.search}`
          }
        }
      } catch {
        // A malformed referer is not forwarded.
      }
    }
    const cookie = cookieHeaderFor(session, target.origin)
    if (cookie !== undefined) headers.cookie = cookie
    if (req.method === 'POST' && /login|signin|sign-in|auth|session|token|oauth|sso/i.test(target.pathname)) {
      session.loginAttempted = true
    }
    if (typeof headers.authorization === 'string' && headers.authorization !== '') {
      session.lastAuthorization = headers.authorization
      const match = /^(?:Bearer|Token)\s+(.+)$/i.exec(headers.authorization)
      if (match?.[1] !== undefined) session.accessToken = match[1]
      void this.captureFromSession(session, { authorization: headers.authorization, source: 'request' })
    }
    if (body !== undefined && req.headers['content-type'] !== undefined && /application\/x-www-form-urlencoded/i.test(req.headers['content-type'])) {
      try {
        const form = new URLSearchParams(body.toString('utf8'))
        if (form.get('client_id') !== null) session.clientId = form.get('client_id')
      } catch {
        // A malformed form still proxies unchanged.
      }
    }

    const fetchUpstream = async (requestUrl, options) => {
      try {
        return await upstreamRequest(requestUrl, options)
      } catch (error) {
        this.recordRequest(session, {
          method: options.method,
          path: requestUrl.pathname,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }
    let response = await fetchUpstream(target, { method: req.method ?? 'GET', headers, body, tls: session.tls })
    let redirects = 0
    while ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && typeof response.headers.location === 'string' && redirects < MAX_REDIRECTS) {
      storeCookies(session, target.origin, response.headers)
      this.recordRequest(session, {
        method: req.method,
        path: target.pathname,
        status: response.statusCode ?? 0,
        contentType: String(response.headers['content-type'] ?? ''),
      })
      response.resume()
      const next = new URL(response.headers.location, target)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') break
      try {
        await this.assertAllowedTarget(next, session)
      } catch (error) {
        return this.json(res, 403, { error: error instanceof Error ? error.message : '重定向目标被阻止' })
      }
      if (target.protocol === 'https:' && next.protocol === 'http:') {
        return this.json(res, 403, { error: '登录页尝试从 HTTPS 降级到 HTTP，已阻止' })
      }
      const method = (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && req.method !== 'GET' && req.method !== 'HEAD')) ? 'GET' : req.method ?? 'GET'
      if (next.origin !== target.origin && method !== 'GET' && method !== 'HEAD' && body !== undefined) {
        return this.json(res, 403, { error: '跨域 307/308 重定向会转发登录请求体，已阻止' })
      }
      if (method === 'GET') delete headers['content-type']
      if (next.origin !== target.origin) {
        delete headers.authorization
        delete headers.cookie
        delete headers['proxy-authorization']
        delete headers.origin
        delete headers.referer
      }
      session.baseOrigin = next.origin
      target = next
      const nextCookie = cookieHeaderFor(session, next.origin)
      if (nextCookie !== undefined) headers.cookie = nextCookie
      else delete headers.cookie
      response = await fetchUpstream(target, { method, headers, body: method === 'GET' ? undefined : body, tls: session.tls })
      redirects += 1
    }
    if (redirects >= MAX_REDIRECTS) return this.json(res, 502, { error: '登录页重定向次数过多' })
    storeCookies(session, target.origin, response.headers)
    const responseType = String(response.headers['content-type'] ?? '').toLowerCase()
    const fetchDest = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase()
    const pathLower = target.pathname.toLowerCase()
    const expectsScript = fetchDest === 'script' || /\.m?js$/.test(pathLower)
    const expectsStyle = fetchDest === 'style' || /\.css$/.test(pathLower)
    const htmlFallback = /text\/html|application\/xhtml\+xml/.test(responseType)
    if ((expectsScript || expectsStyle) && htmlFallback) {
      const expected = expectsScript ? 'JavaScript' : 'CSS'
      const message = `上游对 ${target.pathname} 返回了 HTML 而不是 ${expected}（常见于 SPA fallback 或路径前缀错误）`
      this.recordRequest(session, {
        method: req.method,
        path: target.pathname,
        status: response.statusCode ?? 0,
        contentType: String(response.headers['content-type'] ?? ''),
        error: message,
      })
      response.resume()
      return this.json(res, 404, { error: message })
    }
    this.recordRequest(session, {
      method: req.method,
      path: target.pathname,
      status: response.statusCode ?? 0,
      contentType: String(response.headers['content-type'] ?? ''),
    })
    const responseHeaders = {}
    for (const [name, value] of Object.entries(response.headers)) {
      const lower = name.toLowerCase()
      if (['set-cookie', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'x-frame-options', 'strict-transport-security', 'permissions-policy'].includes(lower)) continue
      if (value !== undefined) responseHeaders[name] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    const rawCookies = response.headers['set-cookie']
    if (rawCookies !== undefined) {
      const lines = Array.isArray(rawCookies) ? rawCookies : [rawCookies]
      responseHeaders['set-cookie'] = lines.map((line) => browserSetCookie(line, ''))
    }
    const contentType = response.headers['content-type']
    const urlFields = extractFromUrl(target)
    if (Object.keys(urlFields).length > 0) await this.captureFromSession(session, { ...urlFields, source: 'url' })
    if (isHtmlType(contentType)) {
      const chunks = []
      let size = 0
      for await (const chunk of response) {
        size += chunk.byteLength
        if (size > MAX_HTML_BYTES) throw new Error('登录页 HTML 超过 8 MB')
        chunks.push(chunk)
      }
      let raw = Buffer.concat(chunks, size)
      if (response.headers['content-encoding'] !== undefined) {
        try {
          raw = decodeBody(raw, response.headers['content-encoding'])
        } catch (error) {
          throw new Error(`登录页 HTML 解压失败（${response.headers['content-encoding']}）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const html = decodeText(raw, response.headers['content-type'])
      const rewritten = rewriteHtml(html, session.baseOrigin)
      const script = `<script>${injectedScript(session.baseOrigin)}</script>`
      const injected = /<head\b[^>]*>/i.test(rewritten)
        ? rewritten.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`)
        : `<!doctype html><html><head>${script}</head><body>${rewritten}</body></html>`
      return this.buffer(res, 200, injected, { ...responseHeaders, 'content-type': withUtf8(contentType ?? 'text/html; charset=utf-8') })
    }
    const assetRequest = expectsScript || expectsStyle
    if (assetRequest) {
      res.writeHead(response.statusCode ?? 200, response.statusMessage, responseHeaders)
      response.pipe(res)
      return
    }
    if (isInspectableText(contentType) && response.statusCode !== undefined) {
      const chunks = []
      let size = 0
      for await (const chunk of response) {
        size += chunk.byteLength
        if (size > MAX_JSON_BYTES) {
          response.destroy()
          return this.json(res, 502, { error: '登录响应过大' })
        }
        chunks.push(chunk)
      }
      let raw = Buffer.concat(chunks, size)
      if (response.headers['content-encoding'] !== undefined) {
        try {
          raw = decodeBody(raw, response.headers['content-encoding'])
        } catch (error) {
          throw new Error(`登录响应解压失败（${response.headers['content-encoding']}）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const text = decodeText(raw, response.headers['content-type'])
      const parsed = safeJson(text)
      if (parsed !== undefined) await this.captureFromSession(session, { ...extractFromJson(parsed), source: 'response' })
      return this.buffer(res, response.statusCode ?? 200, Buffer.from(text, 'utf8'), { ...responseHeaders, 'content-type': withUtf8(contentType) })
    }
    res.writeHead(response.statusCode ?? 200, response.statusMessage, responseHeaders)
    response.pipe(res)
  }

  /** Write a buffered response with a fresh content length. */
  buffer(res, status, body, headers) {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
    const output = { ...headers }
    delete output['content-encoding']
    delete output['transfer-encoding']
    output['content-length'] = String(buffer.byteLength)
    res.writeHead(status, output)
    res.end(buffer)
  }

  /** Write a small JSON response. */
  json(res, status, payload) {
    const body = JSON.stringify(payload)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', Buffer.byteLength(body))
    res.end(body)
  }
}

/** Parse JSON without throwing. */
function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
