// Paper crumpling engine using a deformable mesh on a canvas.
// The mesh is a regular grid of vertices; each vertex has a position
// and a "rest" position. A virtual hand (driven by MediaPipe landmarks)
// can "grab" vertices within a radius, dragging them inward, then release
// them to leave permanent wrinkles.
//
// The mesh is rendered onto a 2D canvas. We project the deformed grid
// into screen space, and shade it with a procedurally generated paper
// texture and lighting based on the local deformation gradient.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vertex {
  // Current position (in world space, same as rest until deformed)
  x: number;
  y: number;
  // Original rest position
  rx: number;
  ry: number;
  // Velocity for spring-back / inertia
  vx: number;
  vy: number;
  // Accumulated crumple (0 = flat, 1 = fully squeezed)
  crumple: number;
  // Pinned (cannot move) - boundary edges
  pinned: boolean;
}

export interface Grab {
  x: number;
  y: number;
  // 0..1 strength of the grab
  strength: number;
  // Radius of influence
  radius: number;
}

export class PaperCrumple {
  width: number;
  height: number;
  cols: number;
  rows: number;
  vertices: Vertex[] = [];
  grabs: Grab[] = [];

  // Paper texture (cached)
  private paperTexture: HTMLCanvasElement | null = null;

  // Smoothed crumple for soft shadows
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;

  // Visual subdivision for the textured paper rendering. We use a
  // separate, coarser grid for the drawImage-per-quad pass, while
  // the physics runs on a denser grid for smooth deformation.
  visualCols = 36;
  visualRows = 26;

  constructor(width: number, height: number, cols = 60, rows = 40) {
    this.width = width;
    this.height = height;
    this.cols = cols;
    this.rows = rows;
    this.initMesh();
    this.buildPaperTexture();
    this.shadowCanvas = document.createElement("canvas");
    this.shadowCanvas.width = width;
    this.shadowCanvas.height = height;
    this.shadowCtx = this.shadowCanvas.getContext("2d");
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.initMesh();
    this.buildPaperTexture();
    if (this.shadowCanvas) {
      this.shadowCanvas.width = w;
      this.shadowCanvas.height = h;
      this.shadowCtx = this.shadowCanvas.getContext("2d");
    }
  }

  private initMesh() {
    this.vertices = [];
    const dx = this.width / (this.cols - 1);
    const dy = this.height / (this.rows - 1);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v: Vertex = {
          x: c * dx,
          y: r * dy,
          rx: c * dx,
          ry: r * dy,
          vx: 0,
          vy: 0,
          crumple: 0,
          pinned: false,
        };
        // Pin the very outer border so the paper doesn't float away
        if (r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1) {
          v.pinned = true;
        }
        this.vertices.push(v);
      }
    }
  }

  private buildPaperTexture() {
    // Create a paper texture with subtle grain, fibers and warm tones
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Base warm off-white with subtle vignette
    const grd = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.1,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.7,
    );
    grd.addColorStop(0, "#fbf6ec");
    grd.addColorStop(0.6, "#f3ebd9");
    grd.addColorStop(1, "#e7dcbf");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.width, this.height);

    // Add fine fiber noise
    const img = ctx.getImageData(0, 0, this.width, this.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.9));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.7));
    }
    ctx.putImageData(img, 0, 0);

    // Sprinkle tiny dark specks (paper fibers)
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < (this.width * this.height) / 600; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#6b5a3a" : "#2b2519";
      const s = Math.random() * 1.4 + 0.3;
      ctx.fillRect(
        Math.random() * this.width,
        Math.random() * this.height,
        s,
        s,
      );
    }
    ctx.globalAlpha = 1;

    // Long thin fibers
    ctx.strokeStyle = "rgba(80, 65, 40, 0.18)";
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const len = Math.random() * 30 + 10;
      const ang = Math.random() * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }

    // Subtle border darkening for depth
    const v = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.width * 0.3,
      this.width / 2,
      this.height / 2,
      this.width * 0.75,
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(40, 28, 10, 0.25)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.width, this.height);

    this.paperTexture = c;
  }

  setGrabs(grabs: Grab[]) {
    this.grabs = grabs;
  }

  // Step the simulation
  step() {
    const verts = this.vertices;
    const grabs = this.grabs;
    const k = 0.10; // spring constant back to rest
    const damping = 0.80;
    const grabK = 0.7; // how strongly grab pulls

    // Apply grab forces and crumple
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (v.pinned) {
        v.vx = 0;
        v.vy = 0;
        continue;
      }
      // Spring back toward rest
      const dx = v.rx - v.x;
      const dy = v.ry - v.y;
      v.vx += dx * k;
      v.vy += dy * k;

      // Apply grab pulls
      let totalInfl = 0;
      let pullX = 0;
      let pullY = 0;
      for (let g = 0; g < grabs.length; g++) {
        const grab = grabs[g];
        const ddx = v.x - grab.x;
        const ddy = v.y - grab.y;
        const d2 = ddx * ddx + ddy * ddy;
        const r2 = grab.radius * grab.radius;
        if (d2 < r2) {
          const d = Math.sqrt(d2) + 0.0001;
          const falloff = 1 - d / grab.radius;
          const inf = falloff * falloff * grab.strength;
          totalInfl += inf;
          // Pull vertex toward the grab center (squeeze)
          pullX += (-ddx / d) * inf * grab.strength * 14;
          pullY += (-ddy / d) * inf * grab.strength * 14;
        }
      }
      v.vx += pullX * grabK;
      v.vy += pullY * grabK;

      // Accumulate crumple (permanent deformation)
      if (totalInfl > 0.02) {
        v.crumple = Math.min(1, v.crumple + totalInfl * 0.04);
      } else {
        // Slow recovery of small elastic crumple for smoother feel
        v.crumple *= 0.99;
      }

      // Apply velocity
      v.x += v.vx;
      v.y += v.vy;
      v.vx *= damping;
      v.vy *= damping;
    }

    // Neighbor coupling (relaxation) for paper-like smoothness
    const passes = 1;
    for (let p = 0; p < passes; p++) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c;
          const v = verts[i];
          if (v.pinned) continue;
          let sx = 0,
            sy = 0,
            count = 0;
          // 4-neighbor average to reduce spikiness
          if (c > 0) {
            const n = verts[i - 1];
            sx += n.x;
            sy += n.y;
            count++;
          }
          if (c < this.cols - 1) {
            const n = verts[i + 1];
            sx += n.x;
            sy += n.y;
            count++;
          }
          if (r > 0) {
            const n = verts[i - this.cols];
            sx += n.x;
            sy += n.y;
            count++;
          }
          if (r < this.rows - 1) {
            const n = verts[i + this.cols];
            sx += n.x;
            sy += n.y;
            count++;
          }
          if (count > 0) {
            const ax = sx / count;
            const ay = sy / count;
            // Soft pull toward neighbor average to keep paper connected
            v.x += (ax - v.x) * 0.06;
            v.y += (ay - v.y) * 0.06;
          }
        }
      }
    }
  }

  // Render the deformed paper to a context
  render(ctx: CanvasRenderingContext2D) {
    const w = this.width;
    const h = this.height;
    const cols = this.cols;
    const rows = this.rows;
    const verts = this.vertices;

    // Clear background
    ctx.save();
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const paperTex = this.paperTexture;
    // Clip to paper bounds (rounded rect) for nice edges
    ctx.save();
    ctx.beginPath();
    const rad = 6;
    ctx.moveTo(rad, 0);
    ctx.lineTo(w - rad, 0);
    ctx.quadraticCurveTo(w, 0, w, rad);
    ctx.lineTo(w, h - rad);
    ctx.quadraticCurveTo(w, h, w - rad, h);
    ctx.lineTo(rad, h);
    ctx.quadraticCurveTo(0, h, 0, h - rad);
    ctx.lineTo(0, rad);
    ctx.quadraticCurveTo(0, 0, rad, 0);
    ctx.closePath();
    ctx.clip();

    if (paperTex) {
      // ---- Step 1: For each visual cell, sample the deformed mesh via
      // bilinear interpolation and draw the corresponding patch of the
      // paper texture. Using a coarser visual grid keeps the per-frame
      // cost reasonable. ----
      const vc = this.visualCols;
      const vr = this.visualRows;
      const vCellW = w / (vc - 1);
      const vCellH = h / (vr - 1);
      const fcols = cols - 1;
      const frows = rows - 1;

      // Helper: sample vertex position at fractional (fc, fr) in [0,1]^2
      // via bilinear interpolation over the physics mesh.
      const sample = (fc: number, fr: number) => {
        const fx = fc * fcols;
        const fy = fr * frows;
        const c0 = Math.max(0, Math.min(fcols - 1, Math.floor(fx)));
        const r0 = Math.max(0, Math.min(frows - 1, Math.floor(fy)));
        const tx = Math.max(0, Math.min(1, fx - c0));
        const ty = Math.max(0, Math.min(1, fy - r0));
        const v00 = verts[r0 * cols + c0];
        const v10 = verts[r0 * cols + Math.min(cols - 1, c0 + 1)];
        const v01 = verts[Math.min(rows - 1, r0 + 1) * cols + c0];
        const v11 =
          verts[Math.min(rows - 1, r0 + 1) * cols + Math.min(cols - 1, c0 + 1)];
        const x = (1 - tx) * (1 - ty) * v00.x +
          tx * (1 - ty) * v10.x +
          (1 - tx) * ty * v01.x +
          tx * ty * v11.x;
        const y = (1 - tx) * (1 - ty) * v00.y +
          tx * (1 - ty) * v10.y +
          (1 - tx) * ty * v01.y +
          tx * ty * v11.y;
        return [x, y];
      };

      for (let r2 = 0; r2 < vr - 1; r2++) {
        for (let c2 = 0; c2 < vc - 1; c2++) {
          const fc0 = c2 / (vc - 1);
          const fr0 = r2 / (vr - 1);
          const fc1 = (c2 + 1) / (vc - 1);
          const fr1 = (r2 + 1) / (vr - 1);
          const [x00, y00] = sample(fc0, fr0);
          const [x10, y10] = sample(fc1, fr0);
          const [x01, y01] = sample(fc0, fr1);
          const sx = c2 * vCellW;
          const sy = r2 * vCellH;
          const ap = (x10 - x00) / vCellW;
          const bp = (y10 - y00) / vCellW;
          const cp = (x01 - x00) / vCellH;
          const dp = (y01 - y00) / vCellH;
          const ep = x00 - ap * sx - cp * sy;
          const fp = y00 - bp * sx - dp * sy;
          ctx.setTransform(ap, bp, cp, dp, ep, fp);
          ctx.drawImage(paperTex, sx, sy, vCellW, vCellH, sx, sy, vCellW, vCellH);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // ---- Step 2: Per-cell dark shadow (where crumpled) ----
      const sctx = this.shadowCtx;
      if (sctx) {
        sctx.clearRect(0, 0, w, h);
        for (let r2 = 0; r2 < rows - 1; r2++) {
          for (let c2 = 0; c2 < cols - 1; c2++) {
            const v00 = verts[r2 * cols + c2];
            const v10 = verts[r2 * cols + c2 + 1];
            const v01 = verts[(r2 + 1) * cols + c2];
            const v11 = verts[(r2 + 1) * cols + c2 + 1];
            const crum =
              (v00.crumple + v10.crumple + v01.crumple + v11.crumple) * 0.25;
            if (crum > 0.05) {
              sctx.fillStyle = `rgba(20, 14, 4, ${crum * 0.6})`;
              sctx.beginPath();
              sctx.moveTo(v00.x, v00.y);
              sctx.lineTo(v10.x, v10.y);
              sctx.lineTo(v11.x, v11.y);
              sctx.lineTo(v01.x, v01.y);
              sctx.closePath();
              sctx.fill();
            }
          }
        }
        if (this.shadowCanvas) ctx.drawImage(this.shadowCanvas, 0, 0);
      }

      // ---- Step 3: Crease highlights along high-crumple edges ----
      ctx.lineWidth = 0.7;
      for (let r2 = 0; r2 < rows; r2++) {
        for (let c2 = 0; c2 < cols - 1; c2++) {
          const a = verts[r2 * cols + c2];
          const b = verts[r2 * cols + c2 + 1];
          const crum = Math.max(a.crumple, b.crumple);
          if (crum > 0.3) {
            ctx.strokeStyle = `rgba(255, 245, 220, ${Math.min(0.75, crum * 0.75)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (let r2 = 0; r2 < rows - 1; r2++) {
        for (let c2 = 0; c2 < cols; c2++) {
          const a = verts[r2 * cols + c2];
          const b = verts[(r2 + 1) * cols + c2];
          const crum = Math.max(a.crumple, b.crumple);
          if (crum > 0.3) {
            ctx.strokeStyle = `rgba(255, 245, 220, ${Math.min(0.75, crum * 0.75)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // ---- Step 4: Soft lighting vignette ----
      const vg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        w * 0.2,
        w / 2,
        h / 2,
        w * 0.8,
      );
      vg.addColorStop(0, "rgba(255,255,255,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#f3ebd9";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    ctx.restore();
  }

  // Reset to flat
  reset() {
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      v.x = v.rx;
      v.y = v.ry;
      v.vx = 0;
      v.vy = 0;
      v.crumple = 0;
    }
  }
}
