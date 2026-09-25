import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
const exec = promisify(execFile)

// Finder-launched apps lack the terminal PATH (e.g. Homebrew/conda proxy helpers).
// Read the user's own login shell environment once, without printing its contents.
export async function sshEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return { ...process.env }
  const shell = userInfo().shell || process.env.SHELL || '/bin/sh'
  try {
    const { stdout } = await exec(
      shell,
      ['-ilc', "printf '\\0PORTICO_ENV\\0'; /usr/bin/env -0"],
      {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env
      }
    )
    const marker = '\0PORTICO_ENV\0'
    const start = stdout.indexOf(marker)
    if (start < 0) return { ...process.env }
    const environment = { ...process.env }
    for (const field of stdout.slice(start + marker.length).split('\0')) {
      const equals = field.indexOf('=')
      if (equals > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.slice(0, equals)))
        environment[field.slice(0, equals)] = field.slice(equals + 1)
    }
    return environment
  } catch {
    return { ...process.env }
  }
}
