// The interval plan of a cardio slot (lib/cardio-intervals.js), edited in the exercise's settings:
// presets to start from, then each step (warm-up, work, recovery, cool-down) with how long or how
// far it lasts and how hard, and repeat blocks around the steps that go together.
// Controlled: `plan` in, `onChange(plan)` out; the sheet saves it with the slot.
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { STEP_KINDS, PRESETS, PRESET_KEYS, maxHrOf, planTotals, flatten } from '../lib/cardio-intervals.js'
import { kindName, fmtClock, PRESET_NAME, effortText } from '../lib/cardio-intervals-copy.js'
import { Button, Segmented } from './ui.jsx'
import Stepper from './Stepper.jsx'
import { inclineFits, levelFits, INCLINE_STEP, INCLINE_MAX, LEVEL_MAX } from '../lib/incline.js'
import { toSpeed, fromSpeed } from '../lib/speed.js'
import { paceOf } from '../lib/cardio-intervals-copy.js'

const clone = p => JSON.parse(JSON.stringify(p || { steps: [] }))
const effKind = eff => (!eff ? 'none' : eff.rpe != null ? 'rpe' : eff.zone != null ? 'zone' : 'bpm')
const newEff = (kind, maxHr) => kind === 'rpe' ? { rpe: 7 } : kind === 'zone' ? { zone: 3 }
  : kind === 'bpm' ? (maxHr ? { lo: Math.round(maxHr * 0.7), hi: Math.round(maxHr * 0.8) } : { lo: 130, hi: 150 }) : null

function StepEditor({ step, onChange, onRemove, onUp, onDown, label, maxHr, machine }) {
  const set = patch => onChange({ ...step, ...patch })
  const byDist = step.m != null
  const ek = effKind(step.eff)
  return <div className="ivl-step" data-kind={step.k}>
    <div className="row between" style={{ gap: 6, marginBottom: 8 }}>
      <strong className="small">{label}</strong>
      <span className="row" style={{ gap: 4 }}>
        {onUp && <Button size="xs" variant="ghost" icon="arrowUp" aria-label={t('Move up')} title={t('Move up')} onClick={onUp} />}
        {onDown && <Button size="xs" variant="ghost" icon="arrowDown" aria-label={t('Move down')} title={t('Move down')} onClick={onDown} />}
        <Button size="xs" variant="ghost" icon="trash" aria-label={t('Remove step')} title={t('Remove step')} onClick={onRemove} />
      </span>
    </div>
    <Segmented className="seg-ivl" value={step.k} onChange={k => set({ k })}
      options={STEP_KINDS.map(k => ({ value: k, label: kindName(k) }))} />
    <div style={{ height: 8 }} />
    <Segmented className="seg-ivl" value={byDist ? 'm' : 'sec'}
      onChange={v => onChange(v === 'm' ? { k: step.k, m: 400, ...(step.eff ? { eff: step.eff } : {}) } : { k: step.k, sec: 180, ...(step.eff ? { eff: step.eff } : {}) })}
      options={[{ value: 'sec', label: t('Time') }, { value: 'm', label: t('Distance') }]} />
    <div className="row cfgrow" style={{ marginTop: 8 }}>
      {byDist
        ? <Stepper label={t('Metres')} value={step.m} step={100} min={10} decimal={false} onChange={v => set({ m: Math.max(10, Math.round(v) || 10) })} />
        : <>
          <Stepper label={t('Minutes')} value={Math.floor(step.sec / 60)} step={1} decimal={false}
            onChange={v => set({ sec: Math.max(5, Math.round(v) * 60 + (step.sec % 60)) })} />
          <Stepper label={t('Seconds')} value={step.sec % 60} step={5} max={55} decimal={false}
            onChange={v => set({ sec: Math.max(5, Math.floor(step.sec / 60) * 60 + Math.min(59, Math.round(v))) })} />
        </>}
    </div>
    {/* The machine's settings for this step (a treadmill's speed and grade, a bike's level).
        Left at 0, the step runs at the exercise's own speed, flat. */}
    {machine && (machine.speed || machine.incline || machine.level) && <>
      <div className="small dim" style={{ margin: '10px 0 6px' }}>{t('Machine settings')}</div>
      <div className="row cfgrow">
        {machine.speed && <Stepper label={machine.unit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={step.speed ? toSpeed(step.speed, machine.unit) : 0} step={0.5} max={machine.unit === 'mph' ? 25 : 40}
          onChange={v => { const { speed: _s, ...rest } = step; const kmh = fromSpeed(v, machine.unit); onChange(kmh > 0 ? { ...rest, speed: Math.round(kmh * 10) / 10 } : rest) }} />}
        {machine.incline && <Stepper label={t('Incline (%)')} value={step.incline || 0} step={INCLINE_STEP} max={INCLINE_MAX}
          onChange={v => { const { incline: _i, ...rest } = step; onChange(v > 0 ? { ...rest, incline: v } : rest) }} />}
        {machine.level && <Stepper label={t('Level')} value={step.level || 0} step={1} max={LEVEL_MAX} decimal={false}
          onChange={v => { const { level: _l, ...rest } = step; onChange(v > 0 ? { ...rest, level: Math.round(v) } : rest) }} />}
      </div>
      {machine.speed && step.speed > 0 && <div className="small dim" style={{ marginTop: 4 }}>{t('Pace {0}', paceOf(step.speed, machine.unit))}</div>}
    </>}
    <div className="small dim" style={{ margin: '10px 0 6px' }}>{t('Target effort')}</div>
    <Segmented className="seg-ivl" value={ek} onChange={k => { const eff = newEff(k, maxHr); const { eff: _e, ...rest } = step; onChange(eff ? { ...rest, eff } : rest) }}
      options={[{ value: 'none', label: t('None') }, { value: 'rpe', label: 'RPE' }, { value: 'zone', label: t('HR zone') }, { value: 'bpm', label: 'bpm' }]} />
    {ek !== 'none' && <div className="row cfgrow" style={{ marginTop: 8 }}>
      {ek === 'rpe' && <Stepper label="RPE" value={step.eff.rpe} step={0.5} min={1} max={10} onChange={v => set({ eff: { rpe: v } })} />}
      {ek === 'zone' && <Stepper label={t('HR zone')} value={step.eff.zone} step={1} min={1} max={5} decimal={false} onChange={v => set({ eff: { zone: Math.round(v) } })} />}
      {ek === 'bpm' && <>
        <Stepper label={t('From (bpm)')} value={step.eff.lo} step={1} min={40} max={230} decimal={false} onChange={v => set({ eff: { lo: v, hi: Math.max(v, step.eff.hi) } })} />
        <Stepper label={t('To (bpm)')} value={step.eff.hi} step={1} min={40} max={230} decimal={false} onChange={v => set({ eff: { lo: Math.min(v, step.eff.lo), hi: v } })} />
      </>}
    </div>}
    {ek === 'zone' && <div className="small dim" style={{ marginTop: 4 }}>{effortText(step.eff, maxHr)}</div>}
  </div>
}

export default function IntervalEditor({ plan, onChange, ex, speedUnit = 'kmh' }) {
  // Which settings a step can carry: speed on anything with a belt, wheel or flywheel, the grade
  // where there is one (lib/incline.js), the resistance where there is a knob.
  const hills = inclineFits(ex), knob = levelFits(ex)
  const machine = { speed: hills || knob, incline: hills, level: knob, unit: speedUnit }
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const maxHr = maxHrOf(S)
  const p = clone(plan)
  const items = p.steps
  const put = fn => { const next = clone(p); fn(next.steps); onChange(next) }
  const move = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]] }
  const usesZones = flatten(p).some(s => s.eff?.zone != null)
  const { sec, m } = planTotals(p)
  const n = flatten(p).length

  return <div className="ivl-ed" data-interval-editor>
    <div className="chips" style={{ marginBottom: 10 }}>
      {PRESET_KEYS.map(k => <button key={k} type="button" className="chip" onClick={() => onChange(clone(PRESETS[k]))}>{t(PRESET_NAME[k])}</button>)}
    </div>
    {items.map((it, i) => it.steps
      ? <div key={i} className="ivl-rep">
        <div className="row between" style={{ gap: 6 }}>
          <Stepper label={t('Repeat (times)')} value={it.rep} step={1} min={1} max={50} decimal={false}
            onChange={v => put(list => { list[i].rep = Math.max(1, Math.round(v) || 1) })} />
          <span className="row" style={{ gap: 4 }}>
            {i > 0 && <Button size="xs" variant="ghost" icon="arrowUp" aria-label={t('Move up')} onClick={() => put(list => move(list, i, -1))} />}
            {i < items.length - 1 && <Button size="xs" variant="ghost" icon="arrowDown" aria-label={t('Move down')} onClick={() => put(list => move(list, i, 1))} />}
            <Button size="xs" variant="ghost" icon="trash" aria-label={t('Remove repeat')} title={t('Remove repeat')} onClick={() => put(list => { list.splice(i, 1) })} />
          </span>
        </div>
        {it.steps.map((s, j) => <StepEditor key={j} step={s} maxHr={maxHr} machine={machine} label={`${i + 1}.${j + 1}`}
          onChange={ns => put(list => { list[i].steps[j] = ns })}
          onRemove={() => put(list => { list[i].steps.splice(j, 1); if (!list[i].steps.length) list.splice(i, 1) })}
          onUp={j > 0 ? () => put(list => move(list[i].steps, j, -1)) : null}
          onDown={j < it.steps.length - 1 ? () => put(list => move(list[i].steps, j, 1)) : null} />)}
        <Button size="sm" icon="plus" onClick={() => put(list => { list[i].steps.push({ k: 'rec', sec: 60 }) })}>{t('Add step')}</Button>
      </div>
      : <StepEditor key={i} step={it} maxHr={maxHr} machine={machine} label={String(i + 1)}
        onChange={ns => put(list => { list[i] = ns })}
        onRemove={() => put(list => { list.splice(i, 1) })}
        onUp={i > 0 ? () => put(list => move(list, i, -1)) : null}
        onDown={i < items.length - 1 ? () => put(list => move(list, i, 1)) : null} />)}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
      <Button size="sm" icon="plus" onClick={() => put(list => { list.push({ k: 'work', sec: 180, eff: { rpe: 7 } }) })}>{t('Add step')}</Button>
      <Button size="sm" icon="repeat" onClick={() => put(list => { list.push({ rep: 4, steps: [{ k: 'work', sec: 120, eff: { rpe: 8 } }, { k: 'rec', sec: 60, eff: { rpe: 3 } }] }) })}>{t('Add repeat')}</Button>
    </div>
    {n > 0 && <div className="small dim" data-ivl-total>{[t('{0} steps', n), sec ? fmtClock(sec) : '', m ? `${m} m` : ''].filter(Boolean).join(' · ')}</div>}
    {usesZones && <div className="row cfgrow" style={{ marginTop: 10 }}>
      <Stepper label={t('Max heart rate')} value={maxHr || 190} step={1} min={100} max={240} decimal={false}
        onChange={v => update(s => { s.maxHr = Math.round(v) })} />
    </div>}
  </div>
}
