import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/core/store'
import { parseListeners } from '../src/main/core/discovery'
import { appSchema, appUrl } from '../src/main/core/schema'
import { cipher, host, remoteApp } from './fixtures'

test('encrypted persistence, concurrent writes and jump-host cycles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portico-store-'))
  try {
    const store = new Store(directory, cipher)
    await store.load()
    const a = host(),
      b = host()
    b.jumpHostId = a.id
    await store.saveHost(a)
    await store.saveHost(b)
    const app = remoteApp(a.id, 8888)
    app.path = '/lab?token=secret-url'
    app.environment = { SECRET: 'environment-secret' }
    await Promise.all([
      store.saveApp(app),
      store.trust('host:22', 'fingerprint')
    ])
    const bytes = await readFile(join(directory, 'workspace.enc'), 'utf8')
    for (const secret of ['test-secret', 'secret-url', 'environment-secret'])
      assert.equal(bytes.includes(secret), false)
    const restored = new Store(directory, cipher)
    await restored.load()
    assert.equal(restored.apps()[0].path, app.path)
    assert.equal(restored.secret(a.id), 'test-secret')
    await assert.rejects(store.saveHost({ ...a, jumpHostId: b.id }), /循环/)
    await assert.rejects(store.deleteHost(a.id), /应用/)
    await store.deleteApp(app.id)
    await assert.rejects(store.deleteHost(a.id), /跳板/)
    await store.saveHost({ ...a, secret: undefined })
    assert.equal(store.secret(a.id), 'test-secret')
    await store.saveHost({ ...a, auth: 'agent', secret: undefined })
    assert.equal(store.secret(a.id), undefined)
    await writeFile(join(directory, 'workspace.enc'), 'corrupt')
    await assert.rejects(new Store(directory, cipher).load(), /原文件已保留/)
    assert.equal(
      await readFile(join(directory, 'workspace.enc'), 'utf8'),
      'corrupt'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test('listener discovery handles ss, netstat, wildcard, IPv6 and deduplication', () => {
  const rows =
    parseListeners(`LISTEN 0 128 127.0.0.1:6006 0.0.0.0:* users:(("tensorboard",pid=12,fd=3))
LISTEN 0 128 [::]:8888 [::]:*
LISTEN 0 128 0.0.0.0:8888 0.0.0.0:*
tcp 0 0 127.0.0.1:5173 0.0.0.0:* LISTEN 22/node
LISTEN 0 128 0.0.0.0:22 0.0.0.0:*`)
  assert.deepEqual(
    rows.map((row) => row.port),
    [5173, 6006, 8888]
  )
  assert.equal(rows[1].process, 'tensorboard')
  assert.equal(rows[2].hostname, '127.0.0.1')
})
test('reject unsafe or incomplete application configuration', () => {
  const app = remoteApp(randomUUID(), 6006)
  assert.equal(
    appSchema.safeParse({ ...app, path: '//evil.test' }).success,
    false
  )
  assert.equal(appSchema.safeParse({ ...app, autoStart: true }).success, false)
  assert.equal(
    appSchema.safeParse({ ...app, hostname: 'host; touch /tmp/bad' }).success,
    false
  )
  assert.equal(appUrl({ ...app, hostname: '::1' }), 'http://[::1]:6006/')
})
