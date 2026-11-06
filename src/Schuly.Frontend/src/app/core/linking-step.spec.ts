import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { LinkFieldDto, LinkSessionDto } from './linking-api';
import { clock, countdownAnnouncement, failureMessage, fieldHint, filterSearchOptions, formHints, initialValues, isHttps, isTerminal, linkErrorMessage, searchOption, secondsLeft, submitValues } from './linking-step';

const field = (extra: Partial<LinkFieldDto>): LinkFieldDto => ({ key: 'k', label: 'Field', type: 'text', required: true, ...extra });
const session = (status: LinkSessionDto['status'], kind: LinkSessionDto['step']['kind'], extra: Partial<LinkSessionDto['step']> = {}): LinkSessionDto => ({
  sessionId: 's',
  providerId: 'p',
  flowId: 'f',
  status,
  expiresAt: '2030-01-01T00:00:00Z',
  step: { id: 'step', kind, ...extra },
});

describe('isHttps', () => {
  it('accepts only absolute https URLs', () => {
    expect(isHttps('https://login.example.org/device')).toBe(true);
    expect(isHttps('http://login.example.org')).toBe(false);
    expect(isHttps('javascript:alert(1)')).toBe(false);
    expect(isHttps('/relative')).toBe(false);
    expect(isHttps(null)).toBe(false);
  });
});

describe('linkErrorMessage', () => {
  it('shows the message the server sent', () => {
    expect(linkErrorMessage(new HttpErrorResponse({ status: 400, error: { message: 'Wrong password.' } }))).toBe('Wrong password.');
    expect(linkErrorMessage(new HttpErrorResponse({ status: 422, error: { detail: 'Bad school address.' } }))).toBe('Bad school address.');
  });

  it('explains a rate limit and uses Retry-After', () => {
    const limited = new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '12' }), error: null });
    expect(linkErrorMessage(limited)).toBe('Too many attempts. Wait 12 seconds and try again.');
    expect(linkErrorMessage(new HttpErrorResponse({ status: 429, error: null }))).toContain('Too many attempts');
  });

  it('maps an expired session and an unreachable server', () => {
    expect(linkErrorMessage(new HttpErrorResponse({ status: 404, error: null }))).toContain('expired');
    expect(linkErrorMessage(new HttpErrorResponse({ status: 0, error: null }))).toContain('not reachable');
  });

  it('never returns an HTML error page', () => {
    expect(linkErrorMessage(new HttpErrorResponse({ status: 400, error: '<html>bad</html>' }), 'Fallback')).toBe('Fallback');
  });
});

describe('isTerminal / failureMessage', () => {
  it('treats a done status or step as success, never as failure', () => {
    expect(isTerminal(session('done', 'done'))).toBe('done');
    expect(isTerminal(session('done', 'form'))).toBe('done');
    expect(isTerminal(session('active', 'done'))).toBe('done');
  });

  it('treats failed, expired and error steps as failure and keeps the real message', () => {
    expect(isTerminal(session('failed', 'error'))).toBe('failed');
    expect(isTerminal(session('expired', 'form'))).toBe('failed');
    expect(isTerminal(session('active', 'error'))).toBe('failed');
    expect(failureMessage(session('failed', 'error', { error: 'This school needs the mobile app.' }))).toBe('This school needs the mobile app.');
    expect(failureMessage(session('expired', 'form'))).toContain('expired');
  });

  it('is not terminal while active', () => {
    expect(isTerminal(session('active', 'otp'))).toBeNull();
  });
});

describe('field hints', () => {
  it('requires required fields and skips optional empty ones', () => {
    expect(fieldHint(field({}), '  ')).toBe('Field is required.');
    expect(fieldHint(field({ required: false }), '')).toBeNull();
  });

  it('checks email shape, https urls (http only for localhost), maxLength and pattern', () => {
    expect(fieldHint(field({ type: 'email' }), 'nope')).toBe('Enter a valid email address.');
    expect(fieldHint(field({ type: 'email' }), 'a@b.ch')).toBeNull();
    expect(fieldHint(field({ type: 'url' }), 'http://example.org')).toContain('https');
    expect(fieldHint(field({ type: 'url' }), 'http://localhost:5000')).toBeNull();
    expect(fieldHint(field({ type: 'url' }), 'https://school.example')).toBeNull();
    expect(fieldHint(field({ maxLength: 3 }), 'abcd')).toContain('at most 3');
    expect(fieldHint(field({ pattern: '^[0-9]+$' }), 'abc')).toContain('expected format');
    expect(fieldHint(field({ pattern: '(?<n>x' }), 'x')).toBeNull();
  });

  it('limits a select without allowCustom to its options', () => {
    const select = field({ type: 'select', options: [{ value: 'a', label: 'A' }] });
    expect(fieldHint(select, 'b')).toContain('Choose one');
    expect(fieldHint({ ...select, allowCustom: true }, 'https://custom.example')).toBeNull();
    expect(fieldHint({ ...select, allowCustom: true }, 'http://custom.example')).toContain('https');
  });

  it('collects hints per key and builds the submit values without empty optional fields', () => {
    const fields = [field({ key: 'a' }), field({ key: 'b', required: false }), field({ key: 'c', type: 'password', secret: true })];
    expect(formHints(fields, { a: '', b: '', c: 'x' })).toEqual({ a: 'Field is required.' });
    expect(submitValues(fields, { a: ' one ', b: '', c: 'x' })).toEqual({ a: 'one', c: 'x' });
  });

  it('starts secret fields empty and prefills defaults', () => {
    const step = { id: 's', kind: 'form' as const, fields: [field({ key: 'u', defaultValue: 'https://x.example' }), field({ key: 'p', secret: true, defaultValue: 'leak' })] };
    expect(initialValues(step)).toEqual({ u: 'https://x.example', p: '' });
  });
});

describe('countdown', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  it('counts down and never goes negative', () => {
    expect(secondsLeft('2030-01-01T00:01:30Z', now)).toBe(90);
    expect(secondsLeft('2029-12-31T23:59:00Z', now)).toBe(0);
    expect(secondsLeft('garbage', now)).toBe(0);
  });

  it('formats m:ss', () => {
    expect(clock(90)).toBe('1:30');
    expect(clock(5)).toBe('0:05');
  });

  it('announces in coarse buckets so a screen reader is not read every second', () => {
    expect(countdownAnnouncement(300)).toBe('About 5 minutes left.');
    expect(countdownAnnouncement(61)).toBe('About 2 minutes left.');
    expect(countdownAnnouncement(45)).toBe('About 1 minute left.');
    expect(countdownAnnouncement(20)).toBe('About 30 seconds left.');
    expect(countdownAnnouncement(5)).toBe('About 10 seconds left.');
    expect(countdownAnnouncement(0)).toBe('The request expired.');
    expect(countdownAnnouncement(44)).toBe(countdownAnnouncement(46));
  });
});

describe('search options', () => {
  const schools = [
    { value: 'https://schulnetz.bbbaden.ch', label: 'Berufsfachschule BBB Baden · AG' },
    { value: 'https://www.schulnetz-ag.ch/ksba', label: 'Kantonsschule Baden · AG' },
    { value: 'https://gibz.zg.ch', label: 'Gewerblich-industrielles Bildungszentrum Zug (GIBZ) · ZG' },
    { value: 'https://schulnetz.zentrumbildung.ch', label: 'Zentrum Bildung – Wirtschaftsschule KV Baden · AG' },
  ].map(searchOption);

  it('splits the canton off the name and shows the address without https', () => {
    expect(schools[0]).toEqual({ value: 'https://schulnetz.bbbaden.ch', name: 'Berufsfachschule BBB Baden', tag: 'AG', address: 'schulnetz.bbbaden.ch' });
    expect(searchOption({ value: 'x', label: 'No tag here' })).toEqual({ value: 'x', name: 'No tag here', tag: null, address: null });
  });

  it('matches every word in name, canton or address, ignoring case and accents', () => {
    expect(filterSearchOptions(schools, 'bbb').map((s) => s.tag)).toEqual(['AG']);
    expect(filterSearchOptions(schools, 'baden kanton').map((s) => s.name)).toEqual(['Kantonsschule Baden']);
    expect(filterSearchOptions(schools, 'zg').map((s) => s.address)).toEqual(['gibz.zg.ch']);
    expect(filterSearchOptions(schools, 'ZENTRUM').length).toBe(2);
    expect(filterSearchOptions(schools, '').length).toBe(4);
  });
});
