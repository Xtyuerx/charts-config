# Restore local MessagePack loading

Problem: initial color classification rejected existing foreign-source overlap as a newly introduced edit. The supplied real model also contains collapsed triangles that interfered with surface binding.

- [x] Reproduce initial shared-surface import rejection with a regression test.
- [x] Record baseline foreign convex polygons and reject only newly acquired foreign area, including expansion within the same original neighbor face. Keep foreign geometry/material unchanged.
- [x] Exclude exactly zero-area faces from both preview reference construction and source projection BVHs; preserve imported buffers. Verify off-plane collapsed triangles cannot separate saved controls from displayed anchors.
- [x] Verify the supplied real file loads lower (15 partitions, 154907 triangles), upper (16 partitions, 154875 triangles), switches back, and downloads unchanged decoded content.
- [x] Run scoped vue-tsc, formatting checks, 63 core tests and page/GPU regressions. Obtain focused independent review.

The real-file browser test is optional via MSGPACK_LOAD_SAMPLE; no local user data is copied into the repository. A strict preview screenshot comparison failed during the grouped run, then the isolated diagnostic rerun passed with zero differing pixels; retained comparison attachments and pixel diagnostics for investigation of future timing-sensitive rendering failures. All actual-file load/export assertions passed after the final projection fix. Independent review found no remaining issue in overlap clipping or projection filtering.
