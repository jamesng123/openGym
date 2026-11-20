import { describe, it, expect } from 'vitest'
import {
  cleanEffort, cleanStep, cleanPlan, flatten, planTotals, hrRange, hrStatus,
  startRun, tick, advance, pause, resume, extend, stop, leftOf, rowsOf, PRESETS, PRESET_KEYS, MAX_FLAT,
} from './cardio-intervals.js'

const plan = { steps: [
  { k: 'warm', sec: 60, eff: { rpe: 3 } },
  { rep: 2, steps: [{ k: 'work', sec: 30, eff: { zone: 5 } }, { k: 'rec', sec: 20 }] },
  { k: 'cool', m: 400 },
] }

describe('cleaning', () => {
  it('keeps one kind of effort and clamps it', () => {
    expect(cleanEffort({ rpe: 12 })).toEqual({ rpe: 10 })
    expect(cleanEffort({ rpe: 7.3 })).toEqual({ rpe: 7.5 })
    expect(cleanEffort({ zone: 9 })).toEqual({ zone: 5 })
    expect(cleanEffort({ lo: 160, hi: 140 })).toEqual({ lo: 140, hi: 160 })
    expect(cleanEffort({ hi: 150 })).toEqual({ lo: 150, hi: 150 })
    expect(cleanEffort({})).toBeNull()
    expect(cleanEffort(null)).toBeNull()
  })
  it('drops steps that are not steps', () => {
    expect(cleanStep({ k: 'sprint', sec: 30 })).toBeNull()
    expect(cleanStep({ k: 'work' })).toBeNull()
    expect(cleanStep({ k: 'work', sec: 1 })).toEqual({ k: 'work', sec: 5 })
    expect(cleanStep({ k: 'work', m: 1000, sec: 30 })).toEqual({ k: 'work', m: 1000 })
  })
  it('cleans repeats and drops empty ones', () => {
    expect(cleanPlan({ steps: [{ rep: 0, steps: [{ k: 'work', sec: 30 }] }, { rep: 3, steps: [] }] }))
      .toEqual({ steps: [{ rep: 1, steps: [{ k: 'work', sec: 30 }] }] })
    expect(cleanPlan({ steps: [] })).toBeNull()
    expect(cleanPlan(null)).toBeNull()
  })
})

describe('flatten', () => {
  it('unrolls repeats in order', () => {
    const f = flatten(plan)
    expect(f.map(s => s.k)).toEqual(['warm', 'work', 'rec', 'work', 'rec', 'cool'])
    expect(f[3].rep).toEqual({ i: 2, n: 2 })
    expect(f[0].rep).toBeNull()
    expect(f[5]).toMatchObject({ sec: null, m: 400, at: 2 })
  })
  it('caps a huge plan', () => {
    const big = { steps: [{ rep: 50, steps: Array(10).fill({ k: 'work', sec: 10 }) }] }
    expect(flatten(big)).toHaveLength(MAX_FLAT)
  })
  it('totals time, distance and open steps', () => {
    expect(planTotals(plan)).toEqual({ sec: 160, m: 400, open: 1 })
  })
  it('every preset is a clean plan', () => {
    for (const k of PRESET_KEYS) expect(cleanPlan(PRESETS[k])).toEqual(PRESETS[k])
  })
})

describe('heart rate', () => {
  it('turns a zone into bpm from max HR', () => {
    expect(hrRange({ zone: 2 }, 190)).toEqual({ lo: 114, hi: 133 })
    expect(hrRange({ zone: 2 }, null)).toBeNull()
    expect(hrRange({ lo: 140, hi: 150 })).toEqual({ lo: 140, hi: 150 })
    expect(hrRange({ rpe: 5 }, 190)).toBeNull()
  })
  it('says below, in or above', () => {
    const r = { lo: 140, hi: 150 }
    expect(hrStatus(130, r)).toBe('below')
    expect(hrStatus(145, r)).toBe('in')
    expect(hrStatus(151, r)).toBe('above')
    expect(hrStatus(null, r)).toBeNull()
  })
})

describe('the run', () => {
  const T = 1_000_000
  it('moves through timed steps by the clock, even after a long sleep', () => {
    const run = startRun(plan, T)
    expect(leftOf(run, T + 10_000)).toBe(50)
    const ev = tick(run, T + 125_000) // 60 + 30 + 20 = 110 s: into the second work step
    expect(ev.map(e => e.type)).toEqual(['step', 'step', 'step'])
    expect(run.i).toBe(3)
    expect(run.at).toBe(T + 110_000)
    expect(run.log.map(l => l.sec)).toEqual([60, 30, 20])
  })
  it('waits on a distance step until Done, and ends after the last', () => {
    const run = startRun(plan, T)
    tick(run, T + 500_000)
    expect(run.i).toBe(5)
    expect(run.ended).toBeNull()
    expect(leftOf(run, T + 500_000)).toBeNull()
    advance(run, T + 600_000)
    expect(run.ended).toBe('done')
    const rows = rowsOf(run)
    expect(rows).toHaveLength(6)
    expect(rows[5]).toMatchObject({ km: 0.4, ivl: { k: 'cool', n: 6 } })
  })
  it('pause stops the clock and resume carries on', () => {
    const run = startRun(plan, T)
    pause(run, T + 20_000)
    expect(leftOf(run, T + 300_000)).toBe(40)
    resume(run, T + 300_000)
    expect(leftOf(run, T + 310_000)).toBe(30)
    tick(run, T + 300_000 + 40_000)
    expect(run.i).toBe(1)
  })
  it('extend adds time to the step', () => {
    const run = startRun(plan, T)
    extend(run, 30, T)
    expect(leftOf(run, T)).toBe(90)
    tick(run, T + 61_000)
    expect(run.i).toBe(0)
  })
  it('skip logs the step; a quick skip is left out of the rows', () => {
    const run = startRun(plan, T)
    advance(run, T + 2000, { skipped: true })
    expect(run.i).toBe(1)
    expect(rowsOf(run)).toHaveLength(0)
  })
  it('stop keeps what was done', () => {
    const run = startRun(plan, T)
    stop(run, T + 90_000)
    expect(run.ended).toBe('stopped')
    expect(rowsOf(run).map(r => r.min)).toEqual([1, 0.5])
  })
  it('an empty plan is already over', () => {
    expect(startRun(null, T).ended).toBe('done')
  })
})
