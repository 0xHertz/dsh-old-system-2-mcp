/** Durable server definitions. Secrets live in the credential store. */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Version of the on-disk document. */
const STORE_VERSION = 2

/**
 * Directory holding this plugin's mutable data.
 *
 * The plugin process does not reliably carry `DSH_PROFILE_DIR`, and awaiting
 * the Settings service on the activation path can deadlock while the Loader is
 * still settling. Use the profile override when the process has it, then the
 * harness home; otherwise the default `~/.dsh` root. The directory is resolved
 * once per plugin lifetime.
 */
export function dataDirectory() {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir !== undefined && profileDir !== '') return join(profileDir, 'mcp-gui')
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'mcp-gui')
  return join(homedir(), '.dsh', 'mcp-gui')
}

/** Absolute path of the server document inside one resolved data directory. */
export function storeFile(directory = dataDirectory()) {
  return join(directory, 'servers.json')
}

/** An empty document. */
export function emptyDocument() {
  return { version: STORE_VERSION, groups: [], servers: [] }
}

/**
 * Load the server document. A missing file is an empty document; malformed
 * content rejects instead of being silently overwritten.
 * @returns {Promise<{version:number, servers:object[]}>}
 */
export async function loadDocument(directory = dataDirectory()) {
  let text
  try {
    text = await readFile(storeFile(directory), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyDocument()
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`MCP 服务配置不是合法 JSON：${storeFile(directory)}。请修复或移走该文件后重启。`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.servers)) {
    throw new Error(`MCP 服务配置结构不合法：${storeFile(directory)}`)
  }
  const groups = Array.isArray(parsed.groups)
    ? parsed.groups.filter((group) => typeof group === 'object' && group !== null)
    : []
  return {
    version: STORE_VERSION,
    groups,
    servers: parsed.servers.filter((server) => typeof server === 'object' && server !== null),
  }
}

/**
 * Atomically write the server document with owner-only permissions.
 * @param {{version:number, servers:object[]}} document
 */
export async function saveDocument(document, directory = dataDirectory()) {
  const dir = directory
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = storeFile(directory)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify({ version: STORE_VERSION, groups: document.groups ?? [], servers: document.servers }, null, 2)}\n`
  await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, target)
  await chmod(target, 0o600)
}
