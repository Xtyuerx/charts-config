import { shallowRef } from 'vue'
import { defineStore } from 'pinia'

import {
  createIndexedDbModelRepairRepository,
  type ModelRepairRepository,
  type ModelRepairTransfer,
} from '@/page/modelRepair/utils/modelTransferUtils'

export const useModelRepairStore = defineStore('modelRepair', () => {
  const activeTransfer = shallowRef<ModelRepairTransfer | null>(null)

  async function setTransfer(
    transfer: ModelRepairTransfer,
    repository: ModelRepairRepository = createIndexedDbModelRepairRepository(),
  ) {
    activeTransfer.value = transfer
    await repository.save(transfer)
  }

  async function restoreTransfer(
    id: string,
    repository: ModelRepairRepository = createIndexedDbModelRepairRepository(),
  ) {
    if (activeTransfer.value?.id === id) return activeTransfer.value
    activeTransfer.value = await repository.load(id)
    return activeTransfer.value
  }

  function clearMemory() {
    activeTransfer.value = null
  }

  return { activeTransfer, setTransfer, restoreTransfer, clearMemory }
})
