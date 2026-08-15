// Mesh generation + linear blend skinning for deformable 2D layers.
// A mesh is a subdivided grid over a layer's bounding box: vertices can be
// individually weighted to nearby bones, so posing bones warps the pixel
// grid smoothly instead of rotating it as one rigid rectangle.

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
