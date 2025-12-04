<template>
  <div class="view-selector">
    <span
      v-for="item in viewLabels"
      :key="item.type"
      :class="{ selected: item.type === selectedType }"
      @click="handleSelectView(item)"
    >
      {{ item.label }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { ViewLabel } from '../types'

defineProps<{
  viewLabels: ViewLabel[]
  selectedType: number
}>()

const emit = defineEmits<{
  select: [view: ViewLabel]
}>()

const handleSelectView = (view: ViewLabel) => {
  emit('select', view)
}
</script>

<style scoped lang="scss">
.view-selector {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 15px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  z-index: 10;

  span {
    padding: 0 5px;
    width: 60px;
    height: 50px;
    text-align: center;
    line-height: 50px;
    cursor: pointer;
    transition: all 0.3s;

    &:hover {
      background-color: rgba(255, 255, 255, 0.5);
    }

    &.selected {
      background-color: #fff;
      color: #285e50;
      font-weight: bold;
    }
  }
}
</style>
