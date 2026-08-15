export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  x: number;        // local position relative to parent, image-pixel units
  y: number;
  rotation: number;  // local rotation relative to parent, radians
  scale: number;     // local uniform scale relative to parent
}

export interface LayerMeta {
  x: number;
  y: number;
  w: number;
  h: number;
}

