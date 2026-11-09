import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Tooth } from './core'

export interface JumpParameters {
  forward: number
  lateral: number
  vertical: number
  opening: number
}
export const defaultJump = (): JumpParameters => ({
  forward: 0,
  lateral: 0,
  vertical: 0,
  opening: 0,
})

export function readJump(raw: unknown): JumpParameters {
  if (raw == null) return defaultJump()
  const value = raw as { schema?: string; parameters?: JumpParameters }
  if (value.schema !== 'occlusal-jump-v1' || !value.parameters)
    throw new Error('咬合跳跃数据格式无效')
  const result = defaultJump()
  for (const key of Object.keys(result) as (keyof JumpParameters)[]) {
    const n = value.parameters[key]
    const min = key === 'opening' ? 0 : -20
    const max = key === 'opening' ? 30 : 20
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`咬合跳跃参数 ${key} 超出范围`)
    result[key] = n
  }
  return result
}

export interface JumpFrame {
  pivot: Vector3
  front: Vector3
  right: Vector3
  up: Vector3
}

/** Fixed to original lower-jaw frames, so comparison and single-tooth edits cannot move the hinge. */
export function jumpFrame(teeth: Tooth[]): JumpFrame {
  const lower = teeth.filter((t) => t.jaw === 'lower')
  const mean = (items: Tooth[]) =>
    items.reduce((v, t) => v.add(t.originalPosition), new Vector3()).divideScalar(items.length || 1)
  const molars = lower.filter((t) => t.id % 10 >= 6)
  const incisors = lower.filter((t) => t.id % 10 <= 2)
  const pivot = mean(molars.length ? molars : lower)
  const up = lower.reduce(
    (v, t) => v.add(new Vector3(0, 0, 1).applyQuaternion(t.originalQuaternion)),
    new Vector3(),
  )
  if (up.lengthSq() < 1e-8) up.set(0, 0, 1)
  up.normalize()
  const front =
    incisors.length && molars.length
      ? mean(incisors).sub(pivot)
      : lower.reduce(
          (v, t) => v.add(new Vector3(0, -1, 0).applyQuaternion(t.originalQuaternion)),
          new Vector3(),
        )
  front.addScaledVector(up, -front.dot(up))
  if (front.lengthSq() < 1e-8) front.set(1, 0, 0).addScaledVector(up, -up.x)
  if (front.lengthSq() < 1e-8) front.set(0, 1, 0).addScaledVector(up, -up.y)
  front.normalize()
  return { pivot, front, up, right: new Vector3().crossVectors(front, up).normalize() }
}

export function jumpMatrix(parameters: JumpParameters, frame: JumpFrame): Matrix4 {
  const shift = frame.front
    .clone()
    .multiplyScalar(parameters.forward)
    .addScaledVector(frame.right, parameters.lateral)
    .addScaledVector(frame.up, parameters.vertical)
  const rotation = new Quaternion().setFromAxisAngle(
    frame.right,
    (-parameters.opening * Math.PI) / 180,
  )
  return new Matrix4()
    .makeTranslation(frame.pivot.clone().add(shift))
    .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new Matrix4().makeTranslation(frame.pivot.clone().negate()))
}
