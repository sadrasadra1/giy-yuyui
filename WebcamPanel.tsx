import { useEffect, useRef, useState } from "react";
import interact from "interactjs";
import {
  startHandTracking,
  HAND_CONNECTIONS,
  type HandData,
} from "../lib/handTracker";

type Status = "idle" | "loading" | "starting-camera" | "ready" | "error" | "denied";

interface Props {
  onHands?: (hands: HandData[]) => void;
}

export default function WebcamPanel({ onHands }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);

  const handsRef = useRef<HandData[]>([]);
  const stopRef = useRef<() => void>(() => {});
  const animRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [gesture, setGesture] = useState<string>("—");
  const [started, setStarted] = useState(false);

  // Set up interact.js (drag + resize) on the panel
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const initW = 360;
    const initH = 270;
    const startX = window.innerWidth - initW - 24;
    const startY = window.innerHeight - initH - 24;
    panel.style.width = initW + "px";
    panel.style.height = initH + "px";
    panel.style.left = startX + "px";
    panel.style.top = startY + "px";

    interact(panel)
      .draggable({
        allowFrom: ".panel-header",
        ignoreFrom: "video, canvas, .resize-handle, button",
        inertia: false,
        listeners: {
          move(event) {
            const target = event.target;
            const x = (parseFloat(target.getAttribute("data-x") || "0")) + event.dx;
            const y = (parseFloat(target.getAttribute("data-y") || "0")) + event.dy;
            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute("data-x", String(x));
            target.setAttribute("data-y", String(y));
          },
        },
      })
      .resizable({
        edges: { left: false, right: true, top: false, bottom: true },
        margin: 8,
        listeners: {
          move(event) {
            const target = event.target;
            let x = parseFloat(target.getAttribute("data-x") || "0");
            let y = parseFloat(target.getAttribute("data-y") || "0");
            target.style.width = event.rect.width + "px";
            target.style.height = event.rect.height + "px";
            x += event.deltaRect.left;
            y += event.deltaRect.top;
            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute("data-x", String(x));
            target.setAttribute("data-y", String(y));
          },
        },
      });

    return () => {
      interact(panel).unset();
    };
  }, []);

  // Start the webcam + MediaPipe
  const start = async () => {
    if (started) return;
    setStarted(true);
    setStatus("loading");
    const video = videoRef.current;
    if (!video) return;
    try {
      const ctrl = await startHandTracking(
        video,
        (hands) => {
          handsRef.current = hands;
          onHands?.(hands);
          if (hands.length > 0) {
            const g = hands[0].gesture;
            const o = hands[0].openness;
            setGesture(
              g === "open"
                ? "OPEN"
                : g === "closed"
                  ? "FIST"
                  : g === "pinch"
                    ? "PINCH"
                    : `MID ${o.toFixed(2)}`,
            );
          } else {
            setGesture("—");
          }
        },
        (s) => setStatus(s as Status),
      );
      stopRef.current = ctrl.stop;
    } catch {
      setStatus("error");
      setStarted(false);
    }
  };

  // Main render loop: draw the mirrored video + hand skeleton overlay.
  useEffect(() => {
    const handCvs = handCanvasRef.current;
    if (!handCvs) return;
    const handCtx = handCvs.getContext("2d");
    if (!handCtx) return;

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = handCvs!.getBoundingClientRect();
      handCvs!.width = Math.max(200, Math.floor(r.width * dpr));
      handCvs!.height = Math.max(150, Math.floor(r.height * dpr));
    }
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(handCvs);

    const loop = () => {
      const W = handCvs.width;
      const H = handCvs.height;
      handCtx.clearRect(0, 0, W, H);
      const hands = handsRef.current;
      for (const h of hands) {
        // Mirror X to match the mirrored video preview
        const pts = h.landmarks.map((p) => ({
          x: (1 - p.x) * W,
          y: p.y * H,
        }));
        // Glow if grabbing
        const grabbing = h.gesture === "closed" || h.gesture === "pinch";
        // Connections
        handCtx.lineCap = "round";
        handCtx.lineWidth = 2.5;
        handCtx.strokeStyle = grabbing
          ? "rgba(255, 120, 120, 0.95)"
          : "rgba(255, 255, 255, 0.9)";
        for (const [a, b] of HAND_CONNECTIONS) {
          handCtx.beginPath();
          handCtx.moveTo(pts[a].x, pts[a].y);
          handCtx.lineTo(pts[b].x, pts[b].y);
          handCtx.stroke();
        }
        // Joints
        handCtx.fillStyle = grabbing
          ? "rgba(255, 150, 150, 1)"
          : "rgba(255, 255, 255, 0.95)";
        for (let i = 0; i < pts.length; i++) {
          const r =
            i === 0 || i === 4 || i === 8 || i === 12 || i === 16 || i === 20
              ? 4
              : 2.5;
          handCtx.beginPath();
          handCtx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
          handCtx.fill();
        }
        // Highlight fingertips
        handCtx.fillStyle = grabbing
          ? "rgba(255, 80, 80, 1)"
          : "rgba(120, 220, 255, 0.95)";
        for (const tipIdx of [4, 8, 12, 16, 20]) {
          handCtx.beginPath();
          handCtx.arc(pts[tipIdx].x, pts[tipIdx].y, 5.5, 0, Math.PI * 2);
          handCtx.fill();
        }
        // Draw grab center marker
        if (grabbing) {
          const palmX = (1 - h.palmX) * W;
          const palmY = h.palmY * H;
          handCtx.strokeStyle = "rgba(255, 80, 80, 0.7)";
          handCtx.lineWidth = 1.2;
          handCtx.setLineDash([4, 4]);
          handCtx.beginPath();
          handCtx.arc(palmX, palmY, 28, 0, Math.PI * 2);
          handCtx.stroke();
          handCtx.setLineDash([]);
        }
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, []);

  const statusLabel: Record<Status, string> = {
    idle: "OFF",
    loading: "LOADING",
    "starting-camera": "STARTING",
    ready: "TRACKING",
    error: "ERROR",
    denied: "DENIED",
  };

  return (
    <div ref={panelRef} className="webcam-panel" data-x="0" data-y="0">
      <div className="panel-header">
        <div className="panel-handle">
          <span className="dot" />
          <span>Webcam · Hand Tracking</span>
        </div>
        <span style={{ opacity: 0.6 }}>drag · resize</span>
      </div>

      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        style={{ zIndex: 1 }}
      />
      <canvas ref={handCanvasRef} className="hand-canvas" />
      <div className="resize-handle" />

      {!started && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 7,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(6px)",
            padding: 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: "italic",
              fontSize: 18,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            Permission to crumple
          </div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            Webcam stays local
          </div>
          <button
            className="pill-btn"
            onClick={start}
            style={{ padding: "0.55rem 1.2rem", fontSize: "0.75rem", marginTop: 4 }}
          >
            Enable Webcam
          </button>
        </div>
      )}

      <div className="status-pill">
        <span
          className="sd"
          style={{
            background: status === "ready" ? "#4ade80" : status === "error" ? "#ef4444" : "#fbbf24",
          }}
        />
        {statusLabel[status]} · {gesture}
      </div>
    </div>
  );
}
