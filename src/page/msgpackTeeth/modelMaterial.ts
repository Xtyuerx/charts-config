import { Color, DoubleSide, MeshStandardMaterial } from 'three'

/** Display material only; never changes the source mesh or MessagePack data. */
export function modelMaterial(color: Color, label: number) {
  return new MeshStandardMaterial({
    color,
    side: DoubleSide,
    roughness: 0.55,
    metalness: 0,
    polygonOffset: true,
    // Nearly coincident gum/tooth surfaces otherwise expose an alternating seam.
    // Bias gum slightly farther away in the depth buffer, without moving geometry.
    polygonOffsetFactor: label === 0 ? 2 : 1,
    polygonOffsetUnits: label === 0 ? 4 : 1,
    name: `tooth-${label}`,
  })
}
