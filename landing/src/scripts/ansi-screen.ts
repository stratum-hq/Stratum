// The home page's ANSI screen, live: re-render the grid for the real width,
// stream it in line by line once, sweep a chase light down the strata, and let
// hover, focus and the arrow keys pick the tenant the resolveConfig box reads.
// Number keys 1 to 4 follow the main menu.
//
// The resolution rule is the library's own (packages/lib/src/services/
// config-service.ts): walk the ancestry root to leaf, and a key an ancestor
// has locked skips every override below it. The real library runs on PGlite
// in the docs Playground; this page reads one fixed example.

import { screen, colsFor, TREE, rowsToHtml, esc } from '../lib/ansi';
import { fitArt } from './ansi-fit';

type Key = 'max_users' | 'data_region' | 'sso_required';
type Value = number | string | boolean;

const UNITS = TREE.flat();
const byId = Object.fromEntries(UNITS.map((u) => [u.id, u]));
const PARENT: Record<string, string | null> = {
  acmesec: null, northstar: 'acmesec', 'client-alpha': 'northstar', 'client-beta': 'northstar', 'team-eng': 'client-alpha', 'team-ops': 'client-beta',
};
const KEYS: Key[] = ['max_users', 'data_region', 'sso_required'];
// client-beta also stores its own data_region, which the lock at NorthStar MSP
// makes void: resolution skips it, but the row is still there.
const ENTRIES: Record<string, Partial<Record<Key, { value: Value; locked: boolean }>>> = {
  acmesec: { max_users: { value: 1000, locked: false }, sso_required: { value: false, locked: false } },
  northstar: { data_region: { value: 'eu-west-1', locked: true } },
  'client-beta': { max_users: { value: 250, locked: false }, sso_required: { value: true, locked: false }, data_region: { value: 'us-east-1', locked: false } },
};

const chain = (id: string) => {
  const out: string[] = [];
  for (let t: string | null = id; t; t = PARENT[t]) out.unshift(t);
  return out;
};

function resolveConfig(id: string) {
  const res: Partial<Record<Key, { value: Value; locked: boolean; source: string }>> = {};
  for (const t of chain(id)) {
    for (const k of KEYS) {
      const e = ENTRIES[t]?.[k];
      if (!e || res[k]?.locked) continue;
      res[k] = { value: e.value, locked: e.locked, source: t };
    }
  }
  return res;
}

const fmt = (v: Value) => (typeof v === 'string' ? `"${v}"` : String(v));
const grid = document.getElementById('ansi');
if (grid) mount(grid);

function mount(grid: HTMLElement) {
  const readout = document.getElementById('readout')!;
  const title = readout.querySelector<HTMLElement>('[data-title]')!;
  const rowsEl = readout.querySelector<HTMLElement>('[data-rows]')!;
  const iso = readout.querySelector<HTMLElement>('[data-iso]')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let selected = 'client-alpha';
  let cols = 0;
  let sweep = 0;

  // VT323's advance width as a fraction of its size, measured once.
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(40);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
  grid.appendChild(probe);
  let ratio = probe.getBoundingClientRect().width / 4000 || 0.5;
  probe.remove();

  function fit() {
    const width = grid.clientWidth;
    const next = colsFor(width);
    grid.style.fontSize = `${width / (next * ratio)}px`;
    fitArt();
    if (next === cols) return false;
    cols = next;
    grid.innerHTML = rowsToHtml(screen(cols));
    mark();
    return true;
  }

  function mark(hi?: string) {
    for (const el of grid.querySelectorAll<HTMLElement>('[data-unit]')) {
      el.classList.toggle('is-hi', el.dataset.unit === (hi ?? selected));
    }
  }

  function read(id: string) {
    selected = id;
    mark();
    const res = resolveConfig(id);
    const u = byId[id];
    title.textContent = `resolveConfig("${id}")`;
    rowsEl.innerHTML = KEYS.map((k) => {
      const r = res[k];
      if (!r) return '';
      const own = ENTRIES[id]?.[k];
      const src = r.locked ? `<span class="rd-lock">■ locked at d${byId[r.source].depth}</span>` : r.source === id ? 'set here' : `← d${byId[r.source].depth} ${byId[r.source].name}`;
      const voided = own && r.source !== id ? ` <span class="rd-void">own ${esc(fmt(own.value))} void</span>` : '';
      return `<li><span class="rd-k">${k}</span><span class="rd-dots" aria-hidden="true"></span><b>${esc(fmt(r.value))}</b><span class="rd-src">${src}${voided}</span></li>`;
    }).join('');
    iso.textContent = u.iso;
  }

  grid.addEventListener('pointerover', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-unit]');
    if (el && el.dataset.unit !== selected) { clearTimeout(sweep); read(el.dataset.unit!); }
  });
  grid.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-unit]');
    if (el) { clearTimeout(sweep); read(el.dataset.unit!); }
  });
  grid.addEventListener('keydown', (ev) => {
    const cur = byId[selected];
    let next: string | undefined;
    if (ev.key === 'ArrowUp') next = PARENT[selected] ?? undefined;
    if (ev.key === 'ArrowDown') next = UNITS.find((u) => PARENT[u.id] === selected)?.id;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      const sib = UNITS.filter((u) => u.depth === cur.depth).map((u) => u.id);
      next = sib[(sib.indexOf(selected) + (ev.key === 'ArrowRight' ? 1 : sib.length - 1)) % sib.length];
    }
    if (!next) return;
    ev.preventDefault();
    clearTimeout(sweep);
    read(next);
  });

  // Number keys follow the main menu, as on a board.
  addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    const link = document.querySelector<HTMLAnchorElement>(`[data-hotkey="${ev.key}"]`);
    if (link) link.click();
  });

  new ResizeObserver(() => { if (fit()) read(selected); }).observe(grid);
  document.fonts?.ready.then(() => {
    probe.style.fontFamily = getComputedStyle(grid).fontFamily;
    grid.appendChild(probe);
    ratio = probe.getBoundingClientRect().width / 4000 || ratio;
    probe.remove();
    cols = 0;
    fit();
    read(selected);
  });
  fit();
  read(selected);

  if (reduce.matches) return;
  // The stream: lines arrive one after another, then the chase light runs
  // root to leaf once and settles on the starting tenant.
  const lines = Array.from(grid.querySelectorAll<HTMLElement>('.ln'));
  grid.classList.add('is-streaming');
  lines.forEach((ln, i) => {
    ln.style.animationDelay = `${i * 32}ms`;
  });
  const path = ['acmesec', 'northstar', 'client-alpha', 'team-eng', 'client-beta', 'team-ops', 'client-alpha'];
  let i = 0;
  const step = () => {
    mark(path[i]);
    i += 1;
    if (i < path.length) sweep = window.setTimeout(step, 260);
    else read(selected);
  };
  sweep = window.setTimeout(step, lines.length * 32 + 300);
}
