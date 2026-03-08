/**
 * ZIP archive builder — single-file ZIP creation for project export.
 *
 * Uses DEFLATE compression via Node.js built-in `zlib`.
 * No external dependencies needed.
 *
 * Extracted from ipc-project.ts (T1131) to keep file size under 400 lines.
 *
 * @module ipc-project-zip
 */
import { deflateRawSync } from 'zlib'

/**
 * Compute CRC-32 of a buffer (standard ZIP CRC polynomial).
 * @internal
 */
function computeCrc32(data: Buffer): number {
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

/**
 * Build a minimal ZIP archive containing a single file.
 * Uses DEFLATE compression via Node.js built-in `zlib`.
 */
export function buildSingleFileZip(filename: string, data: Buffer): Buffer {
  const filenameBytes = Buffer.from(filename, 'utf8')
  const compressed = deflateRawSync(data)
  const crc = computeCrc32(data)
  const now = new Date()
  const dosTime = (now.getSeconds() >> 1) | (now.getMinutes() << 5) | (now.getHours() << 11)
  const dosDate = now.getDate() | ((now.getMonth() + 1) << 5) | ((now.getFullYear() - 1980) << 9)

  const localHeader = Buffer.alloc(30 + filenameBytes.length)
  localHeader.writeUInt32LE(0x04034b50, 0)       // local file header signature
  localHeader.writeUInt16LE(20, 4)               // version needed
  localHeader.writeUInt16LE(0, 6)                // general purpose flags
  localHeader.writeUInt16LE(8, 8)                // compression method: deflate
  localHeader.writeUInt16LE(dosTime, 10)
  localHeader.writeUInt16LE(dosDate, 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(compressed.length, 18)
  localHeader.writeUInt32LE(data.length, 22)
  localHeader.writeUInt16LE(filenameBytes.length, 26)
  localHeader.writeUInt16LE(0, 28)               // extra field length
  filenameBytes.copy(localHeader, 30)

  const centralDirOffset = localHeader.length + compressed.length

  const centralHeader = Buffer.alloc(46 + filenameBytes.length)
  centralHeader.writeUInt32LE(0x02014b50, 0)     // central dir signature
  centralHeader.writeUInt16LE(20, 4)             // version made by
  centralHeader.writeUInt16LE(20, 6)             // version needed
  centralHeader.writeUInt16LE(0, 8)              // general purpose flags
  centralHeader.writeUInt16LE(8, 10)             // compression method
  centralHeader.writeUInt16LE(dosTime, 12)
  centralHeader.writeUInt16LE(dosDate, 14)
  centralHeader.writeUInt32LE(crc, 16)
  centralHeader.writeUInt32LE(compressed.length, 20)
  centralHeader.writeUInt32LE(data.length, 24)
  centralHeader.writeUInt16LE(filenameBytes.length, 28)
  centralHeader.writeUInt16LE(0, 30)             // extra field length
  centralHeader.writeUInt16LE(0, 32)             // file comment length
  centralHeader.writeUInt16LE(0, 34)             // disk number start
  centralHeader.writeUInt16LE(0, 36)             // internal file attributes
  centralHeader.writeUInt32LE(0, 38)             // external file attributes
  centralHeader.writeUInt32LE(0, 42)             // relative offset of local header
  filenameBytes.copy(centralHeader, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)              // end of central dir signature
  eocd.writeUInt16LE(0, 4)                       // disk number
  eocd.writeUInt16LE(0, 6)                       // disk with central dir
  eocd.writeUInt16LE(1, 8)                       // entries on this disk
  eocd.writeUInt16LE(1, 10)                      // total entries
  eocd.writeUInt32LE(centralHeader.length, 12)   // size of central dir
  eocd.writeUInt32LE(centralDirOffset, 16)       // offset of central dir
  eocd.writeUInt16LE(0, 20)                      // comment length

  return Buffer.concat([localHeader, compressed, centralHeader, eocd])
}
