/** Colour of a grade pill: red below the pass mark, amber just above it, green from 5. */
export function gradeTone(grade: number | null): string {
  if (grade == null) return 'bg-muted text-muted-foreground';
  if (grade < 4) return 'bg-red-500/15 text-red-800 dark:text-red-300';
  if (grade < 4.5) return 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
  if (grade >= 5) return 'bg-green-500/15 text-green-800 dark:text-green-400';
  return 'bg-muted text-foreground';
}

export function gradeDot(grade: number): string {
  if (grade < 4) return 'bg-destructive';
  if (grade < 4.5) return 'bg-amber-500';
  if (grade >= 5) return 'bg-green-500';
  return 'bg-foreground/70';
}

/** Where a grade sits on the 1 to 6 scale, in percent. */
export const scalePosition = (grade: number): number => Math.min(100, Math.max(0, ((grade - 1) / 5) * 100));
