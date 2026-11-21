// The words of an interval plan (lib/cardio-intervals.js): what each step is called, its target,
// the plan's one line and what the player says out loud. Kept apart so the engine stays free of
// i18n, and free of imports so history.js can use it without a cycle.
import { t } from './i18n-core.js'
import { planTotals, cleanPlan, hrRange } from './cardio-intervals.js'

/** A clock face: 0:20, 3:00, 1:05:00. */
export function fmtClock(sec) {
  const n = Math.max(0, Math.round(Number(sec)) || 0)
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const fmtM = m => (m >= 1000 ? `${Math.round(m / 10) / 100} km` : `${m} m`)

export const KIND_NAME = { warm: 'Warm-up', work: 'Work', rec: 'Recovery', cool: 'Cool-down' }
export const kindName = k => t(KIND_NAME[k] || 'Work')

/** "RPE 8", "Zone 4 (152-171 bpm)", "140-150 bpm", or '' for no target. */
export function effortText(eff, maxHr) {
  if (!eff) return ''
  if (eff.rpe != null) return t('RPE {0}', String(eff.rpe))
  if (eff.zone != null) {
    const r = hrRange(eff, maxHr)
    return r ? `${t('Zone {0}', eff.zone)} (${r.lo}-${r.hi} bpm)` : t('Zone {0}', eff.zone)
  }
  if (eff.lo != null) return eff.lo === eff.hi ? `${eff.lo} bpm` : `${eff.lo}-${eff.hi} bpm`
  return ''
}

/** How long or how far: "3:00", "400 m". */
export const stepSize = s => (s?.m != null ? fmtM(s.m) : fmtClock(s?.sec))

/** A speed in the profile's unit: "12 km/h", "7.5 mph". */
const fmtSpd = (kmh, unit) => (unit === 'mph' ? `${Math.round(kmh / 1.609344 * 10) / 10} mph` : `${Math.round(kmh * 10) / 10} km/h`)

/** "4:30 /km": the pace a speed runs at (per mile in mph). */
export function paceOf(kmh, unit) {
  const v = unit === 'mph' ? kmh / 1.609344 : kmh
  if (!(v > 0)) return ''
  const sec = Math.round(3600 / v)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /${unit === 'mph' ? 'mi' : 'km'}`
}

/** The machine's settings for a step: "12 km/h (5:00 /km) · 2% incline", "Level 8", or ''. */
export function machineText(s, unit, { pace = false } = {}) {
  if (!s) return ''
  const parts = []
  if (s.speed > 0) parts.push(fmtSpd(s.speed, unit) + (pace ? ` (${paceOf(s.speed, unit)})` : ''))
  if (s.incline > 0) parts.push(t('{0}% incline', String(s.incline)))
  if (s.level > 0) parts.push(t('Level {0}', String(s.level)))
  return parts.join(' · ')
}

/** "Work · 3:00 · RPE 8 · 12 km/h · 2% incline" */
export function stepLine(s, maxHr, unit) {
  return [kindName(s.k), stepSize(s), effortText(s.eff, maxHr), machineText(s, unit)].filter(Boolean).join(' · ')
}

/** The plan in one line, for the routine: "Intervals · 32:00 · 6 steps", "Intervals · 20:00 + 2 km". */
export function intervalsLine(plan) {
  if (!cleanPlan(plan)) return t('Intervals')
  const { sec, m } = planTotals(plan)
  const size = [sec ? fmtClock(sec) : '', m ? fmtM(m) : ''].filter(Boolean).join(' + ')
  return [t('Intervals'), size].filter(Boolean).join(' · ')
}

/** What the player says when a step begins: "Work. 3 minutes. RPE 8." */
export function cueText(s, maxHr, unit) {
  if (!s) return ''
  const size = s.m != null ? fmtM(s.m)
    : s.sec % 60 === 0 ? t('{0} min', s.sec / 60) : t('{0} seconds', s.sec)
  return [kindName(s.k), size, effortText(s.eff ? (s.eff.zone ? { zone: s.eff.zone } : s.eff) : null, maxHr), machineText(s, unit)].filter(Boolean).join('. ') + '.'
}

export const PRESET_NAME = { classic: '5 × 3 min', norwegian: '4 × 4 min', pyramid: 'Pyramid', hills: 'Hills', tempo: 'Tempo' }
