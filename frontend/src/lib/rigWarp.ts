// Renders a layer's source image warped to its posed mesh, one triangle at
// a time. Canvas 2D can't sample an arbitrary quad directly, but it CAN
// draw an image through an affine transform — and any triangle-to-triangle
// mapping is exactly representable as an affine transform. So for each
// mesh triangle: clip to that triangle's posed shape, set the canvas
// transform to map the rest-space triangle onto it, then draw the full
// source image (only the clipped region actually lands on screen).

import type { Mesh, MeshTriangle } from './rigMesh';
import type { Vec2 } from './rigMath';

export interface WarpParams {
  ctx: CanvasRenderingContext2D;
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  mesh: Mesh;
  restVertices: Vec2[]; // rest-space positions (same indexing as mesh.vertices)
  posedVertices: Vec2[]; // current posed positions (same indexing), in canvas/screen space
}

/**
 * Solve the 2x3 affine matrix that maps triangle (r0,r1,r2) onto (p0,p1,p2).
 * Standard triangle-to-triangle affine solve via the inverse of the rest
 * triangle's edge matrix.
 */
function triangleAffine(r0: Vec2, r1: Vec2, r2: Vec2, p0: Vec2, p1: Vec2, p2: Vec2) {
  const x1 = r1.x - r0.x, y1 = r1.y - r0.y;
  const x2 = r2.x - r0.x, y2 = r2.y - r0.y;
  const det = x1 * y2 - y1 * x2;
  if (Math.abs(det) < 1e-8) return null; // degenerate triangle, skip

  const u1 = p1.x - p0.x, v1 = p1.y - p0.y;
  const u2 = p2.x - p0.x, v2 = p2.y - p0.y;

  const a = (u1 * y2 - u2 * y1) / det;
  const b = (v1 * y2 - v2 * y1) / det;
  const c = (u2 * x1 - u1 * x2) / det;
  const d = (v2 * x1 - v1 * x2) / det;
  const e = p0.x - (a * r0.x + c * r0.y);
  const f = p0.y - (b * r0.x + d * r0.y);

  return { a, b, c, d, e, f };
}

function drawTriangle(ctx: CanvasRenderingContext2D, image: CanvasImageSource, tri: MeshTriangle, rest: Vec2[], posed: Vec2[]) {
  const r0 = rest[tri.a], r1 = rest[tri.b], r2 = rest[tri.c];
  const p0 = posed[tri.a], p1 = posed[tri.b], p2 = posed[tri.c];

  const m = triangleAffine(r0, r1, r2, p0, p1, p2);
  if (!m) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();

  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(image, 0, 0);

  ctx.restore();
}

/** Draw every mesh triangle, warping the source image from rest to posed shape. */
export function drawWarpedMesh({ ctx, image, mesh, restVertices, posedVertices }: WarpParams) {
  for (const tri of mesh.triangles) {
    drawTriangle(ctx, image, tri, restVertices, posedVertices);
  }
}
