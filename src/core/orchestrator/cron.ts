import type { ParsedCron } from './types';

/**
 * Parse a cron expression into its components.
 * Format: minute hour day-of-month month day-of-week
 *
 * Examples:
 * - "0 * * * *" - Every hour at minute 0
 * - "0 9 * * 1-5" - 9 AM on weekdays
 * - "0/15 * * * *" - Every 15 minutes (also supports star-slash notation)
 * - "0 0 1 * *" - First day of every month at midnight
 */
export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 parts, got ${parts.length}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12),
    dayOfWeek: parseField(dayOfWeek, 0, 6),
  };
}

/**
 * Parse a single cron field into an array of valid values.
 */
function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  // Handle comma-separated values
  const parts = field.split(',');

  for (const part of parts) {
    // Handle range with step (e.g., "1-10/2")
    if (part.includes('/')) {
      const splitParts = part.split('/');
      const range = splitParts[0] ?? '*';
      const stepStr = splitParts[1] ?? '1';
      const step = Number.parseInt(stepStr, 10);

      if (Number.isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${stepStr}`);
      }

      const rangeValues = range === '*' ? [min, max] : parseRange(range, min, max);
      const start = rangeValues[0] ?? min;
      const end = rangeValues.length === 1 ? max : (rangeValues[1] ?? max);

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) {
          values.add(i);
        }
      }
    }
    // Handle asterisk (all values)
    else if (part === '*') {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    }
    // Handle range (e.g., "1-5")
    else if (part.includes('-')) {
      const rangeValues = parseRange(part, min, max);
      for (let i = rangeValues[0]; i <= rangeValues[1]; i++) {
        values.add(i);
      }
    }
    // Handle single value
    else {
      const value = Number.parseInt(part, 10);
      if (Number.isNaN(value) || value < min || value > max) {
        throw new Error(`Invalid value: ${part} (expected ${min}-${max})`);
      }
      values.add(value);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Parse a range expression (e.g., "1-5").
 */
function parseRange(range: string, min: number, max: number): [number, number] {
  const splitParts = range.split('-');
  const startStr = splitParts[0] ?? '';
  const endStr = splitParts[1] ?? '';
  const start = Number.parseInt(startStr, 10);
  const end = Number.parseInt(endStr, 10);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`Invalid range: ${range}`);
  }

  if (start < min || end > max || start > end) {
    throw new Error(`Range out of bounds: ${range} (expected ${min}-${max})`);
  }

  return [start, end];
}

/**
 * Calculate the next run time from a cron expression.
 * Note: timezone parameter is reserved for future timezone-aware implementation.
 */
export function getNextRunTime(
  expression: string,
  after: Date = new Date(),
  _timezone = 'UTC'
): Date {
  const parsed = parseCron(expression);

  // Start from the next minute
  const next = new Date(after);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Try up to 4 years worth of minutes (to handle complex expressions)
  const maxIterations = 60 * 24 * 366 * 4;

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(next, parsed)) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error('Could not find next run time within 4 years');
}

/**
 * Check if a date matches a parsed cron expression.
 */
function matchesCron(date: Date, cron: ParsedCron): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = date.getDay();

  return (
    cron.minute.includes(minute) &&
    cron.hour.includes(hour) &&
    cron.dayOfMonth.includes(dayOfMonth) &&
    cron.month.includes(month) &&
    cron.dayOfWeek.includes(dayOfWeek)
  );
}

/**
 * Calculate the previous run time from a cron expression.
 * Note: timezone parameter is reserved for future timezone-aware implementation.
 */
export function getPreviousRunTime(
  expression: string,
  before: Date = new Date(),
  _timezone = 'UTC'
): Date | null {
  const parsed = parseCron(expression);

  // Start from the previous minute
  const prev = new Date(before);
  prev.setSeconds(0);
  prev.setMilliseconds(0);
  prev.setMinutes(prev.getMinutes() - 1);

  // Try up to 1 year back
  const maxIterations = 60 * 24 * 366;

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(prev, parsed)) {
      return prev;
    }

    prev.setMinutes(prev.getMinutes() - 1);
  }

  return null;
}

/**
 * Validate a cron expression.
 */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a human-readable description of a cron expression.
 */
export function describeCron(expression: string): string {
  const parsed = parseCron(expression);

  const parts: string[] = [];

  // Minutes
  if (parsed.minute.length === 60) {
    parts.push('every minute');
  } else if (parsed.minute.length === 1) {
    parts.push(`at minute ${parsed.minute[0]}`);
  } else {
    parts.push(`at minutes ${parsed.minute.join(', ')}`);
  }

  // Hours
  if (parsed.hour.length === 24) {
    parts.push('of every hour');
  } else if (parsed.hour.length === 1) {
    parts.push(`past hour ${parsed.hour[0]}`);
  } else {
    parts.push(`past hours ${parsed.hour.join(', ')}`);
  }

  // Days
  if (parsed.dayOfMonth.length < 31 || parsed.dayOfWeek.length < 7) {
    if (parsed.dayOfMonth.length < 31) {
      parts.push(`on day ${parsed.dayOfMonth.join(', ')} of the month`);
    }
    if (parsed.dayOfWeek.length < 7) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = parsed.dayOfWeek.map((d) => dayNames[d]);
      parts.push(`on ${days.join(', ')}`);
    }
  }

  // Months
  if (parsed.month.length < 12) {
    const monthNames = [
      '',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const months = parsed.month.map((m) => monthNames[m]);
    parts.push(`in ${months.join(', ')}`);
  }

  return parts.join(' ');
}
