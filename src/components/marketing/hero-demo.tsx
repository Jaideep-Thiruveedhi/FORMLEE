'use client'

import { useEffect, useState } from 'react'
import { FormleePetMark } from '@/components/brand/formlee-pet-mark'

const FLOW = [
  { label: 'Detect', title: 'Fields found', detail: 'Formlee reads visible labels and input types.' },
  { label: 'Recognize', title: 'Meaning matched', detail: '“Candidate name” maps to a profile field.' },
  { label: 'Prepare', title: 'Saved details located', detail: 'Only a matching saved field is proposed.' },
  { label: 'Review', title: 'Your approval comes first', detail: 'You choose which fields Formlee may fill.' },
  { label: 'Fill', title: 'Approved fields filled', detail: 'The page is checked again; you submit.' },
]

export function HeroDemo() {
  const [step, setStep] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media.matches || paused) return
    const timer = window.setInterval(() => setStep(current => (current + 1) % FLOW.length), 2500)
    return () => window.clearInterval(timer)
  }, [paused])

  return (
    <div
      className='hero-demo'
      aria-label='Illustrative Formlee workflow demonstration with fictional student details'
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false) }}
    >
      <div className='demo-topline'>
        <span><span className='demo-live-dot' /> PRODUCT PREVIEW</span>
        <span className='demo-fiction'>Illustrative · fictional student</span>
      </div>

      <div className='demo-workspace'>
        <section className='portal-window' aria-label='Illustrative examination application portal'>
          <div className='portal-toolbar'>
            <span className='portal-mark'>EXAM APPLICATION</span>
            <span className='portal-step'>PERSONAL DETAILS <b>01 / 04</b></span>
          </div>
          <div className='portal-content'>
            <div className='portal-kicker'>APPLICATION FORM · DEMO ONLY</div>
            <h2>Candidate information</h2>
            <p className='portal-instruction'>Enter details exactly as shown on your documents.</p>
            <div className='portal-fields'>
              <div className={'portal-field ' + (step >= 1 ? 'field-recognized' : '')}>
                <label>Candidate name</label>
                <div className='portal-value'>{step >= 4 ? 'Anaya Mehta' : <span className='field-placeholder'>Enter full name</span>}</div>
                <span className='field-state'>{step >= 1 ? 'Matched · Full name' : 'Waiting for scan'}</span>
              </div>
              <div className={'portal-field ' + (step >= 1 ? 'field-recognized' : '')}>
                <label>Date of birth</label>
                <div className='portal-value'>{step >= 4 ? '14 / 08 / 2007' : <span className='field-placeholder'>DD / MM / YYYY</span>}</div>
                <span className='field-state'>{step >= 1 ? 'Matched · Date of birth' : 'Waiting for scan'}</span>
              </div>
              <div className={'portal-field portal-field-short ' + (step >= 1 ? 'field-recognized' : '')}>
                <label>Class XII board</label>
                <div className='portal-value'>{step >= 4 ? 'CBSE' : <span className='field-placeholder'>Choose an option</span>}</div>
                <span className='field-state'>{step >= 1 ? 'Matched · Class 12 board' : 'Waiting for scan'}</span>
              </div>
            </div>
            <div className='portal-demo-note'>Fictional details shown for illustration only</div>
          </div>
        </section>

        <div className='demo-bridge' aria-hidden='true'>
          <span className={'bridge-node ' + (step >= 0 ? 'bridge-on' : '')} />
          <span className={'bridge-line ' + (step >= 1 ? 'bridge-on' : '')} />
          <span className={'bridge-node bridge-node-end ' + (step >= 2 ? 'bridge-on' : '')} />
          <span className='bridge-caption'>LOCAL REVIEW FLOW</span>
        </div>

        <section className='side-panel-window' aria-label='Illustrative Formlee browser side panel'>
          <div className='side-panel-head'>
            <div className='side-brand'><FormleePetMark size={33} /><div><b>Formlee</b><small>APPLICATION ASSISTANT</small></div></div>
            <span className='panel-menu' aria-hidden='true'>•••</span>
          </div>
          <div className='side-panel-body'>
            <div className='panel-site-label'><span className='panel-site-dot' /> Supported page · preview</div>
            <h3>{FLOW[step].title}</h3>
            <p className='panel-stage-copy' aria-live='polite'>{FLOW[step].detail}</p>
            <div className='panel-match-card'>
              <div className='match-topline'><span>FIELD MAPPING</span><span className='match-confidence'>REVIEWABLE</span></div>
              <div className='match-row'><span className='match-symbol'>↳</span><span>Candidate name</span><span className='match-arrow'>→</span><b>Full name</b></div>
              <div className='match-row'><span className='match-symbol'>↳</span><span>Date of birth</span><span className='match-arrow'>→</span><b>Date of birth</b></div>
              <div className='match-row'><span className='match-symbol'>↳</span><span>Class XII board</span><span className='match-arrow'>→</span><b>Class 12 board</b></div>
              <div className={'approval-row ' + (step >= 3 ? 'approval-active' : '')}>
                <span className='approval-check'>{step >= 3 ? '✓' : ''}</span>
                <span>{step >= 3 ? 'You approved 3 fields' : 'Waiting for your review'}</span>
              </div>
            </div>
            <div className='panel-fill-state'>
              <span className={'fill-state-dot ' + (step >= 4 ? 'fill-done' : '')} />
              <span>{step >= 4 ? 'Approved fields filled · verified' : 'Nothing is filled without approval'}</span>
            </div>
            <div className='panel-controls' role='group' aria-label='Choose a demonstration step'>
              {FLOW.map((item, index) => (
                <button
                  key={item.label}
                  type='button'
                  aria-label={`Show step ${index + 1}: ${item.label}`}
                  aria-pressed={step === index}
                  className={'panel-step-dot ' + (step === index ? 'panel-step-active' : '')}
                  onClick={() => { setStep(index); setPaused(true) }}
                />
              ))}
              <span className='panel-step-counter'>{String(step + 1).padStart(2, '0')} / 05</span>
            </div>
          </div>
          <div className='panel-footer'><span>Student stays in control</span><span className='panel-footer-check'>✓</span></div>
        </section>
      </div>
      <p className='hero-demo-caption'>Illustrative interface · Fictional portal and student data · No live examination portal connected</p>
    </div>
  )
}
