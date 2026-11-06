/**
 * What Schulnetz's approval fields mean. The mobile API sends English codes, seen on BBB accounts: `statusEAB` (the
 * Lehrmeister) is `open`, `confirmed` or `declined`, and `statusEAE` (the parents) is `ofAge` for adults, which means there
 * is no parents' step. Some help pages name German words (KS Rotkreuz: Offen, Bestätigt, Abgelehnt), so those stay too.
 * Any other word means "unknown": no step, never a guess. This is the one place to add new words.
 */
export type ApprovalState = 'open' | 'confirmed' | 'rejected' | 'excused';

const WORDS: Record<string, ApprovalState> = {
  open: 'open',
  confirmed: 'confirmed',
  declined: 'rejected',
  offen: 'open',
  'bestätigt': 'confirmed',
  abgelehnt: 'rejected',
  entschuldigt: 'excused',
};

/** Codes that say the step doesn't apply. Unlike an unknown word this is certain, but the result is the same: no step. */
const NOT_APPLICABLE = new Set(['ofage']);

export function approvalState(value: string | null | undefined): ApprovalState | null {
  const word = (value ?? '').trim().toLowerCase();
  return NOT_APPLICABLE.has(word) ? null : WORDS[word] ?? null;
}

export type StepState = 'done' | 'next' | 'todo' | 'rejected';

export interface AbsenceStep {
  label: string;
  state: StepState;
}

export interface StepInput {
  reported: boolean;
  parentStatus?: string | null;
  trainerStatus?: string | null;
}

/** The steps this absence really has. Parents and Lehrmeister only appear with a value from the school, and nothing known means no steps at all. */
export function absenceSteps(input: StepInput): AbsenceStep[] {
  const parent = approvalState(input.parentStatus);
  const trainer = approvalState(input.trainerStatus);
  if (!input.reported && !parent && !trainer) return [];

  const steps: AbsenceStep[] = [{ label: 'Reported', state: 'done' }];
  let stopped = false;
  const add = (label: string, state: ApprovalState | null): void => {
    if (!state) return;
    if (stopped) {
      steps.push({ label, state: 'todo' });
    } else if (state === 'rejected') {
      steps.push({ label, state: 'rejected' });
      stopped = true;
    } else if (state === 'open') {
      steps.push({ label, state: 'next' });
      stopped = true;
    } else {
      steps.push({ label, state: 'done' });
    }
  };
  add('Parents', parent);
  add('Lehrmeister', trainer);
  steps.push({ label: 'School', state: stopped ? 'todo' : 'next' });
  return steps;
}

const WAITING: Record<string, string> = {
  Parents: 'Waiting for parents',
  Lehrmeister: 'Waiting for Lehrmeister',
  School: 'Waiting for school',
};

const REJECTED: Record<string, string> = {
  Parents: 'Rejected by parents',
  Lehrmeister: 'Rejected by Lehrmeister',
};

export function waitingLabel(steps: AbsenceStep[]): string | null {
  const step = steps.find((s) => s.state === 'next');
  return step ? WAITING[step.label] ?? null : null;
}

export function rejectedLabel(steps: AbsenceStep[]): string | null {
  const step = steps.find((s) => s.state === 'rejected');
  return step ? REJECTED[step.label] ?? null : null;
}
