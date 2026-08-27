# Model Repair Page Design

## Goal

Add a dedicated model repair step after `allStl`. The first release supports raising,
lowering, and smoothing mesh surfaces with adjustable brush range and strength, plus
undo and redo. Cutting and hole filling are explicitly out of scope for this release.

The repair step must receive the current upper and lower jaw geometries, including
changes made by gum deletion, and preserve geometry and label data for later JSON or
STL export.

## User Flow

1. The user finishes segmentation and gum deletion on `/allStl`.
2. The user clicks `保存并下一步`.
3. Pending deletion previews, if any, must be confirmed or cancelled before continuing.
4. The page serializes all loaded jaw meshes into the existing geometry payload format.
5. The app stores the payload under a generated transfer ID and navigates to
   `/modelRepair?task=<transfer-id>`.
6. The repair page displays both jaws. A brush stroke edits only the mesh under the
   pointer.
7. The user selects `升高`, `压低`, or `平滑`, adjusts range and strength, and drags on
   the surface.
8. The user can undo or redo completed strokes.
9. `保存` updates the transferred model payload and stays on the repair page. Export
   actions can create JSON or STL from the repaired geometry.

## Architecture

### Page and Routing

- Add `src/page/modelRepair/index.vue` for the Three.js viewer and repair controls.
- Add a `/modelRepair` route in `src/router/index.ts`.
- Add a `保存并下一步` action to `src/page/allStl/index.vue`.
- Keep the repair page independent from segmentation UI. It consumes and produces a
  shared model payload rather than importing implementation state from `allStl`.

### Transfer State

Add `src/stores/modelRepair.ts` with a Pinia store that owns the active transfer:

- transfer ID;
- upper and lower jaw geometry payloads when present;
- labels and deletion metadata already contained by each geometry payload;
- creation and update timestamps.

Pinia provides the fast in-memory handoff. A small IndexedDB adapter persists the same
transfer by ID so refreshing `/modelRepair` can restore the model. The route contains
only the transfer ID; large geometry arrays are never encoded in the URL or stored in
`sessionStorage`.

If the transfer ID is missing or cannot be restored, the repair page shows a clear
empty state with a button returning to `/allStl`. It does not silently load a different
model.

### Geometry Modules

Add focused utilities under `src/page/modelRepair/utils/`:

- `sculptUtils.ts`: brush falloff, raise/lower displacement, smoothing, and normal
  updates;
- `meshTopologyUtils.ts`: logical vertex groups and vertex adjacency;
- `historyUtils.ts`: compact undo and redo commands;
- `modelTransferUtils.ts`: conversion between transfer payloads and Three.js meshes.

The existing `geometryPayloadUtils.ts` remains the shared serialization contract. If
needed, it will move to a neutral shared directory with compatibility imports so the
segmentation and repair pages use one implementation.

## Sculpting Behavior

### Hit Testing

Use the existing `three-mesh-bvh` dependency to accelerate raycasting and brush-area
queries. On pointer down, the nearest visible jaw surface becomes the stroke target.
The target stays fixed until pointer up so a single stroke cannot jump between jaws.

Orbit controls are disabled while a repair stroke is active and restored when it ends
or is cancelled.

### Brush Range and Falloff

The range value is a world-space radius in millimeters. A visible circular cursor is
oriented to the hit surface. Vertices inside the radius receive a smooth radial falloff:
full influence near the center and zero influence at the edge.

The same range control applies to all three tools. Strength is measured in millimeters
for raise and lower. For smoothing it controls interpolation strength and is presented
with a UI value compatible with the provided design.

### Raise and Lower

Raise moves affected logical vertices along their averaged local normal. Lower uses the
same displacement in the opposite direction. Influence is multiplied by brush falloff,
strength, and pointer movement spacing so results are stable across different mouse
event rates.

STL geometry is commonly non-indexed and contains duplicate positions for adjacent
triangles. Duplicate positions are grouped as logical vertices and always moved
together. This prevents cracks from opening between triangles during sculpting.

### Smooth

Smooth uses adjacency-aware Laplacian smoothing on affected logical vertices. The
brush falloff and strength limit each interpolation step. Boundary and isolated
vertices receive conservative influence to reduce shrinking and edge collapse.

The first release does not remesh, add triangles, or remove triangles. Smoothing changes
positions only, so labels and face counts remain stable.

### Geometry Refresh

During a stroke, changed position ranges are marked for GPU update. Bounding volumes
and vertex normals are recomputed at a throttled rate for responsive feedback, then
fully refreshed on pointer up. The BVH is refitted or rebuilt after the stroke so later
raycasts match the edited surface.

## Undo and Redo

One pointer-down to pointer-up gesture creates one history command. A command contains:

- jaw identifier;
- changed logical vertex indices;
- positions before the stroke;
- positions after the stroke.

Undo restores the before positions and redo restores the after positions. Starting a
new stroke after undo clears the redo stack. History has both an operation limit and an
approximate memory limit; oldest commands are removed first. The initial limits are 50
strokes and 128 MB, whichever is reached first.

Navigation and export do not create history commands. Switching tools ends any active
stroke cleanly.

## UI

The repair page uses the current full-viewer layout with a compact repair panel:

- upper/lower visibility controls;
- mutually exclusive `升高`, `压低`, and `平滑` tool buttons;
- range and strength sliders with numeric millimeter values;
- undo and redo icon buttons with disabled states;
- `上一步` and `保存` actions;
- a concise status or error area for loading and persistence failures.

The default tool is `平滑`. The default range and strength values will be conservative
and can be tuned against the current sample dental scans. The canvas remains usable on
desktop widths already supported by `allStl`; mobile-specific sculpting is not part of
the first release.

`上一步` returns to `/allStl` without inventing a later workflow destination. The first
release does not add a `保存并下一步` destination on the repair page because no following
business step has been specified.

## Data Integrity

- The transferred payload includes the post-deletion position array, labels, normals,
  and source/removed face counts.
- Repair operations do not alter vertex count, face order, labels, or jaw identity.
- Saving recalculates normals and serializes current positions into the same payload
  contract.
- JSON restoration must reproduce the repaired geometry without restoring deleted gum.
- STL export contains only the current triangles and current repaired positions.

## Error Handling

- Block navigation when no jaw geometry is ready.
- Block navigation while a gum deletion preview is awaiting confirmation.
- Restore from IndexedDB when Pinia state is empty after refresh.
- Show a recoverable error and return action if persistence or payload validation fails.
- Ignore a stroke that does not hit a visible jaw.
- Cancel an active stroke safely if the pointer leaves the canvas or the component
  unmounts.

## Testing

Unit tests cover:

- brush falloff at center, interior, and boundary;
- equal movement of duplicate logical vertices;
- raise and lower direction and magnitude;
- smoothing influence and unchanged out-of-range vertices;
- compact history undo/redo and redo invalidation;
- transfer payload round-trip with labels and deletion metadata.

Page-level tests cover:

- `allStl` creating a transfer and navigating to `/modelRepair`;
- repair page restoration from the store and IndexedDB fallback;
- a stroke creating one history command;
- undo and redo button states;
- saving repaired positions back into the payload.

Manual browser verification uses representative upper and lower jaw models and checks
that repeated strokes do not create visible triangle cracks, pointer interaction stays
responsive, and exported JSON restores the same repaired surface.

## Performance Targets

- Brush feedback should remain interactive on the current representative dental scans.
- Pointer movement work is throttled to animation frames.
- BVH queries limit the candidate vertex set before sculpt calculations.
- History stores changed vertices only and is bounded by count and memory.
- Full geometry serialization occurs on navigation or explicit save, not during every
  pointer event.

## Delivery Estimate

The expected implementation time is four to six working days:

- transfer state, route, and repair page viewer: one day;
- topology, BVH brush selection, raise, and lower: one to two days;
- smoothing and normal/BVH refresh: one day;
- undo/redo and bounded history: one day;
- tests, export verification, and performance tuning: one day.

Large or unusually noisy scans may require an additional one to two days of tuning.
Cutting, hole filling, remeshing, mobile touch sculpting, and server-side persistence are
not included in this estimate.
