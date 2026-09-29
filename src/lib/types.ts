/**
 * 字形页面数据模型与布局结果类型（全部为可序列化的纯数据）。
 *
 * 字形内部约定：
 * - rows[r][c] 为 1 表示黑像素，0 表示空白像素。
 * - 位图每行长度必须等于 width，行数必须等于 height，尺寸均在 1~32。
 * - 整页所有字形必须同高（page.height === glyph.height）。
 */

export interface Glyph {
  /** 该字形对应的字符（单个 Unicode 码点）。 */
  char: string
  /** 字形位图宽度，1~32。 */
  width: number
  /** 字形位图高度，1~32，必须等于页面高度。 */
  height: number
  /** 长度为 height、每行长度为 width 的 0/1 数组。 */
  rows: number[][]
}

export interface GlyphPage {
  /** 页面统一高度（所有字形同高），1~32。 */
  height: number
  glyphs: Glyph[]
}

/** 页面/字形非法状态。invalid 为 true 时不允许排版（撤销旧排版）。 */
export interface PageIssue {
  kind:
    | 'glyph-count'
    | 'height'
    | 'glyph-dimensions'
    | 'glyph-shape'
    | 'glyph-pixel'
    | 'duplicate-char'
    | 'empty-char'
    | 'multi-codepoint-char'
  glyphIndex?: number
  message: string
}

export type ComposeErrorKind =
  | 'empty-text'
  | 'text-too-long'
  | 'missing-char'
  | 'invalid-page'

export interface ComposeError {
  kind: ComposeErrorKind
  /** 缺失的字符（kind === 'missing-char' 时给出）。 */
  char?: string
  message: string
  issues?: PageIssue[]
}

export interface BBox {
  /** 黑像素最小/最大 x（闭区间）。 */
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PlacedGlyph {
  /** 在输入串中的序号（从 0 开始），也是标色来源。 */
  index: number
  char: string
  /** 字形左边缘，严格大于前一字左边缘。 */
  x: number
  /** 字形上边缘；同高排版恒为 0。 */
  y: number
  width: number
  height: number
}

export interface LegendItem {
  index: number
  char: string
  x: number
  color: string
}

/** 每个码点最多 80 个字符，因此调色板只需覆盖 80 个颜色。 */
export interface Layout {
  pageHeight: number
  text: string
  /** 按出现顺序放置的字形。 */
  placed: PlacedGlyph[]
  /** 全空（没有任何黑像素）时 bbox 为 null，序列化为 "EMPTY"。 */
  bbox: BBox | null
  /** 合成图画布：y 方向固定为页面高度，x 方向为最小无碰撞延展。 */
  canvasWidth: number
  canvasHeight: number
  /** 与 placed 等长，每字一个 #rrggbb 颜色，按 index 取色。 */
  palette: string[]
  legend: LegendItem[]
}

export interface ComposeResult {
  ok: boolean
  layout?: Layout
  error?: ComposeError
}

/** 导出用 RGBA 合成图：像素按行优先排列，长度为 width*height*4。 */
export interface Raster {
  width: number
  height: number
  /** 背景不透明白(255,255,255,255)；黑像素按来源字颜色着色。 */
  data: Uint8Array
}

export interface ExportSnapshot {
  layout: Layout
  /** 与 layout 同一计算结果栅格化得到，保证 PNG 与 JSON 同源。 */
  raster: Raster
}
