import { TranslatePipe } from '@ngx-translate/core';
import { Component, DestroyRef, ElementRef, effect, inject, model, output, signal, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircle, lucideRotateCcw, lucideSquare, lucideVideo } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

export const MAX_CLIP_SECONDS = 120;

type Phase = 'starting' | 'ready' | 'recording' | 'review' | 'denied' | 'unsupported';

const pickType = (): string => {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
};

/** Records a short camera and microphone clip with MediaRecorder and hands it back as a webm file. */
@Component({
  selector: 'app-clip-dialog',
  imports: [TranslatePipe, NgIcon, HlmButton, HlmDialogImports],
  providers: [provideIcons({ lucideCircle, lucideRotateCcw, lucideSquare, lucideVideo })],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ 'chat.clip.title' | translate }}</h2>
          <p hlmDialogDescription>{{ 'chat.clip.description' | translate }}</p>
        </hlm-dialog-header>

        @switch (phase()) {
          @case ('denied') {
            <p class="text-sm" role="alert">{{ 'chat.clip.blocked' | translate }}</p>
          }
          @case ('unsupported') {
            <p class="text-sm" role="alert">{{ 'chat.clip.unsupported' | translate }}</p>
          }
          @default {
            <div class="bg-muted relative aspect-video overflow-hidden rounded-md">
              @if (phase() === 'review') {
                <video #playback [src]="clipUrl()" controls playsinline class="size-full object-contain" [attr.aria-label]="'chat.clip.preview' | translate"></video>
              } @else {
                <video #live muted playsinline autoplay class="size-full -scale-x-100 object-cover" [attr.aria-label]="'chat.clip.camera' | translate"></video>
              }
            </div>
            <p class="text-sm tabular-nums" role="status" aria-live="off">
              {{ clock(seconds()) }} / {{ clock(max) }}
              @if (phase() === 'recording') {
                <span class="sr-only">{{ 'chat.clip.recording' | translate }}</span>
              }
            </p>
          }
        }

        <hlm-dialog-footer>
          <button hlmBtn variant="outline" type="button" (click)="open.set(false)">{{ 'common.cancel' | translate }}</button>
          @switch (phase()) {
            @case ('ready') {
              <button hlmBtn type="button" (click)="start()"><ng-icon name="lucideCircle" class="text-red-600 dark:text-red-400" aria-hidden="true" />{{ 'chat.clip.record' | translate }}</button>
            }
            @case ('recording') {
              <button hlmBtn type="button" (click)="stop()"><ng-icon name="lucideSquare" aria-hidden="true" />{{ 'chat.clip.stop' | translate }}</button>
            }
            @case ('review') {
              <button hlmBtn variant="outline" type="button" (click)="retake()"><ng-icon name="lucideRotateCcw" aria-hidden="true" />{{ 'chat.clip.retake' | translate }}</button>
              <button hlmBtn type="button" (click)="use()">{{ 'chat.clip.use' | translate }}</button>
            }
            @case ('denied') {
              <button hlmBtn type="button" (click)="retake()">{{ 'common.retry' | translate }}</button>
            }
          }
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class ClipDialog {
  readonly open = model(false);
  readonly clip = output<File>();

  protected readonly max = MAX_CLIP_SECONDS;
  protected readonly phase = signal<Phase>('starting');
  protected readonly seconds = signal(0);
  protected readonly clipUrl = signal('');

  private readonly live = viewChild<ElementRef<HTMLVideoElement>>('live');
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private blob: Blob | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private seq = 0;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? void this.prepare() : this.release()));
    });
    // The preview element appears after the phase changes.
    effect(() => {
      const el = this.live()?.nativeElement;
      if (el && this.stream && el.srcObject !== this.stream) el.srcObject = this.stream;
    });
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected clock(total: number): string {
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  private async prepare(): Promise<void> {
    this.release();
    const seq = ++this.seq;
    this.phase.set('starting');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !pickType()) {
      this.phase.set('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      if (seq !== this.seq || !this.open()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.phase.set('ready');
    } catch {
      if (seq === this.seq) this.phase.set('denied');
    }
  }

  protected start(): void {
    if (!this.stream) return;
    this.chunks = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: pickType() });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => {
      this.blob = new Blob(this.chunks, { type: 'video/webm' });
      this.clipUrl.set(URL.createObjectURL(this.blob));
      this.stopStream();
      this.phase.set('review');
    };
    this.recorder = recorder;
    this.seconds.set(0);
    recorder.start(1000);
    this.phase.set('recording');
    this.timer = setInterval(() => {
      this.seconds.update((s) => s + 1);
      if (this.seconds() >= MAX_CLIP_SECONDS) this.stop();
    }, 1000);
  }

  protected stop(): void {
    clearInterval(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  protected retake(): void {
    this.revokeClip();
    void this.prepare();
  }

  protected use(): void {
    if (!this.blob) return;
    this.clip.emit(new File([this.blob], `clip-${Date.now()}.webm`, { type: 'video/webm' }));
    this.open.set(false);
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private revokeClip(): void {
    if (this.clipUrl()) URL.revokeObjectURL(this.clipUrl());
    this.clipUrl.set('');
    this.blob = null;
  }

  private release(): void {
    this.seq++;
    clearInterval(this.timer);
    if (this.recorder) this.recorder.onstop = null;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    this.stopStream();
    this.revokeClip();
  }
}
