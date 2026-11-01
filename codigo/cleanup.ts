import type { StrokePoint } from "./types";

// Limpeza do traço ao soltar a caneta: o tremido da mão some e o traço vira uma curva lisa,
// mantendo as pontas, as curvas de verdade e a variação de pressão.
// 1) média móvel tira o tremido; 2) simplificação (Ramer-Douglas-Peucker) deixa só os
// pontos que importam; 3) curva Catmull-Rom passa suave por eles.

// Quanto a pressão "pesa" como distância na simplificação (em pixels de tela por 1,0 de pressão).
// Sem isso, um traço reto que afina na ponta perderia o afinamento.
const PRESSURE_PX = 10;
const RESAMPLE_PX = 1.5; // espaçamento dos pontos do traço limpo, na tela

function movingAverage(pts: StrokePoint[], half: number): StrokePoint[] {
  const n = pts.length;
  const out: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    // Janela menor perto das pontas: começo e fim do traço ficam no lugar
    const w = Math.min(half, i, n - 1 - i);
    let x = 0;
    let y = 0;
    let p = 0;
    for (let j = i - w; j <= i + w; j++) {
      x += pts[j].x;
      y += pts[j].y;
      p += pts[j].p;
    }
    const c = 2 * w + 1;
    out.push({ x: x / c, y: y / c, p: p / c });
  }
  return out;
}

// Distância do ponto q até o segmento a-b, contando a pressão como terceira dimensão.
function dist3(q: StrokePoint, a: StrokePoint, b: StrokePoint, pScale: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dp = (b.p - a.p) * pScale;
  const len2 = dx * dx + dy * dy + dp * dp;
  let t = len2 > 0 ? ((q.x - a.x) * dx + (q.y - a.y) * dy + (q.p - a.p) * pScale * dp) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t), (q.p - a.p) * pScale - dp * t);
}

function simplify(pts: StrokePoint[], eps: number, pScale: number): StrokePoint[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = eps;
    for (let k = i + 1; k < j; k++) {
      const d = dist3(pts[k], pts[i], pts[j], pScale);
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

function catmullRom(pts: StrokePoint[], step: number): StrokePoint[] {
  if (pts.length < 3) return pts;
  const out: StrokePoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        x: f(p0.x, p1.x, p2.x, p3.x),
        y: f(p0.y, p1.y, p2.y, p3.y),
        p: Math.max(0, Math.min(1, f(p0.p, p1.p, p2.p, p3.p))),
      });
    }
  }
  return out;
}

// strength: 0 (sem limpeza) a 1 (máxima). pxToDoc: tamanho de 1 pixel de tela em unidades
// do documento no zoom em que o traço foi feito (a limpeza é medida na tela, como a mão).
export function cleanStroke(points: StrokePoint[], strength: number, pxToDoc: number): StrokePoint[] {
  if (strength <= 0 || points.length < 4) return points;
  let pts = movingAverage(points, Math.round(1 + strength * 5));
  pts = movingAverage(pts, Math.round(1 + strength * 3));
  pts = simplify(pts, (0.3 + strength * 2) * pxToDoc, PRESSURE_PX * pxToDoc);
  return catmullRom(pts, RESAMPLE_PX * pxToDoc);
}
