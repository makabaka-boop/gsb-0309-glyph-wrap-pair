import { describe, expect, it } from 'vitest'
import { mount } from './test/mount'
import App from './App.vue'

describe('App 集成冒烟测试', () => {
  it('挂载后渲染字形卡片、排版面板与初始合成结果', async () => {
    const { app, container } = mount(App)
    // 初始页有 A、B 两个字形卡片。
    expect(container.querySelectorAll('.glyph-card').length).toBe(2)
    // 默认字串 ABAB 尚未排版，无结果区。
    expect(container.querySelector('.result')).toBeNull()

    // 点击“排版”按钮。
    const composeBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.includes('排版'))!
    composeBtn.click()
    await app.nextTick()

    const result = container.querySelector('.result')
    expect(result).not.toBeNull()
    // 4 个字符实例的位置列表（换行符不产生列表项）。
    const items = Array.from(
      result!.querySelectorAll<HTMLElement>('.positions > li'),
    )
    expect(items.length).toBe(4)
    // 同一行内位置严格递增；换行（含自动换行）后 x 从 0 重新开始。
    const positions = items.map((li) => ({
      x: Number(li.textContent!.match(/x=(-?\d+)/)![1]),
      y: Number(li.textContent!.match(/y=(-?\d+)/)![1]),
    }))
    expect(positions[0]).toEqual({ x: 0, y: 0 })
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].y === positions[i - 1].y) {
        expect(positions[i].x).toBeGreaterThan(positions[i - 1].x)
      } else {
        expect(positions[i].x).toBe(0)
      }
    }
    // canvas 已按 16× 缩放绘制，高度覆盖全部行（行间留一空行）。
    const canvas = result!.querySelector('canvas')!
    expect(canvas.width).toBeGreaterThan(0)
    const lineCount = new Set(positions.map((p) => p.y)).size
    expect(canvas.height).toBe((8 * lineCount + (lineCount - 1)) * 16)

    app.unmount()
  })

  it('输入缺失字符时显示错误且撤销旧排版；恢复后可重新排版', async () => {
    const { app, container } = mount(App)
    const clickCompose = async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.includes('排版'))!
        .click()
      await app.nextTick()
    }

    await clickCompose()
    expect(container.querySelector('.result')).not.toBeNull()

    const textarea = container.querySelector('textarea')!
    textarea.value = 'AC'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await app.nextTick()
    await clickCompose()

    expect(container.querySelector('.result')).toBeNull()
    expect(container.querySelector('.error')?.textContent).toContain('缺失字符')

    // 编辑内容仍在（两张卡片、字串仍显示 AC）。
    expect(container.querySelectorAll('.glyph-card').length).toBe(2)
    expect(container.querySelector('textarea')!.value).toBe('AC')

    // 恢复合法字串后重新排版。
    textarea.value = 'AB'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await app.nextTick()
    await clickCompose()
    expect(container.querySelector('.result')).not.toBeNull()

    app.unmount()
  })
})
