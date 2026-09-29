import { computed, reactive, ref, shallowRef } from 'vue'
import type {
  ComposeError,
  ExportSnapshot,
  Glyph,
  GlyphPage,
} from '../lib/types'
import { buildExportSnapshot } from '../lib/export'
import { composeLayout } from '../lib/layout'

/** 创建 width×height 全 0 位图。 */
export function emptyRows(width: number, height: number): number[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0),
  )
}

function sampleA(): Glyph {
  // 7×8 的 A
  const P = 1
  const rows = [
    [0, 0, P, P, P, 0, 0],
    [0, P, 0, 0, 0, P, 0],
    [0, P, 0, 0, 0, P, 0],
    [P, 0, 0, 0, 0, 0, P],
    [P, P, P, P, P, P, P],
    [P, 0, 0, 0, 0, 0, P],
    [P, 0, 0, 0, 0, 0, P],
    [P, 0, 0, 0, 0, 0, P],
  ]
  return { char: 'A', width: 7, height: 8, rows }
}

function sampleB(): Glyph {
  // 5×8 的 B（宽度与 A 不同，演示按外框排版的缝隙问题）
  const P = 1
  const rows = [
    [P, P, P, P, 0],
    [P, 0, 0, 0, P],
    [P, 0, 0, 0, P],
    [P, 0, 0, 0, P],
    [P, P, P, P, 0],
    [P, 0, 0, 0, P],
    [P, 0, 0, 0, P],
    [P, P, P, P, 0],
  ]
  return { char: 'B', width: 5, height: 8, rows }
}

function initialPage(): GlyphPage {
  return reactive<GlyphPage>({ height: 8, glyphs: [sampleA(), sampleB()] })
}

/**
 * 单例页面状态。
 *
 * 关键交互语义：任何编辑（改字符/位图/尺寸、加字、删字）都会清空
 * layout 与 snapshot——编辑内容本身完整保留，但旧排版立即撤销，
 * 直到用户再次点击“排版”。排版失败（缺字/非法位图）同样只清空旧排版。
 */
const page = initialPage()
const text = ref('ABAB')
const maxWidth = ref(16)
const error = ref<ComposeError | null>(null)
const layout = shallowRef<ExportSnapshot['layout'] | null>(null)
const snapshot = shallowRef<ExportSnapshot | null>(null)

export function useGlyphPage() {
  function invalidate() {
    layout.value = null
    snapshot.value = null
    error.value = null
  }

  function runLayout() {
    const result = composeLayout(page, text.value, maxWidth.value)
    if (result.ok && result.layout) {
      const rowsMap = new Map(page.glyphs.map((g) => [g.char, g.rows]))
      layout.value = result.layout
      // PNG 与 JSON 的共同来源：同一次 layout 计算出的快照。
      snapshot.value = buildExportSnapshot(result.layout, rowsMap)
      error.value = null
    } else {
      // 保留当前编辑内容，仅撤销旧排版。
      layout.value = null
      snapshot.value = null
      error.value = result.error ?? null
    }
  }

  function setText(value: string) {
    text.value = value
    invalidate()
  }

  function setMaxWidth(value: number) {
    maxWidth.value = Math.min(128, Math.max(8, Math.round(value)))
    invalidate()
  }

  function setHeight(h: number) {
    page.height = h
    invalidate()
  }

  function addGlyph(char = '') {
    page.glyphs.push({
      char,
      width: Math.min(page.height, 8) || 1,
      height: page.height,
      rows: emptyRows(Math.min(page.height, 8) || 1, page.height),
    })
    invalidate()
  }

  function removeGlyph(index: number) {
    page.glyphs.splice(index, 1)
    invalidate()
  }

  function setChar(index: number, char: string) {
    page.glyphs[index].char = char
    invalidate()
  }

  /**
   * 调整字形尺寸。高度始终跟随页面高度（保证同高约束）；
   * 宽度变化时保留左上角重叠区域内容，新增像素为 0。
   */
  function resizeGlyph(index: number, width: number) {
    const g = page.glyphs[index]
    width = Math.max(1, Math.min(32, Math.round(width)))
    if (width === g.width) return
    const next = emptyRows(width, g.height)
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < Math.min(width, g.width); c++) {
        next[r][c] = g.rows[r][c]
      }
    }
    g.width = width
    g.rows = next
    invalidate()
  }

  function syncGlyphHeights() {
    // 高度非法时只让校验报错，绝不用非法长度重建位图，避免误删像素行。
    if (
      !Number.isInteger(page.height) ||
      page.height < 1 ||
      page.height > 32
    ) {
      invalidate()
      return
    }
    for (const g of page.glyphs) {
      if (g.height !== page.height) {
        const next = emptyRows(g.width, page.height)
        for (let r = 0; r < Math.min(page.height, g.height); r++) {
          for (let c = 0; c < g.width; c++) next[r][c] = g.rows[r][c]
        }
        g.height = page.height
        g.rows = next
      }
    }
    invalidate()
  }

  function togglePixel(index: number, r: number, c: number) {
    const g = page.glyphs[index]
    g.rows[r][c] = g.rows[r][c] ? 0 : 1
    invalidate()
  }

  function clearPixels(index: number) {
    const g = page.glyphs[index]
    g.rows = emptyRows(g.width, g.height)
    invalidate()
  }

  function invertPixels(index: number) {
    const g = page.glyphs[index]
    g.rows = g.rows.map((row) => row.map((v) => (v ? 0 : 1)))
    invalidate()
  }

  const charCount = computed(() => Array.from(text.value).length)

  return {
    page,
    text,
    maxWidth,
    error,
    layout,
    snapshot,
    charCount,
    runLayout,
    setText,
    setMaxWidth,
    setHeight: (h: number) => {
      setHeight(h)
      syncGlyphHeights()
    },
    addGlyph,
    removeGlyph,
    setChar,
    resizeGlyph,
    togglePixel,
    clearPixels,
    invertPixels,
  }
}
