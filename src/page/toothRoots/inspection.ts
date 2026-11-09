/** Decode row-major NumPy arrays without assuming byte alignment. */
export function decodeArray(value: unknown): number[][] | undefined {
  if (!(value instanceof Uint8Array)) return
  const tail = new TextDecoder().decode(value.subarray(-64))
  const match = /\|(\d+),(\d+),<f([48])$/.exec(tail)
  if (!match) return
  const rows = Number(match[1]),
    cols = Number(match[2]),
    width = Number(match[3])
  const size = rows * cols * width
  if (size + match[0].length !== value.byteLength) return
  const view = new DataView(value.buffer, value.byteOffset, size)
  const data = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const offset = (row * cols + col) * width
      return width === 8 ? view.getFloat64(offset, true) : view.getFloat32(offset, true)
    }),
  )
  return data.every((row) => row.every(Number.isFinite)) ? data : undefined
}

export function decodePoints(value: unknown): number[][] {
  const rows = decodeArray(value) ?? value
  return Array.isArray(rows) &&
    rows.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
    ? rows
    : []
}

/** Keep the inspector responsive: decode small numeric arrays, summarize large buffers. */
export function inspectValue(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_, item: unknown) => {
        if (typeof item === 'bigint') return `${item}n`
        if (item instanceof Uint8Array) {
          const decoded = item.length < 4096 ? decodeArray(item) : undefined
          return (
            decoded ?? { binaryBytes: item.byteLength, preview: Array.from(item.subarray(0, 12)) }
          )
        }
        if (Array.isArray(item) && item.length > 100)
          return { count: item.length, preview: item.slice(0, 5) }
        return item
      },
      2,
    ) ?? '无数据'
  )
}
