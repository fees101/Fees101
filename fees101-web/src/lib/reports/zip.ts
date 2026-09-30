// Minimal, dependency-free ZIP writer (STORE method — no compression).
//
// We deliberately avoid pulling in a zip dependency (jszip/archiver): the dev
// environment here has a finicky package registry, and a school-data export is
// a handful of small CSVs where compression buys little. A STORE-only archive
// is a well-specified, ~100-line format that every unzip tool (Finder, Windows
// Explorer, `unzip`) opens natively.
//
// Spec: PKWARE APPNOTE .ZIP File Format — local file header (0x04034b50),
// central directory header (0x02014b50), end-of-central-directory (0x06054b50).
// We keep it to what's needed: STORE, no data descriptor, UTF-8 filenames.

// CRC-32 (IEEE 802.3), table-driven. Required by the ZIP spec per entry.
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** File name inside the archive, e.g. "students.csv". */
  name: string
  /** File contents. */
  data: Uint8Array
}

/**
 * Build a ZIP archive (STORE method) from the given entries.
 * Returns the raw archive bytes, ready to stream as application/zip.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  // DOS date/time is intentionally fixed. Date.now()/new Date() are unavailable
  // in some execution contexts and a stable timestamp keeps exports byte-stable;
  // the archive's own metadata timestamp carries no product meaning.
  const dosTime = 0
  const dosDate = 0x21 // 1980-01-01, the ZIP epoch

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    // ---- Local file header ----
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags: bit 11 = UTF-8 filename
    lv.setUint16(8, 0, true) // method: 0 = STORE
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // compressed size (== uncompressed for STORE)
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra field length
    local.set(nameBytes, 30)

    chunks.push(local, entry.data)

    // ---- Central directory header (buffered, appended at the end) ----
    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true) // flags: UTF-8
    cv.setUint16(10, 0, true) // method: STORE
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra field length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += local.length + entry.data.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const cd of central) {
    chunks.push(cd)
    centralSize += cd.length
  }

  // ---- End of central directory ----
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // disk with central dir
  ev.setUint16(8, entries.length, true) // entries on this disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralStart, true)
  ev.setUint16(20, 0, true) // comment length
  chunks.push(eocd)

  // Concatenate.
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
