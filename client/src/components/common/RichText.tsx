import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/*
 * Safe rich text: a small Markdown dialect rendered to React elements (never
 * raw HTML). Blocks: # titres, listes (- / 1. / - [ ]), > citations, ```code```,
 * ---, tableaux | a | b |. Inline: **gras**, *italique*, ++souligné++, ~~barré~~,
 * ==surligné==, {color:#e85d70}couleur{color}, `code`, [lien](url), ![image](url),
 * @mention, clés de tâche (KB-12) et URL automatiques.
 */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'hr' }
  | { type: 'quote'; children: Block[] }
  | { type: 'table'; header: string[] | null; rows: string[][] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] };

interface ListItem {
  text: string;
  checked: boolean | null;
  children: Block[];
}

interface Ctx {
  projectKey?: string;
  mentionLabel?: (username: string) => string | undefined;
  keyPrefix: string;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const FENCE_END_RE = /^\s*(```|~~~)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;
const QUOTE_RE = /^\s{0,3}>/;

const NAMED_COLORS = new Set(['red', 'green', 'blue', 'orange', 'purple', 'gray', 'grey', 'yellow', 'teal', 'pink', 'brown', 'black', 'white']);

const indentOf = (line: string) => (line.match(/^\s*/)?.[0] || '').replace(/\t/g, '  ').length;
const isBlockStart = (line: string) =>
  FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || TABLE_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line);
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function dedent(lines: string[]): string {
  const min = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  return lines.map((l) => l.replace(/^\s*/, (ws) => ' '.repeat(Math.max(0, ws.replace(/\t/g, '  ').length - min)))).join('\n');
}

function buildList(lines: string[], base: number): Block {
  const first = LIST_RE.exec(lines[0])!;
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let current: { text: string[]; sub: string[] } | null = null;
  const push = () => {
    if (!current) return;
    const raw = current.text.join('\n');
    const task = /^\[([ xX])\]\s+/.exec(raw);
    items.push({
      text: task ? raw.slice(task[0].length) : raw,
      checked: task ? task[1] !== ' ' : null,
      children: current.sub.length ? parseBlocks(dedent(current.sub)) : [],
    });
  };
  for (const line of lines) {
    const m = LIST_RE.exec(line);
    if (m && indentOf(line) <= base) {
      push();
      current = { text: [m[3]], sub: [] };
    } else if (current) {
      if (!current.sub.length && !LIST_RE.test(line)) current.text.push(line.trim());
      else current.sub.push(line);
    }
  }
  push();
  return { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) || 1 : 1, items };
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_END_RE.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ type: 'quote', children: parseBlocks(body.join('\n')) });
      continue;
    }
    if (TABLE_RE.test(line)) {
      const rows: string[][] = [];
      let header: string[] | null = null;
      while (i < lines.length && TABLE_RE.test(lines[i])) {
        const cells = splitRow(lines[i]);
        if (cells.every((c) => /^:?-+:?$/.test(c))) {
          if (rows.length === 1 && !header) header = rows.pop()!;
        } else rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (LIST_RE.test(line)) {
      const body: string[] = [];
      const base = indentOf(line);
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line keeps the list open only if it continues right after.
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && (indentOf(lines[j]) > base || (LIST_RE.test(lines[j]) && indentOf(lines[j]) === base))) {
            i = j;
            continue;
          }
          break;
        }
        if (indentOf(l) > base || (LIST_RE.test(l) && indentOf(l) >= base)) {
          body.push(l);
          i++;
          continue;
        }
        break;
      }
      blocks.push(buildList(body, base));
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !(paragraph.length && isBlockStart(lines[i]))) paragraph.push(lines[i++]);
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

// Group numbers are used in inlineNode — keep both in sync.
const INLINE_SOURCE = [
  '`([^`\\n]+)`', // 1 code
  '!\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)', // 2 alt, 3 src
  '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)', // 4 label, 5 href
  '\\{color:(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\\}([\\s\\S]+?)\\{color\\}', // 6 color, 7 text
  '\\*\\*(?!\\s)([\\s\\S]+?)\\*\\*', // 8 bold
  '\\+\\+(?!\\s)([\\s\\S]+?)\\+\\+', // 9 underline
  '~~(?!\\s)([\\s\\S]+?)~~', // 10 strike
  '==(?!\\s)([\\s\\S]+?)==', // 11 highlight
  '\\*(?![\\s*])([^*\\n]*?[^\\s*])\\*(?!\\*)', // 12 italic
  '(?<![\\w])_(?![\\s_])([^_\\n]*?[^\\s_])_(?![\\w])', // 13 italic
  '(https?:\\/\\/[^\\s<>"]*[^\\s<>".,;:!?)\\]\'])', // 14 url
  '(?<![\\w-])([A-Z][A-Z0-9]{1,9}-\\d{1,6})(?![\\w-])', // 15 task key
  '(?<![\\w@./-])@([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?)', // 16 mention
].join('|');

export function safeUrl(url: string, image = false): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || u.startsWith('/api/files/')) return u;
  if (!image && (/^mailto:/i.test(u) || u.startsWith('/projects/') || u.startsWith('#'))) return u;
  return null;
}

function safeColor(color: string): string | null {
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return NAMED_COLORS.has(color.toLowerCase()) ? color.toLowerCase() : null;
}

function inlineNode(m: RegExpExecArray, ctx: Ctx, k: string): ReactNode | null {
  const sub = (text: string) => renderInline(text, { ...ctx, keyPrefix: k });
  if (m[1] !== undefined) return <code key={k}>{m[1]}</code>;
  if (m[3] !== undefined) {
    const src = safeUrl(m[3], true);
    return src ? (
      <a key={k} href={src} target="_blank" rel="noreferrer" className="rt-img">
        <img src={src} alt={m[2]} loading="lazy" />
      </a>
    ) : null;
  }
  if (m[5] !== undefined) {
    const href = safeUrl(m[5]);
    if (!href) return null;
    return href.startsWith('/projects/') ? (
      <Link key={k} to={href}>
        {sub(m[4])}
      </Link>
    ) : (
      <a key={k} href={href} target="_blank" rel="noreferrer">
        {sub(m[4])}
      </a>
    );
  }
  if (m[7] !== undefined) {
    const color = safeColor(m[6]);
    return color ? (
      <span key={k} style={{ color }}>
        {sub(m[7])}
      </span>
    ) : (
      <Fragment key={k}>{sub(m[7])}</Fragment>
    );
  }
  if (m[8] !== undefined) return <strong key={k}>{sub(m[8])}</strong>;
  if (m[9] !== undefined) return <u key={k}>{sub(m[9])}</u>;
  if (m[10] !== undefined) return <s key={k}>{sub(m[10])}</s>;
  if (m[11] !== undefined) return <mark key={k}>{sub(m[11])}</mark>;
  if (m[12] !== undefined || m[13] !== undefined) return <em key={k}>{sub(m[12] ?? m[13])}</em>;
  if (m[14] !== undefined) {
    return (
      <a key={k} href={m[14]} target="_blank" rel="noreferrer">
        {m[14]}
      </a>
    );
  }
  if (m[15] !== undefined) {
    if (!ctx.projectKey || !m[15].startsWith(`${ctx.projectKey}-`)) return null;
    return (
      <Link key={k} className="rt-task" to={`/projects/${ctx.projectKey}/tasks/${m[15]}`}>
        {m[15]}
      </Link>
    );
  }
  if (m[16] !== undefined) {
    const label = ctx.mentionLabel?.(m[16].toLowerCase());
    return (
      <span key={k} className={`mention${label ? '' : ' unknown'}`} title={label}>
        @{m[16]}
      </span>
    );
  }
  return null;
}

function renderInline(text: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SOURCE, 'g');
  let last = 0;
  let n = 0;
  const key = () => `${ctx.keyPrefix}-${n++}`;
  const pushText = (s: string) => {
    s.split('\n').forEach((part, i) => {
      if (i) out.push(<br key={key()} />);
      if (part) out.push(part);
    });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].length) {
      re.lastIndex++;
      continue;
    }
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    const node = inlineNode(m, ctx, key());
    if (node === null) pushText(m[0]);
    else out.push(node);
  }
  pushText(text.slice(last));
  return out;
}

function renderBlocks(blocks: Block[], ctx: Ctx): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${ctx.keyPrefix}.${i}`;
    const c = { ...ctx, keyPrefix: k };
    switch (b.type) {
      case 'heading': {
        const Tag = `h${Math.min(b.level + 2, 6)}` as 'h3';
        return (
          <Tag key={k} className={`rt-h rt-h${b.level}`}>
            {renderInline(b.text, c)}
          </Tag>
        );
      }
      case 'paragraph':
        return <p key={k}>{renderInline(b.text, c)}</p>;
      case 'code':
        return (
          <pre key={k} className="rt-code">
            <code>{b.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={k} />;
      case 'quote':
        return <blockquote key={k}>{renderBlocks(b.children, c)}</blockquote>;
      case 'table':
        return (
          <div key={k} className="rt-table">
            <table>
              {b.header && (
                <thead>
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j}>{renderInline(h, { ...c, keyPrefix: `${k}h${j}` })}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{renderInline(cell, { ...c, keyPrefix: `${k}r${ri}c${ci}` })}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j} className={item.checked !== null ? 'rt-check' : undefined}>
            {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly disabled />}
            {renderInline(item.text, { ...c, keyPrefix: `${k}i${j}` })}
            {item.children.length > 0 && renderBlocks(item.children, { ...c, keyPrefix: `${k}i${j}` })}
          </li>
        ));
        return b.ordered ? (
          <ol key={k} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
    }
  });
}

export default function RichText({
  text,
  projectKey,
  mentionLabel,
  className,
  empty,
}: {
  text: string | undefined;
  projectKey?: string;
  mentionLabel?: (username: string) => string | undefined;
  className?: string;
  empty?: ReactNode;
}) {
  const blocks = useMemo(() => parseBlocks(text || ''), [text]);
  if (!blocks.length) return empty ? <>{empty}</> : null;
  return <div className={`rich-text${className ? ` ${className}` : ''}`}>{renderBlocks(blocks, { projectKey, mentionLabel, keyPrefix: 'b' })}</div>;
}
