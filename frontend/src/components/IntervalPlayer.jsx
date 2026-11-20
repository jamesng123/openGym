// The interval player (lib/cardio-intervals.js, store/useIntervals.js): the whole screen for one
// cardio exercise's interval plan, on the circuit player's layout (cp-* styles). The step you are
// in, its target effort, the clock, your live heart rate against the target, what comes next, and
// Pause, Done, Skip and +30 s. It can be closed and opened again while the clock keeps running.
import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useIntervals, liveBpm } from '../store/useIntervals.js'
import { t } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { leftOf, intoStep, stepEndsAt, hrRange, hrStatus, maxHrOf, flatten, planTotals, rowsOf } from '../lib/cardio-intervals.js'
import { kindName, effortText, stepSize, stepLine, fmtClock, intervalsLine } from '../lib/cardio-intervals-copy.js'
import { onLiveHeartRate } from '../lib/phone-workout.js'
import { useWakeLock } from '../lib/wakelock.js'
import { setOverlayBack } from '../lib/back.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const nameOf = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : String(id ?? ''))
const PHASE = { warm: 'prep', work: 'work', rec: 'rest', cool: 'rest' }

function useNow(running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])
  return running ? now : Date.now()
}

function useBpm() {
  const [bpm, setBpm] = useState(() => liveBpm())
  useEffect(() => {
    const off = onLiveHeartRate(() => setBpm(liveBpm()))
    const iv = setInterval(() => setBpm(liveBpm()), 5000)
    return () => { off?.(); clearInterval(iv) }
  }, [])
  return bpm
}

function Ring({ frac, phase }) {
  const R = 46, C = 2 * Math.PI * R
  return <svg className="cp-ring" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r={R} className="cp-ring-bg" />
    {frac != null && <circle cx="50" cy="50" r={R} className={'cp-ring-fg ' + phase}
      strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, frac)))} />}
  </svg>
}

function VoiceToggle() {
  const on = useStore(s => s.S.spokenCues === true)
  return <button type="button" className="iconbtn cp-voice" aria-pressed={on} aria-label={t('Spoken cues')} title={t('Spoken cues')}
    onClick={() => useStore.getState().update(s => { s.spokenCues = !on })}>
    <Icon name="speaker" />{!on && <span className="cp-voice-off" aria-hidden="true" />}
  </button>
}

function StepList({ steps, from = 0, maxHr, cur = -1 }) {
  return <ol className="cp-stations ivl-list">{steps.slice(from).map((s, k) => {
    const i = from + k
    return <li key={i} className={'cp-st ivl-li' + (i === cur ? ' on' : '')} data-kind={s.k}>
      <span className="ivl-dot" aria-hidden="true" />
      <span className="cp-st-m"><span className="cp-st-n">{kindName(s.k)}{s.rep ? ` ${s.rep.i}/${s.rep.n}` : ''}</span>
        <span className="cp-st-s">{[stepSize(s), effortText(s.eff, maxHr)].filter(Boolean).join(' · ')}</span></span>
    </li>
  })}</ol>
}

function Ready({ S, close }) {
  const pending = useIntervals(s => s.pending)
  const e = S.active?.entries?.[pending?.idx]
  if (!e) return null
  const plan = e.target?.ivl
  const steps = flatten(plan)
  const { sec, open } = planTotals(plan)
  const maxHr = maxHrOf(S)
  const needsMax = steps.some(s => s.eff?.zone != null) && !maxHr
  return <div className="cp-body cp-ready">
    <div className="cp-top">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="cp-top-t">{nameOf(e.id)}</span>
      <VoiceToggle />
    </div>
    <h2 className="cp-ready-h">{t('Ready when you are')}</h2>
    <p className="cp-ready-s">{intervalsLine(plan)}{sec ? '' : ''}</p>
    {open > 0 && <p className="cp-ready-s">{t('Distance steps end when you tap Done.')}</p>}
    {needsMax && <p className="cp-ready-s">{t('Add your max heart rate in the exercise settings to see zones in bpm.')}</p>}
    <StepList steps={steps} maxHr={maxHr} />
    <div className="cp-ready-go">
      <Button variant="primary" icon="play" onClick={() => useIntervals.getState().start()}>{t('Start')}</Button>
    </div>
  </div>
}

function Result({ S, run, close }) {
  const rows = rowsOf(run)
  const total = rows.reduce((n, r) => n + r.min * 60, 0)
  const maxHr = maxHrOf(S)
  return <div className="cp-body cp-result">
    <div className="cp-top">
      <span />
      <span className="cp-top-t">{nameOf(run.exId)}</span>
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>
    <div className="cp-result-ico" aria-hidden="true"><Icon name="checkCircle" /></div>
    <h2 className="cp-ready-h">{run.ended === 'stopped' ? t('Stopped. What you did is saved.') : t('Done and dusted')}</h2>
    <div className="cp-score">{fmtClock(total)}</div>
    <ol className="cp-rounds">{rows.map((r, k) => {
      const s = run.steps[r.ivl.n - 1] || {}
      return <li key={k}><span>{stepLine(s, maxHr)}</span>
        <span className="cp-num">{fmtClock(r.min * 60)}{r.hr ? ` ♥ ${r.hr.avg}` : ''}</span></li>
    })}</ol>
    <p className="cp-ready-s">{t('Rate how hard each step felt on its row in the workout.')}</p>
    <Button variant="primary" onClick={() => { useIntervals.getState().reset() }}>{t('Back to the workout')}</Button>
  </div>
}

function Running({ S, run, close }) {
  const now = useNow(run.paused == null && !run.ended)
  const bpm = useBpm()
  const c = useIntervals.getState()
  const step = run.steps[run.i]
  if (!step) return null
  const maxHr = maxHrOf(S)
  const end = stepEndsAt(run)
  const left = leftOf(run, now)
  const phase = PHASE[step.k] || 'work'
  const frac = end != null && step.sec ? (end - (run.paused ?? now)) / ((step.sec + (run.extra || 0)) * 1000) : null
  const clock = end != null ? fmtClock(left) : fmtClock(intoStep(run, now))
  const range = hrRange(step.eff, maxHr)
  const status = hrStatus(bpm, range)
  const next = run.steps[run.i + 1]
  return <div className={'cp-body cp-run is-' + phase}>
    <div className="cp-top">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="chevronDown" /></button>
      <span className="cp-top-t">{t('Step {0} of {1}', run.i + 1, run.steps.length)}</span>
      <VoiceToggle />
    </div>
    <div className="cp-clock" role="timer" aria-live="off">
      <Ring frac={frac} phase={phase} />
      <div className="cp-clock-in">
        <span className="cp-word">{run.paused != null ? t('Paused') : kindName(step.k)}{step.rep ? ` ${step.rep.i}/${step.rep.n}` : ''}</span>
        <span className="cp-time cp-num">{clock}</span>
        {step.m != null && <span className="cp-cap">{stepSize(step)}</span>}
      </div>
    </div>
    <span className="vh" aria-live="polite">{stepLine(step, maxHr)}</span>
    <section className="cp-station" aria-label={kindName(step.k)}>
      <span className="cp-kicker">{t('Target')}</span>
      <h2 className="cp-name">{effortText(step.eff, maxHr) || t('Your own pace')}</h2>
      {(bpm != null || range) && <div className={'ivl-hr' + (status ? ' ' + status : '')} data-hr-status={status || ''}>
        <Icon name="heart" />
        <span className="cp-num">{bpm != null ? `${bpm} bpm` : t('No heart rate yet')}</span>
        {status && <span className="ivl-hr-s">{status === 'below' ? t('Push a little') : status === 'above' ? t('Ease off') : t('In the zone')}</span>}
      </div>}
    </section>
    {next && <div className="cp-after"><span className="cp-kicker">{t('Then')}</span><span>{stepLine(next, maxHr)}</span></div>}
    <div className="cp-ctrl">
      {run.paused != null
        ? <button type="button" className="cp-side" onClick={() => c.resume()}><Icon name="play" /><span>{t('Resume')}</span></button>
        : <button type="button" className="cp-side" onClick={() => c.pause()}><Icon name="pause" /><span>{t('Pause')}</span></button>}
      <button type="button" className="cp-main" disabled={run.paused != null} onClick={() => c.done()}>
        <Icon name="check" /><span>{t('Done')}</span></button>
      {end != null
        ? <button type="button" className="cp-side" disabled={run.paused != null} onClick={() => c.more(30)}><Icon name="plus" /><span>30 s</span></button>
        : <button type="button" className="cp-side" disabled={run.paused != null} onClick={() => c.skip()}><Icon name="skipForward" /><span>{t('Skip')}</span></button>}
    </div>
    <button type="button" className="cp-stop" onClick={() => c.stop()}>{t('Stop the clock')}</button>
  </div>
}

export default function IntervalPlayer() {
  const open = useIntervals(s => s.open)
  const run = useIntervals(s => s.run)
  const S = useStore(s => s.S)
  const close = () => useIntervals.getState().close()
  const box = useRef(null)
  const running = !!run && !run.ended && run.paused == null
  useWakeLock(open && running)
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    setOverlayBack(() => { close(); return true })
    box.current?.focus?.()
    return () => { window.removeEventListener('keydown', onKey); setOverlayBack(null) }
  }, [open])
  if (!open || !S?.active) return null
  return <div ref={box} className="cp-screen" role="dialog" aria-modal="true" aria-label={t('Interval timer')} tabIndex={-1} data-interval-player>
    {run?.ended ? <Result S={S} run={run} close={close} />
      : run ? <Running S={S} run={run} close={close} />
        : <Ready S={S} close={close} />}
  </div>
}

/** The card on a cardio exercise with an interval plan: what the plan is, and one button. */
export function IntervalCard({ entryIdx }) {
  const A = useStore(s => s.S.active)
  const run = useIntervals(s => s.run)
  const e = A?.entries?.[entryIdx]
  if (!e?.target?.ivl || A.editingWorkoutId || A.backfill) return null
  const mine = run && run.idx === entryIdx && (run.wid == null || run.wid === A.id) ? run : null
  const live = mine && !mine.ended
  const done = (e.sets || []).some(s => s.ivl && s.done)
  const sub = live ? (mine.paused != null ? t('Paused') : t('Step {0} of {1}', mine.i + 1, mine.steps.length))
    : t('Tap start and follow the cues.')
  return <div className="cc" data-interval-card>
    <Icon name="stopwatch" style={{ fontSize: 22, color: 'var(--acc-ink)', flex: 'none' }} />
    <div className="cc-m">
      <span className="cc-t">{intervalsLine(e.target.ivl)}</span>
      <span className="cc-s">{sub}</span>
    </div>
    <Button size="sm" variant={live ? 'tinted' : 'primary'} icon={live ? 'expand' : done ? 'repeat' : 'play'}
      onClick={() => useIntervals.getState().openAt(entryIdx)}>{live ? t('Open') : done ? t('Again') : t('Start')}</Button>
  </div>
}
