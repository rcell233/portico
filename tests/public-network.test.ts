import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dialPublic, isPublicAddress } from '../src/main/core/public-network'

test('public resource routing rejects private, loopback and special IPs including mapped IPv6', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.1.1'
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address)
  }
  await assert.rejects(
    dialPublic(new URL('http://127.0.0.1/')),
    /public addresses/
  )
  await assert.rejects(
    dialPublic(new URL('http://localhost/')),
    /public addresses/
  )
})

test('external resources use the system HTTP proxy with Fake-IP DNS and preserve tunnel bytes', async () => {
  const http = await import('node:http')
  const server = http.createServer()
  const destinations: string[] = []
  server.on('connect', (req, socket) => {
    destinations.push(req.url || '')
    assert.equal(req.headers['proxy-authorization'], undefined)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\nhello')
    socket.on('data', (data) => socket.end(data))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  const resolveProxy = async () => `PROXY 127.0.0.1:${port}`
  const fakeLookup = (async () => [
    { address: '198.18.0.120', family: 4 }
  ]) as typeof import('node:dns/promises').lookup
  try {
    const socket = await dialPublic(
      new URL('https://assets.example.test/file.js'),
      resolveProxy,
      fakeLookup
    )
    let received = ''
    const ended = new Promise<void>((resolve, reject) => {
      socket.on('data', (data) => {
        received += data.toString()
      })
      socket.on('end', resolve)
      socket.on('error', reject)
    })
    socket.write('payload')
    await ended
    socket.destroy()
    assert.equal(received, 'hellopayload')
    assert.deepEqual(destinations, ['assets.example.test:443'])
    await assert.rejects(
      dialPublic(
        new URL('https://assets.example.test/'),
        undefined,
        fakeLookup
      ),
      /public addresses/
    )
    await assert.rejects(
      dialPublic(new URL('https://198.18.0.120/'), resolveProxy, fakeLookup),
      /public addresses/
    )
    await assert.rejects(
      dialPublic(new URL('http://127.0.0.1/'), resolveProxy),
      /public addresses/
    )
    assert.equal(destinations.length, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
