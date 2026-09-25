import { glob, readFile, realpath, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ImportedHost } from '../../shared/api'
const exec = promisify(execFile)

// Only enumerate names here. OpenSSH resolves Host/Match precedence and defaults.
export function configWords(line: string): string[] {
  const words: string[] = []
  let word = '',
    quoted = false,
    escaped = false
  for (const char of line) {
    if (escaped) {
      word += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === '#' && !quoted) break
    if (/\s/.test(char) && !quoted) {
      if (word) words.push(word)
      word = ''
      continue
    }
    word += char
  }
  if (escaped) word += '\\'
  if (word) words.push(word)
  return words
}
function expandHome(path: string, home: string): string {
  return path
    .replace(/^~(?=\/|$)/, home)
    .replace(/%d/g, home)
    .replace(
      /\$\{([^}]+)\}/g,
      (token, key: string) => process.env[key] ?? token
    )
}
export async function configAliases(
  configPath: string,
  home: string
): Promise<string[]> {
  const visited = new Set<string>(),
    aliases = new Set<string>()
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 16 || visited.size >= 256)
      throw new Error('SSH Include 层级或文件数量过多，请手动配置此主机')
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (visited.has(canonical)) return
    visited.add(canonical)
    const info = await stat(canonical)
    if (!info.isFile()) return
    if (info.size > 2 * 1024 * 1024) throw new Error('SSH 配置文件超过 2 MB')
    const text = await readFile(canonical, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(Host|Include)(?:\s*=\s*|\s+)(.*)$/i)
      if (!match) continue
      const words = configWords(match[2])
      if (match[1].toLowerCase() === 'host') {
        for (const alias of words)
          if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(alias)) aliases.add(alias)
      } else {
        for (const word of words) {
          const expanded = expandHome(word, home)
          // Dynamic host-specific tokens cannot be enumerated before choosing a host.
          if (/%[a-zA-Z]|\$\{/.test(expanded)) continue
          const pattern = isAbsolute(expanded)
            ? expanded
            : join(home, '.ssh', expanded)
          const files: string[] = []
          for await (const file of glob(pattern)) files.push(file)
          for (const file of files.sort()) await visit(file, depth + 1)
        }
      }
    }
  }
  await visit(configPath, 0)
  return [...aliases]
}
export async function resolveImportedHost(
  name: string,
  output: string,
  home: string
): Promise<ImportedHost> {
  const fields = new Map<string, string[]>()
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(.*)$/)
    if (match) fields.set(match[1], [...(fields.get(match[1]) || []), match[2]])
  }
  const first = (key: string): string => fields.get(key)?.[0] || ''
  const hostname = first('hostname') || name,
    username = first('user') || userInfo().username
  const port = Number(first('port') || 22)
  const candidates = (fields.get('identityfile') || [])
    .filter((value) => value !== 'none')
    .map((path) =>
      expandHome(path, home).replace(
        /%([%hrnp])/g,
        (_token, key: string) =>
          ({ '%': '%', h: hostname, r: username, n: name, p: String(port) })[
            key
          ] || ''
      )
    )
  let privateKeyPath = ''
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) {
        privateKeyPath = path
        break
      }
    } catch {
      /* ssh may list nonexistent default keys */
    }
  }
  const warnings: string[] = []
  const proxyJump = first('proxyjump') === 'none' ? '' : first('proxyjump')
  if (proxyJump)
    warnings.push(`跳板配置：${proxyJump}。请确认下方已选择对应的已保存主机。`)
  if (first('proxycommand') && first('proxycommand') !== 'none')
    warnings.push('此主机使用 ProxyCommand，当前需手动设置等效跳板主机。')
  if (
    first('identityagent') &&
    !['none', 'SSH_AUTH_SOCK'].includes(first('identityagent'))
  )
    warnings.push(
      '此主机使用自定义 IdentityAgent；当前 agent 模式使用系统 SSH_AUTH_SOCK，请核对认证方式。'
    )
  if (first('identitiesonly') === 'yes' && !privateKeyPath) {
    privateKeyPath = candidates[0] || ''
    warnings.push('未找到配置对应的本机私钥，请选择可用私钥或调整认证方式。')
  }
  return {
    name,
    hostname,
    port,
    username,
    privateKeyPath,
    auth: privateKeyPath ? 'key' : 'agent',
    proxyJump,
    warning: warnings.join(' ')
  }
}
export async function importSshConfig(
  options: {
    home?: string
    configPath?: string
    resolveHost?: (name: string) => Promise<string>
  } = {}
): Promise<ImportedHost[]> {
  const home = options.home || homedir(),
    configPath = options.configPath || join(home, '.ssh/config')
  const aliases = await configAliases(configPath, home)
  const result: ImportedHost[] = new Array(aliases.length)
  let next = 0
  const resolver =
    options.resolveHost ||
    (async (name: string) => {
      const args = options.configPath
        ? ['-F', resolve(configPath), '-G', name]
        : ['-G', name]
      return (await exec('ssh', args, { timeout: 5000, maxBuffer: 256 * 1024 }))
        .stdout
    })
  await Promise.all(
    Array.from({ length: Math.min(4, aliases.length) }, async () => {
      while (next < aliases.length) {
        const index = next++,
          name = aliases[index]
        try {
          result[index] = await resolveImportedHost(
            name,
            await resolver(name),
            home
          )
        } catch {
          result[index] = {
            name,
            hostname: name,
            port: 22,
            username: '',
            privateKeyPath: '',
            auth: 'agent',
            proxyJump: '',
            error: '配置解析失败',
            warning: '无法解析此主机的 SSH 配置，请检查配置后刷新，或手动添加。'
          }
        }
      }
    })
  )
  return result
}
