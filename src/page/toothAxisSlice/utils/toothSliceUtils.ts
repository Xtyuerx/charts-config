import * as THREE from 'three'

export type SliceView = 'front' | 'side' | 'top'

export type ToothAxisPose = {
  origin: THREE.Vector3
  quaternion: THREE.Quaternion
}

export type SliceFrame = {
  origin: THREE.Vector3
  normal: THREE.Vector3
  horizontal: THREE.Vector3
  vertical: THREE.Vector3
}

export type OrthographicViewPose = {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
}

export type SlicePoint = {
  x: number
  y: number
}

export type SliceSegment = {
  start: SlicePoint
  end: SlicePoint
}

export type SliceContour = SlicePoint[]

const LOCAL_FRAMES: Record<
  SliceView,
  Pick<SliceFrame, 'normal' | 'horizontal' | 'vertical'>
> = {
  front: {
    normal: new THREE.Vector3(0, 1, 0),
    horizontal: new THREE.Vector3(1, 0, 0),
    vertical: new THREE.Vector3(0, 0, 1),
  },
  side: {
    normal: new THREE.Vector3(1, 0, 0),
    horizontal: new THREE.Vector3(0, 1, 0),
    vertical: new THREE.Vector3(0, 0, 1),
  },
  top: {
    normal: new THREE.Vector3(0, 0, 1),
    horizontal: new THREE.Vector3(1, 0, 0),
    vertical: new THREE.Vector3(0, 1, 0),
  },
}

export function createSliceFrame(pose: ToothAxisPose, view: SliceView): SliceFrame {
  const local = LOCAL_FRAMES[view]

  return {
    origin: pose.origin.clone(),
    normal: local.normal.clone().applyQuaternion(pose.quaternion).normalize(),
    horizontal: local.horizontal.clone().applyQuaternion(pose.quaternion).normalize(),
    vertical: local.vertical.clone().applyQuaternion(pose.quaternion).normalize(),
  }
}

export function createOrthographicViewPose(
  pose: ToothAxisPose,
  view: SliceView,
  distance: number,
): OrthographicViewPose {
  const frame = createSliceFrame(pose, view)
  return {
    position: frame.origin.clone().addScaledVector(frame.normal, -distance),
    target: frame.origin.clone(),
    up: frame.vertical.clone(),
  }
}

export function calculateOrthographicViewHeight(
  box: THREE.Box3,
  pose: ToothAxisPose,
  view: SliceView,
  aspect: number,
  padding = 1.18,
) {
  const frame = createSliceFrame(pose, view)
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ]
  let halfWidth = 0
  let halfHeight = 0

  for (const corner of corners) {
    const relative = corner.sub(frame.origin)
    halfWidth = Math.max(halfWidth, Math.abs(relative.dot(frame.horizontal)))
    halfHeight = Math.max(halfHeight, Math.abs(relative.dot(frame.vertical)))
  }

  const safeAspect = Math.max(aspect, 1e-6)
  return Math.max(halfHeight * 2, (halfWidth * 2) / safeAspect, 1) * padding
}

function addUniquePoint(points: THREE.Vector3[], point: THREE.Vector3, epsilon: number) {
  if (!points.some((candidate) => candidate.distanceToSquared(point) <= epsilon * epsilon)) {
    points.push(point)
  }
}

function intersectTriangle(
  triangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  frame: SliceFrame,
  epsilon: number,
) {
  const distances = triangle.map((point) => frame.normal.dot(point.clone().sub(frame.origin)))

  if (
    distances.every((distance) => distance > epsilon) ||
    distances.every((distance) => distance < -epsilon)
  ) {
    return null
  }

  const intersections: THREE.Vector3[] = []
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const

  for (const [startIndex, endIndex] of edges) {
    const start = triangle[startIndex]
    const end = triangle[endIndex]
    const startDistance = distances[startIndex]
    const endDistance = distances[endIndex]

    if (Math.abs(startDistance) <= epsilon) addUniquePoint(intersections, start.clone(), epsilon)
    if (Math.abs(endDistance) <= epsilon) addUniquePoint(intersections, end.clone(), epsilon)

    if (startDistance * endDistance < -epsilon * epsilon) {
      const ratio = startDistance / (startDistance - endDistance)
      addUniquePoint(
        intersections,
        start.clone().lerp(end, ratio),
        epsilon,
      )
    }
  }

  if (intersections.length < 2) return null
  if (intersections.length === 2) return intersections as [THREE.Vector3, THREE.Vector3]

  let longestPair: [THREE.Vector3, THREE.Vector3] = [intersections[0], intersections[1]]
  let longestDistance = longestPair[0].distanceToSquared(longestPair[1])

  for (let first = 0; first < intersections.length - 1; first += 1) {
    for (let second = first + 1; second < intersections.length; second += 1) {
      const distance = intersections[first].distanceToSquared(intersections[second])
      if (distance > longestDistance) {
        longestDistance = distance
        longestPair = [intersections[first], intersections[second]]
      }
    }
  }

  return longestPair
}

function projectToFrame(point: THREE.Vector3, frame: SliceFrame): SlicePoint {
  const relative = point.clone().sub(frame.origin)
  return {
    x: relative.dot(frame.horizontal),
    y: relative.dot(frame.vertical),
  }
}

export function sliceGeometry(
  geometry: THREE.BufferGeometry,
  frame: SliceFrame,
  epsilon = 1e-5,
): SliceSegment[] {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return []

  const index = geometry.getIndex()
  const triangleCount = Math.floor((index?.count ?? position.count) / 3)
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
  const segments: SliceSegment[] = []

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const elementIndex = triangleIndex * 3 + vertexOffset
      const vertexIndex = index ? index.getX(elementIndex) : elementIndex
      points[vertexOffset].fromBufferAttribute(position, vertexIndex)
    }

    const intersection = intersectTriangle(
      [points[0].clone(), points[1].clone(), points[2].clone()],
      frame,
      epsilon,
    )
    if (!intersection) continue

    segments.push({
      start: projectToFrame(intersection[0], frame),
      end: projectToFrame(intersection[1], frame),
    })
  }

  return segments
}

function pointsAreClose(first: SlicePoint, second: SlicePoint, tolerance: number) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance
}

function clonePoint(point: SlicePoint): SlicePoint {
  return { x: point.x, y: point.y }
}

export function buildSliceContours(
  segments: SliceSegment[],
  tolerance = 1e-4,
): SliceContour[] {
  const remaining = segments.map((segment) => ({
    start: clonePoint(segment.start),
    end: clonePoint(segment.end),
  }))
  const contours: SliceContour[] = []

  while (remaining.length > 0) {
    const firstSegment = remaining.shift()
    if (!firstSegment) break

    const contour = [firstSegment.start, firstSegment.end]
    let closed = false

    while (remaining.length > 0) {
      const current = contour[contour.length - 1]
      const firstPoint = contour[0]
      if (!current || !firstPoint) break

      if (pointsAreClose(current, firstPoint, tolerance)) {
        contour[contour.length - 1] = clonePoint(firstPoint)
        closed = true
        break
      }

      const nextIndex = remaining.findIndex(
        (segment) =>
          pointsAreClose(segment.start, current, tolerance) ||
          pointsAreClose(segment.end, current, tolerance),
      )
      if (nextIndex < 0) break

      const [nextSegment] = remaining.splice(nextIndex, 1)
      if (!nextSegment) break
      contour.push(
        clonePoint(
          pointsAreClose(nextSegment.start, current, tolerance)
            ? nextSegment.end
            : nextSegment.start,
        ),
      )
    }

    const firstPoint = contour[0]
    const lastPoint = contour[contour.length - 1]
    if (!closed && firstPoint && lastPoint && pointsAreClose(lastPoint, firstPoint, tolerance)) {
      contour[contour.length - 1] = clonePoint(firstPoint)
      closed = true
    }

    if (closed && contour.length >= 4) contours.push(contour)
  }

  return contours
}
