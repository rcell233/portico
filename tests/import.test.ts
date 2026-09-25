import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  configAliases,
  configWords,
  importSshConfig,
  resolveImportedHost
} from '../src/main/core/import'

test('SSH picker discovers Include hosts, quoted aliases and equals syntax without wildcard entries or cycles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'portico-config-'))
  try {
    await mkdir(join(home, '.ssh/config.d'), { recursive: true })
    const config = join(home, '.ssh/config')
    await writeFile(
      config,
      'Host = "work" work-alias # comment\nHost * !excluded\nInclude "config.d/*.conf"\nHost final\n'
    )
    await writeFile(
      join(home, '.ssh/config.d/a.conf'),
      'Host gpu\nInclude config\n'
    )
    await writeFile(join(home, '.ssh/config.d/b.conf'), 'Host gpu laptop\n')
    assert.deepEqual(await configAliases(config, home), [
      'work',
      'work-alias',
      'gpu',
      'laptop',
      'final'
    ])
    assert.deepEqual(configWords('"path with #hash" abc # ignored'), [
      'path with #hash',
      'abc'
    ])
    assert.deepEqual(
      await importSshConfig({ home, configPath: join(home, 'missing') }),
      []
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
test('SSH import retains the first usable IdentityFile, expands tokens, and does not treat ProxyJump none as a proxy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'portico-identity-'))
  try {
    await mkdir(join(home, '.ssh'))
    const key = join(home, '.ssh/alice-work-key')
    await writeFile(key, 'fixture placeholder, not a private key')
    const result = await resolveImportedHost(
      'work',
      'hostname 192.0.2.1\nuser alice\nport 2222\nidentityfile ~/.ssh/missing\nidentityfile ~/.ssh/%r-%n-key\nidentityfile ~/.ssh/also-missing\nproxyjump none\n',
      home
    )
    assert.equal(result.auth, 'key')
    assert.equal(result.privateKeyPath, key)
    assert.equal(result.port, 2222)
    assert.equal(result.warning, '')
    const missing = await resolveImportedHost(
      'work',
      'user alice\nidentitiesonly yes\nidentityfile ~/.ssh/absent\nproxyjump bastion\n',
      home
    )
    assert.equal(missing.auth, 'key')
    assert.equal(missing.proxyJump, 'bastion')
    assert.match(missing.warning, /未找到/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
test('one broken host does not hide the other selectable hosts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'portico-resolve-'))
  try {
    const configPath = join(home, 'config')
    await writeFile(configPath, 'Host good bad\n')
    const result = await importSshConfig({
      home,
      configPath,
      resolveHost: async (name) => {
        if (name === 'bad') throw new Error('bad config')
        return 'hostname 192.0.2.1\nuser alice\nport 22\n'
      }
    })
    assert.equal(result[0].hostname, '192.0.2.1')
    assert.equal(result[0].error, undefined)
    assert.equal(result[1].error, '配置解析失败')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
test('system ssh resolves defaults from a fixture config without connecting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'portico-openssh-'))
  try {
    const configPath = join(home, 'config')
    await writeFile(
      configPath,
      'Host work\n  HostName 192.0.2.10\n  Port 2222\nHost *\n  User alice\n'
    )
    const result = await importSshConfig({ home, configPath })
    assert.equal(result[0].hostname, '192.0.2.10')
    assert.equal(result[0].username, 'alice')
    assert.equal(result[0].port, 2222)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
