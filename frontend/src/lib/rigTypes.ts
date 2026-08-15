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

export const ROOT_BONE_ID = 'root';

export function makeRootBone(): Bone {
  return { id: ROOT_BONE_ID, name: 'Root', parentId: null, x: 0, y: 0, rotation: 0, scale: 1 };
}
