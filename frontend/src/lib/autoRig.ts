import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Bone } from './rigTypes';

// Standard BlazePose 33-point index map (subset we care about for a 2D rig).
const PL = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  NOSE: 0,
};

let landmarker: PoseLandmarker | null = null;

async function getLandmarker() {
  if (landmarker) return landmarker;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    },
    runningMode: 'IMAGE',
    numPoses: 1,
  });
  return landmarker;
}

// Detects a body pose in a static image and returns a bone chain in the
// same {id, name, parentId, x, y, rotation, scale} shape RigCanvas expects.
// Positions are in image-pixel space (imgW × imgH), rotation is derived
// from parent→child direction — same convention as manual bone placement.
export async function autoRigBody(img: HTMLImageElement): Promise<Bone[]> {
  const lm = await getLandmarker();
  const result = lm.detect(img);
  const pts = result.landmarks[0];
  if (!pts) throw new Error('No person detected in this image');

  const px = (i: number) => ({ x: pts[i].x * img.naturalWidth, y: pts[i].y * img.naturalHeight });

  // Hip midpoint = root, matching the standard humanoid rig convention
  // (Mixamo, Unity Humanoid, Cascadeur all root at the pelvis).
  const lHip = px(PL.L_HIP), rHip = px(PL.R_HIP);
  const lShoulder = px(PL.L_SHOULDER), rShoulder = px(PL.R_SHOULDER);
  const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
  const shoulderMid = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };

  const bones: Bone[] = [];
  const angleTo = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

  const addChain = (
    id: string, name: string, parentId: string | null,
    headWorld: { x: number; y: number }, parentHeadWorld: { x: number; y: number } | null
  ) => {
    // x/y stored relative to parent head (local space), matching manual
    // bone creation's worldToLocalPoint — parent rotation is 0 at rest
    // since these are absolute image-pixel positions, not yet posed.
    const px_ = parentHeadWorld ? headWorld.x - parentHeadWorld.x : headWorld.x;
    const py_ = parentHeadWorld ? headWorld.y - parentHeadWorld.y : headWorld.y;
    bones.push({ id, name, parentId, x: px_, y: py_, rotation: 0, scale: 1 });
  };

  addChain('root', 'Hips', null, hipMid, null);
  addChain('spine', 'Spine', 'root', shoulderMid, hipMid);

  addChain('l_upper_arm', 'L Upper Arm', 'spine', lShoulder, shoulderMid);
  addChain('l_forearm', 'L Forearm', 'l_upper_arm', px(PL.L_ELBOW), lShoulder);
  addChain('l_hand', 'L Hand', 'l_forearm', px(PL.L_WRIST), px(PL.L_ELBOW));

  addChain('r_upper_arm', 'R Upper Arm', 'spine', rShoulder, shoulderMid);
  addChain('r_forearm', 'R Forearm', 'r_upper_arm', px(PL.R_ELBOW), rShoulder);
  addChain('r_hand', 'R Hand', 'r_forearm', px(PL.R_WRIST), px(PL.R_ELBOW));

  addChain('l_thigh', 'L Thigh', 'root', lHip, hipMid);
  addChain('l_shin', 'L Shin', 'l_thigh', px(PL.L_KNEE), lHip);
  addChain('l_foot', 'L Foot', 'l_shin', px(PL.L_ANKLE), px(PL.L_KNEE));

  addChain('r_thigh', 'R Thigh', 'root', rHip, hipMid);
  addChain('r_shin', 'R Shin', 'r_thigh', px(PL.R_KNEE), rHip);
  addChain('r_foot', 'R Foot', 'r_shin', px(PL.R_ANKLE), px(PL.R_KNEE));

  addChain('head', 'Head', 'spine', px(PL.NOSE), shoulderMid);

  return bones;
}
