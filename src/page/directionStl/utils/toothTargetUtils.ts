import * as THREE from 'three'

export type ToothTargetTransform = {
  jaw: string
  fdi: number
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

export type ToothTargetPayload = {
  version: 1
  targets: ToothTargetTransform[]
}

export function targetKey(jaw: string, fdi: number) {
  return `${jaw}-${fdi}`
}

export function createToothTargetTransform(
  jaw: string,
  fdi: number,
  object: THREE.Object3D,
): ToothTargetTransform {
  return {
    jaw,
    fdi,
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  }
}

export function upsertToothTargetTransform(
  records: Record<string, ToothTargetTransform>,
  transform: ToothTargetTransform,
) {
  return {
    ...records,
    [targetKey(transform.jaw, transform.fdi)]: transform,
  }
}

export function serializeToothTargetTransforms(
  records: Record<string, ToothTargetTransform>,
): ToothTargetPayload {
  return {
    version: 1,
    targets: Object.values(records).sort((a, b) =>
      a.jaw === b.jaw ? a.fdi - b.fdi : a.jaw.localeCompare(b.jaw),
    ),
  }
}
