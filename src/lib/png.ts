/**
 * 最小 PNG 编码器（RGBA，8-bit，filter 仅用 None，zlib 由
 * CompressionStream('deflate') 提供）。浏览器与 Node ≥18 均内置该 API，
 * 因此导出 PNG 不引入任何第三方依赖。
 *
 * 测试侧 decodePng 只需支持本编码器写出的 filter-0 数据流。
 */
import type { Raster } from './types'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): Uint8Array {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  c = (c ^ 0xffffffff) >>> 0
  return new Uint8Array([
    (c >>> 24) & 255,
    (c >>> 16) & 255,
    (c >>> 8) & 255,
    c & 255,
  ])
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ])
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(12 + body.length)
  out.set(u32be(body.length), 0)
  out.set(typeBytes, 4)
  out.set(body, 8)
  out.set(crc32(new Uint8Array([...typeBytes, ...body])), 8 + body.length)
  return out
}

async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate')
  const writer = stream.writable.getWriter()
  // 不 await，避免大块时背压死锁；写完后再读。
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

export async function encodePng(raster: Raster): Promise<Uint8Array> {
  const { width, height, data } = raster
  const ihdr = new Uint8Array(13)
  ihdr.set(u32be(width), 0)
  ihdr.set(u32be(height), 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }

  const idatBody = await zlibDeflate(raw)
  const total =
    PNG_SIGNATURE.length +
    12 + ihdr.length +
    12 + idatBody.length +
    12 // IEND
  const out = new Uint8Array(total)
  let offset = 0
  out.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  out.set(chunk('IHDR', ihdr), offset)
  offset += 12 + ihdr.length
  out.set(chunk('IDAT', idatBody), offset)
  offset += 12 + idatBody.length
  out.set(chunk('IEND', new Uint8Array(0)), offset)
  return out
}

async function zlibInflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  void writer.write(bytes)
  void writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

function parseChunks(file: Uint8Array): Map<string, Uint8Array[]> {
  const chunks = new Map<string, Uint8Array[]>()
  let p = 8
  while (p + 8 <= file.length) {
    const len =
      (file[p] << 24 | file[p + 1] << 16 | file[p + 2] << 8 | file[p + 3]) >>>
      0
    const type = new TextDecoder().decode(file.subarray(p + 4, p + 8))
    const body = file.subarray(p + 8, p + 8 + len)
    const list = chunks.get(type) ?? []
    list.push(new Uint8Array(body))
    chunks.set(type, list)
    p += 12 + len
  }
  return chunks
}

/**
 * 测试辅助：解码本编码器产出的 PNG（RGBA / filter None）。
 * 非本工具产出的 PNG 可能使用其他过滤器，这里不实现。
 */
export async function decodePng(file: Uint8Array): Promise<Raster> {
  const chunks = parseChunks(file)
  const ihdr = chunks.get('IHDR')![0]
  const width =
    (ihdr[0] << 24 | ihdr[1] << 16 | ihdr[2] << 8 | ihdr[3]) >>> 0
  const height =
    (ihdr[4] << 24 | ihdr[5] << 16 | ihdr[6] << 8 | ihdr[7]) >>> 0
  const idat = new Uint8Array(
    chunks.get('IDAT')!.reduce((n, c) => n + c.length, 0),
  )
  let off = 0
  for (const c of chunks.get('IDAT')!) {
    idat.set(c, off)
    off += c.length
  }
  const raw = await zlibInflate(idat)
  const stride = width * 4
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter !== 0) {
      throw new Error(`测试解码器仅支持 filter None，遇到 filter ${filter}`)
    }
    data.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    )
  }
  return { width, height, data }
}
