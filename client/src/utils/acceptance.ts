/*
 * Splitting pasted text into acceptance criteria ("cas d'acceptation").
 *
 * auto       bullets (-, *, •, ◦, ▪, –, ✓, ☐…), numbering (1. 1) a) (1) AC1: CA-2 -), checkboxes ([ ] [x]),
 *            Gherkin scenarios (Scenario / Scénario + Given/When/Then, Étant donné/Quand/Alors),
 *            otherwise paragraphs, otherwise lines, otherwise "a; b; c"
 * lines      one criterion per non-empty line
 * paragraphs one criterion per block separated by an empty line
 * regex      the user's regular expression is the separator (e.g. `;` or `\n(?=\d+\.)`)
 *
 * Pure module (no DOM, no imports): unit-tested with `npm test` (node:test).
 */

export type SplitMode = 'auto' | 'lines' | 'paragraphs' | 'regex';

export interface ParsedCriterion {
  text: string;
  done: boolean;
}

export interface SplitResult {
  items: ParsedCriterion[];
  error?: string;
}

export const MAX_PASTE_LENGTH = 100_000;
export const MAX_ITEM_LENGTH = 5000;

const BULLET_CHARS = '-*+•◦▪▫‣⁃–—·●○■□➢➤►▶→⇒✓✔✗✘☐☑☒✅❌';
const DONE_MARKS = new Set(['✓', '✔', '☑', '☒', '✅']);
const OPEN_MARKS = new Set(['☐', '□', '✗', '✘', '❌']);

// Group 1: the marker itself. Letter bullets need a closing ")" or "." and are limited to one letter.
const BULLET_RE = new RegExp(
  `^(\\s*)([${BULLET_CHARS.replace(/[-\\\]^]/g, '\\$&')}]|\\(?\\d{1,3}[.)\\]:]|\\(?[a-zA-Z][.)]|(?:AC|CA|TA|TC|CR)[-\\s]?\\d{1,3}\\s*[:.)-])(?:\\s+|$)`,
  'u'
);
const CHECKBOX_RE = /^\[([ xX✓✔-])\]\s*/;
const HEADER_RE = /^(#{1,6}\s*)?(\*\*)?\s*(crit[eè]res?\s+d['’]acceptation|crit[eè]res?\s+d['’]acceptance|acceptance\s+criteria|tests?\s+d['’]acceptation|cas\s+de\s+tests?|cas\s+d['’]acceptation|recette|definition\s+of\s+done|dod)\s*(\*\*)?\s*:?\s*$/i;
const SCENARIO_RE = /^\s*(?:[-*•]\s*)?(scenario(?:\s+outline)?|sc[ée]nario|plan\s+du\s+sc[ée]nario)\s*\d*\s*:/i;
// No \b: it does not work after accented letters ("donné").
const STEP_RE = /^\s*(?:[-*•]\s*)?(?:(?:given|when|then|and|but|[ée]tant\s+donn[ée]e?s?|soit|sachant\s+que|quand|lorsque|alors|et|mais)(?=[\s,:]|$)|lorsqu['’])/i;

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] || '').replace(/\t/g, '  ').length;

function normalizeSource(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/ /g, ' ')
    .slice(0, MAX_PASTE_LENGTH);
}

/** Removes a leading bullet / number / checkbox and tells whether it marked the item as done. */
export function stripMarker(raw: string): ParsedCriterion & { bulleted: boolean } {
  let text = raw.trim();
  let done = false;
  let bulleted = false;
  const m = BULLET_RE.exec(text);
  if (m) {
    bulleted = true;
    if (DONE_MARKS.has(m[2])) done = true;
    text = text.slice(m[0].length);
  } else if (text.length > 1 && (DONE_MARKS.has(text[0]) || OPEN_MARKS.has(text[0]))) {
    bulleted = true;
    done = DONE_MARKS.has(text[0]);
    text = text.slice(1).trim();
  }
  const box = CHECKBOX_RE.exec(text);
  if (box) {
    bulleted = true;
    done = box[1] !== ' ';
    text = text.slice(box[0].length);
  }
  return { text: text.trim(), done, bulleted };
}

function clean(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/(\S)[ \t]+/g, '$1 ').trimEnd())
    .join('\n')
    .trim()
    .replace(/[;,]\s*$/, '')
    .slice(0, MAX_ITEM_LENGTH);
}

function finalize(items: ParsedCriterion[]): ParsedCriterion[] {
  const seen = new Set<string>();
  const out: ParsedCriterion[] = [];
  for (const item of items) {
    const text = clean(item.text);
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, done: item.done });
  }
  return out;
}

function dropHeader(lines: string[]): string[] {
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && HEADER_RE.test(lines[first].trim())) return lines.slice(first + 1);
  return lines;
}

function splitGherkin(lines: string[]): ParsedCriterion[] | null {
  if (!lines.some((l) => SCENARIO_RE.test(l))) return null;
  const items: ParsedCriterion[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (SCENARIO_RE.test(line)) {
      if (current) items.push({ text: current.join('\n'), done: false });
      current = [`**${line.trim().replace(/^[-*•]\s*/, '')}**`];
    } else if (current) {
      current.push(STEP_RE.test(line) ? `- ${line.trim().replace(/^[-*•]\s*/, '')}` : line.trim());
    } else if (!/:\s*$/.test(line.trim())) {
      // Text before the first scenario (feature description) becomes its own criterion.
      items.push({ text: line.trim(), done: false });
    }
  }
  if (current) items.push({ text: current.join('\n'), done: false });
  return items;
}

function splitBullets(lines: string[]): ParsedCriterion[] | null {
  const bulletLines = lines.filter((l) => stripMarker(l).bulleted);
  if (!bulletLines.length) return null;
  const base = Math.min(...bulletLines.map(indentOf));
  const items: ParsedCriterion[] = [];
  let current: (ParsedCriterion & { lines: string[] }) | null = null;
  let afterBlank = false;
  const flush = () => {
    if (current) items.push({ text: current.lines.join('\n'), done: current.done });
    current = null;
  };
  for (const line of lines) {
    if (!line.trim()) {
      afterBlank = true;
      continue;
    }
    const marker = stripMarker(line);
    const indent = indentOf(line);
    if (marker.bulleted && indent <= base + 1) {
      flush();
      current = { text: '', done: marker.done, lines: [marker.text] };
    } else if (marker.bulleted && current) {
      // Nested point: stays inside its parent criterion as a sub-list.
      current.lines.push(`  - ${marker.text}`);
    } else if (current && !afterBlank) {
      // Wrapped line of the same point.
      current.lines[current.lines.length - 1] += ` ${line.trim()}`;
    } else if (/:\s*$/.test(line.trim()) && !current) {
      // "Le formulaire doit :" introduction — not a criterion by itself.
    } else {
      flush();
      current = { text: '', done: false, lines: [line.trim()] };
    }
    afterBlank = false;
  }
  flush();
  return items;
}

function splitParagraphs(source: string): ParsedCriterion[] {
  return source
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((l) => stripMarker(l)))
    .filter((parts) => parts.some((p) => p.text))
    .map((parts) => ({ text: parts.map((p) => p.text).filter(Boolean).join(' '), done: parts[0].done }));
}

function splitLines(lines: string[]): ParsedCriterion[] {
  return lines.filter((l) => l.trim()).map((l) => {
    const { text, done } = stripMarker(l);
    return { text, done };
  });
}

/** Builds the RegExp of the "regex" mode; returns an error message instead of throwing. */
export function compileSeparator(pattern: string): { re: RegExp | null; error?: string } {
  if (!pattern) return { re: null, error: 'Saisissez une expression régulière.' };
  try {
    const re = new RegExp(pattern, 'gmu');
    if (re.test('')) return { re: null, error: "L'expression ne doit pas accepter une chaîne vide." };
    re.lastIndex = 0;
    return { re };
  } catch (e) {
    return { re: null, error: `Expression invalide : ${(e as Error).message}` };
  }
}

export function splitCriteria(input: string, mode: SplitMode = 'auto', pattern = ''): SplitResult {
  const source = normalizeSource(input);
  if (!source.trim()) return { items: [] };

  if (mode === 'regex') {
    const { re, error } = compileSeparator(pattern);
    if (!re) return { items: [], error };
    return { items: finalize(source.split(re).filter((p) => typeof p === 'string').map((p) => stripMarker(p))) };
  }
  if (mode === 'lines') return { items: finalize(splitLines(source.split('\n'))) };
  if (mode === 'paragraphs') return { items: finalize(splitParagraphs(source)) };

  const lines = dropHeader(source.split('\n'));
  const gherkin = splitGherkin(lines);
  if (gherkin) return { items: finalize(gherkin) };
  const bullets = splitBullets(lines);
  if (bullets) return { items: finalize(bullets) };
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 1) {
    const parts = nonEmpty[0].split(/\s*;\s*/).filter(Boolean);
    return { items: finalize(parts.map((p) => ({ text: p, done: false }))) };
  }
  const joined = lines.join('\n');
  const hasParagraphs = /\n\s*\n/.test(joined.trim()) && joined.trim().split(/\n\s*\n/).some((b) => b.trim().includes('\n'));
  return { items: finalize(hasParagraphs ? splitParagraphs(joined) : splitLines(lines)) };
}

/** True when a pasted text clearly holds several criteria (offer to split it). */
export function looksLikeList(text: string): boolean {
  return splitCriteria(text).items.length > 1;
}

// Ready-made separators offered next to the free regex field.
export const REGEX_PRESETS: { label: string; pattern: string }[] = [
  { label: 'Point-virgule', pattern: ';' },
  { label: 'Fin de phrase', pattern: '(?<=[.!?])\\s+(?=[A-ZÀ-Ý])' },
  { label: 'Numéros 1. 2.', pattern: '\\s*(?=\\b\\d{1,3}[.)]\\s)' },
  { label: 'Ligne vide', pattern: '\\n\\s*\\n' },
  { label: 'Barre verticale', pattern: '\\s*\\|\\s*' },
];
