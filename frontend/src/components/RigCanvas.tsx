'use client';
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Icons } from './icons';
import type { Bone, LayerMeta } from '@/lib/rigTypes';
import { makeRootBone, ROOT_BONE_ID } from '@/lib/rigTypes';
import { composeTransform, worldToLocalPoint, angleBetween, IDENTITY_TRANSFORM } from '@/lib/rigMath';
import type { WorldTransform, Vec2 } from '@/lib/rigMath';
import { buildGridMesh, autoWeightByDistance } from '@/lib/rigMesh';
import type { Mesh, BoneInfluence } from '@/lib/rigMesh';
import { skinVertex } from '@/lib/rigMath';
import { drawWarpedMesh } from '@/lib/rigWarp';

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

const DISPLAY_W = 880;
const HANDLE_SCREEN_LEN = 42;
const GRID_STEP_IMG_PX = 50;
const MESH_COLS = 6;
const MESH_ROWS = 6;

// Per-layer state needed for mesh deformation, keyed by layer index.
interface LayerRig {
  mesh: Mesh;
  weights: BoneInfluence[][]; // one entry per mesh vertex
  boneRestPoses: Map<string, WorldTransform>; // captured at bind time
  image: HTMLImageElement;
}

export function RigCanvas({ layers, imageDims, referenceImage, onExit }: RigCanvasProps) {
  const [bones, setBones] = useState<Bone[]>([makeRootBone()]);
  const [bindings, setBindings] = useState<Record<number, string | null>>({});
  const [selectedBoneId, setSelectedBoneId] = useState<string | null>(ROOT_BONE_ID);
  const [selectedLayerIdx, setSelectedLayerIdx] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [showMesh, setShowMesh] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: 'bone' | 'handle'; boneId: string; pointerId: number } | null>(null);
  const layerRigsRef = useRef<Map<number, LayerRig>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [loadedImages, setLoadedImages] = useState<Record<number, boolean>>({});

  const scale = imageDims.w > 0 ? DISPLAY_W / imageDims.w : 1;
  const displayH = imageDims.h * scale;
  const gridStepScreen = GRID_STEP_IMG_PX * scale;

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

  const toScreen = useCallback((p: { x: number; y: number }) => ({ x: p.x * scale, y: p.y * scale }), [scale]);

  const clientToImageSpace = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale]
  );

  // Preload each layer's image into an HTMLImageElement so it can be drawn to canvas.
  useEffect(() => {
    layers.forEach((layer, i) => {
      if (layerRigsRef.current.has(i)) return;
      const img = new Image();
      img.onload = () => {
        setLoadedImages((prev) => ({ ...prev, [i]: true }));
      };
      img.src = `data:image/png;base64,${layer.image}`;
      // Mesh is built in the layer's own local pixel space (0,0 = crop top-left).
      const mesh = buildGridMesh(layer.meta.w, layer.meta.h, MESH_COLS, MESH_ROWS);
      layerRigsRef.current.set(i, {
        mesh,
        weights: [],
        boneRestPoses: new Map(),
        image: img,
      });
    });
  }, [layers]);

  const handleStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!addMode || e.target !== stageRef.current) return;
      const pos = clientToImageSpace(e.clientX, e.clientY);
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
      setBones((prev) => [...prev, newBone]);
      setSelectedBoneId(newBone.id);
    },
    [addMode, clientToImageSpace, selectedBoneId, worldTransforms, bones.length]
  );

  const startDrag = useCallback(
    (kind: 'bone' | 'handle', boneId: string) => (e: React.PointerEvent) => {
      e.stopPropagation();
      dragRef.current = { kind, boneId, pointerId: e.pointerId };
      (e.target as Element).setPointerCapture(e.pointerId);
      setSelectedBoneId(boneId);
    },
    []
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const bone = boneById.get(drag.boneId);
      if (!bone) return;
      const parentWorld = bone.parentId ? worldTransforms.get(bone.parentId) ?? IDENTITY_TRANSFORM : IDENTITY_TRANSFORM;
      const pos = clientToImageSpace(e.clientX, e.clientY);

      if (drag.kind === 'bone') {
        const local = worldToLocalPoint(parentWorld, pos);
        setBones((prev) => prev.map((b) => (b.id === bone.id ? { ...b, x: local.x, y: local.y } : b)));
      } else {
        const boneWorld = worldTransforms.get(bone.id) ?? IDENTITY_TRANSFORM;
        const angle = angleBetween(boneWorld, pos);
        setBones((prev) => prev.map((b) => (b.id === bone.id ? { ...b, rotation: angle - parentWorld.rotation } : b)));
      }
    },
    [boneById, worldTransforms, clientToImageSpace]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Binding a layer to a bone captures the CURRENT world transforms of every
  // bone as that layer's "rest pose" reference, and computes vertex weights
  // relative to bone positions at this moment. Re-binding recalculates both,
  // which lets you re-anchor a layer if you move bones before binding.
  const bindSelected = useCallback(() => {
    if (selectedLayerIdx === null || !selectedBoneId) return;
    setBindings((prev) => ({ ...prev, [selectedLayerIdx]: selectedBoneId }));

    const rig = layerRigsRef.current.get(selectedLayerIdx);
    const meta = layers[selectedLayerIdx]?.meta;
    if (!rig || !meta) return;

    const boneRestPoses = new Map<string, WorldTransform>();
    for (const [id, wt] of worldTransforms.entries()) boneRestPoses.set(id, wt);

    // Bone positions relative to this layer's local mesh space, for weighting.
    const bonePositionsLocal = new Map<string, Vec2>();
    for (const [id, wt] of worldTransforms.entries()) {
      bonePositionsLocal.set(id, { x: wt.x - meta.x, y: wt.y - meta.y });
    }

    const weights = autoWeightByDistance(rig.mesh.vertices, bonePositionsLocal, 3, 2);

    layerRigsRef.current.set(selectedLayerIdx, {
      ...rig,
      weights,
      boneRestPoses,
    });
  }, [selectedLayerIdx, selectedBoneId, worldTransforms, layers]);

  const canDeleteSelected =
    selectedBoneId !== null && selectedBoneId !== ROOT_BONE_ID && !bones.some((b) => b.parentId === selectedBoneId);

  const deleteSelected = useCallback(() => {
    if (!canDeleteSelected || !selectedBoneId) return;
    setBones((prev) => prev.filter((b) => b.id !== selectedBoneId));
    setBindings((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[Number(k)] === selectedBoneId) next[Number(k)] = null;
      }
      return next;
    });
    setSelectedBoneId(ROOT_BONE_ID);
  }, [canDeleteSelected, selectedBoneId]);

  // Re-render every bound layer's canvas whenever bone poses change.
  useEffect(() => {
    layers.forEach((layer, i) => {
      const boneId = bindings[i];
      if (!boneId) return;
      const rig = layerRigsRef.current.get(i);
      const canvas = canvasRefs.current.get(i);
      if (!rig || !canvas || !rig.weights.length || !loadedImages[i]) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const restVertices = rig.mesh.vertices; // local space, unscaled
      const posedVertices = restVertices.map((v, vi) => {
        const posedLocal = skinVertex(
          { x: v.x + layer.meta.x, y: v.y + layer.meta.y }, // rest point in full-image space
          rig.weights[vi] ?? [],
          rig.boneRestPoses,
          worldTransforms
        );
        // Convert to screen space for drawing.
        return toScreen(posedLocal);
      });
      const restScreenVertices = restVertices.map((v) => toScreen({ x: v.x, y: v.y }));

      drawWarpedMesh({
        ctx,
        image: rig.image,
        mesh: rig.mesh,
        restVertices: restScreenVertices,
        posedVertices,
      });
    });
  }, [bindings, worldTransforms, layers, loadedImages, toScreen]);

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
          <button
            onClick={onExit}
            className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium bg-raised border border-border text-muted hover:text-text transition-colors"
          >
            <Icons.Close className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
            Exit rig mode
          </button>
        </div>

        <div
          ref={stageRef}
          onClick={handleStageClick}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            width: DISPLAY_W,
            height: displayH,
            backgroundImage: showMesh
              ? `linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)`
              : undefined,
            backgroundSize: showMesh ? `${gridStepScreen}px ${gridStepScreen}px` : undefined,
          }}
          className="relative bg-raised border border-border rounded-xl overflow-hidden max-w-full"
        >
          {referenceImage && (
            <img
              src={referenceImage}
              alt="Reference"
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none opacity-40"
            />
          )}

          {showMesh &&
            layers.map((layer, i) => {
              const topLeft = toScreen({ x: layer.meta.x, y: layer.meta.y });
              const w = layer.meta.w * scale;
              const h = layer.meta.h * scale;
              const bound = !!bindings[i];
              return (
                <div
                  key={`guide-${i}`}
                  className={
                    'absolute border pointer-events-none ' +
                    (bound ? 'border-accent/50' : 'border-amber/50 border-dashed')
                  }
                  style={{ left: topLeft.x, top: topLeft.y, width: w, height: h }}
                >
                  <span
                    className={
                      'absolute -top-4 left-0 text-[9px] font-mono font-semibold ' +
                      (bound ? 'text-accent' : 'text-amber')
                    }
                  >
                    {i + 1}
                  </span>
                </div>
              );
            })}

          {/* Unbound layers: plain static image, no deformation needed yet. */}
          {layers.map((layer, i) => {
            if (bindings[i]) return null;
            const topLeft = toScreen({ x: layer.meta.x, y: layer.meta.y });
            const w = layer.meta.w * scale;
            const h = layer.meta.h * scale;
            return (
              <img
                key={`static-${i}`}
                src={`data:image/png;base64,${layer.image}`}
                alt={`Layer ${i + 1}`}
                draggable={false}
                className="absolute select-none pointer-events-none"
                style={{ left: topLeft.x, top: topLeft.y, width: w, height: h }}
              />
            );
          })}

          {/* Bound layers: warped canvas, deformed by mesh + bone skinning. */}
          {layers.map((layer, i) => {
            if (!bindings[i]) return null;
            return (
              <canvas
                key={`canvas-${i}`}
                ref={(el) => {
                  if (el) canvasRefs.current.set(i, el);
                  else canvasRefs.current.delete(i);
                }}
                width={DISPLAY_W}
                height={displayH}
                className="absolute inset-0 pointer-events-none"
                style={{ width: DISPLAY_W, height: displayH }}
              />
            );
          })}

          <svg className="absolute inset-0 pointer-events-none" width={DISPLAY_W} height={displayH}>
            {bones
              .filter((b) => b.parentId)
              .map((b) => {
                const parentWorld = worldTransforms.get(b.parentId!);
                const world = worldTransforms.get(b.id);
                if (!parentWorld || !world) return null;
                const p1 = toScreen(parentWorld);
                const p2 = toScreen(world);
                return (
                  <line
                    key={b.id}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    strokeOpacity={0.85}
                  />
                );
              })}
          </svg>

          {bones.map((b) => {
            const world = worldTransforms.get(b.id);
            if (!world) return null;
            const pos = toScreen(world);
            const selected = selectedBoneId === b.id;
            const handlePos = {
              x: pos.x + HANDLE_SCREEN_LEN * Math.cos(world.rotation),
              y: pos.y + HANDLE_SCREEN_LEN * Math.sin(world.rotation),
            };
            return (
              <div key={b.id}>
                <div
                  onPointerDown={startDrag('bone', b.id)}
                  className={
                    'absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 cursor-grab active:cursor-grabbing touch-none ' +
                    (selected ? 'bg-amber border-amber' : 'bg-accent border-accent')
                  }
                  style={{ left: pos.x, top: pos.y }}
                  title={b.name}
                />
                {showMesh && (
                  <span
                    className="absolute text-[9px] font-mono font-semibold text-text bg-bg/70 px-1 rounded pointer-events-none whitespace-nowrap"
                    style={{ left: pos.x + 8, top: pos.y - 16 }}
                  >
                    {b.name}
                  </span>
                )}
                {selected && (
                  <div
                    onPointerDown={startDrag('handle', b.id)}
                    className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-sm bg-amber cursor-alias touch-none"
                    style={{ left: handlePos.x, top: handlePos.y }}
                    title="Drag to rotate"
                  />
                )}
              </div>
            );
          })}
        </div>
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
