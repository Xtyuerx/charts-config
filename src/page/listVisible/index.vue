<template>
  <div class="list-visible-container">
    <h2>列表显示隐藏控制示例</h2>

    <!-- 方案一：在数据源中维护状态 -->
    <div class="approach-section">
      <h3>方案一：数据源状态维护</h3>
      <p class="description">在每个列表项的数据对象中直接添加 visible 属性来控制显示隐藏</p>

      <div class="list-container">
        <div
          v-for="item in listWithStatus"
          :key="item.id"
          class="list-item"
          :class="{ hidden: !item.visible }"
        >
          <div class="item-content">
            <span class="item-id">ID: {{ item.id }}</span>
            <span class="item-name">{{ item.name }}</span>
            <span v-if="item.visible" class="item-description">{{ item.description }}</span>
          </div>
          <button
            @click="toggleItemVisibility(item)"
            class="toggle-btn"
            :class="{ 'hide-btn': item.visible, 'show-btn': !item.visible }"
          >
            {{ item.visible ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <div class="controls">
        <button @click="showAllItems" class="control-btn">全部显示</button>
        <button @click="hideAllItems" class="control-btn">全部隐藏</button>
        <button @click="resetListWithStatus" class="control-btn">重置数据</button>
      </div>
    </div>

    <!-- 方案二：使用Map映射维护状态 -->
    <div class="approach-section">
      <h3>方案二：Map映射状态维护</h3>
      <p class="description">使用独立的Map对象，以列表项的id为key来维护每项的显示隐藏状态</p>

      <div class="list-container">
        <div
          v-for="item in originalList"
          :key="item.id"
          class="list-item"
          :class="{ hidden: !getItemVisibility(item.id) }"
        >
          <div class="item-content">
            <span class="item-id">ID: {{ item.id }}</span>
            <span class="item-name">{{ item.name }}</span>
            <span v-if="getItemVisibility(item.id)" class="item-description">{{
              item.description
            }}</span>
          </div>
          <button
            @click="toggleItemVisibilityByMap(item.id)"
            class="toggle-btn"
            :class="{
              'hide-btn': getItemVisibility(item.id),
              'show-btn': !getItemVisibility(item.id),
            }"
          >
            {{ getItemVisibility(item.id) ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <div class="controls">
        <button @click="showAllItemsByMap" class="control-btn">全部显示</button>
        <button @click="hideAllItemsByMap" class="control-btn">全部隐藏</button>
        <button @click="resetVisibilityMap" class="control-btn">重置状态</button>
      </div>
    </div>

    <!-- 状态信息展示 -->
    <div class="status-info">
      <h4>当前状态信息</h4>
      <div class="status-display">
        <div>
          <strong>方案一 - 数据源状态：</strong>
          <pre>{{
            JSON.stringify(
              listWithStatus.map((item) => ({ id: item.id, visible: item.visible })),
              null,
              2,
            )
          }}</pre>
        </div>
        <div>
          <strong>方案二 - Map映射状态：</strong>
          <pre>{{ JSON.stringify(Object.fromEntries(visibilityMap), null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

// 定义列表项的类型接口
interface ListItem {
  id: number
  name: string
  description: string
}

// 扩展接口，用于方案一（包含visible状态）
interface ListItemWithStatus extends ListItem {
  visible: boolean
}

// 原始数据源（不包含状态信息）
const originalData: ListItem[] = [
  { id: 1, name: '项目A', description: '这是项目A的描述信息' },
  { id: 2, name: '项目B', description: '这是项目B的描述信息' },
  { id: 3, name: '项目C', description: '这是项目C的描述信息' },
  { id: 4, name: '项目D', description: '这是项目D的描述信息' },
  { id: 5, name: '项目E', description: '这是项目E的描述信息' },
]

// ==================== 方案一：数据源状态维护 ====================
/**
 * 方案一的优点：
 * 1. 数据结构简单直观，状态与数据绑定在一起
 * 2. 便于序列化和持久化存储
 * 3. 适合状态需要与数据一起传递的场景
 *
 * 方案一的缺点：
 * 1. 修改了原始数据结构，可能影响其他使用该数据的地方
 * 2. 如果原始数据来自API，需要额外处理状态字段
 * 3. 数据重置时需要重新构建整个数据结构
 */

// 方案一：在每个列表项中添加visible属性来维护显示隐藏状态
const listWithStatus = ref<ListItemWithStatus[]>(
  originalData.map((item) => ({
    ...item,
    visible: true, // 默认所有项都显示
  })),
)

/**
 * 切换单个项目的显示隐藏状态（方案一）
 * @param item 要切换状态的列表项
 */
const toggleItemVisibility = (item: ListItemWithStatus) => {
  item.visible = !item.visible
}

/**
 * 显示所有项目（方案一）
 */
const showAllItems = () => {
  listWithStatus.value.forEach((item) => {
    item.visible = true
  })
}

/**
 * 隐藏所有项目（方案一）
 */
const hideAllItems = () => {
  listWithStatus.value.forEach((item) => {
    item.visible = false
  })
}

/**
 * 重置列表数据（方案一）
 */
const resetListWithStatus = () => {
  listWithStatus.value = originalData.map((item) => ({
    ...item,
    visible: true,
  }))
}

// ==================== 方案二：Map映射状态维护 ====================
/**
 * 方案二的优点：
 * 1. 不修改原始数据结构，保持数据的纯净性
 * 2. 状态管理独立，便于复杂的状态逻辑处理
 * 3. 可以轻松重置状态而不影响原始数据
 * 4. 适合原始数据不可变或来自外部API的场景
 *
 * 方案二的缺点：
 * 1. 需要维护两个数据结构，增加了复杂性
 * 2. 需要额外的方法来同步状态
 * 3. 状态持久化需要单独处理
 */

// 方案二：使用原始列表数据（不包含状态）
const originalList = ref<ListItem[]>([...originalData])

// 使用Map来维护每个列表项的显示隐藏状态，key为item.id
const visibilityMap = reactive<Map<number, boolean>>(new Map())

// 初始化Map，默认所有项都显示
originalData.forEach((item) => {
  visibilityMap.set(item.id, true)
})

/**
 * 获取指定ID项目的显示状态（方案二）
 * @param id 项目ID
 * @returns 显示状态，默认为true
 */
const getItemVisibility = (id: number): boolean => {
  return visibilityMap.get(id) ?? true
}

/**
 * 切换指定ID项目的显示隐藏状态（方案二）
 * @param id 要切换状态的项目ID
 */
const toggleItemVisibilityByMap = (id: number) => {
  const currentState = getItemVisibility(id)
  visibilityMap.set(id, !currentState)
}

/**
 * 显示所有项目（方案二）
 */
const showAllItemsByMap = () => {
  originalList.value.forEach((item) => {
    visibilityMap.set(item.id, true)
  })
}

/**
 * 隐藏所有项目（方案二）
 */
const hideAllItemsByMap = () => {
  originalList.value.forEach((item) => {
    visibilityMap.set(item.id, false)
  })
}

/**
 * 重置Map状态（方案二）
 */
const resetVisibilityMap = () => {
  visibilityMap.clear()
  originalList.value.forEach((item) => {
    visibilityMap.set(item.id, true)
  })
}

// ==================== 使用建议 ====================
/**
 * 选择方案的建议：
 *
 * 1. 如果数据结构简单，状态不复杂，且可以修改原始数据结构，推荐使用方案一
 * 2. 如果原始数据来自API且不应被修改，或者需要复杂的状态管理逻辑，推荐使用方案二
 * 3. 如果需要状态持久化，方案一更容易实现
 * 4. 如果需要频繁重置状态而保持原始数据不变，方案二更合适
 * 5. 对于大量数据的场景，方案二的性能可能更好，因为可以避免不必要的数据复制
 */
</script>

<style scoped>
.list-visible-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.approach-section {
  margin-bottom: 40px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  background-color: #fafafa;
}

.approach-section h3 {
  color: #333;
  margin-bottom: 10px;
}

.description {
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
  font-style: italic;
}

.list-container {
  margin-bottom: 20px;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  margin-bottom: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background-color: white;
  transition: all 0.3s ease;
}

.list-item.hidden {
  opacity: 0.3;
  background-color: #f5f5f5;
}

.item-content {
  display: flex;
  gap: 20px;
  align-items: center;
  flex: 1;
}

.item-id {
  font-weight: bold;
  color: #007bff;
  min-width: 60px;
}

.item-name {
  font-weight: 600;
  color: #333;
  min-width: 80px;
}

.item-description {
  color: #666;
  flex: 1;
}

.toggle-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.toggle-btn.hide-btn {
  background-color: #dc3545;
  color: white;
}

.toggle-btn.hide-btn:hover {
  background-color: #c82333;
}

.toggle-btn.show-btn {
  background-color: #28a745;
  color: white;
}

.toggle-btn.show-btn:hover {
  background-color: #218838;
}

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.control-btn {
  padding: 10px 20px;
  border: 1px solid #007bff;
  border-radius: 4px;
  background-color: white;
  color: #007bff;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.control-btn:hover {
  background-color: #007bff;
  color: white;
}

.status-info {
  margin-top: 30px;
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #f9f9f9;
}

.status-info h4 {
  margin-bottom: 15px;
  color: #333;
}

.status-display {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.status-display > div {
  background-color: white;
  padding: 15px;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
}

.status-display strong {
  display: block;
  margin-bottom: 10px;
  color: #333;
}

.status-display pre {
  background-color: #f8f9fa;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  margin: 0;
}

@media (max-width: 768px) {
  .status-display {
    grid-template-columns: 1fr;
  }

  .item-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .list-item {
    flex-direction: column;
    align-items: stretch;
  }

  .toggle-btn {
    align-self: flex-end;
    margin-top: 10px;
  }
}
</style>
