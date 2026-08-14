export type FrameKey = 'input' | 'coverage' | 'recomposed';

export interface SegmentResponse {
  can_undo?: boolean;
  coverage?: string;
  recomposed?: string | null;
  gallery?: string[];
  layer_count?: number;
  error?: string;
}

export interface UploadResponse {
  coverage?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface AppState {
  sessionId: string | null;
  inputImage: string | null; // full data URL
  coverageImage: string | null; // base64 (no prefix)
  recomposedImage: string | null; // base64 (no prefix)
  gallery: string[];
  layerCount: number;
  loading: boolean;
  segmenting: boolean;
}

export const FRAME_LABELS: Record<FrameKey, string> = {
  input: 'Input',
  coverage: 'Coverage',
  recomposed: 'Recomposed',
};

export const FRAME_HINTS: Record<FrameKey, string> = {
  input: 'Tap a region to extract it',
  coverage: 'Bright = unclaimed · tap to add',
  recomposed: 'Tap a layer to remove it',
};
