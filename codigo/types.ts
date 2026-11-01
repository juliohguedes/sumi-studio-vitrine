import type { Balloon } from "./balloons";
import type { Motif } from "./motifs";
import { newId } from "./ids";
import type { Panel, Pt } from "./panels";
import type { Ruler } from "./rulers";
import type { ToneSettings } from "./tone";

// Estruturas de dados do desenho vetorial.
// Nada aqui é pixel: tudo fica em "unidades" e é redesenhado em qualquer zoom.
// 1 unidade = 0,1 mm.

// Página B5 (182 x 257 mm)
export const PAGE_W = 1820;
export const PAGE_H = 2570;
export const PAGE_GAP = 160; // espaço entre páginas na rolagem

// Tira vertical — sem fim: cresce sozinha conforme você rola ou desenha.
// Ela tem a largura de uma página B5 e o pontilhado marca onde termina cada página:
// ao salvar/exportar, a tira é cortada nesses pontos e vira páginas normais.
export const STRIP_W = PAGE_W;
export const STRIP_SCREEN_H = PAGE_H; // altura de 1 página na tira
export const STRIP_START_H = PAGE_H * 3;
export const STRIP_GROW = PAGE_H; // cresce uma página de cada vez (sempre páginas inteiras)
export const STRIP_GROW_MARGIN = PAGE_H * 1.5; // sempre sobra isso abaixo do que está na tela

export type Format = "pages" | "strip";

export interface StrokePoint {
  x: number;
  y: number;
  p: number; // pressão da caneta, 0..1
}

// Como a pressão (e a direção) mudam a espessura do traço. Cada subferramenta tem o seu.
export interface StrokeStyle {
  minWidth: number; // espessura com pressão zero, em fração da máxima (0..1)
  curve: number; // >1 = precisa apertar mais para engrossar
  calligraphy?: boolean; // espessura muda com a direção, como pena chata
  grain?: number; // lápis: textura do papel aparecendo no traço (0..1)
  taper?: number; // pincel: afina no começo e no fim (fração do comprimento do traço)
  scatter?: number; // salpico: gotinhas de tinta em volta do caminho, em vez de linha
  soft?: number; // aerógrafo: borda esfumada (fração da espessura)
  // Textura de caneta (ver drawInk em render.ts)
  streak?: number; // falhas em fios ao longo do traço, mais fortes com pouca pressão (0..1)
  dry?: number; // a tinta acaba: depois de tantas espessuras de traço, ele fica todo falhado
  bristles?: number; // quantos fios a falha tem (poucos = marcador, muitos = pincel seco)
  rough?: number; // borda irregular, de tinta que corre no papel (0..1)
  blot?: number; // acúmulo de tinta onde a caneta pousa (0..1)
  split?: number; // a pena abre com a pressão e deixa um filete branco no meio (0..1)
  spit?: number; // respingos que a pena solta ao longo do traço (0..1)
  tooth?: number; // papel áspero: furos duros onde a tinta não chega (0..1)
  toothSize?: number; // tamanho desses furos (1 = fino)
  motif?: Motif; // pincel de cenário: desenhos pelo caminho em vez de linha (ver motifs.ts)
  pack?: string; // pacote pago de onde veio (para a troca num reembolso)
}

export interface Stroke {
  id: number; // único na obra (no desenho compartilhado, é assim que se sabe qual traço mudou)
  points: StrokePoint[];
  width: number; // espessura máxima, em unidades
  color: string;
  opacity: number; // 0..1
  style: StrokeStyle;
  panel?: number; // quadro onde o traço começou: ele não passa da borda desse quadro
  above?: boolean; // "saindo do quadro": livre e desenhado por cima das bordas
  mask?: Mask; // traço que veio de uma camada de área (ao juntar camadas) continua preso à área
  fill?: Mask; // pintura do balde: a área inteira é pintada (o ponto único marca onde se clicou)
  // Caixa que envolve o traço, para pular o que está fora da tela
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Área vetorial (contornos; com buracos, se houver). Usada pela área inteligente.
export type Mask = Pt[][];

// Imagem importada (página escaneada/desenhada fora), posicionada em unidades do documento
export interface ImageItem {
  src: string; // a imagem inteira (data URL) — vai junto no arquivo .sumi
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  strokes: Stroke[];
  mask?: Mask; // camada de área: o que se desenha nela fica preso dentro da área
  images?: ImageItem[]; // camada de páginas importadas
  tone?: ToneSettings; // camada de retícula: o que se desenha nela vira retícula
  fill?: boolean; // retícula aplicada numa área: a área inteira fica preenchida
}

// Algo que dá para desfazer/refazer
export type Action =
  | { type: "stroke"; layer: Layer; stroke: Stroke }
  | { type: "strokes"; layer: Layer; before: Stroke[]; after: Stroke[] } // borracha: troca a lista de traços
  | { type: "panels"; page: number; before: Panel[]; after: Panel[] }
  | { type: "layers"; before: Layer[]; after: Layer[]; activeBefore: number; activeAfter: number }
  | { type: "balloons"; before: Balloon[]; after: Balloon[] }
  | { type: "rulers"; before: Ruler[]; after: Ruler[] }
  | { type: "reset"; before: DocContent; after: DocContent } // limpar tudo
  | { type: "tone"; layer: Layer; before?: ToneSettings; after?: ToneSettings };

// Tudo o que foi feito num documento (para "limpar tudo" poder ser desfeito)
export interface DocContent {
  pageCount: number;
  spread?: boolean;
  stripHeight: number;
  layers: Layer[];
  active: number;
  panels: Panel[];
  balloons: Balloon[];
  rulers: Ruler[];
}

// Um documento é um formato + o que foi desenhado nele.
export interface Doc {
  format: Format;
  pageCount: number; // usado no formato "pages"
  spread?: boolean; // páginas lado a lado, de duas em duas (só no formato "pages")
  stripHeight: number; // usado no formato "strip"
  layers: Layer[]; // de baixo para cima
  active: number; // id da camada onde se desenha
  nextLayerId: number;
  panels: Panel[];
  balloons: Balloon[]; // balões e textos (ficam por cima de tudo)
  nextBalloonId: number;
  rulers: Ruler[]; // réguas e perspectiva (só aparecem na tela)
  nextRulerId: number;
  history: Action[];
  redoStack: Action[];
}

// Como o documento aparece na tela: tela = documento * zoom + deslocamento
export interface View {
  zoom: number;
  ox: number;
  oy: number;
}

export function newDoc(format: Format): Doc {
  return {
    format,
    pageCount: 1,
    stripHeight: STRIP_START_H,
    layers: [{ id: 1, name: "Camada 1", visible: true, strokes: [] }],
    active: 1,
    nextLayerId: 2,
    panels: [],
    balloons: [],
    nextBalloonId: 1,
    rulers: [],
    nextRulerId: 1,
    history: [],
    redoStack: [],
  };
}

// Página dupla: as páginas vão de duas em duas, lado a lado, como a revista aberta.
// Leitura de mangá (da direita para a esquerda): a página 1 fica à direita, a 2 à esquerda.
export const isSpread = (doc: Doc) => doc.format === "pages" && !!doc.spread;

// Retângulo de uma página: no formato páginas, a folha; na tira, o trecho entre pontilhados.
export function pageRect(doc: Doc, index: number, spread = isSpread(doc)): Rect {
  if (doc.format === "strip") return { x: 0, y: index * STRIP_SCREEN_H, w: STRIP_W, h: STRIP_SCREEN_H };
  if (spread) {
    const row = Math.floor(index / 2);
    return { x: index % 2 === 0 ? PAGE_W : 0, y: row * (PAGE_H + PAGE_GAP), w: PAGE_W, h: PAGE_H };
  }
  return { x: 0, y: index * (PAGE_H + PAGE_GAP), w: PAGE_W, h: PAGE_H };
}

// Qual página fica no ponto (y; e x, na página dupla) do documento
export function pageAt(doc: Doc, y: number, x = PAGE_W, spread = isSpread(doc)) {
  if (doc.format === "strip") return Math.max(0, Math.floor(y / STRIP_SCREEN_H));
  const n = Math.max(0, Math.floor((y + PAGE_GAP / 2) / (PAGE_H + PAGE_GAP)));
  if (spread) {
    const i = n * 2 + (x < PAGE_W ? 1 : 0);
    return Math.min(doc.pageCount - 1, i);
  }
  return Math.min(doc.pageCount - 1, n);
}

// As áreas brancas onde se desenha: várias páginas, ou uma tira só.
export function sheets(doc: Doc): Rect[] {
  if (doc.format === "strip") return [{ x: 0, y: 0, w: STRIP_W, h: doc.stripHeight }];
  const rects: Rect[] = [];
  for (let i = 0; i < doc.pageCount; i++) rects.push(pageRect(doc, i));
  return rects;
}

export function docSize(doc: Doc) {
  if (doc.format === "strip") return { w: STRIP_W, h: doc.stripHeight };
  const rows = isSpread(doc) ? Math.ceil(doc.pageCount / 2) : doc.pageCount;
  return { w: isSpread(doc) ? PAGE_W * 2 : PAGE_W, h: rows * PAGE_H + (rows - 1) * PAGE_GAP };
}

export function newStroke(width: number, color: string, opacity: number, style: StrokeStyle): Stroke {
  return {
    id: newId(),
    points: [],
    width,
    color,
    opacity,
    style,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

// Pintura do balde: a caixa envolve a área inteira (não só o ponto do clique)
export function fitFillBounds(s: Stroke) {
  for (const ring of s.fill ?? []) {
    for (const p of ring) {
      if (p.x < s.minX) s.minX = p.x;
      if (p.y < s.minY) s.minY = p.y;
      if (p.x > s.maxX) s.maxX = p.x;
      if (p.y > s.maxY) s.maxY = p.y;
    }
  }
}

export function addPoint(s: Stroke, pt: StrokePoint) {
  s.points.push(pt);
  if (pt.x < s.minX) s.minX = pt.x;
  if (pt.y < s.minY) s.minY = pt.y;
  if (pt.x > s.maxX) s.maxX = pt.x;
  if (pt.y > s.maxY) s.maxY = pt.y;
}
