import { Vector3 } from 'three'

export type BoundaryEdit = {
  kind: 'vertex' | 'preview'
  points: number[][]
  controls: number[][]
}
type BoundaryEdits = { version: 1; scopes: Record<string, Record<string, BoundaryEdit>> }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
}

function edits(payload: unknown): BoundaryEdits | undefined {
  if (!object(payload)) throw new Error('msgpack 顶层必须是对象')
  const value = payload.boundary_editor
  if (value === undefined) return undefined
  if (!object(value) || value.version !== 1 || !object(value.scopes))
    throw new Error('boundary_editor 字段不兼容，无法安全保存或恢复边界')
  return value as BoundaryEdits
}

function validPoints(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
  )
}

export function readBoundaryEdit(payload: unknown, scope: string, label: number) {
  const value = edits(payload)?.scopes[scope]?.[label]
  if (!value) return undefined
  if (
    (value.kind !== 'vertex' && value.kind !== 'preview') ||
    !validPoints(value.points) ||
    !validPoints(value.controls)
  )
    throw new Error(`牙号 ${label} 的保存边界无效`)
  return {
    kind: value.kind,
    points: value.points.map((p) => new Vector3(p[0], p[1], p[2])),
    controls: value.controls.map((p) => new Vector3(p[0], p[1], p[2])),
  }
}

/** Prepare a replacement before committing labels, so incompatible metadata cannot cause a partial edit. */
export function prepareBoundaryEdit(
  payload: unknown,
  scope: string,
  label: number,
  edit?: { kind: BoundaryEdit['kind']; points: Vector3[]; controls: Vector3[] },
) {
  const existing = edits(payload)
  const scopes = { ...existing?.scopes }
  const boundaries = { ...scopes[scope] }
  if (edit)
    boundaries[label] = {
      kind: edit.kind,
      points: edit.points.map((p) => p.toArray()),
      controls: edit.controls.map((p) => p.toArray()),
    }
  else delete boundaries[label]
  if (Object.keys(boundaries).length) scopes[scope] = boundaries
  else delete scopes[scope]
  return () => {
    const root = payload as Record<string, unknown>
    if (Object.keys(scopes).length) root.boundary_editor = { version: 1, scopes }
    else delete root.boundary_editor
  }
}
