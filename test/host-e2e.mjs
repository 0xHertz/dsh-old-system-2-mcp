/** Host-level end-to-end checks for the MCP configuration plugin. */

import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockServers } from './fixtures/mock-server.mjs'

const stdioFixture = fileURLToPath(new URL('./fixtures/mock-stdio-server.mjs', import.meta.url))

process.env.DSH_INSTALL_DIR = process.env.DSH_INSTALL_DIR
  ?? '/home/mr-kechen/.nvm/versions/node/v22.21.1/lib/node_modules/@deepseek-ai/dsh'
const profileDir = await mkdtemp(join(tmpdir(), 'mcp-gui-test-'))
process.env.DSH_PROFILE_DIR = profileDir

const { McpGuiController } = await import('../host/controller.js')
const { isPrivateHost } = await import('../host/login-capture.js')

const logs = []
const logger = {
  info: (message) => logs.push(`info ${String(message)}`),
  warn: (message) => logs.push(`warn ${String(message)}`),
  error: (message) => logs.push(`error ${String(message)}`),
  debug: (message) => logs.push(`debug ${String(message)}`),
}

const records = new Map()

function assertJsonSafe(value, path = 'payload') {
  if (value === undefined) throw new Error(`${path} holds undefined`)
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`${path} holds a non-JSON value`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} holds a non-finite number`)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSafe(entry, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) assertJsonSafe(entry, `${path}.${key}`)
  }
}

const credentials = {
  async readRecord(key) { return records.get(key) },
  async describeRecord(key) { return { configured: records.has(key), writable: true } },
  async listRecords() { return [...records.keys()].map((key) => ({ key, kind: records.get(key).kind })) },
  async modifyRecord(key, mutate) {
    const next = await mutate(records.get(key))
    if (next === undefined) return records.get(key)
    assertJsonSafe(next)
    records.set(key, next)
    return next
  },
  async deleteRecord(key) { records.delete(key) },
  async resolve() { return undefined },
  async describe() { return { configured: false, writable: true } },
  async set() {},
  async unset() {},
}

const tools = new Map()
const ctx = {
  logger,
  tools: {
    register(definition) {
      if (tools.has(definition.name)) throw new Error(`tool already registered: ${definition.name}`)
      tools.set(definition.name, definition)
      return () => { tools.delete(definition.name) }
    },
  },
  connection: { requestRejection: () => undefined },
  webServer: { register: () => () => {} },
  get(name) { return name === 'credentials' ? credentials : undefined },
}

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

async function waitFor(predicate, timeoutMs = 12_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return undefined
}

async function waitState(controller, id) {
  return waitFor(async () => {
    const server = controller.state().servers.find((entry) => entry.id === id)
    if (server === undefined) return undefined
    return ['connected', 'error', 'auth-required'].includes(server.status.state) ? server : undefined
  })
}

// 0. SSRF host classification.
check('loopback is private', isPrivateHost('127.0.0.1') === true)
check('link-local metadata is private', isPrivateHost('169.254.169.254') === true)
check('CGNAT is private', isPrivateHost('100.64.0.1') === true)
check('IPv4-mapped IPv6 metadata is private', isPrivateHost('::ffff:a9fe:a9fe') === true)
check('IPv6 link-local is private', isPrivateHost('fe80::1') === true)
check('public IPv4 is public', isPrivateHost('8.8.8.8') === false)
check('fda.gov is not mistaken for IPv6 ULA', isPrivateHost('fda.gov') === false)
check('fc2.com is not mistaken for IPv6 ULA', isPrivateHost('fc2.com') === false)

const servers = await startMockServers()
const controller = new McpGuiController(ctx)
await controller.initialize()

try {
  // 1. Static token service.
  const demo = await controller.saveServer({
    server: {
      name: 'demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'default' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const demoState = await waitState(controller, demo.id)
  check('static server connects', demoState?.status?.state === 'connected', JSON.stringify(demoState?.status))
  check('static server lists tools', (demoState?.status?.tools ?? []).includes('mcp__demo__echo'))
  check('secret is masked in state', demoState?.auth?.masked === 'Bearer ****', demoState?.auth?.masked)
  check('static auth is shown as saved', demoState?.auth?.status === 'captured', JSON.stringify(demoState?.auth))
  check('secret value is not returned', !JSON.stringify(controller.state()).includes('test-token'))

  const staticProbe = await controller.probe({ id: demo.id })
  check('static probe succeeds', staticProbe.ok === true, staticProbe.message)
  check('static probe lists raw tools', ['echo', 'add', 'whoami', 'fail'].every((name) => staticProbe.toolNames.includes(name)), JSON.stringify(staticProbe.toolNames))

  const noneExplicit = await controller.saveServer({
    server: {
      name: 'none-explicit',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'none' },
      tls: { mode: 'default' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const noneProbe = await controller.probe({ id: noneExplicit.id })
  check('auth mode none still sends an explicitly configured header', noneProbe.ok === true, noneProbe.message)
  await controller.deleteServer(noneExplicit.id)

  check('legacy negotiation reports the negotiated version', demoState?.status?.protocolVersion === '2025-06-18', JSON.stringify(demoState?.status))
  check('probe reports the negotiated version', staticProbe.protocolVersion === '2025-06-18', JSON.stringify(staticProbe))
  const protocolDraft = {
    id: demo.id,
    name: 'demo',
    enabled: true,
    transport: 'streamable-http',
    url: `${servers.httpOrigin}/mcp`,
    headers: [{ name: 'Authorization', secret: true }],
    auth: { mode: 'static' },
    tls: { mode: 'default' },
  }
  const autoProbe = await controller.probe({ server: { ...protocolDraft, protocolMode: 'auto' } })
  check('auto negotiation falls back to 2025 on a legacy server', autoProbe.ok === true && autoProbe.protocolVersion === '2025-06-18', JSON.stringify(autoProbe))
  const pinProbe = await controller.probe({ server: { ...protocolDraft, protocolMode: '2026-07-28' } })
  check('forced 2026 fails loudly on a legacy server', pinProbe.ok === false && /2026-07-28/.test(pinProbe.message), JSON.stringify(pinProbe))
  let sseProtocolError = ''
  try {
    await controller.saveServer({
      server: { name: 'bad-sse', transport: 'sse', url: `${servers.httpOrigin}/sse`, headers: [], auth: { mode: 'none' }, protocolMode: 'auto' },
    })
  } catch (error) {
    sseProtocolError = error instanceof Error ? error.message : String(error)
  }
  check('SSE rejects auto protocol negotiation', sseProtocolError.includes('SSE'), sseProtocolError)

  const echo = tools.get('mcp__demo__echo')
  check('echo tool is registered', echo !== undefined)
  const echoResult = await echo.execute({ text: 'hello' }, { signal: AbortSignal.timeout(5_000) })
  check('echo tool returns text', echoResult === 'hello', echoResult)

  const largeTool = tools.get('mcp__demo__large')
  check('large tool is registered', largeTool !== undefined)
  if (largeTool !== undefined) {
    const largeResult = await largeTool.execute({ count: 20_000 }, { signal: AbortSignal.timeout(5_000) })
    check('large tool result is not truncated', largeResult.length === 20_000 && largeResult === 'x'.repeat(20_000), `${largeResult.length}`)
  }

  const failTool = tools.get('mcp__demo__fail')
  let failMessage = ''
  try {
    await failTool.execute({}, { signal: AbortSignal.timeout(5_000) })
  } catch (error) {
    failMessage = error instanceof Error ? error.message : String(error)
  }
  check('MCP isError fails visibly', failMessage.includes('boom'), failMessage)

  // 1a. A server that connects but lists no tools must not pass.
  const emptyServer = await controller.saveServer({
    server: {
      name: 'empty-demo',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp?empty=1`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'default' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const emptyProbe = await controller.probe({ id: emptyServer.id })
  check('zero-tool server does not pass', emptyProbe.ok === false && emptyProbe.code === 'NO_TOOLS', JSON.stringify(emptyProbe))
  await controller.deleteServer(emptyServer.id)

  // 1b. SSE transport.
  const sseServer = await controller.saveServer({
    server: {
      name: 'sse-demo',
      enabled: true,
      transport: 'sse',
      url: `${servers.httpOrigin}/sse`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'default' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const sseState = await waitState(controller, sseServer.id)
  check('SSE server connects', sseState?.status?.state === 'connected', JSON.stringify(sseState?.status))
  const sseEcho = tools.get('mcp__sse-demo__echo')
  check('SSE registers tools', sseEcho !== undefined)
  if (sseEcho !== undefined) {
    const sseResult = await sseEcho.execute({ text: 'sse' }, { signal: AbortSignal.timeout(5_000) })
    check('SSE tool executes', sseResult === 'sse', sseResult)
  }

  // 1c. stdio transport with a secret environment value.
  const stdioServer = await controller.saveServer({
    server: {
      name: 'stdio-demo',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture],
      envKeys: ['MOCK_STDIO_TOKEN'],
      headers: [],
      auth: { mode: 'none' },
      tls: { mode: 'default' },
    },
    envValues: { MOCK_STDIO_TOKEN: 'stdio-secret' },
  })
  const stdioState = await waitState(controller, stdioServer.id)
  check('stdio server connects', stdioState?.status?.state === 'connected', JSON.stringify(stdioState?.status))
  const stdioEnv = tools.get('mcp__stdio-demo__env')
  check('stdio registers tools', stdioEnv !== undefined)
  if (stdioEnv !== undefined) {
    const envResult = await stdioEnv.execute({}, { signal: AbortSignal.timeout(5_000) })
    check('stdio receives configured environment', envResult === 'env-present', envResult)
  }
  check('stdio env secret is not returned by state', !JSON.stringify(controller.state()).includes('stdio-secret'))

  // 2. Browser login capture.
  const loginServer = await controller.saveServer({
    server: {
      name: 'login-demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` },
      tls: { mode: 'default' },
    },
  })
  const started = await controller.startLogin(loginServer.id)
  check('login capture starts with a loopback URL', /^http:\/\/127\.0\.0\.1:\d+\/login$/.test(started.url), started.url)

  const loginPage = await fetch(started.url).then((response) => response.text())
  check('login page is proxied and rewritten', loginPage.includes('action="/login"'), loginPage.slice(0, 200))

  const submit = await fetch(started.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=alice&password=secret',
  }).then((response) => response.text())
  check('login form succeeds', submit.includes('Signed in'), submit.slice(0, 200))

  const tokenResponse = await fetch(`http://127.0.0.1:${new URL(started.url).port}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const tokenBody = await tokenResponse.json().catch(() => ({}))
  check('token endpoint is proxied', tokenResponse.ok && tokenBody.access_token !== undefined, JSON.stringify(tokenBody))

  const captured = await waitFor(async () => {
    try {
      const status = controller.loginStatus(started.id)
      return status.status === 'captured' ? status : undefined
    } catch {
      return undefined
    }
  })
  check('login capture persists credentials', captured !== undefined, JSON.stringify(captured))
  check('captured credential is in the record store', [...records.values()].some((record) => JSON.stringify(record).includes('login-token-1')))
  check('captured token is not returned by state', !JSON.stringify(controller.state()).includes('login-token-1'))
  check('captured token is masked', controller.state().servers.find((entry) => entry.id === loginServer.id)?.auth?.masked === 'Bearer ****')
  const capturedStatus = controller.loginStatus(started.id)
  check('login status carries a masked auth summary', capturedStatus.auth?.accessTokenMasked === '****', JSON.stringify(capturedStatus.auth))
  check('captured scope is exposed as metadata', capturedStatus.auth?.scope === 'mcp.read', JSON.stringify(capturedStatus.auth))
  check('header preview keeps names and masks values', capturedStatus.auth?.capturedHeaders?.some((header) => header.name === 'Authorization' && header.masked === 'Bearer ****'), JSON.stringify(capturedStatus.auth?.capturedHeaders))
  check('auth summary never contains the token', !JSON.stringify(capturedStatus.auth).includes('login-token-1'), JSON.stringify(capturedStatus.auth))

  const loginState = await waitState(controller, loginServer.id)
  check('login server connects with captured token', loginState?.status?.state === 'connected', JSON.stringify(loginState?.status))
  const loginEcho = tools.get('mcp__login-demo__echo')
  const loginResult = await loginEcho.execute({ text: 'captured' }, { signal: AbortSignal.timeout(5_000) })
  check('captured token is used automatically', loginResult === 'captured', loginResult)

  // 2a. Cookie-only login: manual completion persists the cookie header.
  const cookieServer = await controller.saveServer({
    server: {
      name: 'cookie-demo',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/session-login` },
      tls: { mode: 'default' },
    },
  })
  const cookieStart = await controller.startLogin(cookieServer.id)
  const cookieSubmit = await fetch(cookieStart.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  })
  await cookieSubmit.text()
  const cookieComplete = await controller.completeLogin(cookieStart.id)
  check('cookie-only login completes manually', cookieComplete.status === 'captured', JSON.stringify(cookieComplete))
  const cookieView = controller.state().servers.find((entry) => entry.id === cookieServer.id)
  check('cookie-only credential is masked', cookieView?.auth?.masked === '****', cookieView?.auth?.masked)
  check('cookie-only credential is stored', [...records.keys()].some((key) => key.includes(cookieServer.id)))
  await controller.deleteServer(cookieServer.id)
  check('deleting a disabled service removes its credential', [...records.keys()].every((key) => !key.includes(cookieServer.id)))

  // 2a-2. Same-origin redirect keeps the cookie set by the redirect response.
  const sameServer = await controller.saveServer({
    server: {
      name: 'same-redirect',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/same-origin-redirect` },
      tls: { mode: 'default' },
    },
  })
  const sameStart = await controller.startLogin(sameServer.id)
  const sameResponse = await fetch(sameStart.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  })
  const sameBody = await sameResponse.json().catch(() => ({}))
  check('same-origin redirect forwards the new cookie', typeof sameBody.cookie === 'string' && sameBody.cookie.includes('sid=same-origin'), JSON.stringify(sameBody))
  await controller.deleteServer(sameServer.id)

  // 2b. Cross-origin redirect drops the previous origin's Authorization.
  const redirectServer = await controller.saveServer({
    server: {
      name: 'redirect-demo',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/redirect-cross` },
      tls: { mode: 'default' },
    },
  })
  const redirectStart = await controller.startLogin(redirectServer.id)
  const redirectResponse = await fetch(redirectStart.url, { headers: { authorization: 'Bearer cross-secret' } })
  const redirectBody = await redirectResponse.json().catch(() => ({}))
  check('cross-origin redirect drops Authorization', redirectBody.authorization === null, JSON.stringify(redirectBody))
  check('cross-origin redirect does not forward the old cookie', redirectBody.cookie === null, JSON.stringify(redirectBody))
  check('cross-origin redirect does not leak the token', !JSON.stringify(redirectBody).includes('cross-secret'), JSON.stringify(redirectBody))
  const redirectStatus = controller.loginStatus(redirectStart.id)
  check('redirect hop is recorded in diagnostics', redirectStatus.requests?.some((request) => request.path === '/redirect-cross' && request.status === 302), JSON.stringify(redirectStatus.requests))
  await controller.deleteServer(redirectServer.id)

  // 2b-2. Root-mounted absolute asset paths and gzip responses survive the proxy.
  const spaServer = await controller.saveServer({
    server: {
      name: 'spa-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/spa-login` },
      tls: { mode: 'default' },
    },
  })
  const spaStart = await controller.startLogin(spaServer.id)
  const spaPort = new URL(spaStart.url).port
  const spaPage = await fetch(spaStart.url).then((response) => response.text())
  check('root proxy keeps absolute asset paths', spaPage.includes('src="/assets/app.js"'), spaPage.slice(0, 200))
  const assetResponse = await fetch(`http://127.0.0.1:${spaPort}/assets/app.js`)
  const assetBody = await assetResponse.text()
  check('absolute JS asset resolves through the root proxy', assetResponse.ok && assetBody.includes("import('/assets/chunk.js')"), `${assetResponse.status} ${assetBody.slice(0, 120)}`)
  const chunkResponse = await fetch(`http://127.0.0.1:${spaPort}/assets/chunk.js`)
  check('nested absolute JS asset resolves', chunkResponse.ok, String(chunkResponse.status))
  const cssResponse = await fetch(`http://127.0.0.1:${spaPort}/assets/app.css`)
  check('absolute CSS asset resolves', cssResponse.ok, String(cssResponse.status))
  const spaStatus = controller.loginStatus(spaStart.id)
  check('login diagnostics records asset paths and statuses', spaStatus.requests?.some((request) => request.path === '/assets/app.js' && request.status === 200), JSON.stringify(spaStatus.requests))
  await controller.deleteServer(spaServer.id)

  const gzipServer = await controller.saveServer({
    server: {
      name: 'gzip-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/gzip-login` },
      tls: { mode: 'default' },
    },
  })
  const gzipStart = await controller.startLogin(gzipServer.id)
  const gzipPort = new URL(gzipStart.url).port
  const gzipPage = await fetch(gzipStart.url).then((response) => response.text())
  check('gzip HTML is decoded and rewritten', gzipPage.includes('<h1>Gzip login</h1>'), gzipPage.slice(0, 200))
  const gzipAsset = await fetch(`http://127.0.0.1:${gzipPort}/gzip-app.js`)
  const gzipAssetBody = await gzipAsset.text()
  const gzipEncoding = gzipAsset.headers.get('content-encoding')
  check('gzip JS is served decodably', gzipAssetBody.includes('dataset.gzip') && (gzipEncoding === null || gzipEncoding === 'gzip'), `${gzipAsset.status} ${gzipEncoding} ${gzipAssetBody.slice(0, 80)}`)
  await controller.deleteServer(gzipServer.id)

  // 2b-3. Inline scripts stay byte-identical; HTML fallbacks for JS are visible failures.
  const inlineServer = await controller.saveServer({
    server: {
      name: 'inline-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/inline-login` },
      tls: { mode: 'default' },
    },
  })
  const inlineStart = await controller.startLogin(inlineServer.id)
  const inlinePort = new URL(inlineStart.url).port
  const inlinePage = await fetch(inlineStart.url).then((response) => response.text())
  check('inline script body is not rewritten', inlinePage.includes('window.__CFG__={"src":"/assets/app.js","href":"/x"}'), inlinePage.slice(0, 300))
  check('inline script comparison is preserved', inlinePage.includes('if (1 < 2)'), inlinePage.slice(0, 300))
  check('meta CSP is removed', !/http-equiv=["']?Content-Security-Policy/i.test(inlinePage), inlinePage.slice(0, 300))
  check('external script tag is preserved', inlinePage.includes('src="/assets/app.js"'), inlinePage.slice(0, 300))
  const fallbackResponse = await fetch(`http://127.0.0.1:${inlinePort}/fallback.js`)
  const fallbackBody = await fallbackResponse.json().catch(() => ({}))
  check('HTML fallback for JS becomes a 404', fallbackResponse.status === 404 && String(fallbackBody.error ?? '').includes('HTML'), `${fallbackResponse.status} ${JSON.stringify(fallbackBody)}`)
  const inlineStatus = controller.loginStatus(inlineStart.id)
  check('MIME mismatch is recorded as an error', inlineStatus.requests?.some((request) => request.path === '/fallback.js' && request.error !== undefined), JSON.stringify(inlineStatus.requests))
  await controller.deleteServer(inlineServer.id)

  // 2b-4. Cross-origin assets/APIs see the page Origin/Referer, not the CDN origin.
  const cdnServer = await controller.saveServer({
    server: {
      name: 'cdn-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/cdn-login` },
      tls: { mode: 'default' },
    },
  })
  const cdnStart = await controller.startLogin(cdnServer.id)
  const cdnProxyPort = new URL(cdnStart.url).port
  const loginPort = new URL(servers.httpOrigin).port
  const cdnBase64 = Buffer.from(`http://localhost:${loginPort}`).toString('base64url')
  const cdnAssetResponse = await fetch(`http://127.0.0.1:${cdnProxyPort}/__abs/${cdnBase64}/cdn-check.js`, {
    headers: { referer: `http://127.0.0.1:${cdnProxyPort}/cdn-login` },
  })
  const cdnAssetBody = await cdnAssetResponse.text()
  check('cross-origin asset sees the page Referer', cdnAssetResponse.ok && cdnAssetBody.includes('__cdnOk'), `${cdnAssetResponse.status} ${cdnAssetBody.slice(0, 80)}`)
  const cdnOriginResponse = await fetch(`http://127.0.0.1:${cdnProxyPort}/__abs/${cdnBase64}/api-origin`, {
    headers: { origin: `http://127.0.0.1:${cdnProxyPort}` },
  })
  const cdnOriginBody = await cdnOriginResponse.json().catch(() => ({}))
  check('cross-origin API sees the page Origin', cdnOriginResponse.ok && cdnOriginBody.ok === true, `${cdnOriginResponse.status} ${JSON.stringify(cdnOriginBody)}`)
  const cdnSubresourceResponse = await fetch(`http://127.0.0.1:${cdnProxyPort}/__abs/${cdnBase64}/cdn-subresource.js`, {
    headers: { referer: `http://127.0.0.1:${cdnProxyPort}/__abs/${cdnBase64}/style.css` },
  })
  const cdnSubresourceBody = await cdnSubresourceResponse.text()
  check('cross-origin subresource referer maps back to the CDN', cdnSubresourceResponse.ok && cdnSubresourceBody.includes('__cdnSubresourceOk'), `${cdnSubresourceResponse.status} ${cdnSubresourceBody.slice(0, 80)}`)
  await controller.deleteServer(cdnServer.id)

  // 2b-4b. Large JS bundles are streamed, not rejected by the JSON buffer cap.
  const largeServer = await controller.saveServer({
    server: {
      name: 'large-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/spa-login` },
      tls: { mode: 'default' },
    },
  })
  const largeStart = await controller.startLogin(largeServer.id)
  const largePort = new URL(largeStart.url).port
  const largeResponse = await fetch(`http://127.0.0.1:${largePort}/large-app.js`)
  const largeBody = await largeResponse.text()
  check('large JS bundle is streamed', largeResponse.ok && largeBody.includes('window.__large') && largeBody.length > 700 * 1024, `${largeResponse.status} ${largeBody.length}`)
  await controller.deleteServer(largeServer.id)

  // 2b-5. Non-UTF-8 login pages are decoded and re-encoded consistently.
  const gbkServer = await controller.saveServer({
    server: {
      name: 'gbk-login',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/gbk-login` },
      tls: { mode: 'default' },
    },
  })
  const gbkStart = await controller.startLogin(gbkServer.id)
  const gbkResponse = await fetch(gbkStart.url)
  const gbkPage = await gbkResponse.text()
  check('GBK HTML is decoded and served as UTF-8', gbkPage.includes('登录') && String(gbkResponse.headers.get('content-type')).includes('utf-8'), `${gbkResponse.headers.get('content-type')} ${gbkPage.slice(0, 160)}`)
  check('GBK meta charset is rewritten', /<meta charset="utf-8"/i.test(gbkPage), gbkPage.slice(0, 200))
  await controller.deleteServer(gbkServer.id)

  // 2b-6. A generic token without token_type is not mislabeled as Bearer.
  const emptyToken = await controller.saveServer({
    server: {
      name: 'empty-token',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login` },
      tls: { mode: 'default' },
    },
  })
  const emptyTokenStart = await controller.startLogin(emptyToken.id)
  await fetch(`http://127.0.0.1:${new URL(emptyTokenStart.url).port}/empty-token`, { method: 'POST' })
  check('empty access_token is not treated as a credential', controller.loginStatus(emptyTokenStart.id).status !== 'captured' && records.get(`mcp-gui/${emptyToken.id}`) === undefined, JSON.stringify(controller.loginStatus(emptyTokenStart.id)))
  await controller.deleteServer(emptyToken.id)

  const noBearer = await controller.saveServer({
    server: {
      name: 'no-bearer',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login` },
      tls: { mode: 'default' },
    },
  })
  const noBearerStart = await controller.startLogin(noBearer.id)
  const noBearerPort = new URL(noBearerStart.url).port
  await fetch(`http://127.0.0.1:${noBearerPort}/no-bearer-token`, { method: 'POST' })
  const noBearerRecord = records.get(`mcp-gui/${noBearer.id}`)
  check('generic token does not become Bearer', noBearerRecord?.payload?.headers?.Authorization === undefined, JSON.stringify(noBearerRecord))
  check('generic token is still stored as accessToken', noBearerRecord?.payload?.auth?.accessToken === 'custom-session-token-1234567890' && noBearerRecord?.payload?.auth?.tokenType === undefined, JSON.stringify(noBearerRecord?.payload?.auth))

  const configuredToken = await controller.saveServer({
    server: {
      id: noBearer.id,
      name: noBearer.name,
      enabled: false,
      transport: 'streamable-http',
      url: noBearer.url,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, tokenHeader: 'X-Token', tokenPrefix: '' },
      tls: { mode: 'default' },
    },
  })
  const configuredFromOld = records.get(`mcp-gui/${noBearer.id}`)
  check('configuring a token header reuses the captured token', configuredFromOld?.payload?.headers?.['X-Token'] === 'custom-session-token-1234567890' && configuredFromOld?.payload?.headers?.Authorization === undefined, JSON.stringify(configuredFromOld))
  const configuredStart = await controller.startLogin(configuredToken.id)
  const configuredPort = new URL(configuredStart.url).port
  await fetch(`http://127.0.0.1:${configuredPort}/no-bearer-token`, { method: 'POST' })
  const configuredRecord = records.get(`mcp-gui/${noBearer.id}`)
  check('configured token header is used instead of Bearer', configuredRecord?.payload?.headers?.['X-Token'] === 'custom-session-token-1234567890' && configuredRecord?.payload?.headers?.Authorization === undefined, JSON.stringify(configuredRecord))
  const configuredAuthorization = await controller.saveServer({
    server: {
      id: noBearer.id,
      name: noBearer.name,
      enabled: false,
      transport: 'streamable-http',
      url: noBearer.url,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, tokenHeader: 'Authorization', tokenPrefix: 'Bearer ' },
      tls: { mode: 'default' },
    },
  })
  const configuredAuthorizationRecord = records.get(`mcp-gui/${noBearer.id}`)
  check('configured Authorization prefix keeps its trailing space', configuredAuthorizationRecord?.payload?.headers?.Authorization === 'Bearer custom-session-token-1234567890' && configuredAuthorizationRecord?.payload?.headers?.['X-Token'] === undefined, JSON.stringify(configuredAuthorizationRecord))
  await controller.deleteServer(configuredAuthorization.id)

  // 2c. Re-saving the login server must keep captured headers.
  await controller.saveServer({
    server: {
      id: loginServer.id,
      name: 'login-demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` },
      tls: { mode: 'default' },
    },
  })
  const resavedState = await waitState(controller, loginServer.id)
  check('re-save keeps captured credentials', resavedState?.auth?.status === 'captured', JSON.stringify(resavedState?.auth))
  const loginEchoAfterSave = tools.get('mcp__login-demo__echo')
  check('re-save re-registers tools', loginEchoAfterSave !== undefined)

  // 3. Expire the access token; the transport must refresh once and retry.
  await fetch(`${servers.httpOrigin}/expire`)
  const retried = await loginEchoAfterSave.execute({ text: 'after-401' }, { signal: AbortSignal.timeout(10_000) })
  check('401 triggers refresh and one retry', retried === 'after-401', retried)
  const refreshedRecord = [...records.values()].find((record) => JSON.stringify(record).includes('refresh-token-'))
  check('refresh rotates the stored token', refreshedRecord !== undefined && JSON.stringify(refreshedRecord).includes('login-token-2'), JSON.stringify(refreshedRecord))
  check('logs contain no captured token', !logs.some((line) => line.includes('login-token-1') || line.includes('test-token')), logs.filter((line) => line.includes('login-token') || line.includes('test-token')).join('\n'))

  // 3b. Probe a server whose token has expired; it must refresh and pass.
  await fetch(`${servers.httpOrigin}/expire`)
  const refreshedProbe = await controller.probe({ id: loginServer.id })
  check('probe refreshes an expired token', refreshedProbe.ok === true, refreshedProbe.message)

  // 3b-2. Draft probes use the draft's auth mode, and login drafts refresh on 401.
  const draftBase = {
    id: loginServer.id,
    name: 'login-demo',
    enabled: true,
    transport: 'streamable-http',
    url: `${servers.httpOrigin}/mcp`,
    headers: [],
    tls: { mode: 'default' },
  }
  const draftNone = await controller.probe({
    server: { ...draftBase, auth: { mode: 'none', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` } },
  })
  check('draft probe with mode none does not send captured credentials', draftNone.ok === false && draftNone.stage === 'auth', JSON.stringify(draftNone))
  const draftLogin = await controller.probe({
    server: { ...draftBase, auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` } },
  })
  check('draft probe with login mode uses captured credentials', draftLogin.ok === true, draftLogin.message)
  await fetch(`${servers.httpOrigin}/expire`)
  const draftExpired = await controller.probe({
    server: { ...draftBase, auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` } },
  })
  check('draft probe refreshes an expired token', draftExpired.ok === true, draftExpired.message)

  // 3c. Switching the auth mode stops sending captured credentials.
  const noAuthSave = await controller.saveServer({
    server: {
      id: loginServer.id,
      name: 'login-demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'none', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` },
      tls: { mode: 'default' },
    },
  })
  const noAuthProbe = await controller.probe({ id: loginServer.id })
  check('auth mode none stops sending captured credentials', noAuthProbe.ok === false && noAuthProbe.stage === 'auth', JSON.stringify(noAuthProbe))
  const backToLogin = await controller.saveServer({
    server: {
      id: loginServer.id,
      name: 'login-demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpOrigin}/login`, refreshUrl: `${servers.httpOrigin}/refresh` },
      tls: { mode: 'default' },
    },
  })
  const backState = await waitState(controller, loginServer.id)
  check('switching back to login restores the captured credential', backState?.status?.state === 'connected' && backState?.auth?.status === 'captured', JSON.stringify(backState?.auth))

  // 4. Self-signed HTTPS: custom CA succeeds, default verification fails.
  const caPem = await readFile(servers.caFile, 'utf8')
  const tlsServer = await controller.saveServer({
    server: {
      name: 'tls-demo',
      enabled: true,
      transport: 'streamable-http',
      url: `${servers.httpsOrigin}/mcp`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'ca', caPem },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const tlsProbe = await controller.probe({ id: tlsServer.id })
  check('self-signed HTTPS works with a custom CA', tlsProbe.ok === true, tlsProbe.message)

  const insecureServer = await controller.saveServer({
    server: {
      name: 'tls-insecure',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpsOrigin}/mcp`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'insecure' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const insecureProbe = await controller.probe({ id: insecureServer.id })
  check('self-signed HTTPS works with verification disabled', insecureProbe.ok === true, insecureProbe.message)

  const untrusted = await controller.saveServer({
    server: {
      name: 'tls-untrusted',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpsOrigin}/mcp`,
      headers: [{ name: 'Authorization', secret: true }],
      auth: { mode: 'static' },
      tls: { mode: 'default' },
    },
    headerValues: { Authorization: 'Bearer test-token' },
  })
  const untrustedProbe = await controller.probe({ id: untrusted.id })
  check('untrusted self-signed certificate fails with a TLS stage', untrustedProbe.ok === false && untrustedProbe.stage === 'tls', JSON.stringify(untrustedProbe))

  // 4b. HTTPS to HTTP redirect is blocked before the downgrade request.
  const downgradeServer = await controller.saveServer({
    server: {
      name: 'downgrade-demo',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpsOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: `${servers.httpsOrigin}/redirect-downgrade` },
      tls: { mode: 'ca', caPem },
    },
  })
  const downgradeStart = await controller.startLogin(downgradeServer.id)
  const downgradeResponse = await fetch(downgradeStart.url)
  const downgradeBody = await downgradeResponse.json().catch(() => ({}))
  check('HTTPS to HTTP redirect is blocked', downgradeResponse.status === 403 && String(downgradeBody.error ?? '').includes('HTTPS 降级'), JSON.stringify(downgradeBody))
  await controller.deleteServer(downgradeServer.id)

  // 4c. Changing the login page URL invalidates credentials captured for the old page.
  const oldLoginUrl = `${servers.httpOrigin}/spa-login`
  const newLoginUrl = `${servers.httpOrigin}/inline-login`
  const urlChange = await controller.saveServer({
    server: {
      name: 'url-change',
      enabled: false,
      transport: 'streamable-http',
      url: `${servers.httpOrigin}/mcp`,
      headers: [],
      auth: { mode: 'login', loginUrl: oldLoginUrl },
      tls: { mode: 'default' },
    },
  })
  await controller.onCapture(urlChange.id, {
    headers: { Authorization: 'Bearer old-login-token' },
    accessToken: 'old-login-token',
    loginUrl: oldLoginUrl,
    source: 'request',
  })
  let changedState = controller.state().servers.find((entry) => entry.id === urlChange.id)
  check('changing login URL starts from no capture', changedState?.auth?.status === 'captured', JSON.stringify(changedState?.auth))
  const changed = await controller.saveServer({
    server: {
      id: urlChange.id,
      name: urlChange.name,
      enabled: false,
      transport: 'streamable-http',
      url: urlChange.url,
      headers: [],
      auth: { mode: 'login', loginUrl: newLoginUrl, refreshUrl: '' },
      tls: { mode: 'default' },
    },
    headerValues: {},
  })
  changedState = controller.state().servers.find((entry) => entry.id === urlChange.id)
  check('login URL change resets captured status', changed.auth.status === 'none' && changed.auth.capturedAt === null && changedState?.auth?.status === 'none', JSON.stringify(changed.auth))
  const changedRecord = records.get(`mcp-gui/${urlChange.id}`)
  check('login URL change drops captured Authorization/Cookie', changedRecord === undefined || (changedRecord.payload.headers?.Authorization === undefined && changedRecord.payload.headers?.Cookie === undefined), JSON.stringify(changedRecord))
  let lateCaptureRejected = false
  try {
    await controller.onCapture(urlChange.id, {
      headers: { Authorization: 'Bearer late-old-token' },
      accessToken: 'late-old-token',
      loginUrl: oldLoginUrl,
      source: 'request',
    })
  } catch {
    lateCaptureRejected = true
  }
  const lateRecord = records.get(`mcp-gui/${urlChange.id}`)
  check('late capture from the old login page is rejected', lateCaptureRejected && (lateRecord === undefined || lateRecord.payload.headers?.Authorization === undefined), JSON.stringify(lateRecord))
  await controller.deleteServer(urlChange.id)

  // 5. Disable unregisters the tools.
  await controller.setEnabled(demo.id, false)
  check('disable unregisters tools', tools.get('mcp__demo__echo') === undefined)
  await controller.setEnabled(demo.id, true)
  const reenabled = await waitState(controller, demo.id)
  check('re-enable reconnects', reenabled?.status?.state === 'connected', JSON.stringify(reenabled?.status))

  // 6. Delete removes the secret record.
  await controller.deleteServer(loginServer.id)
  check('delete removes the credential record', [...records.keys()].every((key) => !key.includes(loginServer.id)))
  check('delete removes the server row', controller.state().servers.every((entry) => entry.id !== loginServer.id))
} finally {
  await controller.dispose()
  await servers.close()
  await rm(profileDir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
if (failures !== 0) process.exitCode = 1
