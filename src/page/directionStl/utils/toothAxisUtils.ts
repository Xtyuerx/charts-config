import * as THREE from 'three'

export type ToothAxisName = 'x' | 'y' | 'z'

export type ToothAxisInput = {
  fdi: number
  point: THREE.Vector3 | [number, number, number]
}

export type ToothAxisLine = {
  name: ToothAxisName
  color: number
  start: THREE.Vector3
  end: THREE.Vector3
  direction: THREE.Vector3
}

export type ToothAxisSet = {
  fdi: number
  origin: THREE.Vector3
  axes: Record<ToothAxisName, ToothAxisLine>
}

export type ToothAxesOptions = {
  axisLength?: number
  xDirection?: THREE.Vector3
  yDirection?: THREE.Vector3
  zDirection?: THREE.Vector3
  colors?: Partial<Record<ToothAxisName, number>>
}

type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]]

export type AutomaticToothAxisOptions = {
  axisLength?: number
  fallbackCenter?: THREE.Vector3 | [number, number, number]
}

const DEFAULT_AXIS_LENGTH = 5
const DEFAULT_COLORS: Record<ToothAxisName, number> = {
  x: 0xff4d4f,
  y: 0x52c41a,
  z: 0x4096ff,
}

const DEFAULT_DIRECTIONS: Record<ToothAxisName, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}

function toVector3(point: ToothAxisInput['point']) {
  return Array.isArray(point) ? new THREE.Vector3(...point) : point.clone()
}

function getDirection(axis: ToothAxisName, options: ToothAxesOptions) {
  const customDirection =
    axis === 'x' ? options.xDirection : axis === 'y' ? options.yDirection : options.zDirection
  const direction = customDirection?.clone() ?? DEFAULT_DIRECTIONS[axis].clone()

  if (direction.lengthSq() === 0) {
    return DEFAULT_DIRECTIONS[axis].clone()
  }

  return direction.normalize()
}

function createAxisLine(
  name: ToothAxisName,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  color: number,
): ToothAxisLine {
  return {
    name,
    color,
    start: origin.clone(),
    end: origin.clone().add(direction.clone().multiplyScalar(length)),
    direction,
  }
}

function getCenter(
  points: THREE.Vector3[],
  fallbackCenter?: AutomaticToothAxisOptions['fallbackCenter'],
) {
  if (!points.length) {
    return fallbackCenter ? toVector3({ fdi: 0, point: fallbackCenter }.point) : new THREE.Vector3()
  }

  const center = new THREE.Vector3()
  points.forEach((point) => center.add(point))
  return center.multiplyScalar(1 / points.length)
}

function covarianceMatrix(points: THREE.Vector3[], center: THREE.Vector3) {
  const matrix: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]

  if (!points.length) return matrix

  points.forEach((point) => {
    const x = point.x - center.x
    const y = point.y - center.y
    const z = point.z - center.z
    matrix[0][0] += x * x
    matrix[0][1] += x * y
    matrix[0][2] += x * z
    matrix[1][0] += y * x
    matrix[1][1] += y * y
    matrix[1][2] += y * z
    matrix[2][0] += z * x
    matrix[2][1] += z * y
    matrix[2][2] += z * z
  })

  const scale = 1 / points.length
  matrix.forEach((row) => {
    row[0] *= scale
    row[1] *= scale
    row[2] *= scale
  })
  return matrix
}

function multiplyMatrixVector(matrix: Matrix3, vector: THREE.Vector3) {
  return new THREE.Vector3(
    matrix[0][0] * vector.x + matrix[0][1] * vector.y + matrix[0][2] * vector.z,
    matrix[1][0] * vector.x + matrix[1][1] * vector.y + matrix[1][2] * vector.z,
    matrix[2][0] * vector.x + matrix[2][1] * vector.y + matrix[2][2] * vector.z,
  )
}

function dominantEigenvector(matrix: Matrix3, seed: THREE.Vector3) {
  let vector = seed.lengthSq() > 0 ? seed.clone().normalize() : new THREE.Vector3(0, 0, 1)

  for (let index = 0; index < 24; index += 1) {
    const next = multiplyMatrixVector(matrix, vector)
    if (next.lengthSq() < 1e-12) return vector
    vector = next.normalize()
  }

  return vector
}

function finiteUnit(vector: THREE.Vector3, fallback: THREE.Vector3) {
  if (
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(vector.z) ||
    vector.lengthSq() < 1e-12
  ) {
    return fallback.clone().normalize()
  }

  return vector.clone().normalize()
}

function makePerpendicularAxis(primary: THREE.Vector3) {
  const reference =
    Math.abs(primary.dot(new THREE.Vector3(1, 0, 0))) < 0.85
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0)

  return reference.sub(primary.clone().multiplyScalar(reference.dot(primary))).normalize()
}

export function extractToothPoints(
  positions: ArrayLike<number>,
  labels: ArrayLike<number>,
  fdi: number,
) {
  const points: THREE.Vector3[] = []
  const vertexCount = Math.floor(positions.length / 3)
  const count = Math.min(vertexCount, labels.length)

  for (let index = 0; index < count; index += 1) {
    if (labels[index] !== fdi) continue

    const offset = index * 3
    const point = new THREE.Vector3(positions[offset], positions[offset + 1], positions[offset + 2])
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      points.push(point)
    }
  }

  return points
}

export function extractToothMeshGeometry(
  sourceGeometry: THREE.BufferGeometry,
  labels: ArrayLike<number>,
  fdi: number,
) {
  const position = sourceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const toothPositions: number[] = []

  if (!position) {
    return new THREE.BufferGeometry()
  }

  const positions = position.array
  const vertexCount = Math.min(position.count, labels.length)
  const triangleVertexCount = vertexCount - (vertexCount % 3)

  for (let index = 0; index < triangleVertexCount; index += 3) {
    if (labels[index] !== fdi || labels[index + 1] !== fdi || labels[index + 2] !== fdi) continue

    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const positionOffset = (index + vertexOffset) * 3
      const x = positions[positionOffset]
      const y = positions[positionOffset + 1]
      const z = positions[positionOffset + 2]

      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof z !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
      ) {
        continue
      }

      toothPositions.push(x, y, z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(toothPositions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

export function computeAutomaticToothAxis(
  points: THREE.Vector3[],
  options: AutomaticToothAxisOptions = {},
): ToothAxisSet {
  const origin = getCenter(points, options.fallbackCenter)
  const axisLength = options.axisLength ?? DEFAULT_AXIS_LENGTH
  const covariance = covarianceMatrix(points, origin)
  const zDirection = finiteUnit(
    dominantEigenvector(covariance, new THREE.Vector3(0, 0, 1)),
    new THREE.Vector3(0, 0, 1),
  )
  const xDirection = finiteUnit(makePerpendicularAxis(zDirection), new THREE.Vector3(1, 0, 0))
  const yDirection = finiteUnit(
    new THREE.Vector3().crossVectors(zDirection, xDirection),
    new THREE.Vector3(0, 1, 0),
  )

  return {
    fdi: 0,
    origin,
    axes: {
      x: createAxisLine('x', origin, xDirection, axisLength, DEFAULT_COLORS.x),
      y: createAxisLine('y', origin, yDirection, axisLength, DEFAULT_COLORS.y),
      z: createAxisLine('z', origin, zDirection, axisLength, DEFAULT_COLORS.z),
    },
  }
}

export function createToothAxes(
  teeth: ToothAxisInput[],
  options: ToothAxesOptions = {},
): ToothAxisSet[] {
  const axisLength = options.axisLength ?? DEFAULT_AXIS_LENGTH
  const colors = { ...DEFAULT_COLORS, ...options.colors }

  return teeth.map((tooth) => {
    const origin = toVector3(tooth.point)

    return {
      fdi: tooth.fdi,
      origin,
      axes: {
        x: createAxisLine('x', origin, getDirection('x', options), axisLength, colors.x),
        y: createAxisLine('y', origin, getDirection('y', options), axisLength, colors.y),
        z: createAxisLine('z', origin, getDirection('z', options), axisLength, colors.z),
      },
    }
  })
}

function createAxisSetObject(axisSet: ToothAxisSet) {
  const positions: number[] = []
  const colors: number[] = []

  Object.values(axisSet.axes).forEach((axis) => {
    positions.push(...axis.start.toArray(), ...axis.end.toArray())

    const color = new THREE.Color(axis.color)
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    depthTest: false,
  })
  const lineSegments = new THREE.LineSegments(geometry, material)
  lineSegments.name = `tooth-axes-${axisSet.fdi}`
  lineSegments.userData.fdi = axisSet.fdi

  return lineSegments
}

export function createToothAxesGroup(
  teeth: ToothAxisInput[],
  options: ToothAxesOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'tooth-axes'

  createToothAxes(teeth, options).forEach((axisSet) => {
    group.add(createAxisSetObject(axisSet))
  })

  return group
}
