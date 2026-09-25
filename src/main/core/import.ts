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
      throw new Error('SSH Include 层级或文件数量过多，请检查 Include 配置')
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
// Metadata is for display only. Connections pass the alias to system OpenSSH.
export function resolveImportedHost(
  name: string,
  output: string
): ImportedHost {
  const fields = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(.*)$/)
    if (match && !fields.has(match[1])) fields.set(match[1], match[2])
  }
  const route =
    fields.get('proxycommand') && fields.get('proxycommand') !== 'none'
      ? 'ProxyCommand · 由系统 SSH 执行'
      : fields.get('proxyjump') && fields.get('proxyjump') !== 'none'
        ? `ProxyJump · ${fields.get('proxyjump')}`
        : ''
  return {
    name,
    hostname: fields.get('hostname') || name,
    port: Number(fields.get('port') || 22),
    username: fields.get('user') || userInfo().username,
    note: route
  }
}
export async function importSshConfig(
  options: {
    env?: NodeJS.ProcessEnv
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
      return (
        await exec(
          process.platform === 'win32' ? 'ssh' : '/usr/bin/ssh',
          args,
          {
            timeout: 5000,
            maxBuffer: 256 * 1024,
            env: options.env || process.env
          }
        )
      ).stdout
    })
  await Promise.all(
    Array.from({ length: Math.min(4, aliases.length) }, async () => {
      while (next < aliases.length) {
        const index = next++,
          name = aliases[index]
        try {
          result[index] = await resolveImportedHost(name, await resolver(name))
        } catch {
          result[index] = {
            name,
            hostname: name,
            port: 22,
            username: userInfo().username,
            note: '暂时无法读取连接摘要；连接时由系统 SSH 解析原配置。'
          }
        }
      }
    })
  )
  return result
}
