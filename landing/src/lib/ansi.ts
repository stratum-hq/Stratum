// The home page's ANSI art, rendered as rows of character runs for a given
// column count. The page renders it at build time for a default width, and the
// client re-renders it for the real width.
//
// Two kinds of art, both drawn the way ANSI editors draw them:
//   - Logos in the "ANSI Shadow" style: solid blocks with a double-line
//     box-drawn shadow.
//   - Earth in half-block pixels: every cell is two stacked pixels with their
//     own colors, so rock can be mottled, cracked and dithered at twice the
//     vertical resolution, and grass can stand in blades.
// Every art glyph is drawn in CSS (see rowsToHtml), so no fallback font can
// bend the grid.

export interface Run { t: string; c?: string; unit?: string; px?: [string, string] }
export type Row = Run[];

// ---------------------------------------------------------------------------
// The rock face: Stratum's own block letters, carved from strata

// Ten pixels tall (five cell rows), strokes three pixels wide. Drawn as masks;
// the renderer fills them with banded rock and chips the edges.
const ROCKFONT: Record<string, string[]> = {
  A: ['.######.', '########', '###..###', '###..###', '########', '########', '###..###', '###..###', '###..###', '###..###'],
  B: ['#######.', '########', '###..###', '###..###', '#######.', '########', '###..###', '###..###', '########', '#######.'],
  D: ['#######.', '########', '###..###', '###..###', '###..###', '###..###', '###..###', '###..###', '########', '#######.'],
  E: ['########', '########', '###.....', '###.....', '#######.', '#######.', '###.....', '###.....', '########', '########'],
  F: ['########', '########', '###.....', '###.....', '#######.', '#######.', '###.....', '###.....', '###.....', '###.....'],
  G: ['.#######', '########', '###.....', '###.....', '###.####', '###.####', '###..###', '###..###', '########', '.######.'],
  H: ['###..###', '###..###', '###..###', '###..###', '########', '########', '###..###', '###..###', '###..###', '###..###'],
  I: ['#####', '#####', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '#####', '#####'],
  L: ['###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '###.....', '########', '########'],
  M: ['###....###', '####..####', '##########', '###.##.###', '###....###', '###....###', '###....###', '###....###', '###....###', '###....###'],
  N: ['###...###', '####..###', '#####.###', '###.#####', '###..####', '###...###', '###...###', '###...###', '###...###', '###...###'],
  R: ['#######.', '########', '###..###', '###..###', '#######.', '######..', '###.###.', '###..###', '###..###', '###..###'],
  S: ['.######.', '########', '###.....', '###.....', '#######.', '.#######', '.....###', '.....###', '########', '.######.'],
  T: ['#########', '#########', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  U: ['###..###', '###..###', '###..###', '###..###', '###..###', '###..###', '###..###', '###..###', '########', '.######.'],
  Y: ['###...###', '###...###', '.###.###.', '..#####..', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  ' ': ['....', '....', '....', '....', '....', '....', '....', '....', '....', '....'],
};

// Pixel rows of a letter, shallow to deep, with magma breaking through at the base, like the mark.
const LETTER_BANDS = ['limestone', 'limestone', 'sandstone', 'sandstone', 'clay', 'clay', 'topsoil', 'topsoil', 'magma', 'magma'];
const LETTER_SHADOW = '#140E0B';

const pad = (n: number) => (n > 0 ? ' '.repeat(n) : '');

function push(row: Row, t: string, c?: string, unit?: string) {
  const last = row[row.length - 1];
  if (last && !last.px && last.c === c && last.unit === unit) last.t += t;
  else row.push({ t, c, unit });
}

function pushPx(row: Row, top: string, bottom: string, unit?: string) {
  const last = row[row.length - 1];
  if (last && last.px && last.px[0] === top && last.px[1] === bottom && last.unit === unit) last.t += '▀';
  else row.push({ t: '▀', px: [top, bottom], unit });
}

function centre(runs: Row, width: number, cols: number): Row {
  const left = Math.max(0, Math.floor((cols - width) / 2));
  return [{ t: pad(left) }, ...runs, { t: pad(cols - width - left) }];
}

/**
 * Text in the rock face. Each mask pixel becomes `scale` x `scale` pixels;
 * the letter is filled with banded rock in its lighter tones, lit along its
 * top edges and shaded along its bottom edges like carved stone, with the
 * odd fine chip broken off, and a dark shadow two pixels down and right.
 * Returns half-block rows (each cell row is two pixel rows).
 */
export function logo(text: string, cols = 0, scale = 2, opts: { shadow?: number; chips?: boolean } = {}): Row[] {
  const glyphs = [...text.toUpperCase()].map((ch) => ROCKFONT[ch] ?? ROCKFONT[' ']);
  const MH = 10;
  const MW = glyphs.reduce((n, g) => n + g[0].length, 0) + glyphs.length - 1;
  const mask: boolean[][] = Array.from({ length: MH }, () => Array(MW).fill(false));
  let x0 = 0;
  for (const g of glyphs) {
    g.forEach((line, y) => [...line].forEach((c, x) => { if (c === '#') mask[y][x0 + x] = true; }));
    x0 += g[0].length + 1;
  }
  const H = MH * scale;
  const W = MW * scale;
  const sh = opts.shadow ?? scale;
  const chips = opts.chips ?? true;
  const seed = [...text].reduce((n, c) => n + c.charCodeAt(0), 0);
  const on = (x: number, y: number) => y >= 0 && y < H && x >= 0 && x < W && mask[Math.floor(y / scale)][Math.floor(x / scale)];
  const grid: string[][] = Array.from({ length: H + sh + ((H + sh) % 2) }, () => Array(W + sh).fill(SKY));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      const top = !on(x, y - 1), bottom = !on(x, y + 1), left = !on(x - 1, y), right = !on(x + 1, y);
      // A fine chip now and then on an outer corner of the stone.
      if (chips && (top || bottom) && (left || right) && hash(x, y, seed) > 0.55) continue;
      if (chips && (top || bottom || left || right) && hash(x, y, seed + 5) > 0.93) continue;
      const band = LETTER_BANDS[Math.floor(y / scale)];
      if (band === 'magma') {
        grid[y][x] = MAGMA[hash(x, y, seed + 1) > 0.78 ? 2 : 1];
        continue;
      }
      const ramp = ROCK[band];
      // Carved light: top edges catch it, bottom edges fall into shade.
      if (top) grid[y][x] = ramp[3];
      else if (bottom || right) grid[y][x] = ramp[1];
      else {
        const n = smooth(x / 6, y / 2.5, seed) * 2.2 + 1;
        let i = Math.floor(n);
        if (n - i > 0.75 && (x + y) % 2 === 0) i += 1;
        grid[y][x] = ramp[Math.min(3, Math.max(1, i))];
      }
    }
  }
  for (let y = grid.length - 1; y >= sh; y--) {
    for (let x = grid[0].length - 1; x >= sh; x--) {
      const src = grid[y - sh][x - sh];
      if (grid[y][x] === SKY && src !== SKY && src !== LETTER_SHADOW) grid[y][x] = LETTER_SHADOW;
    }
  }
  const rows = pixelRows(grid);
  const width = W + sh;
  return cols ? rows.map((r) => centre(r, width, cols)) : rows;
}

/** The column count a rock-face text needs, so its grid can be fitted to the width. */
export function logoCols(text: string, scale = 2, shadow = scale): number {
  const glyphs = [...text.toUpperCase()].map((ch) => ROCKFONT[ch] ?? ROCKFONT[' ']);
  return (glyphs.reduce((n, g) => n + g[0].length, 0) + glyphs.length - 1) * scale + shadow;
}

// ---------------------------------------------------------------------------
// Earth in half-block pixels

/** Stable hash noise in [0, 1). */
const hash = (x: number, y: number, seed = 0) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Smooth value noise: bilinear between hashed lattice points, for mottled rock. */
function smooth(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Each rock is a ramp, dark to light, in the Stratum rock bands.
const ROCK: Record<string, string[]> = {
  topsoil: ['#4E3220', '#6B4426', '#8F5F36', '#A8764A'],
  clay: ['#7E3A1C', '#A84C26', '#D2683C', '#E08458'],
  sandstone: ['#8C6630', '#B88A44', '#E0B266', '#EDC888'],
  limestone: ['#8D8572', '#ADA38E', '#D6CDB8', '#E8E1D0'],
  basalt: ['#25252B', '#34343B', '#4A4A52', '#5F5F68'],
};
const GRASS = ['#2F5A24', '#4E7F2E', '#7FAF45'];
const MAGMA = ['#A63A10', '#FF5B1F', '#FFB21E'];
const SKY = 'transparent';

/** One rock pixel: mottled by smooth noise, with dithered steps between tones and the odd crack. */
function rockPx(rock: string, x: number, y: number, seed: number): string {
  const ramp = ROCK[rock];
  // Rock is stretched along the bedding: wide patches, shallow in height.
  const n = smooth(x / 7, y / 2.2, seed) * 0.75 + smooth(x / 2.5, y / 1.2, seed + 9) * 0.25;
  // Bias toward the middle tones; the darkest and lightest are accents.
  const level = 0.55 + n * 2.3;
  let i = Math.floor(level);
  // Near a step between tones, checkerboard the two: the classic ANSI dither.
  if (level - i > 0.78 && (x + y) % 2 === 0) i += 1;
  i = Math.max(0, Math.min(ramp.length - 1, i));
  // Thin dark cracks run along the bedding.
  if (hash(x >> 2, y, seed + 3) > 0.985) return ramp[0];
  return ramp[i];
}

interface Unit { id: string; name: string; depth: number; role: string; iso: 'SHARED_RLS' | 'SCHEMA_PER_TENANT' | 'DB_PER_TENANT' }

const TAG = { SHARED_RLS: 'RLS', SCHEMA_PER_TENANT: 'SCHEMA', DB_PER_TENANT: 'DB' } as const;
const BAND = ['topsoil', 'clay', 'sandstone', 'limestone'];

export const TREE: Unit[][] = [
  [{ id: 'acmesec', name: 'AcmeSec', depth: 0, role: 'root tenant', iso: 'DB_PER_TENANT' }],
  [{ id: 'northstar', name: 'NorthStar MSP', depth: 1, role: 'reseller', iso: 'SCHEMA_PER_TENANT' }],
  [
    { id: 'client-alpha', name: 'client-alpha', depth: 2, role: 'client', iso: 'SCHEMA_PER_TENANT' },
    { id: 'client-beta', name: 'client-beta', depth: 2, role: 'client', iso: 'SHARED_RLS' },
  ],
  [
    { id: 'team-eng', name: 'team-eng', depth: 3, role: 'team', iso: 'SHARED_RLS' },
    { id: 'team-ops', name: 'team-ops', depth: 3, role: 'team', iso: 'SHARED_RLS' },
  ],
];

/** Turf: blades of grass one to three pixels tall in three greens, standing on a turf line. */
function turf(cols: number, seed: number): Row[] {
  const H = 4;
  const grid: string[][] = Array.from({ length: H }, () => Array(cols).fill(SKY));
  for (let x = 0; x < cols; x++) {
    const tall = hash(x, 1, seed);
    const blade = tall < 0.35 ? 0 : tall < 0.7 ? 1 : tall < 0.9 ? 2 : 3;
    for (let k = 0; k < blade; k++) grid[H - 2 - k][x] = GRASS[Math.min(2, k + (hash(x, k, seed + 1) > 0.6 ? 1 : 0))];
    grid[H - 1][x] = hash(x, 5, seed) > 0.5 ? GRASS[0] : GRASS[1];
  }
  return pixelRows(grid);
}

function pixelRows(grid: string[][], units?: (string | undefined)[][]): Row[] {
  const rows: Row[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const row: Row = [];
    for (let x = 0; x < grid[y].length; x++) pushPx(row, grid[y][x], grid[y + 1]?.[x] ?? SKY, units?.[y]?.[x]);
    rows.push(row);
  }
  return rows;
}

/** Bedrock: basalt with a magma vein wandering through it. */
function bedrock(cols: number, seed: number): Row[] {
  const H = 6;
  const grid: string[][] = Array.from({ length: H }, (_, y) => Array.from({ length: cols }, (_, x) => rockPx('basalt', x, y + 50, seed)));
  for (let x = 0; x < cols; x++) {
    const vy = Math.round(2.5 + (smooth(x / 14, 0, seed + 4) - 0.5) * 3.5);
    if (vy >= 0 && vy < H) grid[vy][x] = MAGMA[hash(x, 2, seed) > 0.85 ? 2 : 1];
    if (vy + 1 < H) grid[vy + 1][x] = MAGMA[0];
  }
  return pixelRows(grid);
}

/**
 * The cross-section. Each depth is six pixels (three cell rows) of its rock,
 * with a wavy boundary into the rock above; the middle row carries the tenant
 * label and its isolation tag. Siblings meet at a fault. A key locked at d1
 * runs under NorthStar MSP as a magma double line.
 */
export function strata(cols: number): Row[] {
  const rows: Row[] = [...turf(cols, 3)];
  const split = Math.round(cols * 0.56);
  const compact = cols < 76;
  const H = 6;
  let above: string[] = Array(cols).fill(ROCK.topsoil[2]);
  TREE.forEach((layer, li) => {
    const owner = (x: number) => (layer.length === 1 || x < split ? layer[0] : layer[1]);
    const grid: string[][] = [];
    const units: (string | undefined)[][] = [];
    for (let y = 0; y < H; y++) {
      grid.push([]);
      units.push([]);
      for (let x = 0; x < cols; x++) {
        const u = owner(x);
        // The boundary with the layer above wanders up to two pixels down.
        const wave = li === 0 ? 0 : Math.floor(smooth(x / 5, li, 17) * 2.6);
        let color = rockPx(BAND[u.depth], x, li * 10 + y, 23 + li);
        if (y < wave) color = above[x];
        if (layer.length > 1 && x === split - 1) color = ROCK.basalt[0];
        grid[y].push(color);
        units[y].push(u.id);
      }
    }
    above = grid[H - 1];
    const pix = pixelRows(grid, units);
    // Cut the label into the middle cell row.
    const mid = pix[1];
    const labelled: Row = [];
    let x = 0;
    const cells = mid.flatMap((r) => [...r.t].map(() => r));
    while (x < cols) {
      const u = owner(x);
      const start = layer.length > 1 && x >= split ? split + 1 : 2;
      if (x === start) {
        const label = compact ? ` d${u.depth} ${u.name} [${TAG[u.iso]}] ` : ` d${u.depth} ${u.name} / ${u.role} [${TAG[u.iso]}] `;
        push(labelled, label, 'label', u.id);
        x += label.length;
        continue;
      }
      const r = cells[x];
      pushPx(labelled, r.px![0], r.px![1], r.unit);
      x++;
    }
    rows.push(pix[0], labelled, pix[2]);
    if (layer[0].depth === 1) {
      const note = ' >> data_region LOCKED at d1 << ';
      const left = 4;
      rows.push([
        { t: '═'.repeat(left), c: 'lock' },
        { t: note, c: 'lock-note' },
        { t: '═'.repeat(Math.max(0, cols - left - note.length)), c: 'lock' },
      ]);
      above = Array(cols).fill(ROCK.clay[1]);
    }
  });
  rows.push(...bedrock(cols, 11));
  return rows;
}

/** A full-width band of earth between sections; `depth` picks which rocks it cuts through, shallow to deep. */
export function earthBand(cols: number, depth: number): Row[] {
  const sets = [['topsoil', 'clay'], ['clay', 'sandstone'], ['sandstone', 'limestone'], ['limestone', 'basalt']];
  const [a, b] = sets[Math.min(depth, sets.length - 1)];
  const H = 12;
  const grid: string[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      const edge = 5 + (smooth(x / 9, depth, 31) - 0.5) * 6;
      const d = y - edge;
      // A two-pixel dithered seam where the rocks meet.
      if (Math.abs(d) < 1 && (x + y) % 2 === 0) return ROCK[d < 0 ? b : a][1];
      return rockPx(d < 0 ? a : b, x, y + depth * 20, 40 + depth);
    }),
  );
  if (depth === 3) {
    for (let x = 0; x < cols; x++) {
      const vy = Math.round(9 + (smooth(x / 7, 3, 61) - 0.5) * 4);
      if (vy < H) grid[vy][x] = MAGMA[hash(x, 9, 61) > 0.8 ? 2 : 1];
    }
  }
  return [...(depth === 0 ? turf(cols, 21) : []), ...pixelRows(grid)];
}

export function legend(cols: number): Row[] {
  const items: Row = [
    { t: '[DB]', c: 'tag' }, { t: ' database per tenant   ', c: 'silt' },
    { t: '[SCHEMA]', c: 'tag' }, { t: ' schema per tenant   ', c: 'silt' },
    { t: '[RLS]', c: 'tag' }, { t: ' shared RLS   ', c: 'silt' },
    { t: '═', c: 'lock' }, { t: ' locked key', c: 'silt' },
  ];
  const width = items.reduce((n, r) => n + r.t.length, 0);
  if (width <= cols) return [items];
  return [items.slice(0, 4), items.slice(4)];
}

/** Column count for a grid this wide: wider screens get more columns, not bigger letters. */
export const colsFor = (width: number) => (width >= 1180 ? 120 : width >= 860 ? 104 : 66);

export function screen(cols: number): Row[] {
  return [
    ...strata(cols),
    [{ t: '' }],
    ...legend(cols),
  ];
}

// ---------------------------------------------------------------------------
// HTML

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Glyphs drawn in CSS, one cell each. */
const ART: Record<string, string> = {
  '█': 'full', '═': 'h2', '║': 'v2', '╔': 'dr', '╗': 'dl', '╚': 'ur', '╝': 'ul',
};

function runHtml(r: Run): string {
  const unit = r.unit ? ` data-unit="${r.unit}"` : '';
  if (r.px) return `<span class="g g-px"${unit} style="--n:${r.t.length};--t:${r.px[0]};--b:${r.px[1]}"></span>`;
  const attrs = `${r.c ? ` class="a-${r.c}"` : ''}${unit}`;
  let out = '';
  let i = 0;
  const text = [...r.t];
  while (i < text.length) {
    const ch = text[i];
    let j = i;
    while (j < text.length && text[j] === ch) j++;
    const n = j - i;
    out += ART[ch] ? `<span class="g g-${ART[ch]}" style="--n:${n}"></span>` : esc(ch.repeat(n));
    i = j;
  }
  return attrs ? `<span${attrs}>${out}</span>` : out;
}

/** Rows as HTML: one span per line, one span per run. */
export function rowsToHtml(rows: Row[]): string {
  return rows.map((row) => `<span class="ln">${row.map(runHtml).join('')}</span>`).join('');
}
