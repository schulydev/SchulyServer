import { describe, expect, it } from 'vitest';
import { chatPeople, nameFromEmail } from './chat-people';

const me = { displayName: 'Niclas Erismann', userId: 'me', email: 'niclas@school.ch' };
const elias = { displayName: 'Elias Spycher', userId: 'u2', email: 'elias.spycher@school.ch' };

describe('chatPeople', () => {
  it('shows the other member of a 1:1 chat, never the signed-in user', () => {
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, elias] }, 'me', null).people).toEqual([{ id: 'u2', name: 'Elias Spycher' }]);
  });
  it('recognises the user by account email when the id is unknown', () => {
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, elias] }, null, 'Niclas@School.ch').people.map((p) => p.name)).toEqual(['Elias Spycher']);
  });
  it('does not match on name alone', () => {
    const namesake = { displayName: 'Niclas Erismann', userId: 'other', email: 'other@x.ch' };
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, namesake] }, 'me', null).people).toEqual([{ id: 'other', name: 'Niclas Erismann' }]);
  });
  it('names a member without a display name from the email', () => {
    const nameless = { userId: 'u2', email: 'elias.spycher@school.ch' };
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, nameless] }, 'me', null).people).toEqual([{ id: 'u2', name: 'Elias Spycher' }]);
  });
  it('falls back to the last sender when the other member has no name at all', () => {
    const empty = { userId: 'u2' };
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, empty] }, 'me', null, { id: 'u2', displayName: 'Elias S.' }).people).toEqual([{ id: 'u2', name: 'Elias S.' }]);
    expect(chatPeople({ id: 'c', chatType: 'oneOnOne', members: [me, empty] }, 'me', null, { id: 'me', displayName: 'Niclas Erismann' }).people).toEqual([]);
  });
  it('excludes the user from group chats', () => {
    const bo = { displayName: 'Bo', userId: 'u3' };
    const r = chatPeople({ id: 'c', chatType: 'group', members: [me, elias, bo] }, 'me', null);
    expect(r.people.map((p) => p.name)).toEqual(['Elias Spycher', 'Bo']);
    expect(r.memberCount).toBe(3);
  });
  it('labels the notes-to-self chat', () => {
    const r = chatPeople({ id: 'Ab3_x-Z9', chatType: 'oneOnOne', isSelfChat: true, members: [me] }, 'me', null);
    expect(r.notes).toBe(true);
    expect(r.people[0].name).toBe('Notes (you)');
  });
});

describe('nameFromEmail', () => {
  it('capitalises the local part', () => {
    expect(nameFromEmail('a-b_c.d@x.ch')).toBe('A B C D');
    expect(nameFromEmail(null)).toBe('');
  });
});
