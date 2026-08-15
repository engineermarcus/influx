'use client';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Stage, Layer, Circle, Line, Text, Shape, Group, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { Icons } from './icons';
import type { Bone, LayerMeta } from '@/lib/rigTypes';
import { composeTransform, worldToLocalPoint, angleBetween, IDENTITY_TRANSFORM, skinVertex } from '@/lib/rigMath';
import type { WorldTransform, Vec2 } from '@/lib/rigMath';
import { buildGridMesh, buildShapedMesh, autoWeightByDistance } from '@/lib/rigMesh';
import type { Mesh, BoneInfluence } from '@/lib/rigMesh';
import { drawWarpedMesh } from '@/lib/rigWarp';
import { useHistoryState } from '@/lib/rigHistory';
import { autoRigBody } from '@/lib/autoRig';

interface RigLayerInput {
  image: string; // base64, no data: prefix
  meta: LayerMeta;
}

interface RigCanvasProps {
  layers: RigLayerInput[];
  imageDims: { w: number; h: number };
  referenceImage?: string | null;
  onExit: () => void;
}

const STAGE_W = 880;
const STAGE_H = 620;
const MESH_COLS = 18;
const MESH_ROWS = 18;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const MIN_BONE_DRAG_PX = 6; // world px — below this, new bone gets rotation 0 instead of a noisy angle

// Blender/Cascadeur pattern: Edit mode builds the skeleton (rest pose) —
// add/move/reparent bones, bind layers. Pose mode only rotates bones
// relative to their rest pose; no structural changes possible there.
type RigMode = 'edit' | 'pose';

// Inochi2D pattern: most layers don't need mesh deformation, just rigid
// transform inheritance from a bone (like a DOM element parented to a
// transformed <g>). Mesh mode (weight-painted deformation) is reserved for
// layers that need to visibly bend — torso, limbs with a joint inside them.
type BindMode = 'rigid' | 'mesh';

interface Binding {
  boneId: string;
  mode: BindMode;
}

interface RigState {
  bones: Bone[];
  bindings: Record<number, Binding | null>;
}

interface LayerRig {
  mesh: Mesh;
  weights: BoneInfluence[][];
  boneRestPoses: Map<string, WorldTransform>;
  image: HTMLImageElement;
}

export function RigCanvas({ layers, imageDims, referenceImage, onExit }: RigCanvasProps) {
  const { state, setState, setStateLive, pushHistory, undo, redo, canUndo, canRedo } = useHistoryState<RigState>({
    bones: [],
    bindings: {},
  });
  const { bones, bindings } = state;

  const [rigMode, setRigMode] = useState<RigMode>('edit');
  // No forced root — the first bone placed on the model has parentId: null
  // and becomes the anchor by construction, wherever the person clicked.
  const [selectedBoneId, setSelectedBoneId] = useState<string | null>(null);
  const [selectedLayerIdx, setSelectedLayerIdx] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  const [bindMode, setBindMode] = useState<BindMode>('rigid');
  const [layerOffsets, setLayerOffsets] = useState<Record<number, { x: number; y: number }>>({});

  // Camera: Konva Stage's own x/y/scale, so pan+zoom is native, not hand-rolled.
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const stageDragging = useRef(false);

  const layerRigsRef = useRef<Map<number, LayerRig>>(new Map());
  const [loadedImages, setLoadedImages] = useState<Record<number, boolean>>({});
  const [refImg, setRefImg] = useState<HTMLImageElement | null>(null);

  // Fit-to-view scale so the full imageDims box is visible inside the stage on load.
  const baseScale = imageDims.w > 0 ? Math.min(STAGE_W / imageDims.w, STAGE_H / imageDims.h) : 1;

  useEffect(() => {
    setCamera({ x: 0, y: 0, scale: baseScale });
  }, [baseScale]);

  useEffect(() => {
    if (!referenceImage) {
      setRefImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setRefImg(img);
    img.src = referenceImage;
  }, [referenceImage]);

  useEffect(() => {
    layers.forEach((layer, i) => {
      if (layerRigsRef.current.has(i)) return;
      const img = new Image();
      img.onload = () => {
        const { w, h } = layer.meta;
        let mesh;
        try {
          const off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          const offCtx = off.getContext('2d');
          if (!offCtx) throw new Error('no 2d context');
          offCtx.drawImage(img, 0, 0, w, h);
          const rgba = offCtx.getImageData(0, 0, w, h).data;
          const alpha = new Uint8Array(w * h);
          for (let p = 0; p < w * h; p++) alpha[p] = rgba[p * 4 + 3];
          mesh = buildShapedMesh(alpha, w, h, MESH_COLS, MESH_ROWS);
        } catch {
          // getImageData can throw on a tainted canvas (e.g. cross-origin
          // image data) — fall back to the plain rectangular grid so rigging
          // still works, just without silhouette conforming.
          mesh = buildGridMesh(w, h, MESH_COLS, MESH_ROWS);
        }
        const rig = layerRigsRef.current.get(i);
        layerRigsRef.current.set(i, { ...(rig as LayerRig), mesh });
        setLoadedImages((prev) => ({ ...prev, [i]: true }));
      };
      img.src = `data:image/png;base64,${layer.image}`;
      // Placeholder mesh so the ref entry exists immediately; replaced with
      // the shaped mesh once the image decodes and alpha is readable above.
      const placeholderMesh = buildGridMesh(layer.meta.w, layer.meta.h, MESH_COLS, MESH_ROWS);
      layerRigsRef.current.set(i, { mesh: placeholderMesh, weights: [], boneRestPoses: new Map(), image: img });
    });
  }, [layers]);

  const worldTransforms = useMemo(() => {
    const map = new Map<string, WorldTransform>();
    for (const b of bones) {
      const parentWorld = b.parentId ? map.get(b.parentId) ?? IDENTITY_TRANSFORM : IDENTITY_TRANSFORM;
      map.set(b.id, composeTransform(parentWorld, { x: b.x, y: b.y, rotation: b.rotation, scale: b.scale }));
    }
    return map;
  }, [bones]);

  const boneById = useMemo(() => {
    const map = new Map<string, Bone>();
    for (const b of bones) map.set(b.id, b);
    return map;
  }, [bones]);

  // ── Zoom: wheel over the stage ──────────────────────────────────────────
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    setCamera((prev) => {
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const factor = 1.08;
      const newScale = direction > 0 ? prev.scale * factor : prev.scale / factor;
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));

      // Zoom toward the pointer, not the origin.
      const mousePointTo = {
        x: (pointer.x - prev.x) / prev.scale,
        y: (pointer.y - prev.y) / prev.scale,
      };
      return {
        scale: clamped,
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      };
    });
  }, []);

  // Convert a Konva stage pointer position (screen px) to world/image space.
  const screenToWorld = useCallback(
    (pt: { x: number; y: number }) => ({
      x: (pt.x - camera.x) / camera.scale,
      y: (pt.y - camera.y) / camera.scale,
    }),
    [camera]
  );

  // ── Bone creation: click-drag defines head + tail direction in one
  // gesture (Blender's "extrude bone" pattern). ──────────────────────────
  const addBoneStart = useRef<{ x: number; y: number } | null>(null);
  const [addBonePreview, setAddBonePreview] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);

  // ── Pan: middle-mouse drag, or left-drag on empty stage background ──────
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const isMiddle = e.evt.button === 1;
      const isEmptyClick = e.target === e.target.getStage();

      if (rigMode === 'edit' && addMode && isEmptyClick && !isMiddle) {
        addBoneStart.current = screenToWorld(e.target.getStage()!.getPointerPosition()!);
        e.evt.preventDefault();
        return;
      }

      if (isMiddle || (isEmptyClick && !addMode)) {
        stageDragging.current = true;
        e.evt.preventDefault();
      }
    },
    [addMode, rigMode, screenToWorld]
  );

  const dragStartRef = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);

  const handleStageMouseDownCapture = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (stageDragging.current) {
        dragStartRef.current = { x: e.evt.clientX, y: e.evt.clientY, camX: camera.x, camY: camera.y };
      }
    },
    [camera]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (addBoneStart.current) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer) setAddBonePreview({ from: addBoneStart.current, to: screenToWorld(pointer) });
        return;
      }
      const start = dragStartRef.current;
      if (!stageDragging.current || !start) return;
      const dx = e.evt.clientX - start.x;
      const dy = e.evt.clientY - start.y;
      setCamera((prev) => ({ ...prev, x: start.camX + dx, y: start.camY + dy }));
    },
    [screenToWorld]
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      stageDragging.current = false;
      dragStartRef.current = null;

      if (addBoneStart.current) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        const from = addBoneStart.current;
        const to = pointer ? screenToWorld(pointer) : from;

        // Chain build: each new bone parents to whatever is currently
        // selected. A freshly placed bone auto-selects itself below, so
        // clicking repeatedly draws a connected chain — click 1 becomes the
        // root (parentId: null), click 2 parents to click 1, and so on.
        const parentId = selectedBoneId;
        const parentWorld = parentId ? worldTransforms.get(parentId) ?? IDENTITY_TRANSFORM : IDENTITY_TRANSFORM;
        const local = worldToLocalPoint(parentWorld, from);

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dragLenScreen = Math.hypot(dx, dy) * camera.scale;
        const rotation = dragLenScreen > MIN_BONE_DRAG_PX ? Math.atan2(dy, dx) - parentWorld.rotation : 0;

        const newBone: Bone = {
          id: crypto.randomUUID(),
          name: `Bone ${bones.length + 1}`,
          parentId,
          x: local.x,
          y: local.y,
          rotation,
          scale: 1,
        };
        pushHistory();
        setState((prev) => ({ ...prev, bones: [...prev.bones, newBone] }));
        setSelectedBoneId(newBone.id);

        addBoneStart.current = null;
        setAddBonePreview(null);
      }
    },
    [selectedBoneId, worldTransforms, camera.scale, bones.length, setState, pushHistory, screenToWorld]
  );

  const zoomIn = useCallback(() => {
    setCamera((prev) => ({ ...prev, scale: Math.min(MAX_ZOOM, prev.scale * 1.25) }));
  }, []);
  const zoomOut = useCallback(() => {
    setCamera((prev) => ({ ...prev, scale: Math.max(MIN_ZOOM, prev.scale / 1.25) }));
  }, []);
  const resetView = useCallback(() => {
    setCamera({ x: 0, y: 0, scale: baseScale });
  }, [baseScale]);

  // Edit mode only: free translate of a bone's head (this IS the rest pose).
  const onBoneDragMove = useCallback(
    (boneId: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      const bone = boneById.get(boneId);
      if (!bone) return;
      const parentWorld = bone.parentId ? worldTransforms.get(bone.parentId) ?? IDENTITY_TRANSFORM : IDENTITY_TRANSFORM;
      const pos = screenToWorld({ x: e.target.x(), y: e.target.y() });
      const local = worldToLocalPoint(parentWorld, pos);
      setStateLive((prev) => ({
        ...prev,
        bones: prev.bones.map((b) => (b.id === boneId ? { ...b, x: local.x, y: local.y } : b)),
      }));
    },
    [boneById, worldTransforms, screenToWorld, setStateLive]
  );

  // Available in both modes: rotate-only handle, Blender Pose Mode's
  // constraint (bones transform relative to rest, never restructure).
  const onHandleDragMove = useCallback(
    (boneId: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      const bone = boneById.get(boneId);
      if (!bone) return;
      const parentWorld = bone.parentId ? worldTransforms.get(bone.parentId) ?? IDENTITY_TRANSFORM : IDENTITY_TRANSFORM;
      const boneWorld = worldTransforms.get(boneId) ?? IDENTITY_TRANSFORM;
      const pos = screenToWorld({ x: e.target.x(), y: e.target.y() });
      const angle = angleBetween(boneWorld, pos);
      setStateLive((prev) => ({
        ...prev,
        bones: prev.bones.map((b) => (b.id === boneId ? { ...b, rotation: angle - parentWorld.rotation } : b)),
      }));
    },
    [boneById, worldTransforms, screenToWorld, setStateLive]
  );

  const bindSelected = useCallback(() => {
    if (selectedLayerIdx === null || !selectedBoneId) return;
    setState((prev) => ({
      ...prev,
      bindings: { ...prev.bindings, [selectedLayerIdx]: { boneId: selectedBoneId, mode: bindMode } },
    }));

    const rig = layerRigsRef.current.get(selectedLayerIdx);
    const meta = layers[selectedLayerIdx]?.meta;
    if (!rig || !meta) return;

    // Rest poses are captured either way — rigid mode needs just the one
    // bone's rest transform to compute the pivot delta later, mesh mode
    // needs the whole map for skinVertex.
    const boneRestPoses = new Map<string, WorldTransform>();
    for (const [id, wt] of worldTransforms.entries()) boneRestPoses.set(id, wt);

    if (bindMode === 'rigid') {
      layerRigsRef.current.set(selectedLayerIdx, { ...rig, weights: [], boneRestPoses });
      return;
    }

    const bonePositionsLocal = new Map<string, Vec2>();
    for (const [id, wt] of worldTransforms.entries()) {
      bonePositionsLocal.set(id, { x: wt.x - meta.x, y: wt.y - meta.y });
    }
    const weights = autoWeightByDistance(rig.mesh.vertices, bonePositionsLocal, 3, 2);
    layerRigsRef.current.set(selectedLayerIdx, { ...rig, weights, boneRestPoses });
  }, [selectedLayerIdx, selectedBoneId, bindMode, worldTransforms, layers, setState]);

  const canDeleteSelected =
    selectedBoneId !== null && !bones.some((b) => b.parentId === selectedBoneId);

  const deleteSelected = useCallback(() => {
    if (!canDeleteSelected || !selectedBoneId) return;
    setState((prev) => {
      const nextBindings = { ...prev.bindings };
      for (const k of Object.keys(nextBindings)) {
        if (nextBindings[Number(k)]?.boneId === selectedBoneId) nextBindings[Number(k)] = null;
      }
      return { bones: prev.bones.filter((b) => b.id !== selectedBoneId), bindings: nextBindings };
    });
    setSelectedBoneId(null);
  }, [canDeleteSelected, selectedBoneId, setState]);

  const [autoRigging, setAutoRigging] = useState(false);
  const runAutoRig = useCallback(async () => {
    if (!refImg) return;
    setAutoRigging(true);
    try {
      const detected = await autoRigBody(refImg);
      pushHistory();
      setState((prev) => ({ ...prev, bones: detected }));
      setSelectedBoneId('root');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAutoRigging(false);
    }
  }, [refImg, pushHistory, setState]);

  const isEdit = rigMode === 'edit';

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          {/* Edit / Pose mode toggle — Blender Edit Mode vs Pose Mode */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => { setRigMode('edit'); setAddMode(false); }}
              className={'px-3 py-1.5 text-xs font-medium transition-colors ' + (isEdit ? 'bg-accent text-bg' : 'bg-raised text-muted hover:text-text')}
            >
              Edit
            </button>
            <button
              onClick={() => { setRigMode('pose'); setAddMode(false); }}
              className={'px-3 py-1.5 text-xs font-medium transition-colors ' + (!isEdit ? 'bg-amber text-bg' : 'bg-raised text-muted hover:text-text')}
            >
              Pose
            </button>
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={runAutoRig}
            disabled={!isEdit || !refImg || autoRigging}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {autoRigging ? 'Detecting pose…' : 'Auto-rig body'}
          </button>

          <button
            onClick={() => setAddMode((v) => !v)}
            disabled={!isEdit}
            className={
              'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
              (addMode ? 'bg-accent text-bg border-accent' : 'bg-raised border-border text-muted hover:text-text')
            }
          >
            {addMode ? 'Drag canvas to place bone' : 'Add bone'}
          </button>

          {/* Rigid / Mesh bind mode — Inochi2D pattern: most layers are
              rigid (just inherit the bone's transform, no weights); mesh
              is only for layers that need to visibly bend. */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setBindMode('rigid')}
              disabled={!isEdit}
              title="Layer moves as one solid piece with the bone — no deformation"
              className={'px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' + (bindMode === 'rigid' ? 'bg-accent text-bg' : 'bg-raised text-muted hover:text-text')}
            >
              Rigid
            </button>
            <button
              onClick={() => setBindMode('mesh')}
              disabled={!isEdit}
              title="Layer bends around the bone via weighted mesh deformation"
              className={'px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' + (bindMode === 'mesh' ? 'bg-accent text-bg' : 'bg-raised text-muted hover:text-text')}
            >
              Mesh
            </button>
          </div>

          <button
            onClick={bindSelected}
            disabled={!isEdit || selectedLayerIdx === null || !selectedBoneId}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Bind layer → bone
          </button>
          <button
            onClick={deleteSelected}
            disabled={!isEdit || !canDeleteSelected}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icons.Trash className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
            Delete bone
          </button>
          <button
            onClick={() => setShowMesh((v) => !v)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
              (showMesh ? 'bg-amber/15 text-amber border-amber/40' : 'bg-raised border-border text-muted hover:text-text')
            }
          >
            Mesh guides: {showMesh ? 'On' : 'Off'}
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Undo"
          >
            <Icons.Undo className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors scale-x-[-1]"
            title="Redo"
          >
            <Icons.Undo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          <button onClick={zoomOut} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text transition-colors" title="Zoom out">
            −
          </button>
          <span className="text-xs text-dim w-12 text-center tabular-nums">{Math.round(camera.scale * 100)}%</span>
          <button onClick={zoomIn} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text transition-colors" title="Zoom in">
            +
          </button>
          <button onClick={resetView} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text transition-colors" title="Reset view">
            <Icons.Fullscreen className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onExit}
            className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text transition-colors"
          >
            <Icons.Close className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
            Exit rig mode
          </button>
        </div>

        <div className="relative bg-raised border border-border rounded-xl overflow-hidden max-w-full" style={{ width: STAGE_W, height: STAGE_H }}>
          <Stage
            width={STAGE_W}
            height={STAGE_H}
            x={camera.x}
            y={camera.y}
            scaleX={camera.scale}
            scaleY={camera.scale}
            onWheel={handleWheel}
            onMouseDown={(e) => {
              handleStageMouseDownCapture(e);
              handleStageMouseDown(e);
            }}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            style={{ cursor: isEdit && addMode ? 'crosshair' : 'grab' }}
          >
            <Layer listening={false}>
              {refImg && <KonvaImage image={refImg} width={imageDims.w} height={imageDims.h} opacity={0.4} />}
            </Layer>

            <Layer>
              {/* Unbound layers: static image. Draggable in Edit mode only. */}
              {layers.map((layer, i) => {
                if (bindings[i]) return null;
                const rig = layerRigsRef.current.get(i);
                if (!rig || !loadedImages[i]) return null;
                const off = layerOffsets[i] ?? { x: 0, y: 0 };
                return (
                  <KonvaImage
                    key={`static-${i}`}
                    image={rig.image}
                    x={layer.meta.x + off.x}
                    y={layer.meta.y + off.y}
                    width={layer.meta.w}
                    height={layer.meta.h}
                    draggable={isEdit}
                    onDragStart={() => setSelectedLayerIdx(i)}
                    onDragMove={(e) => {
                      setLayerOffsets((prev) => ({
                        ...prev,
                        [i]: { x: e.target.x() - layer.meta.x, y: e.target.y() - layer.meta.y },
                      }));
                    }}
                    onMouseEnter={(e) => {
                      if (!isEdit) return;
                      const stage = e.target.getStage();
                      if (stage) stage.container().style.cursor = 'move';
                    }}
                    onMouseLeave={(e) => {
                      const stage = e.target.getStage();
                      if (stage) stage.container().style.cursor = isEdit && addMode ? 'crosshair' : 'grab';
                    }}
                  />
                );
              })}

              {/* Rigid-bound layers: no deformation, just inherit the
                  bone's transform relative to its rest pose — pivot around
                  the bone's rest-time position via Konva offset. */}
              {layers.map((layer, i) => {
                const binding = bindings[i];
                if (!binding || binding.mode !== 'rigid') return null;
                const rig = layerRigsRef.current.get(i);
                if (!rig || !loadedImages[i]) return null;

                const restWorld = rig.boneRestPoses.get(binding.boneId) ?? IDENTITY_TRANSFORM;
                const currentWorld = worldTransforms.get(binding.boneId) ?? IDENTITY_TRANSFORM;
                const deltaRotationDeg = ((currentWorld.rotation - restWorld.rotation) * 180) / Math.PI;
                const deltaScale = restWorld.scale !== 0 ? currentWorld.scale / restWorld.scale : 1;

                return (
                  <KonvaImage
                    key={`rigid-${i}`}
                    image={rig.image}
                    x={currentWorld.x}
                    y={currentWorld.y}
                    offsetX={restWorld.x - layer.meta.x}
                    offsetY={restWorld.y - layer.meta.y}
                    width={layer.meta.w}
                    height={layer.meta.h}
                    rotation={deltaRotationDeg}
                    scaleX={deltaScale}
                    scaleY={deltaScale}
                    listening={false}
                  />
                );
              })}

              {/* Mesh-bound layers: warped mesh via custom Shape */}
              {layers.map((layer, i) => {
                const binding = bindings[i];
                if (!binding || binding.mode !== 'mesh') return null;
                const rig = layerRigsRef.current.get(i);
                if (!rig || !loadedImages[i] || !rig.weights.length) return null;

                return (
                  <Shape
                    key={`warp-${i}`}
                    listening={false}
                    sceneFunc={(ctx, shape) => {
                      const restVertices = rig.mesh.vertices;
                      const posedVertices = restVertices.map((v, vi) => {
                        const posedWorld = skinVertex(
                          { x: v.x + layer.meta.x, y: v.y + layer.meta.y },
                          rig.weights[vi] ?? [],
                          rig.boneRestPoses,
                          worldTransforms
                        );
                        return posedWorld;
                      });
                      drawWarpedMesh({
                        ctx: ctx._context,
                        image: rig.image,
                        mesh: rig.mesh,
                        restVertices,
                        posedVertices,
                      });
                      ctx.fillStrokeShape(shape);
                    }}
                  />
                );
              })}

              {/* Mesh guide outlines — only meaningful for mesh-mode
                  layers and still-unbound layers (shows what would deform). */}
              {showMesh &&
                layers.map((layer, i) => {
                  const binding = bindings[i];
                  if (binding && binding.mode === 'rigid') return null;
                  const rig = layerRigsRef.current.get(i);
                  if (!rig || !loadedImages[i]) return null;
                  const bound = !!binding;

                  return (
                    <Shape
                      key={`guide-${i}`}
                      listening={false}
                      sceneFunc={(ctx) => {
                        const off = layerOffsets[i] ?? { x: 0, y: 0 };
                        const worldVerts = rig.mesh.vertices.map((v, vi) => {
                          const restWorld = { x: v.x + layer.meta.x + off.x, y: v.y + layer.meta.y + off.y };
                          if (!bound || !rig.weights.length) return restWorld;
                          return skinVertex(restWorld, rig.weights[vi] ?? [], rig.boneRestPoses, worldTransforms);
                        });

                        ctx.beginPath();
                        for (const tri of rig.mesh.triangles) {
                          const a = worldVerts[tri.a], b = worldVerts[tri.b], c = worldVerts[tri.c];
                          ctx.moveTo(a.x, a.y);
                          ctx.lineTo(b.x, b.y);
                          ctx.lineTo(c.x, c.y);
                          ctx.lineTo(a.x, a.y);
                        }
                        ctx.strokeStyle = bound ? 'rgba(80,200,255,0.5)' : 'rgba(255,176,32,0.5)';
                        ctx.lineWidth = 1 / camera.scale;
                        ctx.setLineDash(bound ? [] : [4 / camera.scale, 4 / camera.scale]);
                        ctx.stroke();
                      }}
                    />
                  );
                })}

              {/* Bone connector lines */}
              {bones
                .filter((b) => b.parentId)
                .map((b) => {
                  const parentWorld = worldTransforms.get(b.parentId!);
                  const world = worldTransforms.get(b.id);
                  if (!parentWorld || !world) return null;
                  return (
                    <Line
                      key={b.id}
                      points={[parentWorld.x, parentWorld.y, world.x, world.y]}
                      stroke="var(--color-accent, #4dd0e1)"
                      strokeWidth={2 / camera.scale}
                      opacity={0.85}
                      listening={false}
                    />
                  );
                })}

              {/* Live preview line while dragging out a new bone in Edit mode */}
              {addBonePreview && (
                <Line
                  points={[addBonePreview.from.x, addBonePreview.from.y, addBonePreview.to.x, addBonePreview.to.y]}
                  stroke="#f5a524"
                  strokeWidth={2 / camera.scale}
                  dash={[6 / camera.scale, 4 / camera.scale]}
                  listening={false}
                />
              )}

              {/* Bone handles */}
              {bones.map((b) => {
                const world = worldTransforms.get(b.id);
                if (!world) return null;
                const selected = selectedBoneId === b.id;
                const handleLen = 42 / camera.scale;
                const handlePos = {
                  x: world.x + handleLen * Math.cos(world.rotation),
                  y: world.y + handleLen * Math.sin(world.rotation),
                };
                return (
                  <Group key={b.id}>
                    <Circle
                      x={world.x}
                      y={world.y}
                      radius={7 / camera.scale}
                      fill={selected ? '#f5a524' : '#4dd0e1'}
                      stroke={selected ? '#f5a524' : '#4dd0e1'}
                      draggable={isEdit}
                      onClick={() => setSelectedBoneId(b.id)}
                      onDragStart={() => {
                        setSelectedBoneId(b.id);
                        pushHistory();
                      }}
                      onDragMove={onBoneDragMove(b.id)}
                    />
                    {showMesh && (
                      <Text
                        x={world.x + 8 / camera.scale}
                        y={world.y - 16 / camera.scale}
                        text={b.name}
                        fontSize={11 / camera.scale}
                        fill="white"
                        listening={false}
                      />
                    )}
                    {selected && (
                      <Circle
                        x={handlePos.x}
                        y={handlePos.y}
                        radius={5 / camera.scale}
                        fill="#f5a524"
                        draggable
                        onDragStart={pushHistory}
                        onDragMove={onHandleDragMove(b.id)}
                      />
                    )}
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        </div>
        <p className="text-[11px] text-dim mt-1.5">
          {isEdit
            ? 'Edit mode: drag canvas to add bones, drag bone heads to reposition · Rigid/Mesh selects how the next bind behaves · Scroll to zoom · middle-click or drag empty space to pan'
            : 'Pose mode: drag the outer handle to rotate a bone · structural edits are locked — switch to Edit mode to add/move/bind bones'}
        </p>
      </div>

      <div className="w-full lg:w-52 shrink-0">
        <div className="flex items-center gap-2 mb-2.5">
          <Icons.Layers className="w-3.5 h-3.5 text-muted" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Layers</span>
        </div>
        <div className="flex lg:flex-col flex-wrap gap-2">
          {layers.map((layer, i) => {
            const binding = bindings[i];
            return (
              <button
                key={i}
                onClick={() => setSelectedLayerIdx(i)}
                className={
                  'relative w-16 h-16 lg:w-full lg:h-16 border rounded-lg overflow-hidden flex items-center justify-center transition-colors ' +
                  (selectedLayerIdx === i ? 'border-amber' : 'border-border hover:border-accent/50')
                }
              >
                <img
                  src={`data:image/png;base64,${layer.image}`}
                  alt={`Layer ${i + 1}`}
                  className="max-w-full max-h-full object-contain"
                />
                <span className="absolute top-0.5 left-1 text-[10px] font-mono font-semibold text-dim">{i + 1}</span>
                {binding && (
                  <span
                    className="absolute bottom-0.5 right-0.5 text-[9px] font-mono px-1 rounded bg-bg/80"
                    title={binding.mode === 'rigid' ? 'Rigid bind' : 'Mesh bind'}
                  >
                    {binding.mode === 'rigid' ? <Icons.Eye className="w-3 h-3 text-accent" /> : <Icons.Eye className="w-3 h-3 text-amber" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
