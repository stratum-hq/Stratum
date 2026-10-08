// Fits the ANSI art grids on a page to their width. Two kinds:
//   [data-fit="N"]   a fixed grid N columns wide (logos, page titles), scaled
//                    so the grid exactly fills its box, capped by data-max (px);
//   [data-earth="D"] a full-width earth band at depth D, re-rendered with more
//                    columns on wider screens rather than bigger cells.
// VT323's advance is measured once the font has loaded.

import { earthBand, rowsToHtml } from '../lib/ansi';

let ratio = 0.4;

function measure() {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(40);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:VT323,monospace';
  document.body.appendChild(probe);
  ratio = probe.getBoundingClientRect().width / 4000 || ratio;
  probe.remove();
}

export function fitArt() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-fit]')) {
    const max = Number(el.dataset.max) || Infinity;
    el.style.fontSize = `${Math.min(max, el.clientWidth / (Number(el.dataset.fit) * ratio))}px`;
  }
  for (const band of document.querySelectorAll<HTMLElement>('[data-earth]')) {
    const width = band.clientWidth;
    const want = width >= 1400 ? 200 : width >= 900 ? 150 : width >= 560 ? 100 : 60;
    band.style.fontSize = `${width / (want * ratio)}px`;
    if (band.dataset.cols === String(want)) continue;
    band.dataset.cols = String(want);
    band.innerHTML = rowsToHtml(earthBand(want, Number(band.dataset.earth)));
  }
}

export function getRatio() {
  return ratio;
}

measure();
fitArt();
addEventListener('resize', fitArt);
document.fonts?.ready.then(() => {
  measure();
  fitArt();
});
