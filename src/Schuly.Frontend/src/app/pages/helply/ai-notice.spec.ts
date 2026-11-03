import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HelplyAiNotice, aiNoticeSeen } from './ai-notice';

describe('Helply first-use notice', () => {
  beforeEach(() => localStorage.clear());

  it('says it is an AI and not a person', async () => {
    const fixture = TestBed.createComponent(HelplyAiNotice);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Helply is an AI, not a person');
    expect(text).toContain('sent to an AI model');
  });

  it('asks until the user has seen it, and only once after that', () => {
    expect(aiNoticeSeen().value()).toBe('no');
    aiNoticeSeen().set('yes');
    expect(aiNoticeSeen().value()).toBe('yes');
  });

  it('tells the page when it was understood', () => {
    const fixture = TestBed.createComponent(HelplyAiNotice);
    fixture.detectChanges();
    let understood = false;
    fixture.componentInstance.understood.subscribe(() => (understood = true));
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(understood).toBe(true);
  });
});
