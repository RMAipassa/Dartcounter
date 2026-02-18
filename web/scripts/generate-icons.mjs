import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(process.cwd())
const publicDir = path.join(root, 'public')
const iconsDir = path.join(publicDir, 'icons')
const sourceSvg = path.join(publicDir, 'favicon.svg')

if (!fs.existsSync(publicDir)) {
  throw new Error(`public directory not found at ${publicDir}`)
}

if (!fs.existsSync(sourceSvg)) {
  throw new Error(`icon source not found at ${sourceSvg}`)
}

fs.mkdirSync(iconsDir, { recursive: true })

async function writePng(outPath, size) {
  const buf = await fs.promises.readFile(sourceSvg)
  // Render SVG to PNG at exact size
  await sharp(buf, { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(outPath)
}

await writePng(path.join(iconsDir, 'icon-192.png'), 192)
await writePng(path.join(iconsDir, 'icon-512.png'), 512)
await writePng(path.join(iconsDir, 'apple-touch-icon.png'), 180)
await writePng(path.join(iconsDir, 'favicon-32.png'), 32)
await writePng(path.join(iconsDir, 'favicon-16.png'), 16)

console.log('Icons generated in public/icons')
