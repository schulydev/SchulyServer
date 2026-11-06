import { t } from '../core/i18n';
type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "PT5M12S" as "5 min"; empty when it cannot be read. */
export function durationText(iso: string): string {
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return '';
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Math.round(Number(m[3] ?? 0))];
  return [h && `${h} h`, min && `${min} min`, sec && !h && !min && `${sec} s`].filter(Boolean).join(' ');
}

const list = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : t('chat.event.list', { first: names.slice(0, -1).join(', '), last: names[names.length - 1] }));

/**
 * A short sentence for a system message ("Alice added Bob", "Chat name changed to X"), or null when the event says nothing
 * useful (an unknown type, or one without details), so it can be left out of the conversation.
 * `nameOf` resolves a user id to a name; `meId` makes the user's own actions read "You".
 */
export function describeEvent(detail: Json | null | undefined, nameOf: (id: string) => string | null, meId: string | null): string | null {
  const d = obj(detail);
  if (!d) return null;
  const type = str(d['@odata.type']).replace(/^#?microsoft\.graph\./, '');
  const who = (identity: unknown): string => {
    const user = obj(obj(identity)?.['user']) ?? obj(identity);
    const id = str(user?.['id']);
    if (id && meId && id === meId) return t('chat.you');
    return str(user?.['displayName']) || (id ? nameOf(id) : null) || '';
  };
  const initiator = who(d['initiator']);
  const rawMembers = Array.isArray(d['members']) ? (d['members'] as unknown[]) : [];
  const members = rawMembers.map(who).filter(Boolean);
  const target = members.length ? list(members) : rawMembers.length ? t('chat.event.members', { count: rawMembers.length }) : '';

  switch (type) {
    case 'membersAddedEventMessageDetail':
      if (!target) return null;
      return initiator ? t('chat.event.added', { who: initiator, target }) : t(members.length > 1 ? 'chat.event.wereAdded' : 'chat.event.wasAdded', { target });
    case 'membersDeletedEventMessageDetail':
      if (!target) return null;
      return initiator ? t('chat.event.removed', { who: initiator, target }) : t(members.length > 1 ? 'chat.event.wereRemoved' : 'chat.event.wasRemoved', { target });
    case 'membersJoinedEventMessageDetail':
      return target ? t('chat.event.joined', { target }) : null;
    case 'membersLeftEventMessageDetail':
      return target ? t('chat.event.left', { target }) : null;
    case 'chatRenamedEventMessageDetail': {
      const name = str(d['chatDisplayName']);
      if (!name) return initiator ? t('chat.event.nameRemovedBy', { who: initiator }) : t('chat.event.nameRemoved');
      return initiator ? t('chat.event.renamedBy', { who: initiator, name }) : t('chat.event.renamed', { name });
    }
    case 'teamsAppInstalledEventMessageDetail':
    case 'teamsAppRemovedEventMessageDetail': {
      const app = str(d['teamsAppDisplayName']);
      if (!app) return null;
      return t(type.includes('Installed') ? 'chat.event.appAdded' : 'chat.event.appRemoved', { app });
    }
    case 'callEndedEventMessageDetail': {
      const time = durationText(str(d['callDuration']));
      return time ? t('chat.event.callEndedAfter', { time }) : t('chat.event.callEnded');
    }
    case 'callStartedEventMessageDetail':
      return initiator ? t('chat.event.callStartedBy', { who: initiator }) : t('chat.event.callStarted');
    default:
      return null;
  }
}
