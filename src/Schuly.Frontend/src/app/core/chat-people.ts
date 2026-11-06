import { t } from './i18n';
export interface PersonLike {
  displayName?: string | null;
  userId?: string | null;
  email?: string | null;
}

export interface ChatPerson {
  id: string | null;
  name: string;
}

export interface ChatPeople {
  /** Who the chat is with: everyone but the signed-in user (only the user for the notes-to-self chat). */
  people: ChatPerson[];
  /** Number of members, the signed-in user included. */
  memberCount: number;
  notes: boolean;
}

/** A translation key: the title of the chat with yourself. */
export const NOTES_TITLE = 'chat.notesTitle';

/** "elias.spycher@school.ch" becomes "Elias Spycher", for members the server sent without a display name. */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * The people a chat is with. The signed-in user is recognised by user id or by account email, never by name.
 * A member without a display name is still someone else: they get a name from their email, or from the sender of the
 * last message when that is not the user.
 */
export function chatPeople(
  chat: { id: string; chatType?: string | null; isSelfChat?: boolean | null; members?: PersonLike[] | null },
  mineId: string | null,
  ownEmail: string | null,
  lastSender?: { id?: string | null; displayName?: string | null } | null,
): ChatPeople {
  const members = chat.members ?? [];
  const email = ownEmail?.toLowerCase() ?? null;
  const isMe = (m: PersonLike) => (!!mineId && m.userId === mineId) || (!!email && m.email?.toLowerCase() === email);
  if (chat.isSelfChat === true) return { people: [{ id: mineId, name: t(NOTES_TITLE) }], memberCount: Math.max(1, members.length), notes: true };

  const people: ChatPerson[] = [];
  for (const m of members) {
    if (isMe(m)) continue;
    const name = m.displayName?.trim() || nameFromEmail(m.email);
    if (name) people.push({ id: m.userId ?? null, name });
  }
  if (!people.length && chat.chatType === 'oneOnOne' && lastSender?.displayName && lastSender.id !== mineId) {
    people.push({ id: lastSender.id ?? null, name: lastSender.displayName });
  }
  return { people, memberCount: members.length, notes: false };
}
