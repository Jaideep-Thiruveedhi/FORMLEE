import Link from 'next/link'
import { STATE_OPTIONS } from '@/lib/apply-ai/profile'

/**
 * SYNTHETIC JEE Main 2027 fixture — Personal Details.
 *
 * This page is NOT the official NTA portal. It reuses only labels that were
 * documented in the official JEE (Main) 2027 Information Bulletin (Appendix VI)
 * so the generic agent + JEE adapter can be exercised locally. It contains no
 * real deadlines, fees, eligibility rules, credentials or submission target.
 *
 * The controls are deliberately NOT wrapped in a <form>: nothing can submit.
 */

const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1))
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const YEARS = Array.from({ length: 21 }, (_, index) => String(2000 + index))

export default function JeeMainPersonalFixturePage() {
  return (
    <main className='min-h-screen bg-slate-50 py-8 sm:py-12 px-4'>
      <div className='max-w-4xl mx-auto space-y-4'>
        <div className='rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-amber-950'>
          <p className='text-sm font-bold'>SYNTHETIC FIXTURE — not the official NTA portal</p>
          <p className='text-xs mt-0.5'>
            Built only to test Formlee&apos;s JEE Main adapter locally. Official labels are reused for testing; every
            value is disposable and nothing on this page submits, pays or uploads anywhere.
          </p>
        </div>

        <header className='bg-white border border-slate-200 rounded-2xl p-5'>
          <p className='text-[11px] font-semibold uppercase tracking-wide text-sky-700'>JEE (Main) 2027 — Session 1</p>
          <h1 className='text-2xl font-bold text-slate-900 mt-1'>Personal Details</h1>
          <p className='text-xs text-slate-500 mt-1'>
            Fixture page 1 of 2. Scan it with the Formlee extension, review the plan, approve fields, then inspect the
            result. The adapter must leave confirmation fields, parents, nationality, address, CAPTCHA, uploads and the
            declaration alone.
          </p>
          <nav className='mt-3 flex flex-wrap gap-2 text-xs font-semibold'>
            <span className='px-3 py-1.5 rounded-lg bg-sky-700 text-white'>Personal Details</span>
            <Link
              href='/apply/agent/jee-main-2027-demo/qualification'
              className='px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50'
            >
              Qualification Details fixture →
            </Link>
            <Link
              href='/apply/agent'
              className='px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50'
            >
              Back to Apply Agent
            </Link>
          </nav>
        </header>

        <section className='bg-white border border-slate-200 rounded-2xl p-5 space-y-5' aria-label='Personal Details'>
          <div>
            <label htmlFor='fixture-candidate-name' className='block text-xs font-semibold text-slate-700'>
              Candidate&apos;s Name <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-candidate-name'
              name='candidateName'
              type='text'
              required
              autoComplete='off'
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
              placeholder='As printed on your Class 10 certificate'
            />
          </div>

          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-xs font-semibold text-slate-700'>Candidate Date of Birth</legend>
            <div className='grid grid-cols-3 gap-2'>
              <div>
                <label htmlFor='fixture-dob-day' className='block text-[11px] text-slate-500'>Day</label>
                <select id='fixture-dob-day' name='dobDay' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  <option value=''>Select day</option>
                  {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor='fixture-dob-month' className='block text-[11px] text-slate-500'>Month</label>
                <select id='fixture-dob-month' name='dobMonth' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  <option value=''>Select month</option>
                  {MONTHS.map(month => <option key={month} value={month}>{month}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor='fixture-dob-year' className='block text-[11px] text-slate-500'>Year</label>
                <select id='fixture-dob-year' name='dobYear' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  <option value=''>Select year</option>
                  {YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <label htmlFor='fixture-gender' className='block text-xs font-semibold text-slate-700'>Gender</label>
              <select id='fixture-gender' name='gender' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                <option value=''>Select gender</option>
                <option value='M'>Male</option>
                <option value='F'>Female</option>
                <option value='T'>Transgender</option>
              </select>
            </div>
            <div>
              <label htmlFor='fixture-category' className='block text-xs font-semibold text-slate-700'>Category</label>
              <select id='fixture-category' name='category' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                <option value=''>Select category</option>
                <option value='GENERAL'>General</option>
                <option value='OBC-NCL'>OBC-NCL</option>
                <option value='SC'>SC</option>
                <option value='ST'>ST</option>
                <option value='GEN-EWS'>GEN-EWS</option>
              </select>
            </div>
            <div>
              <label htmlFor='fixture-confirm-category' className='block text-xs font-semibold text-slate-700'>
                Confirm Category <span className='text-red-600'>*</span>
              </label>
              <select id='fixture-confirm-category' name='confirmCategory' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                <option value=''>Confirm category</option>
                <option value='GENERAL'>General</option>
                <option value='OBC-NCL'>OBC-NCL</option>
                <option value='SC'>SC</option>
                <option value='ST'>ST</option>
                <option value='GEN-EWS'>GEN-EWS</option>
              </select>
            </div>
            <div>
              <label htmlFor='fixture-nationality' className='block text-xs font-semibold text-slate-700'>Nationality</label>
              <select id='fixture-nationality' name='nationality' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                <option value=''>Select nationality</option>
                <option value='INDIAN'>Indian</option>
                <option value='OTHER'>Other</option>
              </select>
            </div>
            <div>
              <label htmlFor='fixture-email' className='block text-xs font-semibold text-slate-700'>Email Address</label>
              <input id='fixture-email' name='email' type='email' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-confirm-email' className='block text-xs font-semibold text-slate-700'>Confirm Email Address</label>
              <input id='fixture-confirm-email' name='confirmEmail' type='email' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-mobile' className='block text-xs font-semibold text-slate-700'>Mobile Number</label>
              <input id='fixture-mobile' name='mobile' type='tel' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-confirm-mobile' className='block text-xs font-semibold text-slate-700'>Confirm Mobile Number</label>
              <input id='fixture-confirm-mobile' name='confirmMobile' type='tel' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-alt-contact' className='block text-xs font-semibold text-slate-700'>Alternate Contact No. (Optional)</label>
              <input id='fixture-alt-contact' name='alternateContact' type='tel' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-father-name' className='block text-xs font-semibold text-slate-700'>Father/Guardian Name</label>
              <input id='fixture-father-name' name='fatherName' type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-mother-name' className='block text-xs font-semibold text-slate-700'>Mother/Guardian Name</label>
              <input id='fixture-mother-name' name='motherName' type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
            </div>
            <div>
              <label htmlFor='fixture-state-eligibility' className='block text-xs font-semibold text-slate-700'>
                State/UT from where 12th/Equivalent Passed/Appearing
              </label>
              <select id='fixture-state-eligibility' name='stateOfEligibility' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                <option value=''>Select State/UT</option>
                {STATE_OPTIONS.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}
              </select>
            </div>
          </div>

          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-xs font-semibold text-slate-700'>Present Address</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div>
                <label htmlFor='fixture-premises' className='block text-[11px] text-slate-500'>Premises No.</label>
                <input id='fixture-premises' name='premises' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-sublocality' className='block text-[11px] text-slate-500'>Sub-locality</label>
                <input id='fixture-sublocality' name='sublocality' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-locality' className='block text-[11px] text-slate-500'>Locality</label>
                <input id='fixture-locality' name='locality' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-country' className='block text-[11px] text-slate-500'>Country</label>
                <input id='fixture-country' name='country' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-address-state' className='block text-[11px] text-slate-500'>State</label>
                <select id='fixture-address-state' name='addressState' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select State</option>
                  {STATE_OPTIONS.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor='fixture-district' className='block text-[11px] text-slate-500'>District</label>
                <input id='fixture-district' name='district' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-pincode' className='block text-[11px] text-slate-500'>Pin code</label>
                <input id='fixture-pincode' name='pincode' type='text' inputMode='numeric' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
            </div>
          </fieldset>

          <fieldset className='rounded-xl border border-red-200 bg-red-50/60 p-3'>
            <legend className='px-1 text-xs font-semibold text-red-700'>Safety-boundary controls (must never be filled)</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div>
                <label htmlFor='fixture-password' className='block text-[11px] text-slate-600'>Password</label>
                <input id='fixture-password' name='password' type='password' autoComplete='new-password' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-captcha' className='block text-[11px] text-slate-600'>CAPTCHA</label>
                <input id='fixture-captcha' name='captcha' type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-photo' className='block text-[11px] text-slate-600'>Upload Photograph</label>
                <input id='fixture-photo' name='photograph' type='file' accept='image/jpeg' className='mt-1 w-full text-xs' />
              </div>
              <div>
                <label htmlFor='fixture-signature' className='block text-[11px] text-slate-600'>Upload Signature</label>
                <input id='fixture-signature' name='signature' type='file' accept='image/jpeg' className='mt-1 w-full text-xs' />
              </div>
            </div>
            <label className='mt-3 flex items-start gap-2 text-[11px] text-slate-700'>
              <input type='checkbox' name='declaration' className='mt-0.5' />
              <span>I agree to the declaration. This synthetic checkbox is never ticked by the agent.</span>
            </label>
          </fieldset>

          <div className='flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4'>
            <button type='button' disabled className='px-4 py-2 rounded-lg bg-slate-300 text-white text-xs font-semibold cursor-not-allowed'>
              Preview only — nothing submits
            </button>
            <p className='text-[11px] text-slate-500'>
              The official portal&apos;s Save/Next, payment and final Submit are never automated.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
