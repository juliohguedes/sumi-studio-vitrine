import type { Rect } from "./types";

// Painéis (quadros do mangá). Cada painel é um polígono convexo em unidades do documento.
// Um painel é dividido por um "corte": uma linha que separa o polígono em dois,
// deixando entre eles a calha (o espaço branco). Os modelos prontos são só uma lista
// de cortes — e a futura ferramenta "cortar com um traço" vai usar a mesma conta.

export interface Pt {
  x: number;
  y: number;
}

// Estilo da borda: sem ele, a borda é a linha reta de sempre. Os estilos vêm dos pacotes de materiais.
export interface FrameStyle {
  wobble: number; // quanto a linha treme, em unidades
  swell: number; // quanto a espessura varia (0..1)
  over?: number; // quanto a linha passa do canto, em unidades
  double?: number; // segunda linha, fina, a essa distância para dentro
  pack?: string; // pacote pago de onde veio (para a troca num reembolso)
}

export interface Panel {
  id: number;
  page: number; // índice da página (0 = primeira)
  poly: Pt[];
  border: number; // espessura da borda preta, em unidades
  frame?: FrameStyle;
  // O próprio id + os ids dos quadros de onde ele saiu (ao cortar). Um desenho feito num
  // quadro que depois foi cortado continua preso aos pedaços dele.
  lineage: number[];
}

export interface PanelSettings {
  margin: number; // margem da página até os quadros, em unidades (0,1 mm)
  gutterH: number; // calha entre linhas de quadros (corte deitado)
  gutterV: number; // calha entre colunas de quadros (corte em pé)
  border: number; // espessura da borda preta
  frame?: FrameStyle; // estilo da borda dos quadros novos
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = { margin: 180, gutterH: 60, gutterV: 30, border: 8 };

// Corte de um modelo, em coordenadas 0..1 da área útil (dentro da margem).
// Pode passar das bordas: só os quadros que o segmento atravessa são cortados.
export interface Cut {
  a: [number, number];
  b: [number, number];
}

// Mantém a parte do polígono onde o lado (distância assinada até a linha) é >= limite.
function clipHalfPlane(poly: Pt[], a: Pt, n: Pt, limit: number): Pt[] {
  const side = (p: Pt) => (p.x - a.x) * n.x + (p.y - a.y) * n.y - limit;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

function area(poly: Pt[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

// Quanto do segmento a-b fica dentro do polígono convexo (método de Cyrus-Beck).
function insideLength(poly: Pt[], a: Pt, b: Pt) {
  let t0 = 0;
  let t1 = 1;
  const d = { x: b.x - a.x, y: b.y - a.y };
  // Garante orientação: centro do polígono do lado "de dentro" de cada aresta
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    let n = { x: -(q.y - p.y), y: q.x - p.x };
    if ((c.x - p.x) * n.x + (c.y - p.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    const num = (a.x - p.x) * n.x + (a.y - p.y) * n.y;
    const den = d.x * n.x + d.y * n.y;
    if (den === 0) {
      if (num < 0) return 0;
      continue;
    }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * Math.hypot(d.x, d.y);
}

// Divide um painel pela linha a-b, deixando a calha entre as duas partes.
// Corte deitado usa a calha horizontal; em pé, a vertical; inclinado, uma mistura.
export function splitPanel(poly: Pt[], a: Pt, b: Pt, s: PanelSettings): Pt[][] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const gutter = s.gutterV + (s.gutterH - s.gutterV) * Math.abs(n.y);
  const one = clipHalfPlane(poly, a, n, gutter / 2);
  const two = clipHalfPlane(poly, a, { x: -n.x, y: -n.y }, gutter / 2);
  return [one, two].filter((p) => p.length >= 3 && area(p) > 1);
}

// Aplica um corte a todos os painéis que o segmento atravessa.
// "from" = índice do polígono de origem (para saber de quem cada pedaço veio).
export function applyCutWithSource(polys: Pt[][], a: Pt, b: Pt, s: PanelSettings) {
  const out: { poly: Pt[]; from: number }[] = [];
  polys.forEach((p, from) => {
    if (insideLength(p, a, b) > 1) for (const poly of splitPanel(p, a, b, s)) out.push({ poly, from });
    else out.push({ poly: p, from });
  });
  return out;
}

export function applyCut(polys: Pt[][], a: Pt, b: Pt, s: PanelSettings): Pt[][] {
  return applyCutWithSource(polys, a, b, s).map((c) => c.poly);
}

// O ponto está dentro do polígono convexo?
export function insidePoly(poly: Pt[], pt: Pt) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = (q.x - p.x) * (pt.y - p.y) - (q.y - p.y) * (pt.x - p.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// Monta os painéis de um modelo dentro de uma página.
export function layoutTemplate(cuts: Cut[], page: Rect, s: PanelSettings): Pt[][] {
  const live = {
    x: page.x + s.margin,
    y: page.y + s.margin,
    w: page.w - s.margin * 2,
    h: page.h - s.margin * 2,
  };
  const at = ([u, v]: [number, number]): Pt => ({ x: live.x + u * live.w, y: live.y + v * live.h });
  let polys: Pt[][] = [
    [
      { x: live.x, y: live.y },
      { x: live.x + live.w, y: live.y },
      { x: live.x + live.w, y: live.y + live.h },
      { x: live.x, y: live.y + live.h },
    ],
  ];
  for (const c of cuts) polys = applyCut(polys, at(c.a), at(c.b), s);
  return polys;
}

// ---------- Arrastar bordas ----------

const MIN_PANEL_AREA = 100 * 100; // 1 cm²: quadro menor que isso não é permitido ao arrastar

export interface EdgeHit {
  panel: Panel;
  edge: number; // aresta i = do vértice i ao i+1
}

// Aresta i do polígono: começo, direção (unitária) e normal apontando para fora do quadro.
function edgeInfo(poly: Pt[], i: number) {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let out = { x: u.y, y: -u.x };
  const c = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  if ((c.x - a.x) * out.x + (c.y - a.y) * out.y > 0) out = { x: -out.x, y: -out.y };
  return { a, b, u, out };
}

// Distância de um ponto até a aresta i
export function edgeDistance(poly: Pt[], i: number, pt: Pt) {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t));
}

export function outwardNormal(poly: Pt[], i: number) {
  return edgeInfo(poly, i).out;
}

// As bordas que andam juntas com a aresta agarrada: as que ficam na mesma linha e as
// do outro lado da calha, encostadas umas nas outras (como numa divisa entre quadros).
export function edgeGroup(panels: Panel[], start: EdgeHit, maxGap: number): EdgeHit[] {
  const g = edgeInfo(start.panel.poly, start.edge);
  const along = (p: Pt) => (p.x - g.a.x) * g.u.x + (p.y - g.a.y) * g.u.y;
  const offset = (p: Pt) => (p.x - g.a.x) * g.out.x + (p.y - g.a.y) * g.out.y;
  const cands: (EdgeHit & { lo: number; hi: number })[] = [];
  for (const panel of panels) {
    for (let i = 0; i < panel.poly.length; i++) {
      const e = edgeInfo(panel.poly, i);
      if (Math.abs(e.u.x * g.u.y - e.u.y * g.u.x) > 0.01) continue; // não é paralela
      const o = offset(e.a);
      const sameSide = e.out.x * g.out.x + e.out.y * g.out.y > 0;
      if (sameSide ? Math.abs(o) > 1 : o < -1 || o > maxGap + 1) continue;
      const pa = along(e.a);
      const pb = along(e.b);
      cands.push({ panel, edge: i, lo: Math.min(pa, pb), hi: Math.max(pa, pb) });
    }
  }
  const first = cands.find((c) => c.panel === start.panel && c.edge === start.edge)!;
  const group = [first];
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cands) {
      if (group.includes(c)) continue;
      if (group.some((m) => Math.min(m.hi, c.hi) - Math.max(m.lo, c.lo) > 1)) {
        group.push(c);
        grew = true;
      }
    }
  }
  return group.map(({ panel, edge }) => ({ panel, edge }));
}

function lineIntersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

function isConvex(poly: Pt[]) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// O quadro encolhido d unidades para dentro (a segunda linha da borda dupla)
export function insetPoly(poly: Pt[], d: number): Pt[] {
  let out = poly;
  poly.forEach((a, i) => {
    const n = outwardNormal(poly, i);
    if (out.length) out = clipHalfPlane(out, a, { x: -n.x, y: -n.y }, d);
  });
  return out;
}

// Empurra a aresta i pelo deslocamento d. As arestas vizinhas esticam ou encolhem
// para acompanhar. Retorna null se o quadro ficaria torto ou pequeno demais.
export function moveEdge(poly: Pt[], i: number, d: Pt): Pt[] | null {
  const k = poly.length;
  const a = poly[i];
  const b = poly[(i + 1) % k];
  const prev = poly[(i - 1 + k) % k];
  const next = poly[(i + 2) % k];
  const dir = { x: b.x - a.x, y: b.y - a.y };
  const moved = { x: a.x + d.x, y: a.y + d.y };
  const na = lineIntersect(prev, { x: a.x - prev.x, y: a.y - prev.y }, moved, dir);
  const nb = lineIntersect(b, { x: next.x - b.x, y: next.y - b.y }, moved, dir);
  if (!na || !nb) return null;
  if ((nb.x - na.x) * dir.x + (nb.y - na.y) * dir.y <= 0) return null; // a aresta "virou"
  const out = poly.slice();
  out[i] = na;
  out[(i + 1) % k] = nb;
  return isConvex(out) && area(out) >= MIN_PANEL_AREA ? out : null;
}
