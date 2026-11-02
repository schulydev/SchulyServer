import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_FILES, canSendMessage, checkFiles, fileIcon } from './helply-files';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('checkFiles', () => {
  it('accepts supported types by extension, case-insensitively', () => {
    const { accepted, errors } = checkFiles([file('a.PNG'), file('b.docx'), file('c.markdown')], 0);
    expect(accepted).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it('rejects unsupported types, empty and oversized files with a friendly message', () => {
    const big = file('big.pdf', 1);
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    const { accepted, errors } = checkFiles([file('run.exe'), big, file('e.txt', 0)], 0);
    expect(accepted).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors[1]).toContain('20 MB');
  });

  it('limits the count including files already waiting', () => {
    const { accepted, errors } = checkFiles([file('a.txt'), file('b.txt'), file('c.txt')], MAX_FILES - 2);
    expect(accepted).toHaveLength(2);
    expect(errors).toEqual([`You can attach up to ${MAX_FILES} files per message.`]);
  });
});

describe('fileIcon', () => {
  it('maps types to icons', () => {
    expect(fileIcon('a.png')).toBe('lucideImage');
    expect(fileIcon('a.pdf')).toBe('lucideFileText');
    expect(fileIcon('a.xlsx')).toBe('lucideFileSpreadsheet');
    expect(fileIcon('a.pptx')).toBe('lucidePresentation');
    expect(fileIcon('a.bin')).toBe('lucideFile');
  });
});

describe('canSendMessage', () => {
  const base = { text: '', uploaded: 0, uploading: 0, tooLong: false };
  it('needs text or an uploaded file', () => {
    expect(canSendMessage(base)).toBe(false);
    expect(canSendMessage({ ...base, text: ' hi ' })).toBe(true);
    expect(canSendMessage({ ...base, uploaded: 1 })).toBe(true);
  });
  it('waits for uploads and rejects too long text', () => {
    expect(canSendMessage({ ...base, text: 'hi', uploading: 1 })).toBe(false);
    expect(canSendMessage({ ...base, text: 'hi', tooLong: true })).toBe(false);
  });
});
