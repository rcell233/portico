import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const source = new URL('../resources/icon.svg', import.meta.url)
const root = new URL('../resources/', import.meta.url)
await mkdir(root, { recursive: true })
await sharp(await readFile(source))
  .resize(1024)
  .png()
  .toFile(new URL('icon.png', root).pathname)
// ICNS supports PNG payloads; include Retina sizes for macOS Finder and Dock.
const chunks = []
for (const [kind, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024]
]) {
  const png = await sharp(await readFile(source))
    .resize(size)
    .png()
    .toBuffer()
  const head = Buffer.alloc(8)
  head.write(kind)
  head.writeUInt32BE(png.length + 8, 4)
  chunks.push(head, png)
}
const header = Buffer.alloc(8)
header.write('icns')
header.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
await writeFile(new URL('icon.icns', root), Buffer.concat([header, ...chunks]))
const png = await sharp(await readFile(source))
  .resize(256)
  .png()
  .toBuffer()
const ico = Buffer.alloc(22)
ico.writeUInt16LE(1, 2)
ico.writeUInt16LE(1, 4)
ico.writeUInt16LE(1, 10)
ico.writeUInt16LE(32, 12)
ico.writeUInt32LE(png.length, 14)
ico.writeUInt32LE(22, 18)
await writeFile(new URL('icon.ico', root), Buffer.concat([ico, png]))
console.log('Generated PNG, ICNS and ICO from resources/icon.svg')
