# Surface boundary color repair

Goal: the displayed preview boundary and color partition must use the same three-dimensional surface path. Preserve source buffers, payloads, cancellation and reload behavior.

Chosen approach (authorized by the user's repair request): derive a connected reference surface from the tooth and gum, trace the displayed path on that surface, split crossed display triangles, and flood the resulting cells from the tooth's initial interior. Whole-face classification alone quantizes the edge; a global projected polygon can affect the wrong sheet. Neither satisfies the screenshot report.

- [x] Add failing planar/folded/disconnected-surface regression tests for exact cell boundaries and source preservation.
- [x] Implement a shared preview reference surface and exact path fitting.
- [x] Split display triangles along that path and classify connected cells, preserving normals by barycentric interpolation.
- [x] Replace projected shader recoloring with derived target geometry and gum overlays; preserve original resources for reset/disposal.
- [x] Wire transactional updates and regression-test drag, rollback, reset, persistence and GPU rendering.
- [x] Review and run scoped type checking and relevant tests.

Work in the existing dirty checkout to retain the user's in-progress implementation. Do not commit or clean unrelated files. Reject disconnected or ambiguous edits rather than painting unrelated surfaces.

Results: 61 core tests and 7 Chromium page/GPU tests passed. Scoped vue-tsc, Prettier and diff whitespace checks passed. Failed color-partition restore was demonstrated before fixing control atomicity; rejected saved bowtie was demonstrated to replace the current model before moving validation ahead of installation. Both regressions now pass. Independent review found no remaining important issues. No screenshot-source MessagePack model was available for real-data validation.
