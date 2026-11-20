// The interval player's clock (lib/cardio-intervals.js decides, this runs it): one run at a time,
// for one cardio exercise of the workout in progress. Like the circuit player (store/useCircuit.js)
// it stops the rest and hold timers while it runs, keeps the run in localStorage so a reload comes
// back to where the clock is, and writes each finished step into the session as it happens.
//
// Heart rate: while a step runs, every live reading (lib/phone-workout.js) is added up for it, and
// the step's set gets { avg, max } when it closes. Readings the watch writes onto the set itself
// are kept as they are (writeRows only fills what the run measured).
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { useUI } from './useUI.js'
import { startRun, tick, advance, pause, resume, extend, stop, leftOf, stepEndsAt, writeRows, maxHrOf, cleanPlan } from '../lib/cardio-intervals.js'
import { cueText } from '../lib/cardio-intervals-copy.js'
import { beep, chime, vibrate, unlock } from '../lib/sound.js'
import { speak, voiceOpts } from '../lib/speech.js'
import { onLiveHeartRate, liveHeartRate } from '../lib/phone-workout.js'
import { t } from '../lib/i18n.js'

const KEY = 'gym_intervals_v1'
const TICK_MS = 250
const FRESH_MS = 1500

const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const save = run => { try { if (run) store()?.setItem(KEY, JSON.stringify(run)); else store()?.removeItem(KEY) } catch { /* not kept across a reload */ } }
const load = () => { try { const v = JSON.parse(store()?.getItem(KEY) || 'null'); return v && v.v === 1 ? v : null } catch { return null } }

const S = () => useStore.getState().S
const sound = () => !!S()?.sound
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const say = (text, opts) => { const st = S(); if (text && st?.spokenCues === true) speak(text, { ...voiceOpts(st), ...(opts || {}) }) }

let timer = null
let lastBeep = null
// Live readings per step index: { n, sum, max }.
let hrAcc = {}
let offHr = null

function listenHr() {
  if (offHr) return
  const add = r => {
    const run = useIntervals.getState().run
    if (!run || run.ended || run.paused != null || !(r?.bpm > 0)) return
    const a = hrAcc[run.i] || (hrAcc[run.i] = { n: 0, sum: 0, max: 0 })
    a.n++; a.sum += r.bpm; a.max = Math.max(a.max, r.bpm)
  }
  try { offHr = onLiveHeartRate(add) } catch { offHr = () => {} }
}

// Each new log line gets the heart rate its step collected.
function stampHr(run) {
  for (const l of run.log) {
    if (l.hr) continue
    const a = hrAcc[l.i]
    if (a && a.n) l.hr = { avg: Math.round(a.sum / a.n), max: Math.round(a.max) }
  }
}

function writeSession(run) {
  stampHr(run)
  useStore.getState().update(s => {
    const A = s.active
    if (!A || (run.wid != null && A.id !== run.wid)) return
    const e = A.entries?.[run.idx]
    if (!e || e.id !== run.exId) return
    writeRows(e, run)
    A.cur = run.idx
  })
}

function feedback(run, events, now) {
  if (!visible()) return
  const snd = sound()
  const maxHr = maxHrOf(S())
  for (const e of events) {
    if (now - e.at > FRESH_MS) continue
    if (e.type === 'step') {
      const st = run.steps[e.i]
      const hard = st?.k === 'work'
      beep(snd, hard ? 1320 : 660, 0.3); vibrate(hard ? [60, 40, 60] : 40)
      say(cueText(st, maxHr), { queue: false })
    } else if (e.type === 'end') {
      chime(snd, 'chime'); vibrate([120, 60, 120, 60, 200]); say(t('Workout complete'), { queue: false })
    }
  }
}

export const useIntervals = create((set, get) => ({
  run: null,      // the run, plus { wid, idx, exId } of the entry it belongs to
  open: false,    // the full-screen player is up
  pending: null,  // { idx } the entry the player was opened on, before Start

  /** Opens the player on entry `idx`: its running clock, or ready to start. */
  openAt(idx) {
    const A = S()?.active
    const e = A?.entries?.[idx]
    if (!e || !cleanPlan(e.target?.ivl)) return false
    const cur = get().run
    if (cur && !cur.ended && cur.wid === (A.id ?? null) && cur.idx === idx) { set({ open: true }); return true }
    set({ open: true, pending: { idx }, ...(cur?.ended ? { run: null } : {}) })
    return true
  },
  close() { set({ open: false }) },

  start() {
    const A = S()?.active
    const idx = get().pending?.idx
    const e = A?.entries?.[idx]
    if (!e) return
    unlock(sound())
    useUI.getState().stopRest?.()
    useUI.getState().stopWork?.()
    useUI.getState().stopCountIn?.()
    hrAcc = {}
    listenHr()
    const now = Date.now()
    const run = { ...startRun(e.target.ivl, now), wid: A.id ?? null, idx, exId: e.id }
    set({ run, open: true, pending: null })
    save(run)
    get().loop()
    feedback(run, [{ type: 'step', i: 0, at: now }], now)
  },

  apply(run, events, now = Date.now()) {
    const next = { ...run }
    set({ run: next })
    save(next.ended ? null : next)
    if (events.length || next.ended) writeSession(next)
    feedback(next, events, now)
    if (next.ended) { clearInterval(timer); timer = null }
  },

  tick(now = Date.now()) {
    const run = get().run
    if (!run || run.ended || run.paused != null) return
    const left = leftOf(run, now)
    const end = stepEndsAt(run)
    if (end != null && left != null && left <= 3 && left >= 1 && visible() && lastBeep !== `${end}:${left}`) {
      lastBeep = `${end}:${left}`
      beep(sound(), 880, 0.12)
    }
    const events = tick(run, now)
    if (events.length) get().apply(run, events.map(e => e.type === 'end' ? { ...e, type: 'end' } : e), now)
  },

  loop() {
    clearInterval(timer)
    timer = setInterval(() => {
      const run = get().run
      if (!run || run.ended) { clearInterval(timer); timer = null; return }
      get().tick()
    }, TICK_MS)
  },

  /** Done with this step (a distance step, or ending a timed one early). */
  done() {
    const run = get().run
    if (!run || run.ended) return
    const now = Date.now()
    unlock(sound())
    advance(run, now)
    get().apply(run, run.ended ? [{ type: 'end', at: now }] : [{ type: 'step', i: run.i, at: now }], now)
    if (!run.ended) get().loop()
  },
  skip() {
    const run = get().run
    if (!run || run.ended) return
    const now = Date.now()
    advance(run, now, { skipped: true })
    get().apply(run, run.ended ? [{ type: 'end', at: now }] : [{ type: 'step', i: run.i, at: now }], now)
    if (!run.ended) get().loop()
  },
  pause() { const run = get().run; if (run && !run.ended) { pause(run); set({ run: { ...run } }); save(run) } },
  resume() { const run = get().run; if (run && run.paused != null) { resume(run); set({ run: { ...run } }); save(run); get().loop() } },
  more(sec = 30) { const run = get().run; if (run && !run.ended) { extend(run, sec); set({ run: { ...run } }); save(run) } },
  stop() {
    const run = get().run
    if (!run || run.ended) return
    stop(run)
    get().apply(run, [], Date.now())
  },
  reset() { clearInterval(timer); timer = null; hrAcc = {}; set({ run: null, open: false, pending: null }); save(null) },
}))

/** A run left by a reload or a killed app, picked up where the clock is. */
export function restoreIntervals() {
  const run = load()
  const A = S()?.active
  if (!run || !A || (run.wid != null && A.id !== run.wid)) { if (run) save(null); return false }
  useIntervals.setState({ run })
  listenHr()
  useIntervals.getState().loop()
  useIntervals.getState().tick()
  return true
}

let wired = false
/** The workout gone (finished, discarded, another one started): its clock goes too. */
export function wireIntervals() {
  if (wired) return
  wired = true
  useStore.subscribe(s => {
    const run = useIntervals.getState().run
    if (!run) return
    const A = s.S?.active
    if (!A || (run.wid != null && A.id !== run.wid)) useIntervals.getState().reset()
  })
}

/** The live reading for the player, or null. */
export const liveBpm = () => liveHeartRate()?.bpm ?? null
