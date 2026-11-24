/*
 * Converts pasted HTML (Word, Google Docs, Confluence, web pages, Kýdos itself)
 * into the restricted Markdown dialect rendered by RichText: titles, lists,
 * checkboxes, bold / italic / underline / strike / highlight, code, quotes,
 * tables, links and remote images. Anything else is reduced to its text — no
 * raw HTML ever reaches the stored value.
 */

const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'SELECT', 'OPTION']);
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL', 'DT', 'DD']);

interface Ctx {
  listDepth: number;
  pre: boolean;
}

const safeHref = (href: string | null) => {
  const h = (href || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h.replace(/\)/g, '%29').replace(/\s/g, '%20') : null;
};
const safeImg = (src: string | null) => {
  const s = (src || '').trim();
  return /^https?:\/\//i.test(s) || s.startsWith('/api/files/') ? s.replace(/\)/g, '%29').replace(/\s/g, '%20') : null;
};

function styleOf(el: Element): CSSStyleDeclaration | null {
  return (el as HTMLElement).style || null;
}

// Marker for inline formatting expressed by tags or inline styles (Google Docs uses spans + styles).
function inlineMarkers(el: Element): [string, string][] {
  const tag = el.tagName;
  const st = styleOf(el);
  const weight = st?.fontWeight || '';
  const out: [string, string][] = [];
  const explicitNormal = weight === 'normal' || weight === '400';
  if (((tag === 'B' || tag === 'STRONG') && !explicitNormal) || weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.push(['**', '**']);
  if (tag === 'I' || tag === 'EM' || (st?.fontStyle || '') === 'italic') out.push(['*', '*']);
  const deco = `${st?.textDecoration || ''} ${st?.textDecorationLine || ''}`;
  if (tag === 'U' || tag === 'INS' || deco.includes('underline')) out.push(['++', '++']);
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through')) out.push(['~~', '~~']);
  if (tag === 'MARK') out.push(['==', '==']);
  return out;
}

// "**  text **" would not render: keep spaces outside the markers.
function wrap(content: string, markers: [string, string][]): string {
  if (!markers.length || !content.trim()) return content;
  const lead = /^\s*/.exec(content)![0];
  const trail = /\s*$/.exec(content)![0];
  let core = content.trim();
  for (const [open, close] of markers) core = `${open}${core}${close}`;
  return `${lead}${core}${trail}`;
}

function isWordListParagraph(el: Element): boolean {
  const style = el.getAttribute('style') || '';
  return /mso-list\s*:\s*l\d/i.test(style) || /MsoListParagraph/i.test(el.getAttribute('class') || '');
}

function children(node: Node, ctx: Ctx): string {
  let out = '';
  node.childNodes.forEach((child) => {
    out += convert(child, ctx);
  });
  return out;
}

function listItem(li: Element, ordered: boolean, index: number, ctx: Ctx): string {
  const indent = '  '.repeat(ctx.listDepth);
  let checkbox = '';
  const input = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
  const ariaChecked = li.getAttribute('aria-checked');
  if (input) checkbox = (input as HTMLInputElement).checked || input.hasAttribute('checked') ? '[x] ' : '[ ] ';
  else if (ariaChecked === 'true' || ariaChecked === 'false') checkbox = ariaChecked === 'true' ? '[x] ' : '[ ] ';
  const inner = children(li, { ...ctx, listDepth: ctx.listDepth + 1 })
    .replace(/^\n+/, '')
    .replace(/\n{2,}/g, '\n')
    .trimEnd();
  const [first, ...rest] = inner.split('\n');
  const marker = ordered ? `${index}. ` : '- ';
  const body = [first.trim(), ...rest.map((l) => (/^\s*([-*]|\d+\.)\s/.test(l) ? l : `${indent}  ${l.trim()}`))].join('\n');
  return `${indent}${marker}${checkbox}${body}\n`;
}

function table(el: Element, ctx: Ctx): string {
  const rows = [...el.querySelectorAll('tr')].map((tr) =>
    [...tr.children].map((cell) => children(cell, ctx).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim())
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
  const hasHeader = !!el.querySelector('th');
  const out = [line(rows[0])];
  if (hasHeader) out.push(line(Array(width).fill('---')));
  for (const r of rows.slice(1)) out.push(line(r));
  return `\n\n${out.join('\n')}\n\n`;
}

function convert(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    return ctx.pre ? text : text.replace(/[\s ]+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  const style = el.getAttribute('style') || '';
  if (/mso-list\s*:\s*ignore/i.test(style) || /display\s*:\s*none/i.test(style)) return '';

  switch (tag) {
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const text = children(el, ctx).replace(/\s+/g, ' ').trim().replace(/^\*\*(.*)\*\*$/, '$1');
      return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : '';
    }
    case 'UL':
    case 'OL': {
      const ordered = tag === 'OL';
      let index = Number(el.getAttribute('start')) || 1;
      let out = '';
      el.childNodes.forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'LI') out += listItem(child as Element, ordered, index++, ctx);
        else if (child.nodeType === Node.ELEMENT_NODE) out += convert(child, { ...ctx, listDepth: ctx.listDepth + 1 });
      });
      return ctx.listDepth ? `\n${out}` : `\n\n${out}\n`;
    }
    case 'LI':
      return listItem(el, false, 1, ctx);
    case 'PRE': {
      const code = children(el, { ...ctx, pre: true }).replace(/^\n+|\n+$/g, '');
      return code ? `\n\n\`\`\`\n${code.replace(/```/g, "'''")}\n\`\`\`\n\n` : '';
    }
    case 'CODE': {
      if (ctx.pre) return children(el, ctx);
      const code = (el.textContent || '').replace(/`/g, "'");
      return code.trim() ? `\`${code}\`` : '';
    }
    case 'BLOCKQUOTE': {
      const inner = children(el, ctx).trim();
      return inner ? `\n\n${inner.split('\n').map((l) => `> ${l}`).join('\n')}\n\n` : '';
    }
    case 'TABLE':
      return table(el, ctx);
    case 'A': {
      const href = safeHref(el.getAttribute('href'));
      const label = children(el, ctx).replace(/\s+/g, ' ').trim();
      if (!href) return label;
      if (!label || label === href) return href;
      return `[${label.replace(/[[\]]/g, '')}](${href})`;
    }
    case 'IMG': {
      const src = safeImg(el.getAttribute('src'));
      return src ? `![${(el.getAttribute('alt') || '').replace(/[[\]\n]/g, ' ').trim()}](${src})` : '';
    }
    case 'INPUT':
      return '';
    default:
      break;
  }

  if (tag === 'P' && isWordListParagraph(el)) {
    // Word exports list items as paragraphs; their bullet glyph is in an "mso-list:Ignore" span (skipped above).
    const level = Number(/level(\d)/i.exec(style)?.[1] || 1);
    const text = children(el, ctx).replace(/\s+/g, ' ').trim();
    return text ? `${'  '.repeat(Math.max(0, level - 1))}- ${text}\n` : '';
  }

  const inner = children(el, ctx);
  if (BLOCKS.has(tag)) {
    const text = inner.trim();
    if (!text) return '\n';
    return tag === 'DIV' || tag === 'DT' || tag === 'DD' ? `\n${text}\n` : `\n\n${text}\n\n`;
  }
  return wrap(inner, inlineMarkers(el));
}

export function htmlToMarkdown(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const md = children(doc.body, { listDepth: 0, pre: false });
  return md
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trim();
}

/**
 * Markdown to insert for a paste, or null to let the browser paste plain text
 * (no meaningful formatting in the HTML flavour).
 */
export function markdownFromClipboard(html: string, plain: string): string | null {
  if (!html) return null;
  const md = htmlToMarkdown(html);
  if (!md) return null;
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  return normalize(md) === normalize(plain) ? null : md;
}
