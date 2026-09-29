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
    // 4 个字符实例的位置列表。
    expect(result!.querySelectorAll('.positions > li').length).toBe(4)
    // 位置严格递增。
    const xs = Array.from(
      result!.querySelectorAll<HTMLElement>('.positions > li'),
    ).map((li) => Number(li.textContent!.match(/x=(-?\d+)/)![1]))
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    expect(xs[0]).toBe(0)
    // canvas 已按 16× 缩放绘制。
    const canvas = result!.querySelector('canvas')!
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBe(8 * 16) // 页面高度 8

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
