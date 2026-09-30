import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'
import { STLLoader } from 'three-stdlib'
import {
  orderedBoundaryVertices,
  relabelBoundaryStrip,
} from '../src/page/allStl/utils/localBoundaryUtils'

// Exercise the actual Vue drag implementation with its STL, without needing WebGL.
function loadEditor() {
  const source = readFileSync('src/page/allStl/index.vue', 'utf8')
    .split('<script setup lang="ts">')[1]!
    .split('</script>')[0]!
  const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true)
  const names = new Set([
    'vertexKey',
    'buildMeshFaceTopology',
    'labelsToVertexLabels',
    'resolvedFaceLabelFromVertexLabels',
    'faceLabel',
    'vertexLabelsToFaceLabels',
    'orderEdgeLoops',
    'chooseBoundaryControlEdges',
    'buildBoundaryGroup',
    'shortestEdgePath',
    'previewLocalBoundaryMove',
    'setPointLocalPosition',
    'updateBoundaryLinesFromLoops',
  ])
  const functions = ast.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.has(node.name!.text),
  )
  const code = ts.transpile(functions.map((node) => node.getText(ast)).join('\n'), {
    target: ts.ScriptTarget.ES2020,
  })
  return new Function(
    'THREE',
    'orderedBoundaryVertices',
    `
    const colorForLabel = () => new THREE.Color('red');
    const createCirclePointTexture = () => null;
    ${code}
    return { buildMeshFaceTopology, labelsToVertexLabels, buildBoundaryGroup, previewLocalBoundaryMove, vertexLabelsToFaceLabels };
  `,
  )(THREE, orderedBoundaryVertices)
}

test('moves real lower-jaw boundary controls and commits a bounded strip', () => {
  test.setTimeout(60000)
  const editor = loadEditor()
  const bytes = readFileSync('public/models/lower.stl')
  const geometry = new STLLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  const payload = JSON.parse(readFileSync('public/points/lower.json', 'utf8'))
  const primary = editor.labelsToVertexLabels(geometry, payload)
  const { labels } = primary.sourceMatched
    ? primary
    : editor.labelsToVertexLabels(
        geometry,
        JSON.parse(readFileSync('public/models/lower.json', 'utf8')),
      )
  const faceLabels = editor.vertexLabelsToFaceLabels(labels)
  const topology = editor.buildMeshFaceTopology(geometry)
  const group = editor.buildBoundaryGroup(geometry, labels)
  const mesh = new THREE.Mesh(geometry)
  mesh.add(group)
  const points = group.getObjectByName('tooth-boundary-points') as THREE.Points
  const controls = points.userData.boundaryControlPoints
  const loops = group.userData.boundaryLoops
  let moved = 0
  let committed = 0
  const teeth = new Set<number>()
  for (const loop of loops.filter((item: any) => item.edgeKeys.length > 36)) {
    if (teeth.has(loop.toothId)) continue
    teeth.add(loop.toothId)
    let toothCommitted = false
    for (const fraction of [0.5, 0.25, 0.75, 0.1]) {
      const pointIndex =
        loop.controlPointIndices[Math.floor(loop.controlPointIndices.length * fraction)]
      const control = controls[pointIndex]
      const originalEdge = topology.edgeByKey.get(control.edgeKey)
      const state = {
        points,
        lines: undefined,
        pointIndex,
        mesh,
        topology,
        toothId: loop.toothId,
        originalLocalPosition: originalEdge.midpoint.clone(),
        originalEdgeKey: originalEdge.edgeKey,
        originalLoops: loops,
        oldArc: [],
        newArc: [],
      }
      const candidates = new Set<string>()
      for (const vertex of [originalEdge.fromKey, originalEdge.toKey])
        for (const neighbor of topology.vertexGraph.get(vertex) ?? [])
          candidates.add(neighbor.edgeKey)
      for (const key of candidates) {
        if (key === originalEdge.edgeKey) continue
        const accepted = editor.previewLocalBoundaryMove(state, topology.edgeByKey.get(key))
        if (accepted) {
          moved++
          const limit = Math.min(
            2000,
            Math.max(
              32,
              Math.ceil(faceLabels.filter((label: number) => label === loop.toothId).length * 0.05),
            ),
          )
          const changes = relabelBoundaryStrip(
            faceLabels,
            topology.faceEdges,
            topology.edgeByKey,
            state.oldArc,
            state.newArc,
            loop.toothId,
            limit,
          )
          if (changes?.size) {
            committed++
            toothCommitted = true
          }
          expect(control.edgeKey).toBe(key)
          // Returning to the original position must also remain possible.
          expect(editor.previewLocalBoundaryMove(state, originalEdge)).toBe(true)
          expect(control.edgeKey).toBe(originalEdge.edgeKey)
          if (changes?.size) break
        }
      }
      if (toothCommitted) break
    }
    expect(toothCommitted, `tooth ${loop.toothId} should allow a local edit`).toBe(true)
  }
  console.log({ testedTeeth: teeth.size, moved, committed })
  expect(teeth.size).toBeGreaterThan(5)
  expect(moved).toBeGreaterThanOrEqual(teeth.size)
  expect(committed).toBeGreaterThanOrEqual(teeth.size)
})
