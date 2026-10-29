export interface Sheet {
  name: string;
  rows: string[][];
  /** True when more rows existed than were read. */
  truncated: boolean;
}

/** Picks the delimiter that appears most in the first line, outside quotes. */
export function detectDelimiter(text: string, ext = ''): string {
  if (ext === 'tsv') return '\t';
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let max = 0;
  for (const d of [',', ';', '\t', '|']) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > max) {
      max = count;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 style parser: quoted fields, doubled quotes, embedded delimiters and newlines. */
export function parseCsv(text: string, delimiter = ',', maxRows = Infinity): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let truncated = false;
  const endRow = () => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (rows.length >= maxRows) {
        truncated = i < text.length - 1;
        return { rows, truncated };
      }
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return { rows, truncated };
}
