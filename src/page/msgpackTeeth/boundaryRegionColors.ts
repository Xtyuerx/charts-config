import * as THREE from 'three'

type Region = {
  row: number
  original: THREE.Vector3[]
  origin: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  uniforms: Record<string, THREE.IUniform>
}

/** Fragment masks split color inside a triangle, without changing its topology. */
export class BoundaryRegionColors {
  private readonly regions = new Map<number, Region>()
  private readonly texture: THREE.DataTexture
  private readonly width: number
  private readonly height: number

  constructor(
    models: Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>,
    boundaries: Map<number, THREE.Vector3[]>,
  ) {
    this.width = Math.max(1, ...[...boundaries.values()].map((p) => p.length))
    this.height = Math.max(1, boundaries.size)
    this.texture = new THREE.DataTexture(
      new Float32Array(this.width * this.height * 4),
      this.width,
      this.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    )
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
    const gum = models.get(0)?.material.color.clone() ?? new THREE.Color('#d391a0')
    for (const [label, points] of boundaries) {
      if (points.length < 3 || !models.has(label)) continue
      const origin = points
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .multiplyScalar(1 / points.length)
      const normal = new THREE.Vector3()
      points.forEach((p, i) =>
        normal.add(
          p
            .clone()
            .sub(origin)
            .cross(points[(i + 1) % points.length]!.clone().sub(origin)),
        ),
      )
      if (normal.lengthSq() < 1e-12) continue
      normal.normalize()
      const u = (Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0))
        .cross(normal)
        .normalize()
      const v = normal.clone().cross(u).normalize()
      const radius = Math.max(...points.map((p) => p.distanceTo(origin)))
      const band =
        Math.max(...points.map((p) => Math.abs(p.clone().sub(origin).dot(normal)))) + radius * 0.5
      const row = this.regions.size,
        prefix = `bc${row}`
      this.regions.set(label, {
        row,
        original: points.map((p) => p.clone()),
        origin,
        u,
        v,
        uniforms: {
          [`${prefix}Active`]: { value: 0 },
          [`${prefix}Origin`]: { value: origin },
          [`${prefix}U`]: { value: u },
          [`${prefix}V`]: { value: v },
          [`${prefix}Normal`]: { value: normal },
          [`${prefix}Band`]: { value: band },
          [`${prefix}Bounds`]: { value: new THREE.Vector4() },
          [`${prefix}Color`]: { value: models.get(label)!.material.color.clone() },
        },
      })
    }
    for (const [owner, mesh] of models) {
      const relevant = [...this.regions].filter(([label]) => owner === 0 || owner === label)
      if (!relevant.length) continue
      const declarations = relevant
        .map(([, r]) => {
          const p = `bc${r.row}`
          return `uniform float ${p}Active; uniform vec3 ${p}Origin, ${p}U, ${p}V, ${p}Normal, ${p}Color; uniform float ${p}Band; uniform vec4 ${p}Bounds;`
        })
        .join('\n')
      const masks = relevant
        .map(([, r]) => {
          const p = `bc${r.row}`,
            count = r.original.length
          return `
          if (${p}Active > 0.5) {
            vec3 delta = bcPosition - ${p}Origin;
            if (abs(dot(delta, ${p}Normal)) <= ${p}Band) {
              vec2 q = vec2(dot(delta, ${p}U), dot(delta, ${p}V));
              bool contained = false;
              if (q.x >= ${p}Bounds.x && q.y >= ${p}Bounds.y && q.x <= ${p}Bounds.z && q.y <= ${p}Bounds.w) {
                vec2 a = texture2D(bcPolygon, vec2(${(count - 0.5) / this.width}, ${(r.row + 0.5) / this.height})).xy;
                for (int i=0; i<${count}; i++) {
                  vec2 b = texture2D(bcPolygon, vec2((float(i)+0.5)/${this.width}.0, ${(r.row + 0.5) / this.height})).xy;
                  if ((a.y > q.y) != (b.y > q.y)) {
                    if (q.x < (b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x) contained = !contained;
                  }
                  a = b;
                }
              }
              ${owner === 0 ? `if (contained) diffuseColor.rgb = ${p}Color;` : `diffuseColor.rgb = contained ? ${p}Color : bcGum;`}
            }
          }`
        })
        .join('\n')
      mesh.material.onBeforeCompile = (shader) => {
        Object.assign(
          shader.uniforms,
          { bcPolygon: { value: this.texture }, bcGum: { value: gum } },
          ...relevant.map(([, r]) => r.uniforms),
        )
        shader.vertexShader =
          'varying vec3 bcPosition;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nbcPosition = position;',
          )
        shader.fragmentShader =
          `varying vec3 bcPosition; uniform sampler2D bcPolygon; uniform vec3 bcGum;\n${declarations}\n` +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>\n${masks}`,
          )
      }
      mesh.material.customProgramCacheKey = () =>
        `boundary-fragments:${owner}:${this.width}:${this.height}:${relevant.map(([, r]) => `${r.row},${r.original.length}`).join(';')}`
      mesh.material.needsUpdate = true
    }
  }

  update(label: number, points: THREE.Vector3[]) {
    const r = this.regions.get(label)
    if (!r) return
    if (points.length !== r.original.length) throw new Error('边界采样点数量发生变化')
    const p = `bc${r.row}`
    const reset = points.every((point, i) => point.distanceToSquared(r.original[i]!) < 1e-10)
    r.uniforms[`${p}Active`]!.value = reset ? 0 : 1
    const bounds = new THREE.Vector4(Infinity, Infinity, -Infinity, -Infinity)
    const data = this.texture.image.data as Float32Array
    points.forEach((point, i) => {
      const delta = point.clone().sub(r.origin),
        x = delta.dot(r.u),
        y = delta.dot(r.v)
      const offset = (r.row * this.width + i) * 4
      data[offset] = x
      data[offset + 1] = y
      bounds.x = Math.min(bounds.x, x)
      bounds.y = Math.min(bounds.y, y)
      bounds.z = Math.max(bounds.z, x)
      bounds.w = Math.max(bounds.w, y)
    })
    r.uniforms[`${p}Bounds`]!.value.copy(bounds)
    this.texture.needsUpdate = true
  }
  dispose() {
    this.texture.dispose()
  }
}

/** Independent final pass also runs after transparent model rendering. */
export function renderBoundaryOverlay(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  overlay: THREE.Scene,
  camera: THREE.Camera,
) {
  const autoClear = renderer.autoClear
  renderer.autoClear = true
  renderer.render(scene, camera)
  renderer.autoClear = false
  renderer.clearDepth()
  renderer.render(overlay, camera)
  renderer.autoClear = autoClear
}
