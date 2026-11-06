import { t } from '../core/i18n';
import { Component, computed, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { AgendaEntryType } from '../api';

const labels: Record<AgendaEntryType, string> = { Event: 'overview.event', Lesson: 'shared.lesson', Test: 'overview.test', Holiday: 'overview.holiday' };

@Component({
  selector: 'app-agenda-type-badge',
  imports: [HlmBadge],
  template: `<span hlmBadge [variant]="variant()">{{ label() }}</span>`,
})
export class AgendaTypeBadge {
  readonly type = input.required<AgendaEntryType>();
  protected readonly label = computed(() => t(labels[this.type()]));
  protected readonly variant = computed(() => (this.type() === 'Test' ? 'default' : this.type() === 'Holiday' ? 'secondary' : 'outline'));
}
