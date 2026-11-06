import { t } from '../core/i18n';
export interface PresenceView {
  label: string;
  dot: string;
}

const AVAILABLE = 'bg-green-500';
const BUSY = 'bg-red-500';
const AWAY = 'bg-yellow-500';
const NONE = 'bg-muted-foreground';

const VIEWS: Record<string, PresenceView> = {
  Available: { label: 'presence.available', dot: AVAILABLE },
  AvailableIdle: { label: 'presence.available', dot: AVAILABLE },
  Busy: { label: 'presence.busy', dot: BUSY },
  BusyIdle: { label: 'presence.busy', dot: BUSY },
  DoNotDisturb: { label: 'presence.dnd', dot: BUSY },
  Away: { label: 'presence.away', dot: AWAY },
  BeRightBack: { label: 'presence.brb', dot: AWAY },
  Offline: { label: 'presence.offline', dot: NONE },
};

/** How a Teams status shows in the chat header. No status shows nothing, and one this list doesn't know shows as unknown. */
export function presenceView(availability: string | null): PresenceView | null {
  if (!availability) return null;
  const view = VIEWS[availability] ?? { label: 'presence.unknown', dot: NONE };
  return { ...view, label: t(view.label) };
}
