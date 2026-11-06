import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';
import { dictionaryLookup, useLookup } from './i18n';
import { linkText } from './link-messages';

describe('linkText', () => {
  afterEach(() => useLookup('de', (key) => key));

  it('translates a known plugin text', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(linkText('Your Microsoft password has expired. Change it at office.com, then try again.')).toBe(de.linkMessages.passwordExpired);
    expect(linkText('Sign-in expired, sign in again')).toBe(de.linkMessages.accountExpired);
  });

  it('keeps an unknown text and empties a missing one', () => {
    useLookup('de', dictionaryLookup(de, 'de-CH'));
    expect(linkText('Something only this plugin says.')).toBe('Something only this plugin says.');
    expect(linkText(null)).toBe('');
  });

  it('shows the plugin text when the loaded translations lack the key', () => {
    useLookup('de', dictionaryLookup({}, 'de-CH'));
    expect(linkText('The email or password is wrong.')).toBe('The email or password is wrong.');
  });

  it('maps every English text to the key that holds it in en.json', () => {
    useLookup('en', dictionaryLookup(en));
    for (const text of Object.values(en.linkMessages)) expect(linkText(text)).toBe(text);
  });
});
