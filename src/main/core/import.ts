import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ImportedHost } from '../../shared/api'
const exec = promisify(execFile)
export async function importSshConfig(): Promise<ImportedHost[]> {
  const path = join(homedir(), '.ssh/config')
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch {
    throw new Error('未找到 ~/.ssh/config')
  }
  const aliases = [
    ...new Set(
      source
        .split('\n')
        .flatMap(
          (line) =>
            line.match(/^\s*Host\s+(.+?)(?:\s*#.*)?$/i)?.[1].split(/\s+/) ?? []
        )
        .filter(
          (alias) => /^[A-Za-z0-9_.-]+$/.test(alias) && !alias.startsWith('-')
        )
    )
  ]
  const result: ImportedHost[] = []
  for (const name of aliases.slice(0, 100)) {
    const { stdout } = await exec('ssh', ['-G', name], {
      timeout: 5000,
      maxBuffer: 256 * 1024
    })
    const fields = new Map(
      stdout.split('\n').map((line) => {
        const index = line.indexOf(' ')
        return [line.slice(0, index), line.slice(index + 1)]
      })
    )
    result.push({
      name,
      hostname: fields.get('hostname') || name,
      port: Number(fields.get('port') || 22),
      username: fields.get('user') || '',
      privateKeyPath: (fields.get('identityfile') || '').replace(
        /^~(?=\/)/,
        homedir()
      ),
      warning:
        fields.has('proxyjump') || fields.has('proxycommand')
          ? '此配置使用跳板或代理；请导入后手动选择已保存的跳板主机。'
          : ''
    })
  }
  return result
}
