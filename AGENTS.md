# Influx Segmentation - Agent Handoff Document

## What This Project Is

A browser-based 2D character segmentation and rigging tool. Users upload an image, segment it into named layers using SAM (Segment Anything Model, ViT-B), then enter a rig mode to place bones, bind layers to bones, and deform them using a mesh-based skinning system. The end goal is full 2D character animation from a single static image.

---

## Stack

- Frontend: Next.js App Router, TypeScript, Tailwind, react-konva, konva
- Backend: Flask Python, SAM ViT-B, numpy, scipy, PIL
- Backend entry: servers/segmentation/app.py
- Frontend entry: frontend/src/app/page.tsx

---

## What Was Built Today

### Backend - app.py

SAM encode caching: run_sam now caches predictor.set_image() per session using sess["_encoded_id"] = id(sess["image"]), skipping redundant re-encodes. This was the main bottleneck - every click was re-encoding the full image through the ViT-B backbone.

Session eviction: evict_stale_sessions() with SESSION_TTL = 3600. Called on every upload. Sessions touch _last_used via get_session().

Box-prompt segmentation: run_sam_box uses predictor.predict(box=np.array(box), multimask_output=False). More precise than point prompts for bounded regions.

/api/segment_preview: Non-mutating. Accepts box [x0,y0,x1,y1] or x/y point. Returns tinted cyan preview image without committing to session state.

/api/segment_confirm: Mutating. Same input shape. Commits mask to sess["layers"] and sess["claimed"] after user confirms. Calls push_history before mutating.

/api/segment: Still exists as legacy immediate-commit flow. Not removed but not used by frontend.

---

### Frontend

lib/api.ts: Added api.segmentPreview(sessionId, selection) and api.segmentConfirm(sessionId, selection) where selection is box [x0,y0,x1,y1] or x/y point. Both spread into the request body.

components/FrameCanvas.tsx:
- onBoxSelect prop: drag draws a visible box overlay, fires with image-space [x0,y0,x1,y1] on pointer-up
- onPointSelect prop: drag under 4px screen pixels or tap fires with image-space (x, y)
- Both go through preview/confirm, not direct commit

components/FramePanel.tsx and FullscreenFrame.tsx: Threaded onBoxSelect and onPointSelect through. FullscreenFrame replaced old onClickPoint entirely.

app/page.tsx:
- pendingSelection state: box or x/y or null
- previewImage: base64 shown in coverage panel while selection pending
- handleBoxSelect and handlePointSelect: call api.segmentPreview, set pending state
- handleConfirmBox and handleCancelBox: commit or discard
- Confirm/Cancel bar renders whenever pendingSelection is non-null
- sessionInitRef guard: prevents React Strict Mode double-invoking initSession. Without this, two sessions created on mount, upload went to one, segment_preview called on the other (no image) returning 400

---

### Rig Mode - New Files

lib/rigMesh.ts:
- buildGridMesh(w, h, cols, rows): subdivided triangle grid over a layer bounding box, returns vertices + triangles
- autoWeightByDistance(vertices, bonePositions, maxInfluences, falloff): per-vertex bone weights by inverse-distance falloff, normalized to sum to 1

lib/rigMath.ts additions:
- skinVertex(restPoint, influences, boneRestPoses, bonePosedTransforms): linear blend skinning
- applyBoneDelta: moves a point through a bone's local space then re-projects through posed transform

lib/rigWarp.ts:
- drawWarpedMesh({ ctx, image, mesh, restVertices, posedVertices }): draws layer image warped triangle-by-triangle using per-triangle affine transforms via ctx.transform + ctx.clip. Standard Canvas 2D mesh deformation technique.

lib/rigHistory.ts:
- useHistoryState<T>(): generic undo/redo React hook. Snapshots state before every mutation, clears redo on new mutation. 50-entry cap. Mirrors backend push_history pattern.

components/RigCanvas.tsx - full rewrite on react-konva:
- Stage/Layer with camera state (x, y, scale). Zoom on wheel toward pointer, clamped 0.2 to 5. Middle-mouse and empty-space drag to pan.
- Zoom in/out/reset buttons plus live % display.
- Undo/redo buttons wired to useHistoryState over bones + bindings as one combined state.
- Bones as Konva Circle (draggable), connectors as Konva Line, rotate handle as second Circle on selected bone.
- All bone coordinates in world/image space. Konva scene graph + camera scale handles screen projection natively.
- Unbound layers: Konva Image nodes at rest position.
- Bound layers: Konva Shape with sceneFunc calling drawWarpedMesh.
- bindSelected(): captures rest poses at bind time, computes vertex weights once. Subsequent drags re-skin in real time.

---

## Research Findings

### SAM Performance
predictor.set_image() is the expensive op (full ViT-B encode). Must cache per session. Point prompts tend to over-select (whole person vs face). Box prompts are more reliable and were adopted as the primary selection method.

### Face Animation from Static Image
Researched LivePortrait (MIT license, KwaiVGI). Keypoint-based not diffusion. 12.8ms/frame on RTX 4090, 30+ FPS on RTX 3090 with TensorRT. CPU inference 50-100x slower, not viable interactively. Requires NVIDIA GPU. Dropped from scope.

Alternative: manual mesh point manipulation for expressions - same as Live2D and Cascadeur. Denser mesh over face, user drags control points to author expressions as morph targets. No ML, no GPU, same LBS math as body rigging. This is the planned approach.

### Canvas Library
Konva.js chosen over Fabric.js. Reasons: official react-konva bindings, multi-layer canvas, native scene graph with automatic coordinate inheritance, built-in drag and pinch-zoom, TypeScript support. Konva Shape with sceneFunc allows raw Canvas 2D drawing inside the scene graph - used to integrate drawWarpedMesh.

### Skinning Math
Linear blend skinning (LBS) is industry standard (Spine, DragonBones, every real-time 2D/3D game). Each vertex posed position = weighted sum of influencing bone rest-to-posed deltas. Bounded biharmonic weights (Jacobson 2011) produce higher quality auto-weights worth implementing server-side in Python/numpy as a future bake-weights step. Current: inverse-distance falloff computed client-side at bind time.

---

## Session Update — Mesh Guide Was Never Drawing the Mesh

`showMesh` toggle only ever rendered the layer's bounding-box rectangle (4 corners) — `buildGridMesh`'s subdivided grid was computed and stored in `rig.mesh` but never actually rendered anywhere. This is why nothing looked like a mesh; it was a plain rectangle outline the whole time. Fixed: mesh guide is now a `Shape` that draws every triangle edge from `rig.mesh.triangles`, using skinned (posed) vertices for bound layers so the grid itself visibly deforms with bone movement, rest-position vertices for unbound layers.

Still open: the actual bound-layer pixel warp (`drawWarpedMesh`) — math traced correct in the prior session note below, root cause of any remaining non-warping behavior still needs a real symptom (console error, or confirmation the mesh grid itself now warps but the image doesn't).

---

## Session Update — Undo/History Fixes

Investigated the mesh-deformation bug from the previous session (bound layers not visibly warping when bones move). Traced the full pipeline against actual Konva 10 source: `triangleAffine` solve, `drawWarpedMesh`, `skinVertex`/`applyBoneDelta`, `bindSelected`'s coordinate handling, `ctx._context` access, and Konva's `_setAttr` → `_requestDraw` → `batchDraw` redraw path. All correct — no defect found there. Root cause is still open; needs a real browser test (nothing this sandbox can do — no display, no headless browser download path on the allowed network list) or the actual symptom from testing (console error vs. static-but-not-warping vs. nothing rendering).

Found and fixed two real bugs while tracing it, in `lib/rigHistory.ts` and `components/RigCanvas.tsx`:

- `useHistoryState.setState` pushed to `undoStack.current` **inside** the `setStateInternal` updater. Next.js defaults to React Strict Mode, which double-invokes updaters in dev — duplicate undo entries on every single mutation. Fixed by moving the push outside the updater into a new `pushHistory()`.
- `onBoneDragMove`/`onHandleDragMove` called the undo-tracked `setState` on every drag-move frame, burning through the 50-entry cap in a single drag gesture. Added `setStateLive` (no history push) for continuous drag frames, with `pushHistory()` called once on drag-start so undo still restores the pre-drag pose in one step.

`useHistoryState` now returns `{ state, setState, setStateLive, pushHistory, undo, redo, canUndo, canRedo }` (added `setStateLive` and `pushHistory`).

Also flagged by eslint (`react-hooks/refs`), not yet fixed: `layerRigsRef.current` (mesh/weights cache) is read directly during render inside the JSX `.map()` over layers in `RigCanvas.tsx`. Works today because `bindSelected()` pairs the ref mutation with a `setState` call, but it's an anti-pattern — reading ref `.current` during render is unsafe under React's rules and worth migrating to state or a safer cache pattern.

---

## Current Limitations - Fix Next Session

1. MESH DEFORMATION NOT VISIBLE - HIGH PRIORITY
   Bound layers call drawWarpedMesh inside Konva Shape sceneFunc but moving bones produces no visible pixel warping. Three likely causes:
   - ctx._context inside Konva sceneFunc may not be the raw CanvasRenderingContext2D that drawWarpedMesh expects. Try accessing context differently or passing a pre-obtained raw context.
   - restVertices are in layer-local pixel space (0,0 = crop top-left), posedVertices from skinVertex are in world/image space. Coordinate mismatch. Both must be in the same space before passing to drawWarpedMesh.
   - Konva Shape may not invalidate/redraw when worldTransforms changes because it has no declared dependency on it. Try calling layer.batchDraw() or passing a dummy prop that changes with worldTransforms.

2. NO RIG BUTTON / END GOAL
   User can place bones, bind layers, drag bones - but there is no Rig action, no animated output, no transition to animate mode. Rig mode has no terminal action.

3. CHARACTER NOT DRAGGABLE ON CANVAS
   Pan works but individual layers cannot be grabbed and repositioned. Only bones are draggable.

4. NO NODE GRAPH
   No Blender/Cascadeur-style visual bone hierarchy graph. Only flat parent-child stored in state.

5. NO EXPLODED VIEW
   No way to spread layers apart spatially to select parts without overlap.

---

## Planned Features

### V2 - Next Session (fix mesh deformation first)
- Fix drawWarpedMesh coordinate space mismatch and Konva context access
- Rig button + bone-copy duplicate: After rigging, "Duplicate as bone copy" creates a live skinned puppet. Move a bone, the corresponding skin region moves. Move the arm bone, the arm in the image moves. This is the core deliverable.
- Draggable layers on canvas
- Node graph panel for bone hierarchy

### V3
- Exploded character view: spread layers apart after segmentation for cleaner binding
- Animation timeline: keyframe bone poses, interpolate between them
- Physics: secondary motion for hair, cloth, accessories with spring/lag
- Morph targets: dense mesh over face, drag vertices to author blend shapes (smile, blink, mouth). No ML.

### Advanced Goals
- Sound: lip-sync from audio waveform, phoneme to mouth morph target mapping
- Special effects: particles, glow, motion blur composited over animated character

---

## File Map

```
servers/segmentation/
  app.py                     modified

frontend/src/
  app/
    page.tsx                 modified
  components/
    FrameCanvas.tsx          modified
    FramePanel.tsx           modified
    FullscreenFrame.tsx      modified
    RigCanvas.tsx            full rewrite on react-konva
  lib/
    api.ts                   modified
    rigMesh.ts               new
    rigMath.ts               modified
    rigWarp.ts               new
    rigHistory.ts            new
```
