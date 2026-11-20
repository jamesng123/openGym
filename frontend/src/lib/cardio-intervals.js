// Interval cardio: a run, a ride or a session on the bike as a list of steps instead of sets.
// Pure and framework-free, so the rules are tested here and the editor and the player only show
// what this decides.
//
// Where it lives: on a cardio exercise in a routine, `mode: 'intervals'` and `ivl`, the plan:
//
//   ivl  { steps: [item, ...] }
//   item  a step   { k, sec | m, eff }
//         a repeat { rep, steps: [step, ...] }     one level deep, `rep` times in a row
//   k     'warm' | 'work' | 'rec' | 'cool'         warm-up, work, recovery, cool-down
//   sec   how long the step lasts (seconds), or
//   m     how far (metres): the step ends on Done, since the phone does not measure distance
//   eff   the target effort, optional:
//           { rpe }        1 to 10
//           { lo, hi }     a heart-rate range in bpm
//           { zone }       1 to 5, as a share of the profile's max heart rate (ZONES)
//
// Running it walks the steps in order, repeats unrolled (flatten). Each step done is logged as
// one cardio set ({ min, km?, rpe?, hr? } plus `ivl` saying which step it was), so stats,
// exports and the health hubs read an interval session like any other cardio.

export const STEP_KINDS = ['warm', 'work', 'rec', 'cool']
// Heart-rate zones as a share of max HR: [low, high).
export const ZONES = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
]
const SEC = [5, 6 * 3600]
const METRES = [10, 100000]
const REP = [1, 50]
const MAX_ITEMS = 60
// Never more steps than this once the repeats are unrolled: a mistyped 50 × 50 stays usable.
export const MAX_FLAT = 400

const int = (v, [lo, hi]) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null
}

/** A clean target effort, or null for none. */
export function cleanEffort(e) {
  if (!e || typeof e !== 'object') return null
  if (e.rpe != null) {
    const rpe = Math.round(Number(e.rpe) * 2) / 2
    return Number.isFinite(rpe) ? { rpe: Math.max(1, Math.min(10, rpe)) } : null
  }
  if (e.zone != null) {
    const zone = int(e.zone, [1, ZONES.length])
    return zone ? { zone } : null
  }
  if (e.lo != null || e.hi != null) {
    let lo = int(e.lo, [40, 230]), hi = int(e.hi, [40, 230])
    if (lo == null && hi == null) return null
    if (lo == null) lo = hi
    if (hi == null) hi = lo
    if (lo > hi) [lo, hi] = [hi, lo]
    return { lo, hi }
  }
  return null
}

/** A clean step, or null for anything that is not one. */
export function cleanStep(s) {
  if (!s || typeof s !== 'object' || !STEP_KINDS.includes(s.k)) return null
  const out = { k: s.k }
  if (s.m != null) {
    const m = int(s.m, METRES)
    if (m == null) return null
    out.m = m
  } else {
    const sec = int(s.sec, SEC)
    if (sec == null) return null
    out.sec = sec
  }
  const eff = cleanEffort(s.eff)
  if (eff) out.eff = eff
  return out
}

/** A clean plan ({ steps }), or null when nothing in it is a step. */
export function cleanPlan(plan) {
  const items = Array.isArray(plan?.steps) ? plan.steps : []
  const steps = []
  for (const it of items.slice(0, MAX_ITEMS)) {
    if (it && Array.isArray(it.steps)) {
      const inner = it.steps.map(cleanStep).filter(Boolean)
      if (!inner.length) continue
      steps.push({ rep: int(it.rep, REP) ?? 1, steps: inner })
    } else {
      const s = cleanStep(it)
      if (s) steps.push(s)
    }
  }
  return steps.length ? { steps } : null
}

/**
 * The plan unrolled into the order it runs: [{ k, sec, m, eff, at, rep }]. `sec` and `m` are null
 * when the step does not have them; `at` is the step's position in `plan.steps`; `rep` is
 * { i, n } (1-based) inside a repeat, else null.
 */
export function flatten(plan) {
  const clean = cleanPlan(plan)
  if (!clean) return []
  const out = []
  const push = (s, at, rep) => {
    if (out.length >= MAX_FLAT) return
    out.push({ k: s.k, sec: s.sec ?? null, m: s.m ?? null, eff: s.eff || null, at, rep })
  }
  clean.steps.forEach((it, at) => {
    if (!it.rep) { push(it, at, null); return }
    for (let i = 1; i <= it.rep; i++) for (const s of it.steps) push(s, at, { i, n: it.rep })
  })
  return out
}

/** { sec, m, open }: the planned total time, total distance, and how many steps end on Done. */
export function planTotals(plan) {
  let sec = 0, m = 0, open = 0
  for (const s of flatten(plan)) {
    if (s.sec != null) sec += s.sec
    else { m += s.m || 0; open++ }
  }
  return { sec, m, open }
}

/** A target as a bpm range { lo, hi } when it is about heart rate (a zone needs `maxHr`), else null. */
export function hrRange(eff, maxHr) {
  if (!eff) return null
  if (eff.lo != null) return { lo: eff.lo, hi: eff.hi }
  if (eff.zone != null) {
    const max = Number(maxHr)
    if (!(max >= 100 && max <= 240)) return null
    const [a, b] = ZONES[eff.zone - 1]
    return { lo: Math.round(max * a), hi: Math.round(max * b) }
  }
  return null
}

/** Where a live reading sits against a heart-rate target: 'below' | 'in' | 'above', or null. */
export function hrStatus(bpm, range) {
  const v = Number(bpm)
  if (!range || !Number.isFinite(v) || v <= 0) return null
  if (v < range.lo) return 'below'
  if (v > range.hi) return 'above'
  return 'in'
}

/* ---------- the run ---------- */
//
// Plain data, so it survives a reload: { steps (flatten), i, at (when step i began), paused (ms the
// clock stopped at, or null), extra (seconds added to step i), log: [row], ended }. Time is read
// from the clock, never counted, so a phone locked in a pocket wakes up where it should be.

export function startRun(plan, now = Date.now()) {
  const steps = flatten(plan)
  return { v: 1, steps, i: 0, at: now, startedAt: now, paused: null, extra: 0, log: [], ended: steps.length ? null : 'done', endedAt: steps.length ? null : now }
}

/** When step `i` ends by the clock (ms), or null for a distance step / a paused run. */
export function stepEndsAt(run) {
  const s = run?.steps?.[run.i]
  if (!s || s.sec == null || run.ended) return null
  return run.at + (s.sec + (run.extra || 0)) * 1000
}

/** Seconds left on a timed step, or null. */
export function leftOf(run, now = Date.now()) {
  const end = stepEndsAt(run)
  if (end == null) return null
  const t = run.paused ?? now
  return Math.max(0, Math.ceil((end - t) / 1000))
}

/** Seconds into the current step (paused time excluded). */
export function intoStep(run, now = Date.now()) {
  if (!run || run.ended) return 0
  return Math.max(0, Math.floor(((run.paused ?? now) - run.at) / 1000))
}

function close(run, at, { skipped = false, hr = null, rpe = null, km = null } = {}) {
  const s = run.steps[run.i]
  const sec = Math.max(0, Math.round((at - run.at) / 1000))
  run.log.push({ i: run.i, k: s.k, sec, skipped, ...(hr ? { hr } : {}), ...(rpe != null ? { rpe } : {}), ...(km != null ? { km } : {}) })
}

function next(run, at) {
  run.i += 1
  run.at = at
  run.extra = 0
  if (run.i >= run.steps.length) { run.ended = 'done'; run.endedAt = at }
}

/**
 * Moves the clock on to `now`: every timed step that ended in between is logged at its own end
 * time and the next begins there. Returns the events ({ type: 'step' | 'end', i, at }) for the
 * cues. Mutates `run`.
 */
export function tick(run, now = Date.now()) {
  const events = []
  if (!run || run.ended || run.paused != null) return events
  for (let guard = 0; guard <= run.steps.length; guard++) {
    const end = stepEndsAt(run)
    if (end == null || end > now) break
    close(run, end)
    next(run, end)
    events.push(run.ended ? { type: 'end', at: end } : { type: 'step', i: run.i, at: end })
    if (run.ended) break
  }
  return events
}

/** Done (a distance step, or ending a timed one early) or Skip: logs the step and starts the next. */
export function advance(run, now = Date.now(), opts = {}) {
  if (!run || run.ended) return run
  tick(run, now)
  if (run.ended) return run
  const at = run.paused ?? now
  if (run.paused != null) { run.paused = null }
  close(run, at, opts)
  next(run, at)
  return run
}

export function pause(run, now = Date.now()) {
  if (run && !run.ended && run.paused == null) { tick(run, now); if (!run.ended) run.paused = now }
  return run
}

export function resume(run, now = Date.now()) {
  if (run && run.paused != null) { run.at += now - run.paused; run.paused = null }
  return run
}

/** Adds seconds to the current timed step (+30 s). */
export function extend(run, sec, now = Date.now()) {
  tick(run, now)
  const s = run?.steps?.[run?.i]
  if (s && s.sec != null && !run.ended) run.extra = Math.max(-s.sec, (run.extra || 0) + Math.round(sec))
  return run
}

/** Ends the run where it is (the current step logged as far as it got). */
export function stop(run, now = Date.now()) {
  if (!run || run.ended) return run
  tick(run, now)
  if (run.ended) return run
  const at = run.paused ?? now
  if (at - run.at >= 1000) close(run, at)
  run.paused = null
  run.ended = 'stopped'
  run.endedAt = at
  return run
}

/**
 * The run's log as cardio sets for the workout: { min, km?, rpe?, hr?, ivl: { k, n } } with `n`
 * the step's 1-based place in the run. Skipped steps that lasted under 5 s are left out.
 */
export function rowsOf(run) {
  const rows = []
  for (const l of run?.log || []) {
    if (l.skipped && l.sec < 5) continue
    const step = run.steps[l.i] || {}
    const row = { min: Math.max(0.1, Math.round(l.sec / 6) / 10), done: true, ivl: { k: l.k, n: l.i + 1 } }
    const km = l.km ?? (step.m != null && !l.skipped ? step.m / 1000 : null)
    if (km != null && km > 0) row.km = Math.round(km * 1000) / 1000
    if (l.rpe != null) row.rpe = l.rpe
    if (l.hr) row.hr = l.hr
    rows.push(row)
  }
  return rows
}

/* ---------- presets ---------- */

const st = (k, sec, eff) => ({ k, sec, ...(eff ? { eff } : {}) })
export const PRESETS = {
  classic: { steps: [st('warm', 600, { rpe: 3 }), { rep: 5, steps: [st('work', 180, { rpe: 8 }), st('rec', 120, { rpe: 3 })] }, st('cool', 300, { rpe: 2 })] },
  norwegian: { steps: [st('warm', 600, { zone: 2 }), { rep: 4, steps: [st('work', 240, { zone: 5 }), st('rec', 180, { zone: 2 })] }, st('cool', 300, { zone: 1 })] },
  pyramid: { steps: [st('warm', 600, { rpe: 3 }), st('work', 60, { rpe: 8 }), st('rec', 60, { rpe: 3 }), st('work', 120, { rpe: 8 }), st('rec', 60, { rpe: 3 }), st('work', 180, { rpe: 8 }), st('rec', 90, { rpe: 3 }), st('work', 120, { rpe: 8 }), st('rec', 60, { rpe: 3 }), st('work', 60, { rpe: 9 }), st('cool', 300, { rpe: 2 })] },
  tempo: { steps: [st('warm', 600, { zone: 2 }), st('work', 1200, { zone: 3 }), st('cool', 600, { zone: 1 })] },
}
export const PRESET_KEYS = Object.keys(PRESETS)
