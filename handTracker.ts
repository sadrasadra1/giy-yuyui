// MediaPipe Hands loader and tracker.
// Loads MediaPipe Hands and Camera Utils from CDN (window globals),
// then sets up a per-frame callback with detected hand landmarks.

import type { Results, NormalizedLandmarkList } from "./mediapipeTypes";

export interface HandData {
  landmarks: NormalizedLandmarkList; // 21 points
  gesture: "open" | "closed" | "pinch" | "none";
  // For pinch: distance between thumb tip and index tip (0..1 approx)
  pinchAmount: number;
  // Average finger extension (used to detect open/closed)
  openness: number;
  // Center of palm in normalized coords
  palmX: number;
  palmY: number;
}

declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors?: any;
    drawLandmarks?: any;
    HAND_CONNECTIONS?: any;
  }
}

let mediapipeLoadPromise: Promise<void> | null = null;

export function loadMediaPipe(): Promise<void> {
  if (mediapipeLoadPromise) return mediapipeLoadPromise;
  mediapipeLoadPromise = new Promise<void>((resolve, reject) => {
    let loadedCount = 0;
    const need = 3;
    function maybeDone() {
      loadedCount++;
      if (loadedCount >= need) resolve();
    }
    function addScript(src: string) {
      return new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.crossOrigin = "anonymous";
        s.onload = () => res();
        s.onerror = () => rej(new Error("Failed to load " + src));
        document.head.appendChild(s);
      });
    }
    Promise.all([
      addScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js"),
      addScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js"),
      addScript("https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js"),
    ])
      .then(maybeDone)
      .catch(reject);
    // The .js files above may not actually call our onload until they are parsed
    // but in practice they do. The camera_utils depends on Hands existing.
    setTimeout(() => resolve(), 8000); // safety
  });
  return mediapipeLoadPromise;
}

// Finger tip indices in MediaPipe Hands
const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_MCPS = [2, 5, 9, 13, 17];

// Compute "openness" - 0 = closed fist, 1 = open hand
function computeOpenness(lm: NormalizedLandmarkList): number {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const tip = lm[FINGER_TIPS[i]];
    const mcp = lm[FINGER_MCPS[i]];
    // distance from tip to wrist (0) vs mcp to wrist
    const wrist = lm[0];
    const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const dMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    // ratio > 1 means finger extended
    const r = (dTip - dMcp) / (dMcp + 0.0001);
    // normalize roughly: 0 (folded) .. 0.7 (extended)
    sum += Math.max(0, Math.min(1, r / 0.6));
  }
  return sum / 5;
}

function computePinch(lm: NormalizedLandmarkList): number {
  // distance thumb tip (4) to index tip (8) normalized by hand size
  const thumb = lm[4];
  const index = lm[8];
  const wrist = lm[0];
  const mcpMid = lm[9];
  const handSize = Math.hypot(mcpMid.x - wrist.x, mcpMid.y - wrist.y) + 0.0001;
  const d = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  const ratio = d / handSize;
  // 0 = touching, ~1 = far apart
  return Math.max(0, Math.min(1, ratio));
}

export function classifyHand(lm: NormalizedLandmarkList): HandData {
  const open = computeOpenness(lm);
  const pinch = computePinch(lm);
  // Stable palm reference: midpoint between wrist (0) and middle MCP (9).
  // This point moves smoothly even when fingers curl, making the grab
  // center feel responsive and predictable.
  const wrist = lm[0];
  const midMcp = lm[9];
  const palmX = (wrist.x + midMcp.x) * 0.5;
  const palmY = (wrist.y + midMcp.y) * 0.5;
  let gesture: HandData["gesture"] = "none";
  if (pinch < 0.28) gesture = "pinch";
  else if (open < 0.35) gesture = "closed";
  else if (open > 0.65) gesture = "open";
  return {
    landmarks: lm,
    gesture,
    pinchAmount: pinch,
    openness: open,
    palmX,
    palmY,
  };
}

export function startHandTracking(
  video: HTMLVideoElement,
  onResults: (hands: HandData[]) => void,
  onStatus?: (status: string) => void,
): Promise<{ stop: () => void }> {
  return loadMediaPipe().then(
    () =>
      new Promise((resolve) => {
        if (!window.Hands || !window.Camera) {
          onStatus?.("error");
          resolve({ stop: () => {} });
          return;
        }
        onStatus?.("loading");
        const hands = new window.Hands({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        hands.onResults((results: Results) => {
          const arr: HandData[] = [];
          if (results.multiHandLandmarks) {
            for (const lm of results.multiHandLandmarks) {
              arr.push(classifyHand(lm));
            }
          }
          onResults(arr);
        });
        onStatus?.("starting-camera");
        const camera = new window.Camera(video, {
          onFrame: async () => {
            try {
              await hands.send({ image: video });
            } catch {
              /* ignore */
            }
          },
          width: 640,
          height: 480,
        });
        camera
          .start()
          .then(() => onStatus?.("ready"))
          .catch(() => onStatus?.("error"));
        resolve({
          stop: () => {
            try {
              camera.stop();
            } catch {
              /* ignore */
            }
            try {
              hands.close();
            } catch {
              /* ignore */
            }
          },
        });
      }),
  );
}

export const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];
