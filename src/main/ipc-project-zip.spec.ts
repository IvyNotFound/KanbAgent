/**
 * Tests for ipc-project-zip.ts — buildSingleFileZip + computeCrc32 (T1951)
 *
 * All functions are pure (no I/O), no mocks needed.
 * computeCrc32 is internal — tested indirectly via the CRC field in ZIP headers.
 */

import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'zlib'
import { buildSingleFileZip } from './ipc-project-zip'

// ── Reference CRC-32 implementation (mirrors source logic) ───────────────────

function refCrc32(data: Buffer): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILENAME = 'test.txt'
const CONTENT = Buffer.from('Hello, ZIP world!')

function buildZip(filename = FILENAME, data = CONTENT) {
  return buildSingleFileZip(filename, data)
}

/** Offset of the central directory record derived from the EOCD. */
function centralDirOffset(zip: Buffer): number {
  return zip.readUInt32LE(zip.length - 6) // EOCD offset 16 = zip.length - 22 + 16
}

// ── computeCrc32 (via ZIP header) ─────────────────────────────────────────────

describe('computeCrc32 (indirectly via ZIP local header)', () => {
  it('returns 0x00000000 for empty buffer', () => {
    const zip = buildSingleFileZip('empty.txt', Buffer.alloc(0))
    expect(zip.readUInt32LE(14)).toBe(0x00000000)
  })

  it('matches reference CRC for known content', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(14)).toBe(refCrc32(CONTENT))
  })

  it('CRC in local header matches CRC in central directory header', () => {
    const zip = buildZip()
    const crcLocal = zip.readUInt32LE(14)
    const crcCentral = zip.readUInt32LE(centralDirOffset(zip) + 16)
    expect(crcLocal).toBe(crcCentral)
  })
})

// ── buildSingleFileZip — magic bytes / signatures ─────────────────────────────

describe('buildSingleFileZip — ZIP signatures', () => {
  it('starts with local file header signature 0x04034b50', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  })

  it('contains central directory header signature 0x02014b50', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(centralDirOffset(zip))).toBe(0x02014b50)
  })

  it('ends with End-of-Central-Directory Record signature 0x06054b50', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
  })
})

// ── buildSingleFileZip — compressed data ─────────────────────────────────────

describe('buildSingleFileZip — DEFLATE data', () => {
  it('compressed data is decompressable and equals original content', () => {
    const zip = buildZip()
    const filenameLen = Buffer.from(FILENAME, 'utf8').length
    const localHeaderSize = 30 + filenameLen
    const compressedSize = zip.readUInt32LE(18)
    const compressedData = zip.subarray(localHeaderSize, localHeaderSize + compressedSize)
    const decompressed = inflateRawSync(compressedData)
    expect(decompressed).toEqual(CONTENT)
  })

  it('compressed size in local header equals actual compressed data length', () => {
    const zip = buildZip()
    const filenameLen = Buffer.from(FILENAME, 'utf8').length
    const localHeaderSize = 30 + filenameLen
    const compressedSizeInHeader = zip.readUInt32LE(18)
    // Actual compressed block = between end of local header and start of central dir
    const actualCompressedSize = centralDirOffset(zip) - localHeaderSize
    expect(compressedSizeInHeader).toBe(actualCompressedSize)
  })
})

// ── buildSingleFileZip — size fields ─────────────────────────────────────────

describe('buildSingleFileZip — size fields', () => {
  it('uncompressed size in local header matches original data length', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(22)).toBe(CONTENT.length)
  })

  it('uncompressed size in central dir header matches original data length', () => {
    const zip = buildZip()
    expect(zip.readUInt32LE(centralDirOffset(zip) + 24)).toBe(CONTENT.length)
  })
})

// ── buildSingleFileZip — filename encoding ────────────────────────────────────

describe('buildSingleFileZip — filename encoding', () => {
  it('encodes ASCII filename as UTF-8 in local header', () => {
    const zip = buildZip()
    const filenameBytes = Buffer.from(FILENAME, 'utf8')
    expect(zip.subarray(30, 30 + filenameBytes.length)).toEqual(filenameBytes)
  })

  it('stores correct filename byte-length in local header', () => {
    const zip = buildZip()
    const filenameBytes = Buffer.from(FILENAME, 'utf8')
    expect(zip.readUInt16LE(26)).toBe(filenameBytes.length)
  })

  it('handles multibyte UTF-8 filename correctly', () => {
    const utf8Name = 'données.txt'
    const zip = buildZip(utf8Name)
    const filenameBytes = Buffer.from(utf8Name, 'utf8')
    expect(zip.readUInt16LE(26)).toBe(filenameBytes.length)
    expect(zip.subarray(30, 30 + filenameBytes.length)).toEqual(filenameBytes)
  })

  it('encodes filename consistently in both local and central dir headers', () => {
    const zip = buildZip()
    const filenameBytes = Buffer.from(FILENAME, 'utf8')
    const localName = zip.subarray(30, 30 + filenameBytes.length)
    const centralDir = centralDirOffset(zip)
    const centralName = zip.subarray(centralDir + 46, centralDir + 46 + filenameBytes.length)
    expect(localName).toEqual(centralName)
  })
})
