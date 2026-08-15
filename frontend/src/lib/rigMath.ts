export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldTransform {
  x: number;
  y: number;
  rotation: number; // radians
  scale: number;
}

export const IDENTITY_TRANSFORM: WorldTransform = { x: 0, y: 0, rotation: 0, scale: 1 };

// Compose a bone's LOCAL transform (stored relative to its parent) with the
// parent's already-resolved WORLD transform. This is forward kinematics:
// rotating or moving a parent bone carries every descendant along with it,
// because each child's world position is derived through this chain rather
// than stored independently.
export function composeTransform(parent: WorldTransform, local: WorldTransform): WorldTransform {
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  const scaledX = local.x * parent.scale;
  const scaledY = local.y * parent.scale;
  return {
    x: parent.x + (scaledX * cos - scaledY * sin),
    y: parent.y + (scaledX * sin + scaledY * cos),
    rotation: parent.rotation + local.rotation,
    scale: parent.scale * local.scale,
  };
}

// Inverse of composeTransform's position math: given a desired WORLD point
// and the parent's WORLD transform, solve for the LOCAL x/y that would
// produce it. Needed while dragging — the pointer gives a world-space
// target, but bones only ever store parent-relative local coordinates.
export function worldToLocalPoint(parent: WorldTransform, worldPoint: Vec2): Vec2 {
  const dx = worldPoint.x - parent.x;
  const dy = worldPoint.y - parent.y;
  const cos = Math.cos(-parent.rotation);
  const sin = Math.sin(-parent.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return { x: rx / parent.scale, y: ry / parent.scale };
}

export function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// ── Linear blend skinning ──────────────────────────────────────────────────
// A mesh vertex is defined once in "rest space" (the layer's local pixel
// coordinates when nothing has been posed). To deform it, we need each
// influencing bone's transform in that SAME rest space, plus that bone's
// CURRENT world transform. The vertex is moved by each bone's rest→current
// delta, weighted and summed — this is what lets multiple bones blend their
// influence smoothly across a joint instead of the mesh tearing at the seam.

export interface BoneRestPose {
  restWorld: WorldTransform; // bone's world transform at authoring time (T-pose)
}

/**
 * Apply one bone's rest→posed delta to a rest-space point.
 * Equivalent to: move the point into the bone's local space (as authored),
 * then re-project through the bone's CURRENT world transform.
 */
function applyBoneDelta(point: Vec2, rest: WorldTransform, posed: WorldTransform): Vec2 {
  // Point relative to bone's rest position, undoing rest rotation/scale.
  const dx = point.x - rest.x;
  const dy = point.y - rest.y;
  const cosR = Math.cos(-rest.rotation);
  const sinR = Math.sin(-rest.rotation);
  const localX = (dx * cosR - dy * sinR) / rest.scale;
  const localY = (dx * sinR + dy * cosR) / rest.scale;

  // Re-apply through the bone's posed transform.
  const cosP = Math.cos(posed.rotation);
  const sinP = Math.sin(posed.rotation);
  const scaledX = localX * posed.scale;
  const scaledY = localY * posed.scale;
  return {
    x: posed.x + (scaledX * cosP - scaledY * sinP),
    y: posed.y + (scaledX * sinP + scaledY * cosP),
  };
}

/**
 * Skin a single vertex: blend the results of every influencing bone's
 * rest→posed delta, weighted by that bone's influence on this vertex.
 * Weights should sum to ~1 (autoWeightByDistance in rigMesh.ts guarantees this).
 */
export function skinVertex(
  restPoint: Vec2,
  influences: { boneId: string; weight: number }[],
  boneRestPoses: Map<string, WorldTransform>,
  bonePosedTransforms: Map<string, WorldTransform>
): Vec2 {
  let x = 0;
  let y = 0;
  for (const inf of influences) {
    const rest = boneRestPoses.get(inf.boneId);
    const posed = bonePosedTransforms.get(inf.boneId);
    if (!rest || !posed) continue;
    const p = applyBoneDelta(restPoint, rest, posed);
    x += p.x * inf.weight;
    y += p.y * inf.weight;
  }
  return { x, y };
}
