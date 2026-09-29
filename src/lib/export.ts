/**
 * 把布局结果栅格化为 RGBA 位图，并生成导出 JSON。
 *
 * 关键约束：PNG 与位置 JSON 必须来自同一次排版结果——
 * buildExportSnapshot 只接收一个 Layout，raster 与 json 都由它派生，
 * 调用方应在同一次点击/同一快照上分别编码 PNG 和落盘 JSON。
 */
import type { ExportSnapshot, Layout, Raster } from './types'

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function rasterize(
  layout: Layout,
  glyphRows: Map<string, number[][]>,
): Raster {
  const { canvasWidth: width, canvasHeight: height } = layout
  // 白底不透明；黑像素位置按来源字出现序号取色，同位置被多字黑像素覆盖
  // 时按后放置者着色（布局算法保证该情形不会发生：黑像素不允许重合）。
  const data = new Uint8Array(width * height * 4).fill(255)

  for (const p of layout.placed) {
    const rows = glyphRows.get(p.char)
    if (!rows) continue
    const [rr, gg, bb] = hexToRgb(layout.palette[p.index])
    for (let r = 0; r < p.height; r++) {
      for (let c = 0; c < p.width; c++) {
        if (!rows[r][c]) continue // 空白像素允许互相覆盖，不产生颜色。
        const gx = p.x + c
        const gy = p.y + r
        const o = (gy * width + gx) * 4
        data[o] = rr
        data[o + 1] = gg
        data[o + 2] = bb
        data[o + 3] = 255
      }
    }
  }
  return { width, height, data }
}

export function buildExportSnapshot(
  layout: Layout,
  glyphRows: Map<string, number[][]>,
): ExportSnapshot {
  return { layout, raster: rasterize(layout, glyphRows) }
}

export interface PositionJson {
  text: string
  pageHeight: number
  maxWidth: number | null
  positions: Array<{
    index: number
    char: string
    x: number
    y: number
    width: number
    height: number
    color: string
  }>
  bbox:
    | { minX: number; minY: number; maxX: number; maxY: number }
    | 'EMPTY'
  canvas: { width: number; height: number }
}

export function layoutToJson(layout: Layout): PositionJson {
  return {
    text: layout.text,
    pageHeight: layout.pageHeight,
    maxWidth: Number.isFinite(layout.maxWidth) ? layout.maxWidth : null,
    positions: layout.placed.map((p) => ({
      index: p.index,
      char: p.char,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      color: layout.palette[p.index],
    })),
    bbox: layout.bbox === null ? 'EMPTY' : layout.bbox,
    canvas: { width: layout.canvasWidth, height: layout.canvasHeight },
  }
}
