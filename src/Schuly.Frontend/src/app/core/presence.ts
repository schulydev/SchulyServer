export interface PresenceView {
  label: string;
  dot: string;
}

const AVAILABLE = 'bg-green-500';
const BUSY = 'bg-red-500';
const AWAY = 'bg-yellow-500';
const NONE = 'bg-muted-foreground';

const VIEWS: Record<string, PresenceView> = {
  Available: { label: 'Available', dot: AVAILABLE },
  AvailableIdle: { label: 'Available', dot: AVAILABLE },
  Busy: { label: 'Busy', dot: BUSY },
  BusyIdle: { label: 'Busy', dot: BUSY },
  DoNotDisturb: { label: 'Do not disturb', dot: BUSY },
  Away: { label: 'Away', dot: AWAY },
  BeRightBack: { label: 'Be right back', dot: AWAY },
  Offline: { label: 'Offline', dot: NONE },
};

/** How a Teams status shows in the chat header. No status shows nothing, and one this list doesn't know shows as unknown. */
export function presenceView(availability: string | null): PresenceView | null {
  if (!availability) return null;
  return VIEWS[availability] ?? { label: 'Status unknown', dot: NONE };
}
