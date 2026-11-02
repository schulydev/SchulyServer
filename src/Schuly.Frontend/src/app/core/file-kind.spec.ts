import { describe, expect, it } from 'vitest';
import { fileKindOf, fileTypeLabel } from './file-kind';

describe('fileKindOf', () => {
  it('trusts a known server kind', () => {
    expect(fileKindOf('x.bin', null, 'excel')).toBe('excel');
  });
  it('derives from content type and extension', () => {
    expect(fileKindOf('Report.DOCX')).toBe('word');
    expect(fileKindOf('a', 'image/png')).toBe('image');
    expect(fileKindOf('clip.webm', 'video/webm')).toBe('video');
    expect(fileKindOf('noext', 'application/pdf')).toBe('pdf');
    expect(fileKindOf('weird.xyz')).toBe('other');
  });
});

describe('fileTypeLabel', () => {
  it('names csv as CSV, not Excel', () => {
    expect(fileTypeLabel('data.csv')).toBe('CSV file');
    expect(fileTypeLabel('x', 'text/csv')).toBe('CSV file');
    expect(fileTypeLabel('data.tsv')).toBe('TSV file');
  });
  it('names text-like formats', () => {
    expect(fileTypeLabel('README.md')).toBe('Markdown file');
    expect(fileTypeLabel('a.json')).toBe('JSON file');
    expect(fileTypeLabel('a.txt')).toBe('Text file');
    expect(fileTypeLabel('a.rtf')).toBe('Rich text document');
  });
  it('names OpenDocument formats', () => {
    expect(fileTypeLabel('a.odt')).toBe('OpenDocument text');
    expect(fileTypeLabel('a.ods')).toBe('OpenDocument spreadsheet');
    expect(fileTypeLabel('a.odp')).toBe('OpenDocument presentation');
  });
  it('names media formats', () => {
    expect(fileTypeLabel('a.heic')).toBe('HEIC image');
    expect(fileTypeLabel('a.avif')).toBe('AVIF image');
    expect(fileTypeLabel('a.webm')).toBe('WebM video');
    expect(fileTypeLabel('a.mov')).toBe('QuickTime video');
  });
  it('falls back to the kind label', () => {
    expect(fileTypeLabel('a.xlsx')).toBe('Excel workbook');
    expect(fileTypeLabel('a.docx')).toBe('Word document');
    expect(fileTypeLabel('a.xyz')).toBe('File');
  });
  it('classifies the new extensions', () => {
    expect(fileKindOf('a.avif')).toBe('image');
    expect(fileKindOf('a.md')).toBe('text');
    expect(fileKindOf('a.tsv')).toBe('excel');
  });
});
