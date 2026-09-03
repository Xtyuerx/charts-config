# Seeded Tooth Graph Cut Design

## Goal

Upgrade the standalone tooth segmentation test page from “the drawn stroke is the final boundary” to the following workflow:

1. The user draws a closed seed region on a tooth crown.
2. The page previews the selected STL faces.
3. A local geometry-only Graph Cut expands the seed to the full tooth and finds the tooth–gingiva margin.
4. The generated surface boundary remains editable by dragging control points.
5. Only confirmation writes final triangle labels and creates an independent tooth mesh.

The original `allStl` labels may identify `toothId`, but they must not influence Graph Cut geometry, boundary placement, or foreground/background classification.

## Scope

This design changes only the tooth segmentation test page and focused utilities used by it. It does not replace the existing STL viewer, BVH raycasting, boundary editor, or confirmed-region export machinery.

In scope:

- Seed-region selection and preview.
- Local ROI construction.
- Geometry feature extraction.
- Worker-based binary Graph Cut.
- Closed surface-boundary extraction and simplification.
- Active/inactive boundary presentation.
- Confirmation-time independent mesh creation and label assignment.
- Editing-session persistence and original-format result export.

Out of scope:

- Neural-network inference or remote segmentation services.
- Editing the source STL `BufferGeometry` during drawing or dragging.
- Automatically rerunning Graph Cut during control-point dragging.
- Changing the existing `allStl` page.

## User Experience

The page exposes the following ordered operations:

```text
Enter segmentation mode
  -> draw a purple closed crown region
  -> preview pink Seed Faces
  -> Generate Boundary
  -> preview geometry-derived tooth margin
  -> edit Boundary Points on the STL surface
  -> Confirm Segmentation
  -> save final result
```

### Seed selection

- The purple screen-space stroke is transient input, not a final `ToothBoundary`.
- After pointer release, the polygon interior is sampled on a 6 CSS-pixel grid. Stroke samples are included so narrow regions remain selectable.
- Rays use the camera and the existing BVH-accelerated raycaster and target only the first visible STL mesh hit.
- Hits on a different jaw from the first valid hit are discarded.
- Seed faces are reduced to the largest face-adjacent connected component.
- The selected faces are rendered as a pink overlay.
- The dominant original label over seed faces supplies `toothId`. Original labels have no further role in segmentation.

### Boundary generation

- “生成边界” is enabled when a valid seed exists and no generation job is running.
- The pink seed preview remains visible while the worker runs.
- On success, the generated boundary becomes the active boundary: white line and green circular controls.
- Boundaries belonging to other teeth are displayed as green lines and blue circular controls.
- On failure, no existing boundary or confirmed result is overwritten; the pink seed remains available for retry or redraw.

### Boundary editing

- Pointer selection may intersect control-point objects, but drag positioning raycasts only against the source STL mesh.
- The selected control stores the exact local-space STL intersection.
- Only the previous and next surface segments are recomputed.
- Surface segments use cached STL topology paths and remain attached after camera rotation.
- Dragging never edits source STL geometry, rebuilds BVH, runs Graph Cut, or performs triangle classification.
- Dragging a confirmed boundary invalidates only that tooth’s confirmed result.

### Confirmation

- “确认分牙” uses the edited boundary to classify the final face region.
- Conflict with another confirmed tooth is rejected atomically.
- On success, the page creates an independent, non-indexed `BufferGeometry` containing copies of the selected source triangles. It does not remove those triangles from the source jaw.
- The independent mesh is stored by jaw and `toothId` and replaces the previous mesh for the same tooth.
- Confirmation writes the per-face result labels; unconfirmed faces remain `0`.

## State Model

Each tooth has an explicit workflow state:

```ts
type ToothSegmentationStatus = 'seeded' | 'boundary-ready' | 'confirmed'

type ToothSegmentationState = {
  toothId: number
  jaw: 'upper' | 'lower'
  seedFaceIndices: number[]
  boundary: ToothBoundary | null
  triangleIndices: number[]
  status: ToothSegmentationStatus
}
```

The page owns one in-memory `Map<number, ToothSegmentationState>`. Three.js preview objects and independent tooth meshes are derived views keyed by `jaw:toothId`; they are not authoritative state.

State transitions are:

```text
new drawing -> seeded
seeded + successful Graph Cut -> boundary-ready
boundary-ready + successful confirmation -> confirmed
confirmed + boundary drag -> boundary-ready
new seed for the same tooth -> seeded
```

Every transition that replaces a state first validates and computes the new state. Existing state is disposed only after the replacement is ready.

## Local ROI

Graph Cut operates on a local face graph:

- Compute the three-dimensional seed diameter from the seed-face bounds.
- Expand from seed faces by surface geodesic distance up to `3.0 * seedDiameter`.
- Stop expansion at 40,000 faces. Reaching this limit is an error rather than silently truncating the ROI.
- The background seed set consists of valid hits in a screen-space ring between `1.25x` and `1.65x` scaled copies of the original polygon, plus ROI boundary faces.
- Foreground and background seeds must each contain at least three distinct faces.
- Any face present in both sets is removed from the background set. If fewer than three background faces remain, generation fails.

These values live in one exported configuration object so tests can use smaller deterministic limits without changing algorithm code.

## Geometry Features

Graph nodes are ROI triangles. Graph edges connect triangles sharing one quantized STL edge.

For each adjacency, calculate:

- Normal angle between faces.
- Signed dihedral angle, with concave tooth-neck transitions favored as cut locations.
- Absolute difference in normalized mean curvature.
- Shared-edge length.

For each face, calculate:

- Geodesic distance to foreground seeds.
- Geodesic distance to background seeds.
- Difference from the robust median foreground normal.
- Relative height along the robust foreground normal.

Continuous features are normalized within the ROI using median and median absolute deviation. Degenerate deviations use `1` to avoid division by zero.

Pairwise capacity is high across smooth, continuous surface regions and low across sharp or concave transitions. Unary source/sink capacities combine foreground/background geodesic distance, normal difference, and relative height. Foreground seeds receive an effectively infinite source capacity; background seeds receive an effectively infinite sink capacity.

Default normalized weights are centralized and testable:

```ts
const graphCutWeights = {
  normalAngle: 2.5,
  concavity: 3.0,
  curvature: 1.5,
  geodesic: 2.0,
  foregroundNormal: 1.0,
  relativeHeight: 0.75,
}
```

The implementation uses a deterministic binary max-flow/min-cut algorithm. Equal-capacity decisions are resolved by ascending local face index so repeated generation produces identical results.

## Worker Boundary

Graph Cut runs in a dedicated module Web Worker.

The main thread performs BVH selection, retrieves or builds cached jaw topology/features, constructs the ROI, and sends only transferable typed arrays:

- ROI source face indices.
- Pairwise adjacency endpoints and capacities.
- Unary source and sink capacities.
- Foreground and background seed masks.

The worker returns the foreground local-face mask and job identifier. Results from a superseded job identifier are discarded. Three.js objects, meshes, and geometries never cross the worker boundary.

The UI remains interactive while the job runs, but drawing another seed cancels the logical ownership of the previous result. The worker may finish, but its stale output cannot update page state.

## Boundary Extraction

After Graph Cut:

1. Keep only the foreground component containing the largest number of foreground seed faces.
2. Reject results smaller than the seed set or larger than 90% of the ROI.
3. Collect shared edges between foreground and background faces.
4. Build edge loops from quantized STL vertices.
5. Reject open chains.
6. Remove loops shorter than `0.15 * seedDiameter`.
7. Choose the loop whose foreground side contains the seed component and whose enclosed foreground component has the largest area.
8. Simplify the loop with a surface-aware tolerance of `max(0.15, seedDiameter * 0.01)` in STL units.
9. Resample by surface arc length to between 24 and 64 controls. The count is clamped after targeting one control per `seedDiameter / 12` of boundary length.

The resulting controls are stored as exact three-dimensional surface positions. Display segments are generated from cached surface topology paths. The loop is closed explicitly.

## Rendering

Render-order and colors match the supplied reference sequence:

- Drawing stroke: purple.
- Seed-face overlay: pink.
- Active generated boundary: white line, green circular controls.
- Inactive generated boundary: green line, blue circular controls.
- Confirmed independent tooth mesh: translucent green `0x35d07f`, matching the current confirmation highlight.

All overlays use local jaw coordinates and are attached to their source jaw transform, so camera rotation cannot detach them from the STL.

## Persistence and Export

Two different artifacts serve different purposes.

### Editing-session JSON

The existing segmentation-session export evolves to version 2:

```ts
type SegmentationSessionV2 = {
  version: 2
  teeth: Array<{
    toothId: number
    jaw: 'upper' | 'lower'
    status: ToothSegmentationStatus
    seedFaceIndices: number[]
    boundary: ToothBoundary['boundary'] | null
    triangleIndices: number[]
  }>
  jaws: {
    upper: { triangleLabels: number[] }
    lower: { triangleLabels: number[] }
  }
}
```

Loading reconstructs seed previews, boundaries, confirmed labels, and independent meshes. The loader remains backward-compatible with the current boundary-only and combined segmentation formats.

### Final result JSON

“保存分牙结果” downloads one JSON file per jaw using the original `allStl` JSON shape:

```json
{
  "id_patient": "",
  "jaw": "upper",
  "labels": [0, 0, 11, 11, 11],
  "metadata": {}
}
```

- Preserve `id_patient`, `jaw`, `metadata`, and other source fields.
- Remove stale `faceLabels` if present and write `labels` in the original vertex-label length.
- Each confirmed face writes its `toothId` to all three vertex-label entries.
- Every unconfirmed face writes `0`.
- Export fails if the source vertex count does not match the expected label length.

## Error Handling

- No STL hit: reject the drawing and keep prior state.
- Cross-jaw drawing: keep only the first-hit jaw.
- Disconnected seed: preview only the largest component.
- Missing `toothId`: request a valid manual tooth ID before generation.
- Insufficient seeds, missing background ring, ROI limit, invalid cut size, or no closed loop: retain the pink seed and report a specific error.
- Duplicate generation click: ignored while the current job is running.
- Stale worker response: discarded by job identifier.
- Confirmed-region overlap: reject without changing labels or meshes.
- Invalid imported state or label length: reject the entire import before disposing current state.

## Module Boundaries

Keep the change focused by separating pure computation from Three.js orchestration:

- `seedSelectionUtils.ts`: polygon sampling results, connected seed component, background ring hits.
- `toothGraphCutUtils.ts`: ROI construction, normalized geometry features, typed-array graph payload, deterministic cut result interpretation.
- `toothGraphCut.worker.ts`: max-flow/min-cut execution only.
- `toothBoundaryExtractionUtils.ts`: cut boundary edges, loops, simplification, resampling.
- Existing `surfaceBoundaryUtils.ts`: surface path display and local drag updates.
- Existing persistence utility: versioned session parsing and original-format result payloads.
- Page component: pointer events, worker job lifecycle, state transitions, and Three.js views.

No utility may mutate the source STL `BufferGeometry`.

## Testing Strategy

Pure deterministic tests cover:

- Screen polygon seed hit reduction and largest connected component.
- Cross-jaw hit filtering.
- ROI geodesic limit and 40,000-face guard.
- Foreground/background seed constraints.
- Feature normalization for flat and degenerate geometry.
- Graph Cut on hand-constructed smooth/concave face graphs.
- Deterministic tie breaking.
- Foreground component selection and leakage rejection.
- Closed-loop tracing, open-chain rejection, and main-loop selection.
- Surface simplification and 24–64 control bounds.
- Exact surface intersection preservation during dragging.
- Only adjacent display segments changing during a drag.
- No label mutation before confirmation.
- Confirmation-time independent geometry extraction.
- Vertex-label expansion and original-format JSON preservation.
- Version 2 session round trip and legacy import compatibility.

Integration tests cover:

- Draw -> seed preview -> generate -> edit -> confirm state transitions.
- Worker stale-result rejection.
- Error messages leave prior state intact.
- Reload restores the correct visual/editing stage.

## Acceptance Criteria

- A crown-centered closed drawing produces a pink connected seed preview rather than immediately becoming the final boundary.
- Generated Boundary surrounds the tooth at a geometry-derived tooth–gingiva transition without consulting original label boundaries.
- Active and inactive boundary styling matches the supplied screenshots.
- Dragged controls and both adjacent segments remain on the STL surface under camera rotation.
- Pointer movement does not mutate source STL geometry, rebuild BVH/topology, run Graph Cut, or classify triangles.
- Confirmation creates an independent tooth mesh and updates only confirmed output labels.
- Editing-session JSON restores workflow state.
- Final per-jaw JSON matches the original `allStl` schema and label length, with unconfirmed faces set to `0`.
- All new pure utilities have red-green regression tests, and the focused Vue/TypeScript and lint checks pass.
