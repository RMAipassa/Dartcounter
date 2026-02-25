#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim()
const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'
const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128'
const baseUrl = process.env.ELEVENLABS_BASE_URL?.trim() || 'https://api.elevenlabs.io'
const langsRaw = process.env.CALLOUT_LANGS?.trim() || 'en'
const langs = langsRaw
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

if (!apiKey || !voiceId) {
  console.error('Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID')
  process.exit(1)
}

const root = process.cwd()
const outRoot = path.join(root, 'web', 'public', 'audio', 'callouts')
fs.mkdirSync(outRoot, { recursive: true })

const packs = {
  en: buildEnglishPack(),
  nl: buildDutchPack(),
  de: buildGermanPack(),
}

for (const lang of langs) {
  const pack = packs[lang]
  if (!pack) {
    console.warn(`Skipping unsupported language: ${lang}`)
    continue
  }
  const dir = path.join(outRoot, lang)
  fs.mkdirSync(dir, { recursive: true })

  const entries = Object.entries(pack)
  console.log(`Generating ${entries.length} clips for ${lang}...`)
  for (const [key, text] of entries) {
    const file = path.join(dir, `${key}.mp3`)
    if (fs.existsSync(file)) {
      continue
    }
    try {
      const audio = await synthesize(text)
      fs.writeFileSync(file, audio)
      process.stdout.write('.')
      await sleep(120)
    } catch (err) {
      console.error(`\nFailed ${lang}/${key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  process.stdout.write('\n')
}

console.log('Done.')

async function synthesize(text) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: outputFormat,
      voice_settings: {
        stability: 0.38,
        similarity_boost: 0.82,
        style: 0.65,
        use_speaker_boost: true,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body}`)
  }

  const arr = await res.arrayBuffer()
  return Buffer.from(arr)
}

function buildEnglishPack() {
  const map = {}
  for (let i = 0; i <= 180; i++) map[`score-${i}`] = String(i)
  map['bust'] = 'Bust.'
  map['game-shot'] = 'Game shot.'
  map['game-shot-match'] = 'Game shot and the match.'
  for (let leg = 1; leg <= 20; leg++) {
    map[`game-shot-leg-${leg}`] = `Game shot and the ${ordinalEn(leg)} leg.`
  }
  return map
}

function buildDutchPack() {
  const map = {}
  for (let i = 0; i <= 180; i++) map[`score-${i}`] = String(i)
  map['bust'] = 'Busted.'
  map['game-shot'] = 'Game shot.'
  map['game-shot-match'] = 'Game shot en de wedstrijd.'
  for (let leg = 1; leg <= 20; leg++) {
    map[`game-shot-leg-${leg}`] = `Game shot en de ${ordinalNl(leg)} leg.`
  }
  return map
}

function buildGermanPack() {
  const map = {}
  for (let i = 0; i <= 180; i++) map[`score-${i}`] = String(i)
  map['bust'] = 'Bust.'
  map['game-shot'] = 'Game shot.'
  map['game-shot-match'] = 'Game shot und das Match.'
  for (let leg = 1; leg <= 20; leg++) {
    map[`game-shot-leg-${leg}`] = `Game shot und das ${ordinalDe(leg)} Leg.`
  }
  return map
}

function ordinalEn(n) {
  const words = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
    14: 'fourteenth',
    15: 'fifteenth',
  }
  if (words[n]) return words[n]
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n}st`
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`
  return `${n}th`
}

function ordinalNl(n) {
  const words = {
    1: 'eerste',
    2: 'tweede',
    3: 'derde',
    4: 'vierde',
    5: 'vijfde',
    6: 'zesde',
    7: 'zevende',
    8: 'achtste',
    9: 'negende',
    10: 'tiende',
  }
  return words[n] || `${n}e`
}

function ordinalDe(n) {
  const words = {
    1: 'erste',
    2: 'zweite',
    3: 'dritte',
    4: 'vierte',
    5: 'fuenfte',
    6: 'sechste',
    7: 'siebte',
    8: 'achte',
    9: 'neunte',
    10: 'zehnte',
  }
  return words[n] || `${n}.`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
