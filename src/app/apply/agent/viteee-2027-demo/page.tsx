import Link from 'next/link'

/**
 * SYNTHETIC VITEEE 2027 fixture — Personal Details.
 *
 * This page is NOT the official VITEEE portal. It reuses common labels from
 * VIT's published application guidance so the VITEEE adapter can be exercised
 * locally. It contains no real deadlines, fees, eligibility rules, credentials
 * or submission target.
 *
 * The controls are deliberately NOT wrapped in a <form>: nothing can submit.
 */

const DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1))
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const YEARS = Array.from({ length: 21 }, (_, index) => String(2000 + index))
const GENDERS = ['Male', 'Female', 'Other']
const CATEGORIES = ['General', 'OBC-NCL', 'SC', 'ST', 'EWS']
const NATIONALITIES = ['Indian', 'NRI', 'Foreign National', 'OCI', 'PIO']

export default function ViteeePersonalFixturePage() {
  return (
    <main className='min-h-screen bg-slate-50 py-8 sm:py-12 px-4'>
      <div className='max-w-4xl mx-auto space-y-4'>
        <div className='rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-amber-950'>
          <p className='text-sm font-bold'>SYNTHETIC FIXTURE — not the official VITEEE portal</p>
          <p className='text-xs mt-0.5'>
            Built only to test Formlee&apos;s VITEEE adapter locally. Common labels are reused for testing; every
            value is disposable and nothing on this page submits, pays or uploads anywhere.
          </p>
        </div>

        <header className='bg-white border border-slate-200 rounded-2xl p-5'>
          <p className='text-[11px] font-semibold uppercase tracking-wide text-sky-700'>VITEEE 2027</p>
          <h1 className='text-2xl font-bold text-slate-900 mt-1'>Personal Details</h1>
          <p className='text-xs text-slate-500 mt-1'>
            Fixture page for the documentation-backed VITEEE adapter. Scan it with the Formlee extension and review
            which fields are mapped, left manual, or skipped for safety.
          </p>
          <nav className='mt-3 flex flex-wrap gap-2 text-xs font-semibold'>
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
              placeholder='As per Class 10 certificate'
            />
          </div>

          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-xs font-semibold text-slate-700'>Date of Birth</legend>
            <div className='grid grid-cols-3 gap-2'>
              <div>
                <label htmlFor='fixture-dob-day' className='block text-[11px] text-slate-500'>Day</label>
                <select id='fixture-dob-day' name='dobDay' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor='fixture-dob-month' className='block text-[11px] text-slate-500'>Month</label>
                <select id='fixture-dob-month' name='dobMonth' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  {MONTHS.map(month => <option key={month} value={month}>{month}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor='fixture-dob-year' className='block text-[11px] text-slate-500'>Year</label>
                <select id='fixture-dob-year' name='dobYear' className='mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm'>
                  {YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
            </div>
          </fieldset>

          <div>
            <label htmlFor='fixture-gender' className='block text-xs font-semibold text-slate-700'>
              Gender <span className='text-red-600'>*</span>
            </label>
            <select id='fixture-gender' name='gender' required className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
              <option value=''>Select</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor='fixture-nationality' className='block text-xs font-semibold text-slate-700'>
              Nationality <span className='text-red-600'>*</span>
            </label>
            <select id='fixture-nationality' name='nationality' required className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
              <option value=''>Select</option>
              {NATIONALITIES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor='fixture-category' className='block text-xs font-semibold text-slate-700'>
              Category <span className='text-red-600'>*</span>
            </label>
            <select id='fixture-category' name='category' required className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
              <option value=''>Select</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor='fixture-email' className='block text-xs font-semibold text-slate-700'>
              Email Address <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-email'
              name='email'
              type='email'
              required
              autoComplete='off'
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>

          <div>
            <label htmlFor='fixture-mobile' className='block text-xs font-semibold text-slate-700'>
              Mobile Number <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-mobile'
              name='mobile'
              type='tel'
              required
              autoComplete='off'
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>

          <div>
            <label htmlFor='fixture-father' className='block text-xs font-semibold text-slate-700'>
              Father&apos;s Name <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-father'
              name='fatherName'
              type='text'
              required
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>
        </section>

        <section className='bg-white border border-slate-200 rounded-2xl p-5 space-y-5' aria-label='Qualification Details'>
          <h2 className='text-lg font-bold text-slate-900'>Qualification Details</h2>

          <div>
            <label htmlFor='fixture-class10-board' className='block text-xs font-semibold text-slate-700'>
              Class 10 School Board <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-class10-board'
              name='class10Board'
              type='text'
              required
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>

          <div>
            <label htmlFor='fixture-class10-year' className='block text-xs font-semibold text-slate-700'>
              Class 10 Year of Passing <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-class10-year'
              name='class10Year'
              type='number'
              required
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>

          <div>
            <label htmlFor='fixture-class12-board' className='block text-xs font-semibold text-slate-700'>
              Class 12 School Board <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-class12-board'
              name='class12Board'
              type='text'
              required
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>

          <div>
            <label htmlFor='fixture-class12-year' className='block text-xs font-semibold text-slate-700'>
              Class 12 Year of Passing / Appearing <span className='text-red-600'>*</span>
            </label>
            <input
              id='fixture-class12-year'
              name='class12Year'
              type='number'
              required
              className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
            />
          </div>
        </section>
      </div>
    </main>
  )
}
