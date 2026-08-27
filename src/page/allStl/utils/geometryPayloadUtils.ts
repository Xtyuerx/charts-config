import * as THREE from 'three'

export type MeshGeometryPayload = {
  formatVersion: 1
  positions: number[]
  labels: number[]
  normals?: number[]
  gumRemoved: boolean
  removedFaceCount: number
  sourceFaceCount: number
}

export type ScreenPoint = {
  x: number
  y: number
}

export function isScreenPointInsidePolygon(point: ScreenPoint, polygon: ScreenPoint[]) {
  if (polygon.length < 3) return false

  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index++
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const crossesY = current.y > point.y !== previous.y > point.y
    const intersectionX =
      ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (crossesY && point.x < intersectionX) inside = !inside
  }

  return inside
}

export function getFacesInsideScreenPolygon(
  geometry: THREE.BufferGeometry,
  polygon: ScreenPoint[],
  projectVertex: (point: THREE.Vector3, vertexIndex: number) => ScreenPoint | null,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const faceIndices = new Set<number>()
  if (!position || polygon.length < 3) return faceIndices

  const point = new THREE.Vector3()
  const faceCount = Math.floor(position.count / 3)

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const base = faceIndex * 3
    let insideVertexCount = 0
    const projectedVertices: ScreenPoint[] = []

    for (let offset = 0; offset < 3; offset++) {
      const vertexIndex = base + offset
      point.set(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))
      const projected = projectVertex(point, vertexIndex)
      if (!projected) continue
      projectedVertices.push(projected)
      if (isScreenPointInsidePolygon(projected, polygon)) insideVertexCount++
    }

    const projectedCenter =
      projectedVertices.length === 3
        ? {
            x: (projectedVertices[0].x + projectedVertices[1].x + projectedVertices[2].x) / 3,
            y: (projectedVertices[0].y + projectedVertices[1].y + projectedVertices[2].y) / 3,
          }
        : null

    if (
      insideVertexCount > 0 ||
      (projectedCenter && isScreenPointInsidePolygon(projectedCenter, polygon))
    ) {
      faceIndices.add(faceIndex)
    }
  }

  return faceIndices
}

export function filterMeshGeometryFaces(
  geometry: THREE.BufferGeometry,
  labels: number[],
  deletedFaceIndices: Set<number>,
) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('Cannot filter geometry without positions.')

  const sourceFaceCount = Math.floor(position.count / 3)
  const nextPositions: number[] = []
  const nextLabels: number[] = []

  for (let faceIndex = 0; faceIndex < sourceFaceCount; faceIndex++) {
    if (deletedFaceIndices.has(faceIndex)) continue

    const base = faceIndex * 3
    for (let offset = 0; offset < 3; offset++) {
      const vertexIndex = base + offset
      nextPositions.push(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
      )
      nextLabels.push(Number(labels[vertexIndex] ?? 0))
    }
  }

  const nextGeometry = new THREE.BufferGeometry()
  nextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3))
  nextGeometry.computeVertexNormals()

  return {
    geometry: nextGeometry,
    labels: nextLabels,
    removedFaceCount: deletedFaceIndices.size,
    sourceFaceCount,
  }
}

export function buildGeometryPayloadFromMesh(
  geometry: THREE.BufferGeometry,
  labels: number[],
  options: Pick<MeshGeometryPayload, 'removedFaceCount' | 'sourceFaceCount'>,
): MeshGeometryPayload {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('Cannot export geometry without positions.')

  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const positions = Array.from(position.array, Number)
  const normals = normal ? Array.from(normal.array, Number) : undefined

  return {
    formatVersion: 1,
    positions,
    labels: labels.slice(0, position.count).map(Number),
    normals,
    gumRemoved: options.removedFaceCount > 0,
    removedFaceCount: options.removedFaceCount,
    sourceFaceCount: options.sourceFaceCount,
  }
}

export function createGeometryFromPayload(payload: MeshGeometryPayload) {
  if (payload.formatVersion !== 1) {
    throw new Error(`Unsupported geometry payload version: ${payload.formatVersion}`)
  }
  if (payload.positions.length % 9 !== 0) {
    throw new Error('Geometry positions must contain complete triangles.')
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(payload.positions, 3))

  if (payload.normals?.length === payload.positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(payload.normals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  return {
    geometry,
    labels: payload.labels.slice(0, payload.positions.length / 3).map(Number),
  }
}
