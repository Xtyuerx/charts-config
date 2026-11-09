// 单位示意模板：颈部 z=0、根尖 z=-1。每牙位独立 OBJ；可用真实标准库替换。
import { mkdirSync, writeFileSync } from 'node:fs'
const folder = new URL('../public/root-templates/', import.meta.url)
mkdirSync(folder, { recursive: true })
for (const quadrant of [1, 2, 3, 4])
  for (let tooth = 1; tooth <= 8; tooth++) {
    const id = quadrant * 10 + tooth,
      n = 32,
      vertices = [],
      faces = []
    function tube(rings) {
      const offset = vertices.length
      for (const [z, r, cx, cy] of rings)
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * i) / n
          vertices.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z])
        }
      for (let j = 0; j < rings.length - 1; j++)
        for (let i = 0; i < n; i++) {
          const a = offset + j * n + i + 1,
            b = offset + j * n + ((i + 1) % n) + 1,
            c = b + n,
            d = a + n
          faces.push([a, b, c], [a, c, d])
        }
      const end = offset + (rings.length - 1) * n + 1
      for (let i = 1; i < n - 1; i++) faces.push([end, end + i, end + i + 1])
    }
    const roots = tooth >= 6 ? (quadrant <= 2 ? 3 : 2) : tooth === 4 && quadrant <= 2 ? 2 : 1
    if (roots === 1)
      tube([
        [0, 1, 0, 0],
        [-0.18, 0.84, 0, 0],
        [-0.55, 0.48, 0.04, 0],
        [-1, 0.012, 0.12, 0],
      ])
    else {
      tube([
        [0, 1, 0, 0],
        [-0.2, 0.82, 0, 0],
        [-0.36, 0.68, 0, 0],
      ])
      for (let r = 0; r < roots; r++) {
        const a = (2 * Math.PI * r) / roots,
          x = Math.cos(a),
          y = Math.sin(a)
        tube([
          [-0.25, 0.5, x * 0.3, y * 0.3],
          [-0.55, 0.3, x * 0.55, y * 0.55],
          [-1, 0.012, x * 0.85, y * 0.85],
        ])
      }
    }
    const content = [
      '# schematic template; neck z=0, tip z=-1',
      `o tooth_${id}`,
      ...vertices.map((v) => `v ${v.map((x) => x.toFixed(6)).join(' ')}`),
      ...faces.map((f) => `f ${f.join(' ')}`),
    ].join('\n')
    writeFileSync(new URL(`${id}.obj`, folder), content + '\n')
  }
console.log('Generated 32 per-tooth schematic OBJ root templates')
