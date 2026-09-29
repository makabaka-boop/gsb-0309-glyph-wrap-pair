<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ExportSnapshot } from '../lib/types'
import { drawRaster, exportSnapshot } from '../composables/download'
import { MAX_TEXT_LENGTH } from '../lib/layout'

const props = defineProps<{
  text: string
  maxWidth: number
  charCount: number
  snapshot: ExportSnapshot | null
  errorMessage: string | null
  errorIssues: string[]
}>()

const emit = defineEmits<{
  (e: 'update:text', value: string): void
  (e: 'update:maxWidth', value: number): void
  (e: 'compose'): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const scale = ref(16)

const scaleOptions = [8, 12, 16, 24, 32]

const bboxText = computed(() => {
  const b = props.snapshot?.layout.bbox
  if (!props.snapshot) return '—'
  return b
    ? `(${b.minX}, ${b.minY})–(${b.maxX}, ${b.maxY})  尺寸 ${b.maxX - b.minX + 1}×${b.maxY - b.minY + 1}`
    : 'EMPTY'
})

function redraw() {
  if (canvasRef.value && props.snapshot) {
    drawRaster(canvasRef.value, props.snapshot, scale.value)
  }
}

onMounted(redraw)
// flush: 'post'：等 v-if 的 canvas 完成挂载后再绘制，
// 否则 snapshot 从 null 首次变为有值时 canvasRef 还是 null。
watch(() => props.snapshot, redraw, { deep: false, flush: 'post' })
watch(scale, redraw)

async function doExport() {
  if (props.snapshot) await exportSnapshot(props.snapshot)
}
</script>

<template>
  <section class="composer">
    <h2>排版</h2>

    <label class="text-label">
      输入字串
      <textarea
        rows="4"
        :value="text"
        spellcheck="false"
        @input="emit('update:text', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </label>
    <div class="count" :class="{ over: charCount > MAX_TEXT_LENGTH }">
      码点长度 {{ charCount }} / {{ MAX_TEXT_LENGTH }}
    </div>
    <label class="scale">
      每行最大像素宽度
      <input type="number" min="8" max="128" :value="maxWidth"
        @change="emit('update:maxWidth', Number(($event.target as HTMLInputElement).value))" />
    </label>

    <div class="actions">
      <button type="button" class="primary" @click="emit('compose')">排版</button>
      <button type="button" :disabled="!snapshot" @click="doExport">
        导出 PNG + 位置 JSON
      </button>
      <label class="scale">
        缩放
        <select v-model.number="scale">
          <option v-for="s in scaleOptions" :key="s" :value="s">{{ s }}×</option>
        </select>
      </label>
    </div>

    <p v-if="errorMessage" class="error">
      {{ errorMessage }}
    </p>
    <ul v-if="errorIssues.length" class="issue-list">
      <li v-for="(msg, i) in errorIssues" :key="i">{{ msg }}</li>
    </ul>

    <div v-if="snapshot" class="result">
      <p class="bbox">最小包围盒：{{ bboxText }}</p>
      <p class="positions-title">各字形位置（同一行内 x 严格递增，换行后从 x=0 起）：</p>
      <ol class="positions">
        <li v-for="p in snapshot.layout.placed" :key="p.index">
          <span class="swatch" :style="{ background: snapshot.layout.palette[p.index] }" />
          #{{ p.index }} “{{ p.char }}” → x={{ p.x }}, y={{ p.y }}
          （外框 {{ p.width }}×{{ p.height }}）
        </li>
      </ol>

      <p class="positions-title">合成图（颜色 = 字串中的出现来源）：</p>
      <div class="canvas-wrap">
        <canvas ref="canvasRef"></canvas>
      </div>
    </div>
  </section>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.text-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-weight: 600;
}
textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px;
  padding: 8px;
  resize: vertical;
}
.count {
  font-size: 12px;
  color: #57606a;
}
.count.over {
  color: #cf222e;
  font-weight: 700;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
button {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #d0d7de;
  background: #f6f8fa;
  cursor: pointer;
}
button.primary {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
  font-weight: 700;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.scale {
  font-size: 12px;
  color: #57606a;
  margin-left: auto;
}
.error {
  color: #cf222e;
  font-weight: 600;
  margin: 0;
}
.issue-list {
  margin: 0;
  padding-left: 18px;
  color: #cf222e;
  font-size: 13px;
}
.result {
  border-top: 1px solid #d0d7de;
  padding-top: 10px;
}
.bbox {
  font-weight: 700;
  margin: 0 0 6px;
}
.positions-title {
  font-weight: 600;
  margin: 8px 0 4px;
}
.positions {
  margin: 0;
  padding-left: 20px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  max-height: 160px;
  overflow: auto;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}
.canvas-wrap {
  overflow: auto;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 8px;
  background: #f6f8fa;
  display: inline-block;
  max-width: 100%;
}
</style>
