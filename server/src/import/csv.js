// Minimal RFC 4180 CSV parser (no dependency): quoted fields, escaped quotes
// (""), CR/LF/CRLF line breaks and newlines inside quoted fields. Jira CSV
// exports rely on all of these (multi-line descriptions and comments) and
// repeat header names (Sprint, Labels, Fix versions, Comment…), so headers
// are returned as a plain array rather than an object.

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

function parseCsv(input, { delimiter } = {}) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === sep) {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const [headers = [], ...records] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: records, delimiter: sep };
}

function toCsv(headers, rows, sep = ',') {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\r\n]|[,;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(sep)).join('\r\n');
}

module.exports = { parseCsv, toCsv, detectDelimiter };
