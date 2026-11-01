import type { Pt } from "./panels";
import type { Rect, View } from "./types";

// Réguas: guias que só aparecem na tela (não saem na exportação). Com as réguas ligadas,
// o traço que começa perto de uma régua "gruda" nela — linha reta perfeita, curva, círculo/elipse.
// A perspectiva (1, 2 ou 3 pontos de fuga) vale para a página inteira: cada traço corre
// sozinho para o ponto de fuga (ou fica na horizontal/vertical) conforme a direção em que começa.

export type RulerKind = "line" | "curve" | "ellipse" | "persp";

// Quadriculado em perspectiva, para construir fundos: chão ou uma das paredes
export type GridPlane = "floor" | "wallA" | "wallB";
export interface PerspGrid {
  plane: GridPlane;
  at: Pt; // um canto de um quadradinho
  size: number; // tamanho do quadradinho nesse canto, em unidades
}

export type Ruler =
  | { id: number; kind: "line"; a: Pt; b: Pt }
  | { id: number; kind: "curve"; pts: Pt[] }
  | { id: number; kind: "ellipse"; c: Pt; rx: number; ry: number; angle: number }
  | { id: number; kind: "persp"; page: number; vps: Pt[]; grid?: PerspGrid };

export const RULER_COLOR = "#b25ce8";
const OFF_COLOR = "rgba(180, 180, 190, 0.55)";

const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number) => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

// ---------- Curva (Catmull-Rom passando pelos pontos) ----------

export function curvePolyline(pts: Pt[], steps = 16): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Simplifica o traço à mão da régua de curva em poucos pontos de controle (Ramer-Douglas-Peucker)
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const d = unit(sub(pts[j], pts[i]));
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const v = sub(pts[k], pts[i]);
      const dist = Math.abs(v.x * d.y - v.y * d.x);
      if (dist > bestD) {
        bestD = dist;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Ponto mais perto numa linha quebrada, com a direção dela ali
function nearestOnPolyline(poly: Pt[], p: Pt): { q: Pt; dir: Pt; dist: number } {
  let best = { q: poly[0], dir: { x: 1, y: 0 }, dist: Infinity };
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const ab = sub(poly[i + 1], a);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const q = add(a, mul(ab, t));
    const dist = len(sub(p, q));
    if (dist < best.dist) best = { q, dir: unit(ab), dist };
  }
  return best;
}

function offsetPolyline(poly: Pt[], d: number): Pt[] {
  return poly.map((p, i) => {
    const a = poly[Math.max(0, i - 1)];
    const b = poly[Math.min(poly.length - 1, i + 1)];
    const t = unit(sub(b, a));
    return add(p, { x: -t.y * d, y: t.x * d });
  });
}

// ---------- Elipse ----------

function toEllipse(r: Extract<Ruler, { kind: "ellipse" }>, p: Pt) {
  const cos = Math.cos(-r.angle);
  const sin = Math.sin(-r.angle);
  const d = sub(p, r.c);
  return { u: d.x * cos - d.y * sin, v: d.x * sin + d.y * cos };
}

function fromEllipse(r: Extract<Ruler, { kind: "ellipse" }>, u: number, v: number): Pt {
  const cos = Math.cos(r.angle);
  const sin = Math.sin(r.angle);
  return { x: r.c.x + u * cos - v * sin, y: r.c.y + u * sin + v * cos };
}

// ---------- Grudar o traço ----------

// Distância (em unidades) do ponto até a régua (perspectiva não entra: ela vale para a página toda)
export function rulerDistance(r: Ruler, p: Pt): number {
  if (r.kind === "line") {
    const d = unit(sub(r.b, r.a));
    const v = sub(p, r.a);
    return Math.abs(v.x * d.y - v.y * d.x);
  }
  if (r.kind === "curve") return nearestOnPolyline(curvePolyline(r.pts), p).dist;
  if (r.kind === "ellipse") {
    const { u, v } = toEllipse(r, p);
    const k = Math.hypot(u / Math.max(r.rx, 1e-6), v / Math.max(r.ry, 1e-6));
    return Math.abs(k - 1) * Math.min(r.rx, r.ry);
  }
  return Infinity;
}

// O traço que começa em p0 corre paralelo à régua (passando por p0)
export function makeSnap(r: Ruler, p0: Pt): (p: Pt) => Pt {
  if (r.kind === "line") {
    const d = unit(sub(r.b, r.a));
    return (p) => add(p0, mul(d, dot(sub(p, p0), d)));
  }
  if (r.kind === "curve") {
    const poly = curvePolyline(r.pts);
    const n = nearestOnPolyline(poly, p0);
    const side = Math.sign(n.dir.x * (p0.y - n.q.y) - n.dir.y * (p0.x - n.q.x)) || 1;
    const off = offsetPolyline(poly, side * n.dist);
    return (p) => nearestOnPolyline(off, p).q;
  }
  if (r.kind === "ellipse") {
    // Elipse "irmã" (mesmo centro e formato) que passa por p0
    const s = toEllipse(r, p0);
    const k = Math.hypot(s.u / r.rx, s.v / r.ry);
    return (p) => {
      const { u, v } = toEllipse(r, p);
      const phi = Math.atan2(v / r.ry, u / r.rx);
      return fromEllipse(r, k * r.rx * Math.cos(phi), k * r.ry * Math.sin(phi));
    };
  }
  return (p) => p;
}

// Perspectiva: direções possíveis a partir de p0 — para cada ponto de fuga, e (com 1 ou 2 pontos)
// também a vertical e, com 1 ponto, a horizontal. Retorna a régua da direção mais parecida com o movimento.
export function perspectiveSnap(r: Extract<Ruler, { kind: "persp" }>, p0: Pt, moved: Pt): (p: Pt) => Pt {
  const dirs: Pt[] = r.vps.map((vp) => unit(sub(vp, p0)));
  if (r.vps.length <= 2) dirs.push({ x: 0, y: 1 });
  if (r.vps.length === 1) dirs.push({ x: 1, y: 0 });
  const m = unit(sub(moved, p0));
  let best = dirs[0];
  let bestCos = -1;
  for (const d of dirs) {
    const c = Math.abs(dot(d, m));
    if (c > bestCos) {
      bestCos = c;
      best = d;
    }
  }
  return (p) => add(p0, mul(best, dot(sub(p, p0), best)));
}

// Perspectiva padrão, com o horizonte e o centro no ponto clicado
export function newPerspective(id: number, page: number, n: number, at: Pt, pageW: number, pageH: number): Ruler {
  const vps =
    n === 1
      ? [at]
      : [
          { x: at.x - pageW * 0.95, y: at.y },
          { x: at.x + pageW * 0.95, y: at.y },
        ];
  if (n === 3) vps.push({ x: at.x, y: at.y + pageH * 1.2 });
  return { id, kind: "persp", page, vps };
}

// ---------- Quadriculado ----------

type Persp = Extract<Ruler, { kind: "persp" }>;
type H = [number, number, number]; // ponto ou reta em coordenadas homogêneas (z = 0: direção)

const cross = (a: H, b: H): H => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hp = (p: Pt): H => [p.x, p.y, 1];

// As duas direções do plano: cada uma é um ponto de fuga ou (sem ele) a horizontal/vertical
function planeDirs(r: Persp, plane: GridPlane): [H, H] {
  const across: H = r.vps.length > 1 ? hp(r.vps[1]) : [1, 0, 0];
  const up: H = r.vps.length > 2 ? hp(r.vps[2]) : [0, 1, 0];
  if (plane === "floor") return [hp(r.vps[0]), across];
  return plane === "wallA" ? [hp(r.vps[0]), up] : [across, up];
}

function towards(at: Pt, d: H): Pt {
  return Math.abs(d[2]) < 1e-9 ? unit({ x: d[0], y: d[1] }) : unit(sub({ x: d[0] / d[2], y: d[1] / d[2] }, at));
}

// O segundo canto do quadradinho, para onde vai a alça de tamanho
function gridSizePoint(r: Persp, g: PerspGrid): Pt {
  return add(g.at, mul(towards(g.at, planeDirs(r, g.plane)[0]), g.size));
}

// Corta o segmento a-b para dentro da caixa (Liang-Barsky)
function clipSegment(a: Pt, b: Pt, box: Rect): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const d = sub(b, a);
  const sides: [number, number][] = [
    [-d.x, a.x - box.x],
    [d.x, box.x + box.w - a.x],
    [-d.y, a.y - box.y],
    [d.y, box.y + box.h - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [add(a, mul(d, t0)), add(a, mul(d, t1))];
}

const GRID_LINES = 90; // linhas para cada lado do canto

// As linhas do quadriculado dentro da página. O plano é uma folha quadriculada vista em
// perspectiva: monta-se um quadradinho a partir dos pontos de fuga e a conta leva qualquer
// ponto (u, v) da folha para a tela (homografia).
export function gridLines(r: Persp, page: Rect): [Pt, Pt][] {
  const g = r.grid;
  if (!g) return [];
  const [d1, d2] = planeDirs(r, g.plane);
  const p0 = g.at;
  const p1 = add(p0, mul(towards(p0, d1), g.size));
  const p3 = add(p0, mul(towards(p0, d2), g.size));
  const c = cross(cross(hp(p1), d2), cross(hp(p3), d1));
  if (Math.abs(c[2]) < 1e-9) return [];
  const p2 = { x: c[0] / c[2], y: c[1] / c[2] };
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return []; // o canto está em cima do horizonte
  const e = (sx * dy2 - dx2 * sy) / den;
  const f = (dx1 * sy - sx * dy1) / den;
  const w = (u: number, v: number) => e * u + f * v + 1;
  const map = (u: number, v: number) => ({
    x: ((p1.x - p0.x + e * p1.x) * u + (p3.x - p0.x + f * p3.x) * v + p0.x) / w(u, v),
    y: ((p1.y - p0.y + e * p1.y) * u + (p3.y - p0.y + f * p3.y) * v + p0.y) / w(u, v),
  });
  // Atrás de quem olha (w <= 0) a conta se inverte: a linha para antes. E perto do horizonte
  // (w grande) os quadrados ficam minúsculos e viram uma faixa sólida: também para ali.
  const MIN_W = 0.03;
  const MAX_W = Math.sqrt(g.size / 12);
  const line = (ua: number, va: number, ub: number, vb: number): [Pt, Pt] | null => {
    const wa = w(ua, va);
    const wb = w(ub, vb);
    let a = 0;
    let b = 1;
    if (Math.abs(wb - wa) > 1e-9) {
      const t0 = (MIN_W - wa) / (wb - wa);
      const t1 = (MAX_W - wa) / (wb - wa);
      a = Math.max(0, Math.min(t0, t1));
      b = Math.min(1, Math.max(t0, t1));
      if (a >= b) return null;
    } else if (wa < MIN_W || wa > MAX_W) return null;
    return clipSegment(map(ua + (ub - ua) * a, va + (vb - va) * a), map(ua + (ub - ua) * b, va + (vb - va) * b), page);
  };
  const out: [Pt, Pt][] = [];
  for (let i = -GRID_LINES; i <= GRID_LINES; i++) {
    const a = line(i, -GRID_LINES, i, GRID_LINES);
    const b = line(-GRID_LINES, i, GRID_LINES, i);
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return out;
}

// ---------- Alças (para editar a régua arrastando) ----------

export function handles(r: Ruler): { key: string; pt: Pt }[] {
  if (r.kind === "line") return [{ key: "a", pt: r.a }, { key: "b", pt: r.b }, { key: "mid", pt: mul(add(r.a, r.b), 0.5) }];
  if (r.kind === "curve") return r.pts.map((pt, i) => ({ key: String(i), pt }));
  if (r.kind === "ellipse")
    return [
      { key: "c", pt: r.c },
      { key: "rx", pt: fromEllipse(r, r.rx, 0) },
      { key: "ry", pt: fromEllipse(r, 0, r.ry) },
    ];
  const vps = r.vps.map((pt, i) => ({ key: String(i), pt }));
  return r.grid ? [...vps, { key: "gridAt", pt: r.grid.at }, { key: "gridSize", pt: gridSizePoint(r, r.grid) }] : vps;
}

// Régua com a alça key arrastada até p (orig = como a régua estava ao começar a arrastar)
export function moveHandle(orig: Ruler, key: string, start: Pt, p: Pt, shift: boolean): Ruler {
  const d = sub(p, start);
  if (orig.kind === "line") {
    if (key === "mid") return { ...orig, a: add(orig.a, d), b: add(orig.b, d) };
    let q = p;
    if (shift) {
      // Shift: trava de 15 em 15 graus
      const o = key === "a" ? orig.b : orig.a;
      const v = sub(p, o);
      const step = Math.PI / 12;
      const ang = Math.round(Math.atan2(v.y, v.x) / step) * step;
      q = add(o, { x: Math.cos(ang) * len(v), y: Math.sin(ang) * len(v) });
    }
    return { ...orig, [key]: q } as Ruler;
  }
  if (orig.kind === "curve") return { ...orig, pts: orig.pts.map((pt, i) => (String(i) === key ? p : pt)) };
  if (orig.kind === "ellipse") {
    if (key === "c") return { ...orig, c: add(orig.c, d) };
    const v = sub(p, orig.c);
    if (key === "rx") return { ...orig, rx: Math.max(1, len(v)), angle: Math.atan2(v.y, v.x) };
    if (key === "corner") {
      // Criando: arrastar do centro para fora dá os dois raios (Shift = círculo)
      const rx = Math.max(1, Math.abs(v.x));
      const ry = Math.max(1, Math.abs(v.y));
      const m = Math.max(rx, ry);
      return shift ? { ...orig, rx: m, ry: m } : { ...orig, rx, ry };
    }
    const { u, v: vv } = toEllipse(orig, p);
    return { ...orig, ry: Math.max(1, Math.hypot(u, vv)) };
  }
  if (orig.grid && key === "gridAt") return { ...orig, grid: { ...orig.grid, at: p } };
  if (orig.grid && key === "gridSize") {
    const dir = towards(orig.grid.at, planeDirs(orig, orig.grid.plane)[0]);
    return { ...orig, grid: { ...orig.grid, size: Math.max(20, dot(sub(p, orig.grid.at), dir)) } };
  }
  return { ...orig, vps: orig.vps.map((pt, i) => (String(i) === key ? p : pt)) };
}

// ---------- Desenho na tela ----------

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  rulers: Ruler[],
  v: View,
  w: number,
  h: number,
  opts: { on: boolean; editing: boolean; selected: number | null; pageRect: (page: number) => Rect },
) {
  const sp = (p: Pt) => ({ x: p.x * v.zoom + v.ox, y: p.y * v.zoom + v.oy });
  const color = opts.on ? RULER_COLOR : OFF_COLOR;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  for (const r of rulers) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (r.kind === "line") {
      // A régua reta é infinita: a parte entre as alças forte, o resto fraco
      const a = sp(r.a);
      const b = sp(r.b);
      const d = unit(sub(b, a));
      const far = w + h;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(a.x - d.x * far, a.y - d.y * far);
      ctx.lineTo(b.x + d.x * far, b.y + d.y * far);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (r.kind === "curve") {
      ctx.beginPath();
      curvePolyline(r.pts).map(sp).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    } else if (r.kind === "ellipse") {
      const c = sp(r.c);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r.rx * v.zoom, r.ry * v.zoom, r.angle, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawPerspective(ctx, r, v, sp, opts.pageRect(r.page));
    }
  }
  if (opts.editing) {
    for (const r of rulers) {
      for (const hd of handles(r)) {
        const p = sp(hd.pt);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r.kind === "persp" ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = r.id === opts.selected ? "#fff" : color;
        ctx.fill();
        ctx.strokeStyle = r.id === opts.selected ? color : "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// Raios saindo de cada ponto de fuga, só dentro da página; o horizonte passa pelos pontos
function drawPerspective(
  ctx: CanvasRenderingContext2D,
  r: Extract<Ruler, { kind: "persp" }>,
  v: View,
  sp: (p: Pt) => Pt,
  page: Rect,
) {
  const pr = { x: page.x * v.zoom + v.ox, y: page.y * v.zoom + v.oy, w: page.w * v.zoom, h: page.h * v.zoom };
  ctx.save();
  ctx.beginPath();
  ctx.rect(pr.x, pr.y, pr.w, pr.h);
  ctx.clip();
  const corners = [
    { x: pr.x, y: pr.y },
    { x: pr.x + pr.w, y: pr.y },
    { x: pr.x + pr.w, y: pr.y + pr.h },
    { x: pr.x, y: pr.y + pr.h },
  ];
  const far = (pr.w + pr.h) * 4;
  ctx.lineWidth = 1;
  for (const vp of r.vps.map(sp)) {
    // Ângulos que cobrem a página vista do ponto de fuga
    const angs = corners.map((c) => Math.atan2(c.y - vp.y, c.x - vp.x));
    const inside = vp.x >= pr.x && vp.x <= pr.x + pr.w && vp.y >= pr.y && vp.y <= pr.y + pr.h;
    let a0 = -Math.PI;
    let a1 = Math.PI;
    if (!inside) {
      // Desenrola os ângulos em volta do primeiro, para achar o leque certo
      const base = angs[0];
      const un = angs.map((a) => base + Math.atan2(Math.sin(a - base), Math.cos(a - base)));
      a0 = Math.min(...un);
      a1 = Math.max(...un);
    }
    const n = 28;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.moveTo(vp.x, vp.y);
      ctx.lineTo(vp.x + Math.cos(a) * far, vp.y + Math.sin(a) * far);
    }
    ctx.stroke();
  }
  // Horizonte
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (r.vps.length === 1) {
    const p = sp(r.vps[0]);
    ctx.moveTo(pr.x, p.y);
    ctx.lineTo(pr.x + pr.w, p.y);
  } else {
    const a = sp(r.vps[0]);
    const b = sp(r.vps[1]);
    const d = unit(sub(b, a));
    ctx.moveTo(a.x - d.x * far, a.y - d.y * far);
    ctx.lineTo(b.x + d.x * far, b.y + d.y * far);
  }
  ctx.stroke();
  const lines = gridLines(r, page);
  if (lines.length) {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of lines) {
      const pa = sp(a);
      const pb = sp(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
