import type { Glyph, GlyphPage, PageIssue } from './types'

/** 把字形位图转换成每行一个 32 位整数（位 0 = 最左列）。 */
export function rowMasks(glyph: Glyph): Uint32Array {
  const masks = new Uint32Array(glyph.height)
  for (let r = 0; r < glyph.height; r++) {
    let mask = 0
    const row = glyph.rows[r]
    for (let c = 0; c < glyph.width; c++) {
      if (row[c]) mask |= 1 << c
    }
    masks[r] = mask >>> 0
  }
  return masks
}

function issue(
  kind: PageIssue['kind'],
  message: string,
  glyphIndex?: number,
): PageIssue {
  return { kind, message, glyphIndex }
}

/** 单个字形合法性：字符单码点、尺寸 1~32、位图形状与像素值合法。 */
export function validateGlyph(glyph: Glyph, index: number): PageIssue[] {
  const issues: PageIssue[] = []
  const chars = Array.from(glyph.char)
  if (chars.length === 0) {
    issues.push(issue('empty-char', `第 ${index + 1} 个字形缺少字符`, index))
  } else if (chars.length > 1) {
    issues.push(
      issue(
        'multi-codepoint-char',
        `第 ${index + 1} 个字形的字符 "${glyph.char}" 不是单个码点`,
        index,
      ),
    )
  }

  if (
    !Number.isInteger(glyph.width) ||
    !Number.isInteger(glyph.height) ||
    glyph.width < 1 ||
    glyph.width > 32 ||
    glyph.height < 1 ||
    glyph.height > 32
  ) {
    issues.push(
      issue(
        'glyph-dimensions',
        `字符 "${glyph.char}" 的宽高必须为 1~32 的整数（当前 ${glyph.width}×${glyph.height}）`,
        index,
      ),
    )
    // 尺寸非法时形状检查没有意义。
    return issues
  }

  if (
    !Array.isArray(glyph.rows) ||
    glyph.rows.length !== glyph.height ||
    glyph.rows.some((row) => !Array.isArray(row) || row.length !== glyph.width)
  ) {
    issues.push(
      issue(
        'glyph-shape',
        `字符 "${glyph.char}" 的位图不是 ${glyph.width}×${glyph.height} 的二维数组`,
        index,
      ),
    )
    return issues
  }

  for (let r = 0; r < glyph.height; r++) {
    for (let c = 0; c < glyph.width; c++) {
      const v = glyph.rows[r][c]
      if (v !== 0 && v !== 1) {
        issues.push(
          issue(
            'glyph-pixel',
            `字符 "${glyph.char}" 的位图只允许 0/1（第 ${r + 1} 行第 ${c + 1} 列为 ${String(v)}）`,
            index,
          ),
        )
        return issues
      }
    }
  }
  return issues
}

/**
 * 校验整个字形页。任何问题都会阻止排版；返回全部问题以便编辑器展示。
 * 同高是页面排版的硬约束。
 */
export function validatePage(page: GlyphPage): PageIssue[] {
  const issues: PageIssue[] = []

  if (
    !Number.isInteger(page.height) ||
    page.height < 1 ||
    page.height > 32
  ) {
    issues.push(issue('height', `页面高度必须为 1~32 的整数（当前 ${page.height}）`))
  }

  if (page.glyphs.length < 2 || page.glyphs.length > 40) {
    issues.push(
      issue(
        'glyph-count',
        `字形数量必须在 2~40 之间（当前 ${page.glyphs.length}）`,
      ),
    )
  }

  const seen = new Map<string, number>()
  page.glyphs.forEach((glyph, i) => {
    for (const problem of validateGlyph(glyph, i)) issues.push(problem)

    const chars = Array.from(glyph.char)
    if (chars.length === 1) {
      const prev = seen.get(glyph.char)
      if (prev !== undefined) {
        issues.push(
          issue(
            'duplicate-char',
            `字符 "${glyph.char}" 被第 ${prev + 1} 个与第 ${i + 1} 个字形重复定义`,
            i,
          ),
        )
      } else {
        seen.set(glyph.char, i)
      }
    }

    if (
      Number.isInteger(page.height) &&
      page.height >= 1 &&
      page.height <= 32 &&
      Number.isInteger(glyph.height) &&
      glyph.height >= 1 &&
      glyph.height <= 32 &&
      glyph.height !== page.height
    ) {
      issues.push(
        issue(
          'glyph-dimensions',
          `字符 "${glyph.char}" 高度 ${glyph.height} 与页面高度 ${page.height} 不一致`,
          i,
        ),
      )
    }
  })

  return issues
}
