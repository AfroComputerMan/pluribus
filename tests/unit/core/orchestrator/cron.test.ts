import { describe, expect, it } from 'bun:test';
import {
  describeCron,
  getNextRunTime,
  getPreviousRunTime,
  isValidCron,
  parseCron,
} from '@/core/orchestrator/cron';

describe('Cron Parser', () => {
  describe('parseCron', () => {
    it('should parse simple cron expression with asterisks', () => {
      const result = parseCron('* * * * *');

      expect(result.minute).toHaveLength(60);
      expect(result.hour).toHaveLength(24);
      expect(result.dayOfMonth).toHaveLength(31);
      expect(result.month).toHaveLength(12);
      expect(result.dayOfWeek).toHaveLength(7);
    });

    it('should parse specific values', () => {
      const result = parseCron('30 9 15 6 3');

      expect(result.minute).toEqual([30]);
      expect(result.hour).toEqual([9]);
      expect(result.dayOfMonth).toEqual([15]);
      expect(result.month).toEqual([6]);
      expect(result.dayOfWeek).toEqual([3]);
    });

    it('should parse ranges', () => {
      const result = parseCron('0-5 9-17 1-15 1-6 1-5');

      expect(result.minute).toEqual([0, 1, 2, 3, 4, 5]);
      expect(result.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
      expect(result.dayOfMonth).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(result.month).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse step values', () => {
      const result = parseCron('*/15 */2 */5 */3 */2');

      expect(result.minute).toEqual([0, 15, 30, 45]);
      expect(result.hour).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
      expect(result.dayOfMonth).toEqual([1, 6, 11, 16, 21, 26, 31]);
      expect(result.month).toEqual([1, 4, 7, 10]);
      expect(result.dayOfWeek).toEqual([0, 2, 4, 6]);
    });

    it('should parse range with step', () => {
      const result = parseCron('0-30/10 * * * *');

      expect(result.minute).toEqual([0, 10, 20, 30]);
    });

    it('should parse comma-separated values', () => {
      const result = parseCron('0,15,30,45 9,12,18 * * *');

      expect(result.minute).toEqual([0, 15, 30, 45]);
      expect(result.hour).toEqual([9, 12, 18]);
    });

    it('should parse mixed expressions', () => {
      const result = parseCron('0,30 9-17 1,15 */2 1-5');

      expect(result.minute).toEqual([0, 30]);
      expect(result.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
      expect(result.dayOfMonth).toEqual([1, 15]);
      expect(result.month).toEqual([1, 3, 5, 7, 9, 11]);
      expect(result.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('should throw for invalid part count', () => {
      expect(() => parseCron('* * *')).toThrow('expected 5 parts');
      expect(() => parseCron('* * * * * *')).toThrow('expected 5 parts');
    });

    it('should throw for invalid values', () => {
      expect(() => parseCron('60 * * * *')).toThrow('Invalid value');
      expect(() => parseCron('* 24 * * *')).toThrow('Invalid value');
      expect(() => parseCron('* * 32 * *')).toThrow('Invalid value');
      expect(() => parseCron('* * * 13 *')).toThrow('Invalid value');
      expect(() => parseCron('* * * * 7')).toThrow('Invalid value');
    });

    it('should throw for invalid ranges', () => {
      expect(() => parseCron('10-5 * * * *')).toThrow('Range out of bounds');
      expect(() => parseCron('* * 0-31 * *')).toThrow('Range out of bounds');
    });

    it('should throw for invalid step values', () => {
      expect(() => parseCron('*/0 * * * *')).toThrow('Invalid step');
      expect(() => parseCron('*/abc * * * *')).toThrow('Invalid step');
    });
  });

  describe('getNextRunTime', () => {
    it('should find next minute for every-minute cron', () => {
      const after = new Date('2024-01-15T10:30:00Z');
      const next = getNextRunTime('* * * * *', after);

      expect(next.getTime()).toBe(new Date('2024-01-15T10:31:00Z').getTime());
    });

    it('should find next run for hourly cron', () => {
      const after = new Date('2024-01-15T10:30:00Z');
      const next = getNextRunTime('0 * * * *', after);

      expect(next.getTime()).toBe(new Date('2024-01-15T11:00:00Z').getTime());
    });

    it('should find next run for daily cron', () => {
      const after = new Date('2024-01-15T10:30:00Z');
      const next = getNextRunTime('0 9 * * *', after);

      expect(next.getTime()).toBe(new Date('2024-01-16T09:00:00Z').getTime());
    });

    it('should find next run for weekday cron', () => {
      // 2024-01-15 is Monday
      const after = new Date('2024-01-15T18:00:00Z');
      const next = getNextRunTime('0 9 * * 1-5', after);

      expect(next.getTime()).toBe(new Date('2024-01-16T09:00:00Z').getTime());
    });

    it('should skip to next week for weekend cron', () => {
      // 2024-01-15 is Monday, next Saturday is 2024-01-20
      const after = new Date('2024-01-15T10:00:00Z');
      const next = getNextRunTime('0 9 * * 6', after);

      expect(next.getTime()).toBe(new Date('2024-01-20T09:00:00Z').getTime());
    });

    it('should find next run for monthly cron', () => {
      const after = new Date('2024-01-20T10:00:00Z');
      const next = getNextRunTime('0 0 1 * *', after);

      expect(next.getTime()).toBe(new Date('2024-02-01T00:00:00Z').getTime());
    });

    it('should handle year rollover', () => {
      const after = new Date('2024-12-25T10:00:00Z');
      const next = getNextRunTime('0 0 1 1 *', after); // Jan 1st

      expect(next.getTime()).toBe(new Date('2025-01-01T00:00:00Z').getTime());
    });

    it('should set seconds and milliseconds to 0', () => {
      const after = new Date('2024-01-15T10:30:45.123Z');
      const next = getNextRunTime('* * * * *', after);

      expect(next.getSeconds()).toBe(0);
      expect(next.getMilliseconds()).toBe(0);
    });
  });

  describe('getPreviousRunTime', () => {
    it('should find previous minute for every-minute cron', () => {
      const before = new Date('2024-01-15T10:30:00Z');
      const prev = getPreviousRunTime('* * * * *', before);

      expect(prev?.getTime()).toBe(new Date('2024-01-15T10:29:00Z').getTime());
    });

    it('should find previous run for hourly cron', () => {
      const before = new Date('2024-01-15T10:30:00Z');
      const prev = getPreviousRunTime('0 * * * *', before);

      expect(prev?.getTime()).toBe(new Date('2024-01-15T10:00:00Z').getTime());
    });

    it('should find previous run for daily cron', () => {
      const before = new Date('2024-01-15T08:00:00Z');
      const prev = getPreviousRunTime('0 9 * * *', before);

      expect(prev?.getTime()).toBe(new Date('2024-01-14T09:00:00Z').getTime());
    });

    it('should return null if no match found within limit', () => {
      // This cron is impossible (day 31 in month 2/Feb which has max 29 days)
      // The function should still return matches for other months
      const before = new Date('2024-02-15T10:00:00Z');
      const prev = getPreviousRunTime('0 0 31 2 *', before);

      // Feb 31 doesn't exist, so no match should be found
      expect(prev).toBeNull();
    });
  });

  describe('isValidCron', () => {
    it('should return true for valid expressions', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('0 9 * * 1-5')).toBe(true);
      expect(isValidCron('*/15 * * * *')).toBe(true);
      expect(isValidCron('0,30 9-17 1,15 */2 1-5')).toBe(true);
    });

    it('should return false for invalid expressions', () => {
      expect(isValidCron('invalid')).toBe(false);
      expect(isValidCron('* * *')).toBe(false);
      expect(isValidCron('60 * * * *')).toBe(false);
      expect(isValidCron('')).toBe(false);
    });
  });

  describe('describeCron', () => {
    it('should describe every minute', () => {
      const desc = describeCron('* * * * *');
      expect(desc).toContain('every minute');
      expect(desc).toContain('every hour');
    });

    it('should describe specific minute', () => {
      const desc = describeCron('0 * * * *');
      expect(desc).toContain('at minute 0');
    });

    it('should describe specific hours', () => {
      const desc = describeCron('0 9 * * *');
      expect(desc).toContain('past hour 9');
    });

    it('should describe multiple hours', () => {
      const desc = describeCron('0 9,12,18 * * *');
      expect(desc).toContain('past hours 9, 12, 18');
    });

    it('should describe weekdays', () => {
      const desc = describeCron('0 9 * * 1-5');
      expect(desc).toContain('Mon');
      expect(desc).toContain('Fri');
    });

    it('should describe specific months', () => {
      const desc = describeCron('0 0 1 1,6,12 *');
      expect(desc).toContain('Jan');
      expect(desc).toContain('Jun');
      expect(desc).toContain('Dec');
    });
  });
});
