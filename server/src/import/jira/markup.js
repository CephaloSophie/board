// Jira rich text → readable plain text (light Markdown). Descriptions and
// comments are shown as text in Kýdos, never rendered as HTML.

// Atlassian Document Format (REST v3).
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return wikiToText(node);
  const kids = (n, sep = '') => (n.content || []).map((c) => adfToText(c)).join(sep);
  switch (node.type) {
    case 'doc':
      return kids(node, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
    case 'paragraph':
      return kids(node);
    case 'heading':
      return `${'#'.repeat(node.attrs?.level || 1)} ${kids(node)}`;
    case 'text': {
      let t = node.text || '';
      for (const m of node.marks || []) {
        if (m.type === 'strong') t = `**${t}**`;
        else if (m.type === 'em') t = `_${t}_`;
        else if (m.type === 'code') t = `\`${t}\``;
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`;
      }
      return t;
    }
    case 'hardBreak':
      return '\n';
    case 'bulletList':
      return (node.content || []).map((li) => `- ${adfToText(li).replace(/\n/g, '\n  ')}`).join('\n');
    case 'orderedList':
      return (node.content || []).map((li, i) => `${(node.attrs?.order || 1) + i}. ${adfToText(li).replace(/\n/g, '\n   ')}`).join('\n');
    case 'listItem':
      return kids(node, '\n');
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language || ''}\n${kids(node)}\n\`\`\``;
    case 'blockquote':
    case 'panel':
      return kids(node, '\n\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'rule':
      return '---';
    case 'mention':
      return `@${(node.attrs?.text || '').replace(/^@/, '')}`;
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || '';
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url || '';
    case 'status':
      return `[${node.attrs?.text || ''}]`;
    case 'date':
      return node.attrs?.timestamp ? new Date(+node.attrs.timestamp).toISOString().slice(0, 10) : '';
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '[pièce jointe non importée]';
    case 'table':
      return (node.content || [])
        .map((row) => `| ${(row.content || []).map((cell) => adfToText({ type: 'doc', content: cell.content }).replace(/\n+/g, ' ')).join(' | ')} |`)
        .join('\n');
    default:
      return kids(node);
  }
}

// Jira wiki markup (CSV, REST v2, Data Center).
function wikiToText(s) {
  if (!s) return '';
  const blocks = [];
  const keep = (txt) => `@@CODE${blocks.push(txt) - 1}@@`;
  const out = String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\{code(?::([a-z0-9]+))?[^}]*\}([\s\S]*?)\{code\}/gi, (_, l, c) => keep(`\`\`\`${l || ''}\n${c.trim()}\n\`\`\``))
    .replace(/\{noformat\}([\s\S]*?)\{noformat\}/gi, (_, c) => keep(`\`\`\`\n${c.trim()}\n\`\`\``))
    .replace(/^[ \t]*([*#-]+)[ \t]+/gm, (_, b) => `${'  '.repeat(b.length - 1)}${b.endsWith('#') ? '1. ' : '- '}`)
    .replace(/^h([1-6])\.[ \t]*/gm, (_, n) => `${'#'.repeat(+n)} `)
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,;:!?]|$)/gm, '$1**$2**')
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/![^!\n]+!/g, '[pièce jointe non importée]')
    .replace(/\{color[^}]*\}|\{panel[^}]*\}|\{quote\}/gi, '');
  return out.replace(/@@CODE(\d+)@@/g, (_, i) => blocks[+i]).trim();
}

// Moves an "Acceptance criteria" section (heading + bullets) out of the description.
function extractAcceptance(text) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*(acceptance criteria|crit[eè]res d['’]acceptation|ac)\s*:?\s*$/i.test(l.trim()));
  if (start < 0) return { description: String(text || ''), acceptance: [] };
  let end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l.trim()));
  if (end < 0) end = lines.length;
  const acceptance = lines
    .slice(start + 1, end)
    .map((l) => l.trim())
    .filter((l) => /^(-|\d+\.)\s+/.test(l))
    .map((l) => l.replace(/^(-|\d+\.)\s+/, '').trim())
    .filter(Boolean);
  const description = [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim();
  return { description, acceptance };
}

module.exports = { adfToText, wikiToText, extractAcceptance };
