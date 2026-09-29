import { createApp, nextTick, type Component } from 'vue'

/**
 * 极简挂载助手（不引入 @vue/test-utils）：
 * vitest 的 jsdom 环境提供 document，直接 createApp 挂载根组件。
 */
export function mount(root: Component) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(root)
  app.mount(container)
  return {
    app: {
      nextTick,
      unmount: () => {
        app.unmount()
        container.remove()
      },
    },
    container,
  }
}
