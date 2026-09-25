import { lookup } from 'node:dns/promises'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import ipaddr from 'ipaddr.js'

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

// Resolve once and connect to the checked IP, preventing DNS rebinding into
// local/private networks. The configured service has its own SSH-only route.
export async function dialPublic(url: URL): Promise<Duplex> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true })
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error('External resources must use public addresses')
  const port = Number(
    url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80)
  )
  let lastError: unknown
  for (const { address, family } of addresses) {
    try {
      return await new Promise<Duplex>((resolve, reject) => {
        const socket = connect({ host: address, family, port })
        const timer = setTimeout(
          () =>
            socket.destroy(new Error('External resource connection timed out')),
          15000
        )
        socket.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        socket.once('connect', () => {
          clearTimeout(timer)
          resolve(socket)
        })
      })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
