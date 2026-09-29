import { beforeEach, describe, expect, it } from 'vitest'
import { useGlyphPage } from './useGlyphPage'

let store: ReturnType<typeof useGlyphPage>

beforeEach(() => {
  // 模块级单例在同一测试进程内共享：测试间显式恢复到初始状态。
  store = useGlyphPage()
  store.page.height = 8
  store.page.glyphs.splice(0, store.page.glyphs.length)
  store.page.glyphs.push(
    {
      char: 'A',
      width: 2,
      height: 8,
      rows: [
        [1, 0], [1, 0], [1, 0], [1, 1],
        [1, 0], [1, 0], [1, 0], [0, 0],
      ],
    },
    {
      char: 'B',
      width: 2,
      height: 8,
      rows: [
        [1, 1], [1, 0], [1, 0], [1, 1],
        [1, 0], [1, 0], [1, 1], [0, 0],
      ],
    },
  )
  store.setText('AB')
})

describe('useGlyphPage：保留编辑、撤销旧排版', () => {
  it('成功排版后产生快照，PNG/JSON 共享同一 layout', () => {
    store.runLayout()
    expect(store.snapshot.value).not.toBeNull()
    expect(store.error.value).toBeNull()
    expect(store.snapshot.value!.layout).toBe(store.layout.value)
  })

  it('缺失字符：编辑内容保留，旧排版被撤销', () => {
    store.runLayout()
    expect(store.snapshot.value).not.toBeNull()

    store.setText('AX')
    store.runLayout()
    expect(store.error.value?.kind).toBe('missing-char')
    expect(store.snapshot.value).toBeNull()
    expect(store.layout.value).toBeNull()
    // 编辑内容仍在。
    expect(store.page.glyphs).toHaveLength(2)
    expect(store.text.value).toBe('AX')
  })

  it('非法位图：编辑保留、排版撤销，并能在修复后重新排版', () => {
    store.runLayout()
    expect(store.snapshot.value).not.toBeNull()

    // 故意破坏位图形状。
    const g = store.page.glyphs[0]
    g.rows = [[1]]
    store.runLayout()
    expect(store.error.value?.kind).toBe('invalid-page')
    expect(store.snapshot.value).toBeNull()
    // 被破坏的编辑内容原样保留。
    expect(store.page.glyphs[0].rows).toEqual([[1]])

    // 修复（恢复同高 8×2）。
    g.rows = Array.from({ length: 8 }, () => [0, 0])
    g.height = 8
    store.runLayout()
    expect(store.snapshot.value).not.toBeNull()
    expect(store.error.value).toBeNull()
  })

  it('任何编辑动作都会立即撤销旧排版', () => {
    store.runLayout()
    expect(store.snapshot.value).not.toBeNull()

    store.togglePixel(0, 0, 1)
    expect(store.snapshot.value).toBeNull()

    store.runLayout()
    store.resizeGlyph(1, 5)
    expect(store.snapshot.value).toBeNull()

    store.runLayout()
    store.addGlyph('C')
    expect(store.snapshot.value).toBeNull()

    store.runLayout()
    store.removeGlyph(2)
    expect(store.snapshot.value).toBeNull()
  })

  it('改页面高度会同步字形高度并撤销排版', () => {
    store.runLayout()
    store.setHeight(10)
    expect(store.page.glyphs.every((g) => g.height === 10)).toBe(true)
    expect(store.page.glyphs.every((g) => g.rows.length === 10)).toBe(true)
    expect(store.snapshot.value).toBeNull()
  })
})
