import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const iconsDir = path.join(publicDir, 'icons')
const source = await readFile(path.join(publicDir, 'favicon.svg'))
const background = '#111411'

await mkdir(iconsDir, { recursive: true })

function render(size) {
  return sharp(source, { density: 300 }).resize(size, size)
}

// The maskable version has a full-bleed background and extra room around the
// board and dart so circular and rounded-square launchers won't clip the art.
const maskableArtwork = await render(448).png().toBuffer()
const output = [
  ['icon-192.png', render(192)],
  ['icon-512.png', render(512)],
  ['apple-touch-icon.png', render(180).flatten({ background })],
  ['favicon-32.png', render(32)],
  ['favicon-16.png', render(16)],
  ['icon-maskable-512.png', sharp({ create: { width: 512, height: 512, channels: 3, background } })
    .composite([{ input: maskableArtwork, gravity: 'centre' }]).removeAlpha()],
]

await Promise.all(output.map(([file, image]) => image.png({ compressionLevel: 9 }).toFile(path.join(iconsDir, file))))

console.log('Icons generated in public/icons')
