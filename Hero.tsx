import { useEffect, useRef, useState } from "react";
import WebcamPanel from "./WebcamPanel";
import { PaperCrumple, type Grab } from "../lib/paperCrumple";
import type { HandData } from "../lib/handTracker";

export default function Hero() {
  // Refs to share hand data with the panel
  const handsRef = useRef<HandData[]>([]);
  const [showHandHint, setShowHandHint] = useState(true);

  // Main paper canvas
  const paperCanvasRef = useRef<HTMLCanvasElement>(null);
  const paperRef = useRef<PaperCrumple | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const cvs = paperCanvasRef.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const init = () => {
      const r = cvs.getBoundingClientRect();
      cvs.width = Math.max(300, Math.floor(r.width * dpr));
      cvs.height = Math.max(300, Math.floor(r.height * dpr));
      if (!paperRef.current) {
        paperRef.current = new PaperCrumple(cvs.width, cvs.height, 60, 42);
        // Bump visual grid up slightly for large papers
        const p = paperRef.current;
        if (p) {
          p.visualCols = 42;
          p.visualRows = 30;
        }
      } else {
        paperRef.current.resize(cvs.width, cvs.height);
      }
    };
    init();
    const ro = new ResizeObserver(init);
    ro.observe(cvs);

    const loop = () => {
      const paper = paperRef.current;
      const ctx = cvs.getContext("2d");
      if (paper && ctx) {
        const hands = handsRef.current;
        // Build grabs from hands. Palm coords are normalized in the
        // unmirrored video frame; we mirror X so that the user's hand
        // appears at the same relative position on the paper (the webcam
        // is also visually mirrored in the panel).
        const grabs: Grab[] = [];
        for (const h of hands) {
          const cx = (1 - h.palmX) * paper.width;
          const cy = h.palmY * paper.height;
          let strength = 0;
          if (h.gesture === "closed") strength = 1.0;
          else if (h.gesture === "pinch") strength = 0.95;
          else if (h.gesture === "open") strength = 0.0;
          else strength = Math.max(0, 1 - h.openness) * 0.8;
          const radius = Math.max(70, Math.min(paper.width, paper.height) * 0.16);
          if (strength > 0.05) grabs.push({ x: cx, y: cy, strength, radius });
        }
        paper.setGrabs(grabs);
        const steps = 2;
        for (let s = 0; s < steps; s++) paper.step();
        paper.render(ctx);

        // Subtle red dashed grab indicator (only visible while grabbing)
        for (const g of grabs) {
          ctx.save();
          ctx.strokeStyle = "rgba(180, 30, 30, 0.22)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
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

  // Hide the hint after some seconds or once a hand is detected
  useEffect(() => {
    const id = setInterval(() => {
      if (handsRef.current.length > 0) setShowHandHint(false);
    }, 500);
    const tmo = setTimeout(() => setShowHandHint(false), 12000);
    return () => {
      clearInterval(id);
      clearTimeout(tmo);
    };
  }, []);

  return (
    <section className="hero-bg noise relative min-h-screen w-full overflow-hidden text-white">
      {/* Top navigation */}
      <header className="fade-in fade-in-1 relative z-30 flex w-full items-center justify-between px-6 pt-6 md:px-12 md:pt-8">
        <div className="font-serif text-2xl tracking-tight md:text-[28px]">
          <span className="italic">s</span>adra
        </div>
        <nav className="flex items-center gap-3">
          <a href="#work" className="pill-btn">
            My Work
          </a>
          <a href="#hello" className="pill-btn ghost">
            Say Hello
          </a>
        </nav>
      </header>

      {/* Main content - split layout */}
      <div className="relative z-10 grid min-h-[calc(100vh-96px)] grid-cols-1 md:grid-cols-12">
        {/* Left: text content */}
        <div className="col-span-1 flex flex-col justify-between px-6 pt-10 pb-10 md:col-span-7 md:px-12 md:pt-16 md:pb-12">
          {/* Tagline */}
          <div className="fade-in fade-in-2 max-w-2xl">
            <div className="mb-1 text-[13px] font-light tracking-wide text-white/85 md:text-sm">
              <span className="diamond">◆</span>
              <span>Ai Member of </span>
              <em className="font-serif italic text-white">Nabulines</em>
            </div>
          </div>

          {/* Headline */}
          <div className="fade-in fade-in-3 mt-10 max-w-5xl md:mt-0">
            <h1
              className="headline font-serif font-light leading-[0.98] tracking-tight"
              style={{ fontSize: "clamp(2.4rem, 4.6vw, 7.2rem)" }}
            >
              <span className="block">Crafting digital</span>
              <span className="block">experiences,</span>
              <span
                className="em block italic"
                style={{
                  fontSize: "clamp(2.8rem, 5.6vw, 8.8rem)",
                  lineHeight: 0.95,
                  fontStyle: "italic",
                  fontWeight: 300,
                  letterSpacing: "-0.01em",
                }}
              >
                one fold at a time.
              </span>
            </h1>
          </div>

          {/* Bottom paragraph */}
          <div className="fade-in fade-in-4 mt-10 max-w-md md:mt-0">
            <p className="text-[12px] font-light leading-[1.7] text-white/70 md:text-[13px]">
              A boutique design practice shaping brands,
              <br />
              interfaces, and quiet moments of craft.
              <br />
              Based somewhere between the page and the screen.
            </p>
          </div>
        </div>

        {/* Right: paper canvas (the thing you crumple) */}
        <div className="fade-in fade-in-3 relative col-span-1 flex items-center justify-center px-6 pb-10 md:col-span-5 md:items-center md:justify-center md:px-6 md:pb-12">
          <div
            className="paper-wrap relative h-[55vh] w-full max-w-[640px] overflow-hidden md:h-[70vh]"
            style={{
              borderRadius: 4,
              boxShadow:
                "0 60px 100px -30px rgba(0,0,0,0.9), 0 30px 60px -15px rgba(0,0,0,0.6)",
            }}
          >
            <canvas
              ref={paperCanvasRef}
              className="absolute inset-0 h-full w-full"
              style={{ display: "block" }}
            />
            {/* Hint overlay */}
            {showHandHint && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-3 z-10 text-center text-[10px] uppercase tracking-[0.3em] text-white/60"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
              >
                Make a fist in the webcam to crumple the paper
              </div>
            )}
            {/* Corner label */}
            <div
              className="pointer-events-none absolute right-3 top-3 z-10 text-[9px] uppercase tracking-[0.35em]"
              style={{ color: "rgba(0,0,0,0.45)" }}
            >
              Paper · 01
            </div>
          </div>
        </div>
      </div>

      {/* Subtle bottom hairline */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
        }}
      />

      {/* Floating webcam/hand-tracking panel */}
      <WebcamPanel
        onHands={(hands) => {
          handsRef.current = hands;
          if (hands.length > 0) setShowHandHint(false);
        }}
      />

      {/* Decorative side index */}
      <div className="fade-in fade-in-4 pointer-events-none absolute bottom-8 left-12 z-10 hidden text-[10px] uppercase tracking-[0.3em] text-white/40 md:block">
        <div>— Portfolio · 2026</div>
      </div>

      {/* Top-right index marks */}
      <div className="fade-in fade-in-4 pointer-events-none absolute right-12 top-8 z-10 hidden flex-col items-end gap-1 text-[10px] uppercase tracking-[0.3em] text-white/40 md:flex">
        <div>Sadra · Nabulines</div>
        <div>Interactive · 2026</div>
      </div>
    </section>
  );
}
