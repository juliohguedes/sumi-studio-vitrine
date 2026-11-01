import type { Pt } from "./panels";
import type { Rect, View } from "./types";

// Retícula (screentone) vetorial: o padrão de pontos/linhas é calculado no espaço do
// documento, então fica nítido em qualquer zoom e na exportação (sem moiré de reamostragem).
// Na tela, quando os pontos ficariam menores que ~6 px, mostra um cinza equivalente.

export type ToneKind = "dots" | "lines" | "cross" | "sand";

// Degradê: a densidade vai do valor normal até "to", atravessando o desenho da camada
export interface ToneFade {
  dir: 0 | 90 | 180 | 270; // para onde a retícula some: 0 = direita, 90 = baixo
  to: number; // densidade no fim (0..1)
}

export interface ToneSettings {
  kind: ToneKind;
  lpi: number; // linhas por polegada (mangá: 50–75)
  density: number; // 0..1 (quanto da área fica preta)
  angle: number; // graus (pontos costumam ir a 45°)
  fade?: ToneFade;
  image?: { src: string; mm: number }; // textura de um pacote: imagem que se repete a cada "mm"
  pack?: string; // pacote pago de onde veio (para a troca num reembolso)
}

export const DEFAULT_TONE: ToneSettings = { kind: "dots", lpi: 60, density: 0.3, angle: 45 };

const TILE = 64; // a célula do padrão é desenhada grande e depois reduzida
const SAND_CELLS = 8; // a areia só se repete a cada 8 células, para não parecer grade
const tiles = new Map<string, HTMLCanvasElement>();

// Grãos da areia: sempre os mesmos (o desenho não pode mudar a cada redesenho). Um grão em cada
// casinha de uma grade fina, fora do centro: fica irregular, mas sem manchas.
function sandGrains(n: number) {
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ x: (i + rnd()) / n, y: (j + rnd()) / n });
  return out;
}

function drawSand(g: CanvasRenderingContext2D, size: number, amount: number) {
  const grains = sandGrains(SAND_CELLS * 2);
  const r = size * Math.sqrt(amount / (grains.length * Math.PI));
  g.beginPath();
  for (const p of grains) {
    // Repete na borda oposta, para a emenda da repetição não aparecer
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const x = p.x * size + dx;
        const y = p.y * size + dy;
        if (x < -r || y < -r || x > size + r || y > size + r) continue;
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, Math.PI * 2);
      }
    }
  }
  g.fill();
}

function tile(kind: ToneKind, density: number) {
  const d = Math.round(density * 100) / 100;
  const key = `${kind}:${d}`;
  let c = tiles.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  const size = kind === "sand" ? TILE * SAND_CELLS : TILE;
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  if (kind === "lines") {
    const t = d * TILE;
    g.fillRect(0, (TILE - t) / 2, TILE, t);
  } else if (kind === "cross") {
    // Duas linhas cruzadas: a espessura de cada uma é tal que, juntas, cobrem a densidade
    const t = (1 - Math.sqrt(1 - d)) * TILE;
    g.fillRect(0, (TILE - t) / 2, TILE, t);
    g.fillRect((TILE - t) / 2, 0, t, TILE);
  } else if (d <= 0.5) {
    // pontos pretos: área do ponto = densidade × área da célula
    if (kind === "sand") drawSand(g, size, d);
    else {
      g.beginPath();
      g.arc(TILE / 2, TILE / 2, TILE * Math.sqrt(d / Math.PI), 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // acima de 50%: fundo preto com furos brancos (como a retícula impressa)
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = "destination-out";
    if (kind === "sand") drawSand(g, size, 1 - d);
    else {
      g.beginPath();
      g.arc(TILE / 2, TILE / 2, TILE * Math.sqrt((1 - d) / Math.PI), 0, Math.PI * 2);
      g.fill();
    }
  }
  tiles.set(key, c);
  return c;
}

// Texturas de pacote: carregadas uma vez; quando terminam, a tela redesenha
const toneImages = new Map<string, HTMLImageElement>();
let onToneImage = () => {};
export function setToneImageHandler(fn: () => void) {
  onToneImage = fn;
}

export function loadToneImage(src: string) {
  let img = toneImages.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onToneImage();
    img.src = src;
    toneImages.set(src, img);
  }
  return img;
}

// Tinta da retícula para o zoom atual (padrão alinhado ao documento, ou cinza se muito pequeno)
export function tonePaint(
  ctx: CanvasRenderingContext2D,
  t: ToneSettings,
  v: View,
  density = t.density,
): string | CanvasPattern {
  if (t.image) {
    const img = loadToneImage(t.image.src);
    if (!img.complete || !img.naturalWidth) return `rgba(0, 0, 0, ${t.density})`;
    const pattern = ctx.createPattern(img, "repeat")!;
    const k = (t.image.mm * 10 * v.zoom) / img.naturalWidth;
    pattern.setTransform(new DOMMatrix().translateSelf(v.ox, v.oy).rotateSelf(t.angle).scaleSelf(k));
    return pattern;
  }
  const periodPx = (254 / t.lpi) * v.zoom; // 1 polegada = 254 unidades
  if (periodPx < 6) return `rgba(0, 0, 0, ${density})`; // pontos menores fariam moiré na tela
  const pattern = ctx.createPattern(tile(t.kind, density), "repeat")!;
  pattern.setTransform(new DOMMatrix().translateSelf(v.ox, v.oy).rotateSelf(t.angle).scaleSelf(periodPx / TILE));
  return pattern;
}

// Pinta a tela inteira com a retícula. Com degradê, "box" é a caixa do desenho (em unidades):
// são faixas de densidade crescente, finas o bastante para o degrau não aparecer.
export function fillTone(g: CanvasRenderingContext2D, t: ToneSettings, v: View, w: number, h: number, dpr: number, box: Rect) {
  const f = t.image ? undefined : t.fade;
  if (!f) {
    g.fillStyle = tonePaint(g, t, v);
    g.fillRect(0, 0, w, h);
    return;
  }
  const across = f.dir === 0 || f.dir === 180;
  const start = (across ? box.x : box.y) * v.zoom + (across ? v.ox : v.oy);
  const size = Math.max(1, (across ? box.w : box.h) * v.zoom);
  const reverse = f.dir === 180 || f.dir === 270;
  const n = Math.min(128, Math.max(6, Math.ceil(size / 3)));
  const far = across ? w : h;
  const edge = (x: number) => Math.round(x * dpr) / dpr; // emenda no pixel, sem risco entre as faixas
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const density = t.density + (f.to - t.density) * (reverse ? 1 - k : k);
    if (density <= 0.005) continue;
    // A primeira e a última faixa vão até a beira da tela (o desenho pode passar da caixa)
    const a = i === 0 ? 0 : edge(start + (size * i) / n);
    const b = i === n - 1 ? far : edge(start + (size * (i + 1)) / n);
    if (b <= a) continue;
    g.fillStyle = tonePaint(g, t, v, density);
    if (across) g.fillRect(a, 0, b - a, h);
    else g.fillRect(0, a, w, b - a);
  }
}
