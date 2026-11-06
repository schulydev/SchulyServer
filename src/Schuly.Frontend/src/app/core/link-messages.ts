import { t } from './i18n';

/** The plugins' fixed English sign-in texts and their translation keys. */
const KEYS: Record<string, string> = {
  'Your Microsoft password has expired. Change it at office.com, then try again.': 'linkMessages.passwordExpired',
  'This Microsoft account has no password. Use the Schuly mobile app to link it.': 'linkMessages.noPassword',
  'The Microsoft sign-in of that account has expired. Sign in to Microsoft again.': 'linkMessages.microsoftSignInExpired',
  'Sign-in expired, sign in again': 'linkMessages.accountExpired',
  'The email or password is wrong.': 'linkMessages.wrongPassword',
  'Too many attempts, try again later.': 'linkMessages.rateLimited',
  'Too many failed attempts. Wait a few minutes and try again.': 'linkMessages.tooManyFailed',
  'The Microsoft sign-in failed. Start again.': 'linkMessages.failed',
  'The sign-in expired. Start again.': 'linkMessages.expired',
  'Microsoft could not be reached. Try again later.': 'linkMessages.unreachable',
  "Your school's Microsoft sign-in isn't supported here yet. Use the Schuly mobile app to link this account.": 'linkMessages.unsupported',
  "Your school's Microsoft policy blocks this sign-in here. Use the Schuly mobile app to link this account.": 'linkMessages.blocked',
};

/** A plugin's sign-in text in the active language; texts without a translation, or with none loaded yet, show as sent. */
export function linkText(text: string | null | undefined): string {
  if (!text) return '';
  const key = KEYS[text];
  if (!key) return text;
  const translated = t(key);
  return translated === key ? text : translated;
}
