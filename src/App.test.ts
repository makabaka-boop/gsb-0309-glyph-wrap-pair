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
    // 4 个字符实例的位置列表（换行不产生条目）。
    expect(result!.querySelectorAll('.positions > li').length).toBe(4)
    // 每个视觉行内 x 从 0 开始且严格递增。默认页 A 宽 7、B 宽 5、行宽 16：
    // A 与 B 不碰撞且外框 7+5=12≤16 → AB 同行（x=0,7）；下一个 A 起每行放不下。
    const ys = Array.from(
      result!.querySelectorAll<HTMLElement>('.positions > li'),
    ).map((li) => Number(li.textContent!.match(/y=(-?\d+)/)![1]))
    const xs = Array.from(
      result!.querySelectorAll<HTMLElement>('.positions > li'),
    ).map((li) => Number(li.textContent!.match(/x=(-?\d+)/)![1]))
    expect(xs).toEqual([0, 7, 0, 7])
    expect(ys).toEqual([0, 0, 9, 9]) // 行0 两字，行1 两字
    // canvas 已按 16× 缩放绘制：2 视觉行 + 1 空白行 = 17 高。
    const canvas = result!.querySelector('canvas')!
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBe(17 * 16)

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
