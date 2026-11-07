import Link from 'next/link'
import { EXAMS } from '@/lib/apply-ai/exams'
import { ReferralTracker } from '@/components/referral/referral-tracker'
import { FormleePetMark } from '@/components/brand/formlee-pet-mark'
import { HeroDemo } from '@/components/marketing/hero-demo'

const EXAM_STATUS: Record<string, { label: string; tone: 'beta' | 'demo' | 'catalog' }> = {
  JEE_MAIN: { label: 'Documentation-backed beta', tone: 'beta' },
  VITEEE: { label: 'Demonstration · docs-backed', tone: 'demo' },
  BITSAT: { label: 'Catalog entry', tone: 'catalog' },
  MET: { label: 'Catalog entry', tone: 'catalog' },
  CUET_UG: { label: 'Catalog entry', tone: 'catalog' },
}

const VAULT_FIELDS = ['Identity & contact', 'Class 10 & 12 academics', 'Saved document checklist', 'Preferences you control']

export default function LandingPage() {
  return (
    <div className='marketing-site'>
      <ReferralTracker />
      <header className='marketing-header'>
        <div className='marketing-nav-wrap'>
          <Link href='/' className='brand-lockup' aria-label='Formlee home'>
            <FormleePetMark size={38} />
            <span>formlee<span className='brand-period'>.</span></span>
          </Link>
          <nav className='marketing-nav' aria-label='Main navigation'>
            <a href='#how-it-works'>How it works</a>
            <a href='#vault'>The Vault</a>
            <a href='#exams'>Exam status</a>
            <a href='#privacy'>Privacy</a>
          </nav>
          <div className='marketing-actions'>
            <Link href='/login' className='nav-signin'>Sign in</Link>
            <Link href='/login?mode=sign-up' className='button button-small button-primary'>Get started <span aria-hidden>↗</span></Link>
          </div>
        </div>
      </header>

      <main>
        <section className='marketing-hero'>
          <div className='hero-grid-glow' aria-hidden='true' />
          <div className='marketing-container hero-content'>
            <div className='hero-copy'>
              <p className='eyebrow'><span className='eyebrow-line' /> A calmer way to get application-ready</p>
              <h1>Less retyping.<br /><em>More room</em> to focus.</h1>
              <p className='hero-lede'>Keep your exam details organized, see what is still missing, and get careful help with supported forms — with every decision left to you.</p>
              <div className='hero-actions'>
                <Link href='/login?mode=sign-up' className='button button-primary'>Create your account <span aria-hidden>↗</span></Link>
                <a href='#how-it-works' className='button button-quiet'>See how it works <span aria-hidden>↓</span></a>
              </div>
              <div className='hero-footnote'><span aria-hidden>✳</span> Start with your profile. No rank or result needed.</div>
            </div>
            <HeroDemo />
          </div>
          <div className='hero-bottom-rule' aria-hidden='true' />
        </section>

        <section className='problem-section section-light' id='how-it-works'>
          <div className='marketing-container problem-grid'>
            <div className='section-index'>01 <span>THE REPEAT WORK</span></div>
            <div className='problem-copy'>
              <p className='eyebrow eyebrow-dark'>A familiar loop</p>
              <h2>Same details.<br /><em>Another form.</em></h2>
            </div>
            <div className='problem-detail'>
              <p>Every new examination form can mean another round of names, school details, documents and preferences. Formlee gives that preparation a home, so you can spend less time hunting for what you entered last time.</p>
              <Link href='/login?mode=sign-up' className='text-link'>Make a little room <span aria-hidden>↗</span></Link>
            </div>
          </div>
          <div className='marketing-container story-divider' aria-hidden='true'><span /></div>
          <div className='marketing-container steps-grid'>
            <article className='story-step'><span className='step-number'>01</span><h3>Gather once</h3><p>Build a student profile and keep the documents you need together.</p></article>
            <article className='story-step'><span className='step-number'>02</span><h3>Get prepared</h3><p>Track applications and see which configured requirements still need your attention.</p></article>
            <article className='story-step'><span className='step-number'>03</span><h3>Review every field</h3><p>On supported pages, check the proposed matches and approve only what you want filled.</p></article>
            <article className='story-step'><span className='step-number'>04</span><h3>Submit yourself</h3><p>Formlee stops before official submission. You verify the form and take it from there.</p></article>
          </div>
        </section>

        <section className='vault-section' id='vault'>
          <div className='marketing-container vault-layout'>
            <div className='vault-copy'>
              <div className='section-index section-index-light'>02 <span>THE STUDENT INFORMATION VAULT</span></div>
              <p className='eyebrow'><span className='eyebrow-line' /> Your information, organized</p>
              <h2>A steady place<br />for <em>the details.</em></h2>
              <p>Keep your profile information and application documents together in one workspace. Review and update it when something changes; Formlee does not verify your entries or invent missing answers.</p>
              <Link href='/login?mode=sign-up' className='button button-outline'>Set up your Vault <span aria-hidden>↗</span></Link>
            </div>
            <div className='vault-card' aria-label='Illustrative Student Information Vault contents'>
              <div className='vault-card-top'><div><span className='vault-card-label'>ILLUSTRATIVE WORKSPACE</span><h3>Student Information Vault</h3></div><span className='vault-lock' aria-label='Private workspace'>⌑</span></div>
              <div className='vault-progress-row'><span>Profile sections</span><span>Add them as you go</span></div>
              <ul className='vault-fields'>
                {VAULT_FIELDS.map((field, index) => (
                  <li key={field}><span className='vault-field-icon'>{['◉', '▤', '▧', '⌁'][index]}</span><span>{field}</span><span className='vault-field-arrow' aria-hidden>↗</span></li>
                ))}
              </ul>
              <div className='vault-card-note'><span className='vault-note-dot' /> Self-entered · unverified · under your control</div>
            </div>
          </div>
        </section>

        <section className='hub-section section-light' id='application-hub'>
          <div className='marketing-container' id='exams'>
            <div className='hub-heading'>
              <div><div className='section-index section-index-dark'>03 <span>APPLICATION HUB</span></div><h2>One view of<br /><em>what’s next.</em></h2></div>
              <p>Keep track of examination applications, their configured preparation requirements and the details you still need to confirm. It is an organizer, not an eligibility decision.</p>
            </div>
            <div className='exam-board'>
              {EXAMS.map(exam => {
                const status = EXAM_STATUS[exam.id] ?? { label: 'Catalog entry', tone: 'catalog' as const }
                return (
                  <article className='exam-tile' key={exam.id}>
                    <div className='exam-tile-top'><span className='exam-index'>{exam.id === 'JEE_MAIN' ? 'A' : exam.id === 'VITEEE' ? 'B' : '·'}</span><span className={'exam-status status-' + status.tone}>{status.label}</span></div>
                    <h3>{exam.name}</h3>
                    <p>{exam.organizer}</p>
                    {exam.officialWebsite ? (
                      <a href={exam.officialWebsite} target='_blank' rel='noreferrer noopener' aria-label={`Visit official ${exam.name} website`} className='exam-link'>Official site <span aria-hidden>↗</span></a>
                    ) : <span className='exam-link'>Official site details unavailable</span>}
                  </article>
                )
              })}
            </div>
            <p className='exam-disclaimer'>JEE Main’s adapter is documentation-backed beta and has not been validated on the live portal. VITEEE is a demonstration/documentation-backed adapter, also not live-portal validated. BITSAT, MET and CUET are catalog entries; working integrations are not confirmed.</p>
          </div>
        </section>

        <section className='readiness-section'>
          <div className='marketing-container readiness-grid'>
            <div className='readiness-copy'>
              <div className='section-index section-index-light'>04 <span>READINESS CHECKER</span></div>
              <p className='eyebrow'><span className='eyebrow-line' /> Know what still needs doing</p>
              <h2>Preparation,<br />made <em>visible.</em></h2>
              <p>Formlee compares your saved profile and document checklist against the requirements configured for an examination. You get a clearer to-do list before you reach the official portal.</p>
              <Link href='/login?mode=sign-up' className='text-link text-link-blue'>See your workspace <span aria-hidden>↗</span></Link>
            </div>
            <div className='readiness-board' aria-label='Illustrative readiness checklist'>
              <div className='readiness-board-head'><span>APPLICATION PREPARATION</span><span className='readiness-notice'>CHECKLIST, NOT ELIGIBILITY</span></div>
              <div className='readiness-exam-name'><span>JEE Main · Session 1</span><span>Illustrative</span></div>
              <div className='readiness-rule'><span className='rule-check'>✓</span><span><b>Profile basics</b><small>Saved details available to review</small></span><span className='rule-state'>Ready to review</span></div>
              <div className='readiness-rule'><span className='rule-check'>✓</span><span><b>Application photograph</b><small>Document added to your workspace</small></span><span className='rule-state'>Added</span></div>
              <div className='readiness-rule rule-pending'><span className='rule-pending-mark'>·</span><span><b>Choose an examination city</b><small>This preference is still yours to decide</small></span><span className='rule-state'>Your choice</span></div>
              <div className='readiness-bottom'>Status is based on configured checklist items. Confirm current requirements with the official examination body.</div>
            </div>
          </div>
        </section>

        <section className='sidepanel-section section-light' id='side-panel'>
          <div className='marketing-container sidepanel-layout'>
            <div className='sidepanel-visual'>
              <div className='browser-frame'>
                <div className='browser-chrome'><span /><span /><span /><div>application.example / demo</div></div>
                <div className='browser-content'><span className='browser-overline'>APPLICATION FORM</span><div className='browser-line browser-line-long' /><div className='browser-input browser-input-filled'>Anaya Mehta <span>✓</span></div><div className='browser-line browser-line-short' /><div className='browser-input'>DD / MM / YYYY</div><div className='browser-line browser-line-short' /><div className='browser-input'>Choose an option</div><div className='browser-submit'>Submit application</div></div>
                <div className='browser-extension'><FormleePetMark size={26} /><span>Formlee side panel is open</span><span className='extension-blue-dot' /></div>
              </div>
              <div className='sidepanel-callout'><FormleePetMark size={38} /><p><b>Alongside your browser.</b><br />Not in control of your account.</p></div>
            </div>
            <div className='sidepanel-copy'>
              <div className='section-index section-index-dark'>05 <span>BROWSER SIDE PANEL</span></div>
              <p className='eyebrow eyebrow-dark'>Help where you need it</p>
              <h2>Stay on the page.<br /><em>Stay in charge.</em></h2>
              <p>The Chrome Side Panel works beside a supported application page. It can inspect visible field labels, propose profile matches and prepare an approval list. Your browser session and portal login stay yours.</p>
              <ul className='control-list'><li>Review each proposed match</li><li>Choose which fields to approve</li><li>Check the page after filling</li><li>Submit on the official site yourself</li></ul>
              <Link href='/login?mode=sign-up' className='button button-primary'>Explore Formlee <span aria-hidden>↗</span></Link>
            </div>
          </div>
        </section>

        <section className='pet-section'>
          <div className='marketing-container pet-layout'>
            <div className='pet-orbit' aria-hidden='true'><span className='orbit orbit-one' /><span className='orbit orbit-two' /><div className='pet-mark-large'><FormleePetMark size={126} /></div><span className='pet-spark spark-one'>✳</span><span className='pet-spark spark-two'>·</span><span className='pet-spark spark-three'>✦</span></div>
            <div className='pet-copy'>
              <div className='section-index section-index-light'>06 <span>MEET YOUR GUIDE</span></div>
              <p className='eyebrow'><span className='eyebrow-line' /> A small companion, useful when needed</p>
              <h2>Formlee Pet<br /><em>keeps it human.</em></h2>
              <p>A gentle guide for real workflow states — ready, reviewing, waiting for your approval or needing attention. Formlee Pet never pretends that work happened when it did not.</p>
              <div className='pet-states'><span>Ready</span><span>Review</span><span>Waiting for you</span></div>
            </div>
          </div>
        </section>

        <section className='privacy-section section-light' id='privacy'>
          <div className='marketing-container privacy-layout'>
            <div className='privacy-heading'><div className='section-index section-index-dark'>07 <span>PRIVACY & CONTROL</span></div><h2>Your application.<br /><em>Your call.</em></h2></div>
            <div className='privacy-detail'>
              <p>Formlee helps prepare and review. It does not bypass examination-portal security or take over consequential actions.</p>
              <div className='manual-grid'><span>CAPTCHA</span><span>OTP</span><span>Payments</span><span>Declarations</span><span>Final submission</span></div>
              <p className='manual-note'>These steps stay manual. You decide what to save, review every proposed field and complete the official application yourself.</p>
            </div>
          </div>
        </section>

        <section className='closing-section'>
          <div className='marketing-container closing-inner'>
            <FormleePetMark size={54} />
            <p className='eyebrow'><span className='eyebrow-line' /> Start with what you have</p>
            <h2>Get your details<br /><em>in one place.</em></h2>
            <p>Build your profile at your pace. No result, rank or exam registration required.</p>
            <div className='closing-actions'><Link href='/login?mode=sign-up' className='button button-primary'>Create your account <span aria-hidden>↗</span></Link><Link href='/login' className='button button-quiet'>Sign in</Link></div>
          </div>
        </section>
      </main>

      <footer className='marketing-footer'>
        <div className='marketing-container footer-main'><Link href='/' className='brand-lockup'><FormleePetMark size={34} /><span>formlee<span className='brand-period'>.</span></span></Link><p>Application preparation with a little more breathing room.</p><nav aria-label='Footer navigation'><a href='#how-it-works'>How it works</a><a href='#exams'>Exam status</a><a href='#privacy'>Privacy</a><Link href='/login'>Sign in</Link></nav></div>
        <div className='marketing-container footer-disclaimer'>Formlee is an independent preparation tool and is not affiliated with NTA or any examination body. Support status varies by examination. Always confirm requirements and submit through official portals.</div>
      </footer>
    </div>
  )
}
