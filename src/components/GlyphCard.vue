<script setup lang="ts">
import { computed } from 'vue'
import type { Glyph } from '../lib/types'

const props = defineProps<{
  glyph: Glyph
  index: number
  issues: string[]
}>()

const emit = defineEmits<{
  (e: 'set-char', value: string): void
  (e: 'resize', width: number): void
  (e: 'toggle', r: number, c: number): void
  (e: 'clear'): void
  (e: 'invert'): void
  (e: 'remove'): void
}>()

const cell = computed(() => Math.max(8, Math.min(28, Math.floor(560 / props.glyph.width))))
</script>

<template>
  <section class="glyph-card" :class="{ invalid: issues.length > 0 }">
    <header class="glyph-head">
      <label class="char-label">
        字符
        <input
          class="char-input"
          :value="glyph.char"
          maxlength="2"
          @input="emit('set-char', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <span class="dim">{{ glyph.width }}×{{ glyph.height }}</span>
      <button type="button" class="mini" title="清空像素" @click="emit('clear')">清空</button>
      <button type="button" class="mini" title="像素反相" @click="emit('invert')">反相</button>
      <button type="button" class="mini danger" title="删除字形" @click="emit('remove')">×</button>
    </header>

    <label class="width-label">
      宽度 {{ glyph.width }}
      <input
        type="range"
        min="1"
        max="32"
        :value="glyph.width"
        @input="emit('resize', Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <div
      class="grid"
      :style="{ gridTemplateColumns: `repeat(${glyph.width}, ${cell}px)` }"
      role="grid"
    >
      <button
        v-for="r in glyph.height"
        :key="`row-${r - 1}`"
        class="row"
      >
        <template v-for="c in glyph.width" :key="c - 1">
          <span
            class="cell"
            :class="{ on: glyph.rows[r - 1][c - 1] === 1 }"
            :style="{ width: `${cell}px`, height: `${cell}px` }"
            role="gridcell"
            :aria-label="`第${r}行第${c}列`"
            @mousedown.prevent="emit('toggle', r - 1, c - 1)"
          />
        </template>
      </button>
    </div>

    <ul v-if="issues.length" class="issues">
      <li v-for="(msg, i) in issues" :key="i">{{ msg }}</li>
    </ul>
  </section>
</template>

<style scoped>
.glyph-card {
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.glyph-card.invalid {
  border-color: #cf222e;
  background: #fff5f5;
}
.glyph-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.char-input {
  width: 3.2em;
  font-size: 18px;
  text-align: center;
  padding: 2px 4px;
}
.dim {
  color: #57606a;
  font-variant-numeric: tabular-nums;
}
.mini {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid #d0d7de;
  background: #f6f8fa;
  cursor: pointer;
}
.mini.danger {
  color: #cf222e;
  margin-left: auto;
}
.width-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #57606a;
}
.grid {
  display: grid;
  gap: 0;
  overflow: auto;
}
.row {
  display: contents;
}
.cell {
  display: inline-block;
  box-sizing: border-box;
  border: 1px solid #eaeef2;
  background: #fff;
  cursor: pointer;
  padding: 0;
}
.cell.on {
  background: #1f2328;
  border-color: #1f2328;
}
.issues {
  margin: 0;
  padding-left: 18px;
  color: #cf222e;
  font-size: 12px;
}
</style>
