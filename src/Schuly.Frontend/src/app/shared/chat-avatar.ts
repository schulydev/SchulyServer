import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal } from '@angular/core';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { ChatStore } from '../stores/chat.store';
import { PersonAvatar } from './person-avatar';

export interface ChatPerson {
  id: string | null;
  name: string;
}

/** Graph has no group photo, so a group icon is built from members; this many are asked for photos. */
const PHOTO_CANDIDATES = 4;

/**
 * Icon of a chat, in this order:
 * 1. the chat's own image, when the data has one;
 * 2. a 1:1 chat shows the other person;
 * 3. a group prefers members who have a photo (never the signed-in user): two photos are stacked, exactly one is shown on its own;
 * 4. initials only when no member has a photo.
 */
@Component({
  selector: 'app-chat-avatar',
  imports: [HlmAvatarImports, PersonAvatar],
  template: `
    @if (chatImage(); as src) {
      <hlm-avatar [size]="main()" aria-hidden="true">
        <img [src]="src" alt="" width="40" height="40" loading="lazy" decoding="async" class="size-full rounded-full object-cover" />
      </hlm-avatar>
    } @else if (shown().length === 2) {
      <span class="relative block shrink-0" [class]="compact() ? 'size-8' : 'size-10'" aria-hidden="true">
        <app-person-avatar class="absolute top-0 left-0" size="sm" [userId]="shown()[0].id" [name]="shown()[0].name" />
        <app-person-avatar
          class="ring-background absolute right-0 bottom-0 rounded-full ring-2"
          size="sm"
          [userId]="shown()[1].id"
          [name]="shown()[1].name"
        />
      </span>
    } @else {
      <span class="flex" aria-hidden="true">
        <app-person-avatar [size]="main()" [userId]="shown()[0]?.id ?? null" [name]="shown()[0]?.name ?? title()" />
      </span>
    }
  `,
  host: { class: 'inline-flex shrink-0' },
})
export class ChatAvatar {
  private readonly store = inject(ChatStore);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly people = input<ChatPerson[]>([]);
  readonly oneOnOne = input(false);
  readonly title = input('');
  readonly image = input<string | null>(null);
  /** The data says the chat has its own picture, served at `chats/{chatId}/photo` like member photos. */
  readonly imageAvailable = input(false);
  readonly chatId = input<string | null>(null);
  readonly size = input<'default' | 'compact'>('default');

  protected readonly compact = computed(() => this.size() === 'compact');
  protected readonly main = computed<'default' | 'lg'>(() => (this.compact() ? 'default' : 'lg'));
  /** An explicit image URL wins; otherwise the authenticated chat photo once loaded. Null falls back to member photos. */
  protected readonly chatImage = computed(() => this.image() || (this.imageAvailable() ? this.store.chatImageFor(this.chatId()) : null));

  private readonly visible = signal(false);

  /** Everyone but the signed-in user (the store already leaves them out; this keeps the rule true for any caller). */
  private readonly others = computed(() => {
    const me = this.store.meId();
    const others = this.people().filter((p) => !me || p.id !== me);
    return others.length ? others : this.people();
  });

  protected readonly shown = computed<ChatPerson[]>(() => {
    const others = this.others();
    if (this.oneOnOne()) return others.slice(0, 1);
    const candidates = others.slice(0, PHOTO_CANDIDATES);
    const withPhoto = candidates.filter((p) => !!this.store.photoFor(p.id));
    if (withPhoto.length >= 2) return withPhoto.slice(0, 2);
    if (withPhoto.length === 1) return withPhoto;
    return others.slice(0, 2);
  });

  constructor() {
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.visible.set(true);
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.visible.set(true);
          observer.disconnect();
        }
      });
      observer.observe(this.element.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    // The store de-duplicates requests per (account, user).
    effect(() => {
      if (!this.visible()) return;
      const chatId = this.chatId();
      if (this.imageAvailable() && !this.image() && chatId) this.store.requestChatImage(chatId);
      if (this.chatImage()) return;
      for (const p of this.others().slice(0, PHOTO_CANDIDATES)) if (p.id) this.store.requestPhoto(p.id);
    });
  }
}
