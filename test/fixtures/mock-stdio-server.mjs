/** Minimal stdio MCP server used by the plugin's transport tests. */

import readline from 'node:readline'

const tools = [
  {
    name: 'echo',
    description: 'Echo text over stdio.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'env',
    description: 'Report whether the configured environment variable is present.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify(result(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-stdio', version: '1.0.0' },
    }))}\n`)
    return
  }
  if (message.method === 'ping') {
    process.stdout.write(`${JSON.stringify(result(message.id, {}))}\n`)
    return
  }
  if (message.method === 'tools/list') {
    process.stdout.write(`${JSON.stringify(result(message.id, { tools }))}\n`)
    return
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'echo') {
      process.stdout.write(`${JSON.stringify(result(message.id, { content: [{ type: 'text', text: String(args.text ?? '') }] }))}\n`)
    } else if (name === 'env') {
      process.stdout.write(`${JSON.stringify(result(message.id, { content: [{ type: 'text', text: process.env.MOCK_STDIO_TOKEN === 'stdio-secret' ? 'env-present' : 'env-missing' }] }))}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result(message.id, { isError: true, content: [{ type: 'text', text: 'unknown tool' }] }))}\n`)
    }
    return
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })}\n`)
})
