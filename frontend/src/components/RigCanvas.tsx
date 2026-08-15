'use client';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Stage, Layer, Circle, Line, Text, Shape, Group, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { Icons } from './icons';
import type { Bone, LayerMeta } from '@/lib/rigTypes';
import { makeRootBone, ROOT_BONE_ID } from '@/lib/rigTypes';
import { composeTransform, worldToLocalPoint, angleBetween, IDENTITY_TRANSFORM, skinVertex } from '@/lib/rigMath';
import type { WorldTransform, Vec2 } from '@/lib/rigMath';
import { buildGridMesh, autoWeightByDistance } from '@/lib/rigMesh';
import type { Mesh, BoneInfluence } from '@/lib/rigMesh';
import { drawWarpedMesh } from '@/lib/rigWarp';
import { useHistoryState } from '@/lib/rigHistory';

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
const MESH_COLS = 6;
const MESH_ROWS = 6;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;

interface RigState {
  bones: Bone[];
  bindings: Record<number, string | null>;
}

interface LayerRig {
  mesh: Mesh;
  weights: BoneInfluence[][];
  boneRestPoses: Map<string, WorldTransform>;
  image: HTMLImageElement;
}

export function RigCanvas({ layers, imageDims, referenceImage, onExit }: RigCanvasProps) {
  const { state, setState, setStateLive, pushHistory, undo, redo, canUndo, canRedo } = useHistoryState<RigState>({
    bones: [makeRootBone()],
    bindings: {},
  });
  const { bones, bindings } = state;

  const [selectedBoneId, setSelectedBoneId] = useState<string | null>(ROOT_BONE_ID);
  const [selectedLayerIdx, setSelectedLayerIdx] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [showMesh, setShowMesh] = useState(true);

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
      img.onload = () => setLoadedImages((prev) => ({ ...prev, [i]: true }));
      img.src = `data:image/png;base64,${layer.image}`;
      const mesh = buildGridMesh(layer.meta.w, layer.meta.h, MESH_COLS, MESH_ROWS);
      layerRigsRef.current.set(i, { mesh, weights: [], boneRestPoses: new Map(), image: img });
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

  // ── Pan: middle-mouse drag, or left-drag on empty stage background ──────
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const isMiddle = e.evt.button === 1;
      const isEmptyClick = e.target === e.target.getStage();
      if (isMiddle || (isEmptyClick && !addMode)) {
        stageDragging.current = true;
        e.evt.preventDefault();
      }
    },
    [addMode]
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

  const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const start = dragStartRef.current;
    if (!stageDragging.current || !start) return;
    const dx = e.evt.clientX - start.x;
    const dy = e.evt.clientY - start.y;
    setCamera((prev) => ({ ...prev, x: start.camX + dx, y: start.camY + dy }));
  }, []);

  const handleStageMouseUp = useCallback(() => {
    stageDragging.current = false;
    dragStartRef.current = null;
  }, []);

  const zoomIn = useCallback(() => {
    setCamera((prev) => ({ ...prev, scale: Math.min(MAX_ZOOM, prev.scale * 1.25) }));
  }, []);
  const zoomOut = useCallback(() => {
    setCamera((prev) => ({ ...prev, scale: Math.max(MIN_ZOOM, prev.scale / 1.25) }));
  }, []);
  const resetView = useCallback(() => {
    setCamera({ x: 0, y: 0, scale: baseScale });
  }, [baseScale]);

  // Convert a Konva stage pointer position (screen px) to world/image space.
  const screenToWorld = useCallback(
    (pt: { x: number; y: number }) => ({
      x: (pt.x - camera.x) / camera.scale,
      y: (pt.y - camera.y) / camera.scale,
    }),
    [camera]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!addMode || e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const pos = screenToWorld(pointer);
      const parentId = selectedBoneId ?? ROOT_BONE_ID;
      const parentWorld = worldTransforms.get(parentId) ?? IDENTITY_TRANSFORM;
      const local = worldToLocalPoint(parentWorld, pos);
      const newBone: Bone = {
        id: crypto.randomUUID(),
        name: `Bone ${bones.length}`,
        parentId,
        x: local.x,
        y: local.y,
        rotation: 0,
        scale: 1,
      };
      setState((prev) => ({ ...prev, bones: [...prev.bones, newBone] }));
      setSelectedBoneId(newBone.id);
    },
    [addMode, screenToWorld, selectedBoneId, worldTransforms, bones.length, setState]
  );

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
    setState((prev) => ({ ...prev, bindings: { ...prev.bindings, [selectedLayerIdx]: selectedBoneId } }));

    const rig = layerRigsRef.current.get(selectedLayerIdx);
    const meta = layers[selectedLayerIdx]?.meta;
    if (!rig || !meta) return;

    const boneRestPoses = new Map<string, WorldTransform>();
    for (const [id, wt] of worldTransforms.entries()) boneRestPoses.set(id, wt);

    const bonePositionsLocal = new Map<string, Vec2>();
    for (const [id, wt] of worldTransforms.entries()) {
      bonePositionsLocal.set(id, { x: wt.x - meta.x, y: wt.y - meta.y });
    }

    const weights = autoWeightByDistance(rig.mesh.vertices, bonePositionsLocal, 3, 2);
    layerRigsRef.current.set(selectedLayerIdx, { ...rig, weights, boneRestPoses });
  }, [selectedLayerIdx, selectedBoneId, worldTransforms, layers, setState]);

  const canDeleteSelected =
    selectedBoneId !== null && selectedBoneId !== ROOT_BONE_ID && !bones.some((b) => b.parentId === selectedBoneId);

  const deleteSelected = useCallback(() => {
    if (!canDeleteSelected || !selectedBoneId) return;
    setState((prev) => {
      const nextBindings = { ...prev.bindings };
      for (const k of Object.keys(nextBindings)) {
        if (nextBindings[Number(k)] === selectedBoneId) nextBindings[Number(k)] = null;
      }
      return { bones: prev.bones.filter((b) => b.id !== selectedBoneId), bindings: nextBindings };
    });
    setSelectedBoneId(ROOT_BONE_ID);
  }, [canDeleteSelected, selectedBoneId, setState]);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <button
            onClick={() => setAddMode((v) => !v)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
              (addMode ? 'bg-accent text-bg border-accent' : 'bg-raised border-border text-muted hover:text-text')
            }
          >
            {addMode ? 'Click canvas to add bone' : 'Add bone'}
          </button>
          <button
            onClick={bindSelected}
            disabled={selectedLayerIdx === null || !selectedBoneId}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Bind layer → bone
          </button>
          <button
            onClick={deleteSelected}
            disabled={!canDeleteSelected}
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
            onClick={handleStageClick}
            style={{ cursor: addMode ? 'crosshair' : 'grab' }}
          >
            <Layer listening={false}>
              {refImg && <KonvaImage image={refImg} width={imageDims.w} height={imageDims.h} opacity={0.4} />}
            </Layer>

            <Layer>
              {/* Unbound layers: static image */}
              {layers.map((layer, i) => {
                if (bindings[i]) return null;
                const rig = layerRigsRef.current.get(i);
                if (!rig || !loadedImages[i]) return null;
                return (
                  <KonvaImage
                    key={`static-${i}`}
                    image={rig.image}
                    x={layer.meta.x}
                    y={layer.meta.y}
                    width={layer.meta.w}
                    height={layer.meta.h}
                    listening={false}
                  />
                );
              })}

              {/* Bound layers: warped mesh via custom Shape */}
              {layers.map((layer, i) => {
                const boneId = bindings[i];
                if (!boneId) return null;
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

              {/* Mesh guide outlines — actual subdivided grid, not just the bbox */}
              {showMesh &&
                layers.map((layer, i) => {
                  const rig = layerRigsRef.current.get(i);
                  if (!rig || !loadedImages[i]) return null;
                  const boneId = bindings[i];
                  const bound = !!boneId;

                  return (
                    <Shape
                      key={`guide-${i}`}
                      listening={false}
                      sceneFunc={(ctx) => {
                        const worldVerts = rig.mesh.vertices.map((v, vi) => {
                          const restWorld = { x: v.x + layer.meta.x, y: v.y + layer.meta.y };
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
                      draggable
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
        <p className="text-[11px] text-dim mt-1.5">Scroll to zoom · middle-click or drag empty space to pan</p>
      </div>

      <div className="w-full lg:w-52 shrink-0">
        <div className="flex items-center gap-2 mb-2.5">
          <Icons.Layers className="w-3.5 h-3.5 text-muted" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Layers</span>
        </div>
        <div className="flex lg:flex-col flex-wrap gap-2">
          {layers.map((layer, i) => {
            const bound = bindings[i];
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
                {bound && <Icons.Eye className="absolute bottom-0.5 right-0.5 w-3 h-3 text-accent" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
