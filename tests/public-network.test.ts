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
