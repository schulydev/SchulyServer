import type { Sheet } from './csv';

export const MAX_SHEET_ROWS = 20000;
const MAX_SHEETS = 50;

/** Reads a spreadsheet (xlsx, xls, ods) with SheetJS, imported on demand so it never lands in the initial bundle. */
export async function readWorkbook(buffer: ArrayBuffer): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(buffer, { type: 'array', sheetRows: MAX_SHEET_ROWS + 1, cellDates: true });
  return book.SheetNames.slice(0, MAX_SHEETS).map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }).map((r) => r.map((c) => String(c ?? '')));
    const truncated = rows.length > MAX_SHEET_ROWS;
    return { name, rows: truncated ? rows.slice(0, MAX_SHEET_ROWS) : rows, truncated };
  });
}
