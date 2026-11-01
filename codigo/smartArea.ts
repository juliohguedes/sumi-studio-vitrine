import type { Pt } from "./panels";
import type { Mask, Rect, View } from "./types";

// Área inteligente: a partir de um clique, acha a região cercada pelos traços.
// 1) desenha as linhas numa grade (só para a conta — o resultado é vetorial);
// 2) engrossa as linhas para fechar pequenas falhas e preenche a partir do clique;
// 3) devolve a área ao tamanho certo e avança um pouco por baixo da linha;
// 4) transforma o contorno em polígonos (marching squares) — com buracos, se houver.

const MAX_CELLS = 3_000_000;

// Distância (aproximada, chanfro 1/√2) de cada célula até a célula "fonte" mais próxima.
function distanceTo(src: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : 1e9;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

function floodFill(blocked: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack = [start];
  out[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const tryPush = (j: number) => {
      if (!blocked[j] && !out[j]) {
        out[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) tryPush(i - 1);
    if (x < w - 1) tryPush(i + 1);
    if (i >= w) tryPush(i - w);
    if (i < w * (h - 1)) tryPush(i + w);
  }
  return out;
}

// Pares de arestas cortadas pelo contorno em cada caso do marching squares.
// Arestas: 0 = topo, 1 = direita, 2 = baixo, 3 = esquerda.
const CASES: number[][] = [
  [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [3, 2], [0, 2], [0, 1, 2, 3], [1, 2], [3, 1], [0, 1], [3, 0], [],
];

function contours(m: Uint8Array, w: number, h: number): Pt[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  const W = w + 2;
  // Chave do ponto no meio de uma aresta da grade (horizontal ou vertical)
  const hKey = (x: number, y: number) => ((y + 1) * W + (x + 1)) * 2;
  const vKey = (x: number, y: number) => ((y + 1) * W + (x + 1)) * 2 + 1;
  const segA: number[] = [];
  const segB: number[] = [];
  const byPoint = new Map<number, number[]>();
  const link = (k: number, s: number) => {
    const l = byPoint.get(k);
    if (l) l.push(s);
    else byPoint.set(k, [s]);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = at(x, y) | (at(x + 1, y) << 1) | (at(x + 1, y + 1) << 2) | (at(x, y + 1) << 3);
      const edges = CASES[c];
      if (!edges.length) continue;
      const key = (e: number) => (e === 0 ? hKey(x, y) : e === 1 ? vKey(x + 1, y) : e === 2 ? hKey(x, y + 1) : vKey(x, y));
      for (let i = 0; i < edges.length; i += 2) {
        const s = segA.length;
        const a = key(edges[i]);
        const b = key(edges[i + 1]);
        segA.push(a);
        segB.push(b);
        link(a, s);
        link(b, s);
      }
    }
  }
  const toPt = (k: number): Pt => {
    const vertical = k & 1;
    const cell = k >> 1;
    const gx = (cell % W) - 1;
    const gy = Math.floor(cell / W) - 1;
    return vertical ? { x: gx, y: gy + 0.5 } : { x: gx + 0.5, y: gy };
  };
  const used = new Uint8Array(segA.length);
  const rings: Pt[][] = [];
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const ring = [toPt(segA[s0])];
    let point = segB[s0];
    let seg = s0;
    while (point !== segA[s0]) {
      ring.push(toPt(point));
      const next = byPoint.get(point)!.find((t) => t !== seg && !used[t]);
      if (next === undefined) break;
      used[next] = 1;
      seg = next;
      point = segA[next] === point ? segB[next] : segA[next];
    }
    rings.push(ring);
  }
  return rings;
}

function simplifyRing(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i];
    const b = pts[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = eps;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / len;
      if (d > bestD) {
        bestD = d;
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

function ringArea(r: Pt[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export interface AreaOptions {
  click: Pt;
  rect: Rect; // até onde a área pode ir (a página)
  cell: number; // tamanho desejado de cada célula da grade, em unidades
  gap: number; // tamanho das falhas que são fechadas, em unidades
  expand: number; // quanto a área avança por baixo da linha, em unidades
  drawLines: (ctx: CanvasRenderingContext2D, v: View) => void; // desenha as linhas em preto
}

export function findArea(o: AreaOptions): Mask | null {
  const cell = Math.max(o.cell, Math.sqrt((o.rect.w * o.rect.h) / MAX_CELLS));
  const w = Math.ceil(o.rect.w / cell);
  const h = Math.ceil(o.rect.h / cell);
  const cx = Math.floor((o.click.x - o.rect.x) / cell);
  const cy = Math.floor((o.click.y - o.rect.y) / cell);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  o.drawLines(ctx, { zoom: 1 / cell, ox: -o.rect.x / cell, oy: -o.rect.y / cell });
  const px = ctx.getImageData(0, 0, w, h).data;
  const line = new Uint8Array(w * h);
  for (let i = 0; i < line.length; i++) line[i] = px[i * 4] < 128 ? 1 : 0;

  const gapCells = o.gap / 2 / cell; // engrossar cada lado pela metade fecha falhas do tamanho todo
  const lineDist = distanceTo(line, w, h);
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) blocked[i] = lineDist[i] <= gapCells ? 1 : 0;
  const start = cy * w + cx;
  if (blocked[start]) return null; // clicou em cima da linha

  const region = floodFill(blocked, w, h, start);
  const regionDist = distanceTo(region, w, h);
  const grow = gapCells + o.expand / cell;
  const final = new Uint8Array(w * h);
  for (let i = 0; i < final.length; i++) final[i] = regionDist[i] <= grow ? 1 : 0;

  const rings = contours(final, w, h)
    .map((r) => simplifyRing(r, 0.6))
    .filter((r) => r.length >= 3 && ringArea(r) >= 4)
    .map((r) => r.map((p) => ({ x: o.rect.x + (p.x + 0.5) * cell, y: o.rect.y + (p.y + 0.5) * cell })));
  return rings.length ? rings : null;
}
