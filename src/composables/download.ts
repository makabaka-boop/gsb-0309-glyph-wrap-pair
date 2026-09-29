import type { ExportSnapshot } from '../lib/types'
import { layoutToJson } from '../lib/export'
import { encodePng } from '../lib/png'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 导出 PNG 与位置 JSON。两者都直接来自同一个 snapshot：
 * snapshot 由一次排版结果栅格化得到，JSON 序列化的 layout
 * 与 PNG 像素严格同源，不可能出现两套位置。
 */
export async function exportSnapshot(snapshot: ExportSnapshot) {
  const png = await encodePng(snapshot.raster)
  triggerDownload(
    new Blob([png as BlobPart], { type: 'image/png' }),
    'glyph-compose.png',
  )
  triggerDownload(
    new Blob([JSON.stringify(layoutToJson(snapshot.layout), null, 2)], {
      type: 'application/json',
    }),
    'glyph-positions.json',
  )
}

/**
 * 用 Canvas 放大绘制合成图供页面预览。像素数据与导出 PNG 完全一致，
 * 只是按 scale 放大便于观察。
 */
export function drawRaster(
  canvas: HTMLCanvasElement,
  snapshot: ExportSnapshot,
  scale: number,
) {
  const { raster } = snapshot
  canvas.width = raster.width * scale
  canvas.height = raster.height * scale
  const out = canvas.getContext('2d')
  // jsdom 等无 canvas 2D 实现的环境：尺寸已设置，绘制直接跳过。
  if (!out) return

  const scaled = document.createElement('canvas')
  scaled.width = raster.width
  scaled.height = raster.height
  const ctx = scaled.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(raster.width, raster.height)
  image.data.set(raster.data)
  ctx.putImageData(image, 0, 0)

  out.imageSmoothingEnabled = false
  out.clearRect(0, 0, canvas.width, canvas.height)
  out.drawImage(scaled, 0, 0, canvas.width, canvas.height)
}
