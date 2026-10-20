/**
 * Renders simple, clearly illustrative phone UIs as SVG data URIs.
 * Used only for mock states (`provenance: 'mock'`), never as runtime captures.
 */

export const MOCK_SCREEN_WIDTH = 360;
export const MOCK_SCREEN_HEIGHT = 780;

export type MockBlock =
  | { type: 'appbar'; title: string; back?: boolean; actions?: number }
  | { type: 'logo'; label: string }
  | { type: 'hero'; label: string; height?: number }
  | { type: 'heading'; text: string }
  | { type: 'text'; lines: number }
  | { type: 'input'; label: string }
  | { type: 'button'; label: string; variant?: 'primary' | 'ghost' }
  | { type: 'grid'; count: number }
  | { type: 'list'; count: number; avatar?: boolean }
  | { type: 'spacer'; height: number }
  | { type: 'dots'; count: number; active: number };

export type MockOverlay =
  | { type: 'dialog'; title: string; body: string; actions: string[] }
  | { type: 'sheet'; title: string; rows: number };

export interface MockScreenSpec {
  blocks: MockBlock[];
  tabbar?: { active: number };
  overlay?: MockOverlay;
  background?: string;
}

const W = MOCK_SCREEN_WIDTH;
const H = MOCK_SCREEN_HEIGHT;
const ACCENT = '#f26b3a';
const INK = '#1f2433';
const MUTED = '#9aa1b2';
const LINE = '#e6e8ef';
const SURFACE = '#f4f5f8';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function txt(x: number, y: number, text: string, size: number, fill: string, extra = ''): string {
  return `<text x="${x}" y="${y}" font-family="Inter,Segoe UI,sans-serif" font-size="${size}" fill="${fill}" ${extra}>${esc(text)}</text>`;
}

function bars(x: number, y: number, widths: number[], gap = 14): string {
  return widths
    .map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="8" rx="4" fill="${LINE}"/>`)
    .join('');
}

function renderBlock(block: MockBlock, y: number): { svg: string; height: number } {
  const pad = 20;
  switch (block.type) {
    case 'appbar': {
      let svg = `<rect x="0" y="${y}" width="${W}" height="56" fill="#fff"/>`;
      svg += `<line x1="0" y1="${y + 56}" x2="${W}" y2="${y + 56}" stroke="${LINE}"/>`;
      const tx = block.back ? 56 : pad;
      if (block.back) {
        svg += `<path d="M30 ${y + 28} l8 -8 M30 ${y + 28} l8 8" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
      }
      svg += txt(tx, y + 35, block.title, 18, INK, 'font-weight="600"');
      for (let i = 0; i < (block.actions ?? 0); i++) {
        svg += `<circle cx="${W - 28 - i * 36}" cy="${y + 28}" r="10" fill="none" stroke="${INK}" stroke-width="2"/>`;
      }
      return { svg, height: 56 };
    }
    case 'logo': {
      const cy = y + 150;
      const svg =
        `<circle cx="${W / 2}" cy="${cy}" r="46" fill="${ACCENT}"/>` +
        `<path d="M${W / 2 - 16} ${cy - 10} h32 l-4 26 h-24 z" fill="#fff"/>` +
        txt(W / 2, cy + 90, block.label, 26, INK, 'font-weight="700" text-anchor="middle"');
      return { svg, height: 300 };
    }
    case 'hero': {
      const h = block.height ?? 150;
      const svg =
        `<rect x="${pad}" y="${y + 12}" width="${W - pad * 2}" height="${h}" rx="16" fill="url(#hero)"/>` +
        txt(pad + 18, y + 12 + h - 22, block.label, 18, '#fff', 'font-weight="700"');
      return { svg, height: h + 24 };
    }
    case 'heading':
      return { svg: txt(pad, y + 34, block.text, 22, INK, 'font-weight="700"'), height: 48 };
    case 'text':
      return {
        svg: bars(pad, y + 10, Array.from({ length: block.lines }, (_, i) => (i % 3 === 2 ? 180 : 300))),
        height: block.lines * 14 + 16,
      };
    case 'input': {
      const svg =
        txt(pad, y + 22, block.label, 12, MUTED) +
        `<rect x="${pad}" y="${y + 30}" width="${W - pad * 2}" height="44" rx="10" fill="#fff" stroke="${LINE}" stroke-width="1.5"/>`;
      return { svg, height: 84 };
    }
    case 'button': {
      const primary = block.variant !== 'ghost';
      const svg =
        `<rect x="${pad}" y="${y + 10}" width="${W - pad * 2}" height="48" rx="24" fill="${primary ? ACCENT : 'none'}"/>` +
        txt(W / 2, y + 40, block.label, 15, primary ? '#fff' : ACCENT, 'font-weight="600" text-anchor="middle"');
      return { svg, height: 66 };
    }
    case 'grid': {
      const cw = (W - pad * 2 - 12) / 2;
      const ch = 170;
      let svg = '';
      for (let i = 0; i < block.count; i++) {
        const x = pad + (i % 2) * (cw + 12);
        const yy = y + 12 + Math.floor(i / 2) * (ch + 12);
        svg += `<rect x="${x}" y="${yy}" width="${cw}" height="${ch}" rx="14" fill="${SURFACE}"/>`;
        svg += `<rect x="${x + 12}" y="${yy + 12}" width="${cw - 24}" height="${ch - 64}" rx="10" fill="${i % 2 ? '#ffd9c7' : '#dfe6ff'}"/>`;
        svg += bars(x + 12, yy + ch - 42, [cw - 50, 50]);
      }
      return { svg, height: Math.ceil(block.count / 2) * (ch + 12) + 12 };
    }
    case 'list': {
      let svg = '';
      for (let i = 0; i < block.count; i++) {
        const yy = y + i * 64;
        const tx = block.avatar ? pad + 52 : pad;
        if (block.avatar) svg += `<rect x="${pad}" y="${yy + 12}" width="40" height="40" rx="10" fill="${SURFACE}"/>`;
        svg += bars(tx, yy + 20, [200 - (i % 3) * 30, 120]);
        svg += `<line x1="${pad}" y1="${yy + 63}" x2="${W - pad}" y2="${yy + 63}" stroke="${LINE}"/>`;
      }
      return { svg, height: block.count * 64 };
    }
    case 'spacer':
      return { svg: '', height: block.height };
    case 'dots': {
      let svg = '';
      const start = W / 2 - (block.count - 1) * 10;
      for (let i = 0; i < block.count; i++) {
        svg += `<circle cx="${start + i * 20}" cy="${y + 12}" r="${i === block.active ? 5 : 4}" fill="${i === block.active ? ACCENT : LINE}"/>`;
      }
      return { svg, height: 24 };
    }
  }
}

function renderTabbar(active: number): string {
  const y = H - 72;
  let svg = `<rect x="0" y="${y}" width="${W}" height="72" fill="#fff"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${LINE}"/>`;
  for (let i = 0; i < 3; i++) {
    const cx = (W / 3) * i + W / 6;
    svg += `<rect x="${cx - 11}" y="${y + 16}" width="22" height="22" rx="6" fill="${i === active ? ACCENT : MUTED}"/>`;
    svg += `<rect x="${cx - 16}" y="${y + 46}" width="32" height="6" rx="3" fill="${i === active ? ACCENT : LINE}"/>`;
  }
  return svg;
}

function renderOverlay(overlay: MockOverlay): string {
  let svg = `<rect x="0" y="0" width="${W}" height="${H}" fill="#0b0e17" opacity="0.45"/>`;
  if (overlay.type === 'dialog') {
    const x = 32;
    const w = W - 64;
    const y = H / 2 - 110;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="200" rx="22" fill="#fff"/>`;
    svg += txt(x + 24, y + 44, overlay.title, 19, INK, 'font-weight="700"');
    svg += txt(x + 24, y + 76, overlay.body, 13, MUTED);
    overlay.actions.forEach((label, i) => {
      const bx = x + w - 24 - (overlay.actions.length - i) * 100 + 10;
      const last = i === overlay.actions.length - 1;
      svg += `<rect x="${bx}" y="${y + 138}" width="90" height="38" rx="19" fill="${last ? ACCENT : 'none'}"/>`;
      svg += txt(bx + 45, y + 162, label, 13, last ? '#fff' : ACCENT, 'font-weight="600" text-anchor="middle"');
    });
  } else {
    const h = 120 + overlay.rows * 64;
    const y = H - h;
    svg += `<rect x="0" y="${y}" width="${W}" height="${h + 24}" rx="24" fill="#fff"/>`;
    svg += `<rect x="${W / 2 - 22}" y="${y + 12}" width="44" height="5" rx="3" fill="${LINE}"/>`;
    svg += txt(20, y + 56, overlay.title, 19, INK, 'font-weight="700"');
    svg += renderBlock({ type: 'list', count: overlay.rows, avatar: true }, y + 72).svg;
  }
  return svg;
}

export function renderMockScreen(spec: MockScreenSpec): string {
  let y = 0;
  let body = '';
  // Status bar
  body += `<rect x="0" y="0" width="${W}" height="32" fill="#fff"/>`;
  body += txt(24, 22, '9:41', 13, INK, 'font-weight="600"');
  body += `<rect x="${W - 54}" y="12" width="26" height="11" rx="3" fill="none" stroke="${INK}" stroke-width="1.4"/><rect x="${W - 52}" y="14" width="18" height="7" rx="1.5" fill="${INK}"/>`;
  y = 32;
  for (const block of spec.blocks) {
    const r = renderBlock(block, y);
    body += r.svg;
    y += r.height;
  }
  if (spec.tabbar) body += renderTabbar(spec.tabbar.active);
  if (spec.overlay) body += renderOverlay(spec.overlay);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a5b"/><stop offset="1" stop-color="#e2456b"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="${spec.background ?? '#fff'}"/>` +
    body +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
