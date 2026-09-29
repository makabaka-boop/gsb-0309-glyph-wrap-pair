<script setup lang="ts">
import { computed } from 'vue'
import GlyphCard from './components/GlyphCard.vue'
import ComposerPanel from './components/ComposerPanel.vue'
import { useGlyphPage } from './composables/useGlyphPage'
import { validatePage } from './lib/glyph'

const {
  page,
  text,
  maxWidth,
  error,
  snapshot,
  charCount,
  runLayout,
  setText,
  setMaxWidth,
  setHeight,
  addGlyph,
  removeGlyph,
  setChar,
  resizeGlyph,
  togglePixel,
  clearPixels,
  invertPixels,
} = useGlyphPage()

const issues = computed(() => validatePage(page))
const issuesByIndex = computed(() => {
  const map = new Map<number, string[]>()
  for (const issue of issues.value) {
    if (issue.glyphIndex === undefined) continue
    const list = map.get(issue.glyphIndex) ?? []
    list.push(issue.message)
    map.set(issue.glyphIndex, list)
  }
  return map
})
const pageLevelIssues = computed(() =>
  issues.value
    .filter((i) => i.glyphIndex === undefined)
    .map((i) => i.message),
)

const errorIssues = computed(() => error.value?.issues?.map((i) => i.message) ?? [])
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Compose Glyph 离线字形排版</h1>
      <p class="subtitle">
        像素字形按黑像素实际形状紧凑排布：空白凹口可以互相伸入，但同一行内任何两个字的黑像素绝不重合；
        放不下整幅字形外框时自动换到下一行，换行后从 x=0 重新开始，只与<em>同一行</em>已放字形对撞，
        避免第三字撞上第一字的伸出笔画。
      </p>
    </header>

    <main class="layout">
      <div class="editor-pane">
        <div class="page-bar">
          <label>
            页面统一高度
            <input
              type="number"
              min="1"
              max="32"
              :value="page.height"
              @input="setHeight(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <span>字形数 {{ page.glyphs.length }} / 2~40</span>
          <button type="button" @click="addGlyph()">+ 添加字形</button>
        </div>

        <ul v-if="pageLevelIssues.length" class="page-issues">
          <li v-for="(msg, i) in pageLevelIssues" :key="i">{{ msg }}</li>
        </ul>

        <div class="cards">
          <GlyphCard
            v-for="(glyph, i) in page.glyphs"
            :key="i"
            :glyph="glyph"
            :index="i"
            :issues="issuesByIndex.get(i) ?? []"
            @set-char="(v: string) => setChar(i, v)"
            @resize="(w: number) => resizeGlyph(i, w)"
            @toggle="(r: number, c: number) => togglePixel(i, r, c)"
            @clear="clearPixels(i)"
            @invert="invertPixels(i)"
            @remove="removeGlyph(i)"
          />
        </div>
      </div>

      <div class="composer-pane">
        <ComposerPanel
          :text="text"
          :max-width="maxWidth"
          :char-count="charCount"
          :snapshot="snapshot"
          :error-message="error?.message ?? null"
          :error-issues="errorIssues"
          @update:text="setText"
          @update:max-width="setMaxWidth"
          @compose="runLayout"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px 60px;
}
.app-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.subtitle {
  color: #57606a;
  font-size: 13px;
  max-width: 900px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(360px, 1fr);
  gap: 24px;
  align-items: start;
}
.editor-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.page-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(255, 255, 255, 0.95);
  padding: 8px 0;
  border-bottom: 1px solid #d0d7de;
}
.page-bar input {
  width: 64px;
  padding: 3px 6px;
}
.page-bar button {
  margin-left: auto;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #1f6feb;
  color: #1f6feb;
  background: #fff;
  cursor: pointer;
}
.page-issues {
  margin: 0;
  padding-left: 18px;
  color: #cf222e;
  font-size: 13px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
@media (max-width: 980px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
