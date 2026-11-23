/**
 * Local fixture used to verify the MCP configuration plugin without a real
 * remote service. It serves:
 * - an MCP streamable-HTTP endpoint at /mcp (Bearer auth),
 * - a browser login page at /login that yields a JSON token,
 * - a refresh endpoint at /refresh,
 * - /expire to force the next MCP call to see a 401,
 * - both HTTP and HTTPS listeners (the HTTPS one uses a self-signed cert).
 *
 * No secrets are printed.
 */

import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const state = {
  validTokens: new Set(['test-token']),
  expiredTokens: new Set(),
  refreshTokens: new Set(['refresh-token-1']),
  currentLoginToken: 'login-token-1',
  refreshCounter: 1,
  sessions: new Set(),
  loginAttempts: 0,
  sseSessions: new Map(),
  httpPort: 0,
  httpsPort: 0,
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(text)
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(html)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function cookieValue(req, name) {
  const raw = req.headers.cookie ?? ''
  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

function authorized(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return false
  const match = /^Bearer\s+(.+)$/.exec(header)
  if (match === null) return false
  const token = match[1]
  if (state.expiredTokens.has(token)) return false
  return state.validTokens.has(token)
}

function mcpTools() {
  return [
    {
      name: 'echo',
      description: 'Echo the provided text back.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'add',
      description: 'Add two numbers.',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
    },
    {
      name: 'whoami',
      description: 'Report whether the call was authenticated.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'fail',
      description: 'Always return an MCP tool error.',
      inputSchema: { type: 'object', properties: {} },
    },
  ]
}

function mcpResult(id, result, headers = {}) {
  return { jsonrpc: '2.0', id, result }
}

async function handleMcp(req, res, url) {
  if (req.method === 'GET') {
    res.writeHead(405, { allow: 'POST, DELETE' })
    res.end()
    return
  }
  if (req.method === 'DELETE') {
    res.writeHead(204)
    res.end()
    return
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'invalid_token' }, {
      'www-authenticate': 'Bearer error="invalid_token", error_description="token expired or invalid"',
    })
    return
  }
  let message
  try {
    message = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    return
  }
  if (message.method === 'notifications/initialized' || message.id === undefined) {
    res.writeHead(202)
    res.end()
    return
  }
  if (message.method === 'initialize') {
    const headers = { 'mcp-session-id': 'mock-session' }
    sendJson(res, 200, mcpResult(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    }), headers)
    return
  }
  if (message.method === 'ping') {
    sendJson(res, 200, mcpResult(message.id, {}))
    return
  }
  if (message.method === 'tools/list') {
    sendJson(res, 200, mcpResult(message.id, { tools: url.searchParams.get('empty') === '1' ? [] : mcpTools() }))
    return
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'echo') {
      sendJson(res, 200, mcpResult(message.id, { content: [{ type: 'text', text: String(args.text ?? '') }] }))
      return
    }
    if (name === 'add') {
      const sum = Number(args.a ?? 0) + Number(args.b ?? 0)
      sendJson(res, 200, mcpResult(message.id, { content: [{ type: 'text', text: String(sum) }] }))
      return
    }
    if (name === 'whoami') {
      sendJson(res, 200, mcpResult(message.id, { content: [{ type: 'text', text: 'authenticated' }] }))
      return
    }
    if (name === 'fail') {
      sendJson(res, 200, mcpResult(message.id, { isError: true, content: [{ type: 'text', text: 'boom' }] }))
      return
    }
    sendJson(res, 200, mcpResult(message.id, { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] }))
    return
  }
  sendJson(res, 200, {
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `method not found: ${message.method}` },
  })
}

function sseSend(res, message) {
  res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
}

async function handleSse(req, res) {
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'invalid_token' })
    return
  }
  const sessionId = `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)
  state.sseSessions.set(sessionId, res)
  const keepAlive = setInterval(() => { try { res.write(': keep-alive\n\n') } catch {} }, 15_000)
  req.on('close', () => {
    clearInterval(keepAlive)
    state.sseSessions.delete(sessionId)
  })
}

async function handleSseMessage(req, res, sessionId) {
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'invalid_token' })
    return
  }
  const stream = state.sseSessions.get(sessionId)
  if (stream === undefined) {
    sendJson(res, 404, { error: 'unknown session' })
    return
  }
  const message = JSON.parse(await readBody(req))
  res.writeHead(202)
  res.end()
  if (message.id === undefined) return
  let result
  if (message.method === 'initialize') {
    result = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-sse', version: '1.0.0' },
    }
  } else if (message.method === 'ping') {
    result = {}
  } else if (message.method === 'tools/list') {
    result = { tools: mcpTools() }
  } else if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'echo') result = { content: [{ type: 'text', text: String(args.text ?? '') }] }
    else if (name === 'add') result = { content: [{ type: 'text', text: String(Number(args.a ?? 0) + Number(args.b ?? 0)) }] }
    else if (name === 'whoami') result = { content: [{ type: 'text', text: 'authenticated' }] }
    else result = { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] }
  } else {
    sseSend(stream, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
    return
  }
  sseSend(stream, { jsonrpc: '2.0', id: message.id, result })
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname === '/sse') {
    await handleSse(req, res)
    return
  }
  if (url.pathname === '/messages') {
    await handleSseMessage(req, res, url.searchParams.get('sessionId') ?? '')
    return
  }
  if (url.pathname === '/gbk-login') {
    const body = Buffer.concat([
      Buffer.from('<!doctype html><html><head><meta charset="gbk"></head><body><h1>', 'utf8'),
      Buffer.from([0xB5, 0xC7, 0xC2, 0xBC]),
      Buffer.from('</h1></body></html>', 'utf8'),
    ])
    res.writeHead(200, {
      'content-type': 'text/html; charset=gbk',
      'content-length': body.byteLength,
      'cache-control': 'no-store',
    })
    res.end(body)
    return
  }
  if (url.pathname === '/no-bearer-token') {
    sendJson(res, 200, { token: 'custom-session-token-1234567890' })
    return
  }
  if (url.pathname === '/large-app.js') {
    const body = `/*${'x'.repeat(700 * 1024)}*/\nwindow.__large = true;\n`
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
    return
  }
  if (url.pathname === '/cdn-login') {
    const port = new URL(`http://${req.headers.host ?? 'localhost'}`).port
    sendHtml(res, 200, `<!doctype html><html><head><script src="http://localhost:${port}/cdn-check.js"></script></head><body><h1>CDN login</h1></body></html>`)
    return
  }
  if (url.pathname === '/cdn-check.js') {
    const expected = `http://127.0.0.1:${state.httpPort}`
    if (!String(req.headers.referer ?? '').startsWith(expected)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('bad referer')
      return
    }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end('window.__cdnOk = true;\n')
    return
  }
  if (url.pathname === '/cdn-subresource.js') {
    const expected = `http://localhost:${state.httpPort}`
    if (!String(req.headers.referer ?? '').startsWith(expected)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('bad subresource referer')
      return
    }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end('window.__cdnSubresourceOk = true;\n')
    return
  }
  if (url.pathname === '/api-origin') {
    const expected = `http://127.0.0.1:${state.httpPort}`
    if (req.headers.origin !== expected) {
      sendJson(res, 403, { error: 'bad origin', origin: req.headers.origin ?? null })
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }
  if (url.pathname === '/inline-login') {
    sendHtml(res, 200, '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><script>window.__CFG__={"src":"/assets/app.js","href":"/x"}; if (1 < 2) { window.__ok = true }</script><script src="/assets/app.js"></script></head><body><h1>Inline login</h1></body></html>')
    return
  }
  if (url.pathname === '/fallback.js') {
    sendHtml(res, 200, '<!doctype html><html><body>SPA fallback, not JavaScript</body></html>')
    return
  }
  if (url.pathname === '/spa-login') {
    sendHtml(res, 200, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script></head><body><h1>SPA login</h1></body></html>')
    return
  }
  if (url.pathname === '/assets/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end("import('/assets/chunk.js').then(function (m) { document.body.dataset.chunk = m.default; });\n")
    return
  }
  if (url.pathname === '/assets/chunk.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end("export default 'ok';\n")
    return
  }
  if (url.pathname === '/assets/app.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
    res.end('body{margin:0}\n')
    return
  }
  if (url.pathname === '/gzip-login') {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Gzip login</title></head><body><h1>Gzip login</h1><script src="/gzip-app.js"></script></body></html>'
    const body = gzipSync(Buffer.from(html, 'utf8'))
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': body.byteLength,
      'cache-control': 'no-store',
    })
    res.end(body)
    return
  }
  if (url.pathname === '/gzip-app.js') {
    const body = gzipSync(Buffer.from("document.body.dataset.gzip = 'ok';\n", 'utf8'))
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': body.byteLength,
      'cache-control': 'no-store',
    })
    res.end(body)
    return
  }
  if (url.pathname === '/mcp') {
    await handleMcp(req, res, url)
    return
  }
  if (url.pathname === '/same-origin-redirect' && req.method === 'POST') {
    res.writeHead(302, {
      location: '/protected',
      'set-cookie': 'sid=same-origin; Path=/; HttpOnly',
    })
    res.end()
    return
  }
  if (url.pathname === '/protected') {
    sendJson(res, 200, { cookie: req.headers.cookie ?? null })
    return
  }
  if (url.pathname === '/redirect-downgrade') {
    res.writeHead(302, { location: `http://127.0.0.1:${state.httpPort}/debug-headers` })
    res.end()
    return
  }
  if (url.pathname === '/redirect-cross') {
    const port = new URL(`http://${req.headers.host ?? 'localhost'}`).port
    res.writeHead(302, { location: `http://localhost:${port}/debug-headers` })
    res.end()
    return
  }
  if (url.pathname === '/debug-headers') {
    sendJson(res, 200, {
      authorization: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null,
    })
    return
  }
  if (url.pathname === '/login' && req.method === 'GET') {
    sendHtml(res, 200, `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock login</title></head>
<body style="font-family:system-ui;max-width:420px;margin:48px auto">
  <h1>Mock MCP login</h1>
  <form method="POST" action="/login">
    <p><label>Username <input name="username" value="alice" autocomplete="username"></label></p>
    <p><label>Password <input name="password" type="password" value="secret" autocomplete="current-password"></label></p>
    <p><button type="submit">Sign in</button></p>
  </form>
  <p id="status"></p>
</body></html>`)
    return
  }
  if (url.pathname === '/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req))
    state.loginAttempts += 1
    if (form.get('username') !== 'alice' || form.get('password') !== 'secret') {
      sendHtml(res, 401, '<h1>Invalid credentials</h1><p>Use alice / secret.</p>')
      return
    }
    const sid = `sid-${state.loginAttempts}-${Date.now()}`
    state.sessions.add(sid)
    sendHtml(res, 200, `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title></head>
<body style="font-family:system-ui;max-width:420px;margin:48px auto">
  <h1>Signed in</h1>
  <p id="status">Requesting token…</p>
  <script>
    fetch('/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json() })
      .then(function (t) { document.getElementById('status').textContent = 'Token captured by DSH.'; })
      .catch(function () { document.getElementById('status').textContent = 'Token request failed.' });
  </script>
</body></html>`, { 'set-cookie': `sid=${sid}; Path=/; HttpOnly` })
    return
  }
  if (url.pathname === '/session-login' && req.method === 'POST') {
    state.loginAttempts += 1
    const sid = `sid-cookie-${state.loginAttempts}-${Date.now()}`
    state.sessions.add(sid)
    sendHtml(res, 200, '<!doctype html><html><body><h1>Session signed in</h1><p>Cookie-only login.</p></body></html>', {
      'set-cookie': `sid=${sid}; Path=/; HttpOnly`,
    })
    return
  }
  if (url.pathname === '/token' && (req.method === 'POST' || req.method === 'GET')) {
    const sid = cookieValue(req, 'sid')
    if (sid === undefined || !state.sessions.has(sid)) {
      sendJson(res, 401, { error: 'login_required' })
      return
    }
    const token = state.currentLoginToken
    state.validTokens.add(token)
    sendJson(res, 200, {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: `refresh-token-${state.refreshCounter}`,
      scope: 'mcp.read',
    })
    return
  }
  if (url.pathname === '/refresh' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req))
    if (form.get('grant_type') !== 'refresh_token' || !state.refreshTokens.has(form.get('refresh_token') ?? '')) {
      sendJson(res, 400, { error: 'invalid_grant', error_description: 'refresh token is not valid' })
      return
    }
    state.refreshTokens.delete(form.get('refresh_token'))
    state.refreshCounter += 1
    const next = `login-token-${state.refreshCounter}`
    state.currentLoginToken = next
    state.validTokens.add(next)
    const refresh = `refresh-token-${state.refreshCounter}`
    state.refreshTokens.add(refresh)
    sendJson(res, 200, {
      access_token: next,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: 'mcp.read',
    })
    return
  }
  if (url.pathname === '/expire') {
    state.expiredTokens.add(state.currentLoginToken)
    sendJson(res, 200, { expired: state.currentLoginToken })
    return
  }
  if (url.pathname === '/me') {
    sendJson(res, 200, {
      authenticated: authorized(req),
      cookie: cookieValue(req, 'sid') !== undefined,
    })
    return
  }
  sendJson(res, 404, { error: 'not found' })
}

/** Start both listeners and return their URLs. */
export async function startMockServers() {
  const httpServer = http.createServer((req, res) => { void handle(req, res) })
  const httpsServer = https.createServer({
    key: readFileSync(join(here, 'tls', 'key.pem')),
    cert: readFileSync(join(here, 'tls', 'cert.pem')),
  }, (req, res) => { void handle(req, res) })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  await new Promise((resolve) => httpsServer.listen(0, '127.0.0.1', resolve))
  const httpPort = httpServer.address().port
  const httpsPort = httpsServer.address().port
  state.httpPort = httpPort
  state.httpsPort = httpsPort
  return {
    httpOrigin: `http://127.0.0.1:${httpPort}`,
    httpsOrigin: `https://127.0.0.1:${httpsPort}`,
    caFile: join(here, 'tls', 'cert.pem'),
    close: async () => {
      for (const stream of state.sseSessions.values()) {
        try { stream.end() } catch {}
      }
      state.sseSessions.clear()
      await new Promise((resolve) => httpServer.close(() => resolve()))
      await new Promise((resolve) => httpsServer.close(() => resolve()))
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const servers = await startMockServers()
  console.log(JSON.stringify({ httpOrigin: servers.httpOrigin, httpsOrigin: servers.httpsOrigin, caFile: servers.caFile }))
  process.on('SIGINT', () => { void servers.close().then(() => process.exit(0)) })
  process.on('SIGTERM', () => { void servers.close().then(() => process.exit(0)) })
}
