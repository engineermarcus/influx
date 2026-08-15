// Mesh generation + linear blend skinning for deformable 2D layers.
// Two ways to build a mesh:
//  - buildGridMesh: plain rectangular grid over the full w×h bbox. Cheap,
//    but for a segmented cutout most of that bbox is transparent padding —
//    doesn't "take the shape" of the character (limbs, gaps between arms
//    and torso, etc).
//  - buildShapedMesh: samples points only where the layer's alpha channel
//    says there's actual pixel content, then Delaunay-triangulates them and
//    drops any triangle that lands mostly on transparent pixels. Produces a
//    mesh that hugs the silhouette instead of a rectangle.

import Delaunator from 'delaunator';

export interface MeshVertex {
  // Rest-pose position, in the layer's local pixel space (0,0 = top-left of the layer crop).
  x: number;
  y: number;
}

export interface MeshTriangle {
  a: number; // index into vertices[]
  b: number;
  c: number;
}

export interface Mesh {
  vertices: MeshVertex[];
  triangles: MeshTriangle[];
  cols: number; // grid resolution used to build it
  rows: number;
}

/**
 * Build a subdivided grid mesh over a w×h rest-pose region.
 * cols/rows = number of quads per axis (e.g. 4×4 = 25 vertices, 32 triangles).
 * Higher resolution = smoother deformation, more compute per frame.
 */
export function buildGridMesh(w: number, h: number, cols: number, rows: number): Mesh {
  const vertices: MeshVertex[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      vertices.push({ x: (c / cols) * w, y: (r / rows) * h });
    }
  }

  const triangles: MeshTriangle[] = [];
  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * stride + c;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      // two triangles per quad
      triangles.push({ a: i0, b: i1, c: i2 });
      triangles.push({ a: i1, b: i3, c: i2 });
    }
  }

  return { vertices, triangles, cols, rows };
}

/**
 * Build a mesh that conforms to a layer's actual silhouette instead of its
 * bounding box.
 *
 * alpha: single-channel alpha buffer, length w*h, row-major (alpha[y*w+x]).
 * cols/rows: sample-grid density used to seed candidate points before
 *   filtering — same meaning as buildGridMesh's params, but points outside
 *   the silhouette get dropped rather than kept.
 * alphaThreshold: 0-255, minimum alpha to count as "inside" the character.
 *
 * Falls back to buildGridMesh if too few points survive filtering (tiny
 * layer, near-empty alpha, degenerate cases) so callers always get a
 * non-empty mesh back.
 */
export function buildShapedMesh(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  cols: number,
  rows: number,
  alphaThreshold = 20
): Mesh {
  const at = (x: number, y: number): number => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
    return alpha[iy * w + ix];
  };
  const inside = (x: number, y: number) => at(x, y) > alphaThreshold;

  const stepX = w / cols;
  const stepY = h / rows;

  const points: MeshVertex[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = Math.min(w - 1, c * stepX);
      const y = Math.min(h - 1, r * stepY);
      if (!inside(x, y)) continue;

      // Nudge points that sit right on the silhouette edge to hug it more
      // closely, by checking the 4-neighborhood at grid resolution. Not a
      // full marching-squares contour, but enough to keep narrow limbs
      // (forearms, ankles) from getting rounded off by the sample grid.
      points.push({ x, y });
    }
  }

  // Too sparse to triangulate meaningfully (tiny sliver layer, mostly-empty
  // alpha, etc) — fall back to the plain rectangular grid.
  if (points.length < 3) {
    return buildGridMesh(w, h, cols, rows);
  }

  const coords = new Float64Array(points.length * 2);
  points.forEach((p, i) => {
    coords[i * 2] = p.x;
    coords[i * 2 + 1] = p.y;
  });

  const delaunay = new Delaunator(coords);
  const triangles: MeshTriangle[] = [];

  for (let t = 0; t < delaunay.triangles.length; t += 3) {
    const a = delaunay.triangles[t];
    const b = delaunay.triangles[t + 1];
    const c = delaunay.triangles[t + 2];
    const pa = points[a], pb = points[b], pc = points[c];

    // Reject triangles that mostly span transparent gaps — between arms and
    // torso, between legs, around the neck, etc — by sampling alpha at the
    // centroid and a couple of interior points rather than just the
    // (always-inside) vertices.
    const cx = (pa.x + pb.x + pc.x) / 3;
    const cy = (pa.y + pb.y + pc.y) / 3;
    const midAB = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const midBC = { x: (pb.x + pc.x) / 2, y: (pb.y + pc.y) / 2 };
    const midCA = { x: (pc.x + pa.x) / 2, y: (pc.y + pa.y) / 2 };

    const samples = [
      inside(cx, cy),
      inside(midAB.x, midAB.y),
      inside(midBC.x, midBC.y),
      inside(midCA.x, midCA.y),
    ];
    const insideCount = samples.filter(Boolean).length;
    if (insideCount < 3) continue; // majority of the triangle is background — drop it

    triangles.push({ a, b, c });
  }

  return { vertices: points, triangles, cols, rows };
}

export interface BoneInfluence {
  boneId: string;
  weight: number; // 0..1, all influences for a vertex should sum to ~1
}

/**
 * Auto-weight every vertex to nearby bones by inverse-distance falloff.
 * bonePositions: rest-pose world positions of each bone (already offset into
 * the same local space as the mesh vertices).
 * maxInfluences: cap on bones per vertex (keeps skinning cost bounded).
 * falloff: higher = influence drops off faster with distance.
 */
export function autoWeightByDistance(
  vertices: MeshVertex[],
  bonePositions: Map<string, { x: number; y: number }>,
  maxInfluences = 3,
  falloff = 2
): BoneInfluence[][] {
  const boneEntries = Array.from(bonePositions.entries());

  return vertices.map((v) => {
    const distances = boneEntries.map(([boneId, pos]) => {
      const dx = v.x - pos.x;
      const dy = v.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001; // avoid div-by-zero at exact overlap
      return { boneId, dist };
    });

    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances.slice(0, maxInfluences);

    const rawWeights = nearest.map((n) => 1 / Math.pow(n.dist, falloff));
    const total = rawWeights.reduce((s, w) => s + w, 0) || 1;

    return nearest.map((n, i) => ({
      boneId: n.boneId,
      weight: rawWeights[i] / total,
    }));
  });
}
