/**
 * What Schulnetz's approval fields mean. No real values have been seen yet, so this only knows the words a school's
 * help pages name (KS Rotkreuz: Offen, Bestätigt, Abgelehnt). Any other word means "unknown": no step, never a guess.
 * When real data shows other words, this is the one place to add them.
 */
export type ApprovalState = 'open' | 'confirmed' | 'rejected' | 'excused';

const WORDS: Record<string, ApprovalState> = {
  offen: 'open',
  'bestätigt': 'confirmed',
  abgelehnt: 'rejected',
  entschuldigt: 'excused',
};

export function approvalState(value: string | null | undefined): ApprovalState | null {
  return WORDS[(value ?? '').trim().toLowerCase()] ?? null;
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
