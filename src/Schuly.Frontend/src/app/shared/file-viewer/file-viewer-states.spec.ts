import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from './file-viewer';
import { ViewerFile } from './viewer-file';

type Internals = {
  phase(): string | null;
  failed(): boolean;
  failedThrottled(): boolean;
  shownKind(): string;
  mediaUrl(): string;
  waitSeconds(): number;
  dialogClass(): string;
  retry(): void;
};

const throttled = (seconds = 7) => new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': String(seconds) }) });
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
const PDF = new Blob(['%PDF-1.7']);

describe('FileViewer states', () => {
  let fixture: ComponentFixture<FileViewer>;
  let viewer: Internals;

  const open = (file: ViewerFile) => {
    fixture.componentRef.setInput('file', file);
    fixture.detectChanges();
  };
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    fixture = TestBed.createComponent(FileViewer);
    viewer = fixture.componentInstance as unknown as Internals;
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays a video from its stream without fetching the bytes', async () => {
    const load = vi.fn(async () => PNG);
    open({ name: 'clip.mp4', load, stream: async () => '/api/plugins/microsoft/media/h' });
    await settle();
    expect(viewer.shownKind()).toBe('video');
    expect(viewer.mediaUrl()).toBe('/api/plugins/microsoft/media/h');
    expect(load).not.toHaveBeenCalled();
  });

  it('waits out a throttle instead of asking again, then plays', async () => {
    const stream = vi.fn<() => Promise<string>>().mockRejectedValueOnce(throttled(7)).mockResolvedValue('/m');
    const load = vi.fn(async () => PNG);
    const pdf = vi.fn(async () => PDF);
    open({ name: 'clip.mp4', load, pdf, stream });
    await settle();
    expect(viewer.phase()).toBe('waiting');
    expect(viewer.waitSeconds()).toBe(7);
    expect(viewer.failed()).toBe(false);
    await settle(6000);
    expect(stream).toHaveBeenCalledTimes(1);
    await settle(1000);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(viewer.shownKind()).toBe('video');
    expect(load).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
  });

  it('never falls through to the file while the PDF is throttled', async () => {
    const pdf = vi.fn<() => Promise<Blob>>().mockRejectedValueOnce(throttled(5)).mockResolvedValue(PDF);
    const load = vi.fn(async () => PNG);
    open({ name: 'Plan.docx', load, pdf });
    await settle();
    expect(pdf).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(viewer.phase()).toBe('waiting');
    await settle(5000);
    expect(pdf).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();
    expect(viewer.shownKind()).toBe('pdf');
  });

  it('a PDF that fails for another reason still falls back to the file', async () => {
    const load = vi.fn(async () => PNG);
    open({ name: 'Plan.docx', load, pdf: async () => Promise.reject(new HttpErrorResponse({ status: 415 })) });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after some tries and offers to try again', async () => {
    const load = vi.fn<() => Promise<Blob>>().mockRejectedValue(throttled(5));
    open({ name: 'a.png', load });
    await settle(60_000);
    expect(load).toHaveBeenCalledTimes(6);
    expect(viewer.failed()).toBe(true);
    expect(viewer.failedThrottled()).toBe(true);
    load.mockResolvedValue(PNG);
    viewer.retry();
    await settle();
    expect(viewer.failed()).toBe(false);
    expect(viewer.shownKind()).toBe('image');
  });

  it('closing during a wait asks for nothing more', async () => {
    const load = vi.fn<() => Promise<Blob>>().mockRejectedValue(throttled(5));
    open({ name: 'a.png', load });
    await settle();
    fixture.componentRef.setInput('file', null);
    fixture.detectChanges();
    await settle(30_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a server without the stream falls back to the bytes', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])]));
    open({ name: 'clip.mp4', load, stream: async () => Promise.reject(new HttpErrorResponse({ status: 404 })) });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(viewer.shownKind()).toBe('video');
  });

  it('a file over the limit is merely not previewable', async () => {
    open({ name: 'clip.mp4', load: async () => PNG, stream: async () => Promise.reject(new HttpErrorResponse({ status: 413 })) });
    await settle();
    expect(viewer.failed()).toBe(false);
    expect(viewer.shownKind()).toBe('none');
  });

  it('another failure says so and can be retried', async () => {
    const load = vi.fn<() => Promise<Blob>>().mockRejectedValueOnce(new HttpErrorResponse({ status: 500 })).mockResolvedValue(PNG);
    open({ name: 'a.png', load });
    await settle();
    expect(viewer.failed()).toBe(true);
    expect(viewer.failedThrottled()).toBe(false);
    viewer.retry();
    await settle();
    expect(viewer.shownKind()).toBe('image');
  });

  describe('dialog size', () => {
    it('shrinks to a picture or video', async () => {
      open({ name: 'a.png', load: async () => PNG });
      await settle();
      expect(viewer.dialogClass()).toContain('sm:w-fit');
      expect(viewer.dialogClass()).toContain('sm:h-fit');
      expect(viewer.dialogClass()).toContain('h-dvh');
    });

    it('stays large for a document', async () => {
      open({ name: 'a.pdf', load: async () => PDF });
      await settle();
      expect(viewer.dialogClass()).toContain('sm:w-[calc(100vw-2rem)]');
      expect(viewer.dialogClass()).not.toContain('sm:w-fit');
    });

    it('is modest while loading', () => {
      open({ name: 'a.png', load: () => new Promise(() => undefined) });
      expect(viewer.dialogClass()).toContain('sm:w-lg');
    });
  });
});
