import { lookup } from 'node:dns/promises'
import { connect, isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
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
export async function dialPublic(
  url: URL,
  resolveProxy?: (url: string) => Promise<string>,
  resolveHost = lookup
): Promise<Duplex> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const proxyRules = resolveProxy ? await resolveProxy(url.href) : 'DIRECT'
  const route = proxyRules.split(';')[0].trim()
  const proxyMatch = /^(PROXY|HTTPS)\s+(.+)$/i.exec(route)
  if (route !== 'DIRECT' && !proxyMatch)
    throw new Error(`Unsupported system proxy route: ${route}`)
  const addresses = await resolveHost(hostname, { all: true })
  // Fake-IP DNS is meaningful only through the user's configured proxy.
  // Never allow these addresses for direct connections or IP-literal URLs.
  const proxyFakeIp = (address: string): boolean =>
    Boolean(proxyMatch && !isIP(hostname) && /^198\.(18|19)\./.test(address))
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => !isPublicAddress(address) && !proxyFakeIp(address)
    )
  )
    throw new Error('External resources must use public addresses')
  const port = Number(
    url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80)
  )
  if (proxyMatch)
    return dialSystemProxy(proxyMatch[1], proxyMatch[2], hostname, port)
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

// CONNECT preserves end-to-end TLS in Chromium and lets the system proxy
// resolve destination names. Portico's internal proxy credentials stay local.
async function dialSystemProxy(
  kind: string,
  endpoint: string,
  hostname: string,
  port: number
): Promise<Duplex> {
  const proxy = new URL(
    `${kind.toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${endpoint}`
  )
  const authority = `${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
  return new Promise((resolve, reject) => {
    const request = (proxy.protocol === 'https:' ? https : http).request({
      hostname: proxy.hostname.replace(/^\[|\]$/g, ''),
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority },
      agent: false
    })
    const timer = setTimeout(
      () => request.destroy(new Error('System proxy connection timed out')),
      15000
    )
    request.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.once('connect', (response, socket, head) => {
      clearTimeout(timer)
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(
          new Error(`System proxy CONNECT failed: HTTP ${response.statusCode}`)
        )
        return
      }
      if (head.length) socket.unshift(head)
      resolve(socket)
    })
    request.end()
  })
}
