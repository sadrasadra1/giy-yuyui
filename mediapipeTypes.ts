// Minimal MediaPipe type definitions used by handTracker.ts

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type NormalizedLandmarkList = NormalizedLandmark[];

export interface Results {
  multiHandLandmarks?: NormalizedLandmarkList[];
  multiHandedness?: Array<{
    index: number;
    score: number;
    label: string;
  }>;
  image?: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
}
