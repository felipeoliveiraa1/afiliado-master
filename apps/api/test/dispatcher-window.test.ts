import { describe, expect, it } from 'vitest';
import { checkDispatchWindow } from '@/dispatcher/whatsapp.js';

describe('checkDispatchWindow', () => {
  it('opens during business hours', () => {
    const noon = new Date('2026-05-03T12:00:00');
    const actual = checkDispatchWindow(noon, 8, 22);
    expect(actual).toEqual({ open: true });
  });

  it('reschedules to next morning when called at midnight', () => {
    const midnight = new Date('2026-05-03T00:30:00');
    const actual = checkDispatchWindow(midnight, 8, 22);
    expect(actual.open).toBe(false);
    if (actual.open) return;
    expect(actual.nextOpenAt.getHours()).toBe(8);
    expect(actual.nextOpenAt.getDate()).toBe(midnight.getDate());
  });

  it('reschedules to tomorrow morning when called late evening', () => {
    const lateNight = new Date('2026-05-03T23:30:00');
    const actual = checkDispatchWindow(lateNight, 8, 22);
    expect(actual.open).toBe(false);
    if (actual.open) return;
    expect(actual.nextOpenAt.getHours()).toBe(8);
    expect(actual.nextOpenAt.getDate()).toBe(lateNight.getDate() + 1);
  });

  it('respects custom window edges', () => {
    const earlyMorning = new Date('2026-05-03T06:00:00');
    const actual = checkDispatchWindow(earlyMorning, 5, 23);
    expect(actual).toEqual({ open: true });
  });
});
