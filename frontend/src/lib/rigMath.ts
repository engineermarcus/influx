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
