import Link from 'next/link'

/**
 * SYNTHETIC JEE Main 2027 fixture — Qualification Details.
 *
 * Labels mirror the official Information Bulletin (Appendix VI) only where the
 * adapter claims support. Class 10 and Class 12 controls are grouped with
 * accessible fieldsets so the adapter can distinguish them without positional
 * selectors. This page never submits, uploads or pays anywhere.
 */

const BOARDS = ['CBSE', 'ICSE', 'State Board', 'Other']
const PASSING_YEARS = Array.from({ length: 11 }, (_, index) => String(2020 + index))

function BoardField({ id, label, className = '' }: { id: string; label: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className='block text-[11px] font-medium text-slate-600'>{label}</label>
      <select id={id} name={id} className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
        <option value=''>Select board</option>
        {BOARDS.map(board => <option key={board} value={board}>{board}</option>)}
      </select>
    </div>
  )
}

function PassingYearField({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={id} className='block text-[11px] font-medium text-slate-600'>Year of Passing/Appearing</label>
      <select id={id} name={id} className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
        <option value=''>Select year</option>
        {PASSING_YEARS.map(year => <option key={year} value={year}>{year}</option>)}
      </select>
    </div>
  )
}

function RollField({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={id} className='block text-[11px] font-medium text-slate-600'>
        Registration No./Enrollment No./Roll No.
      </label>
      <input id={id} name={id} type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
    </div>
  )
}

export default function JeeMainQualificationFixturePage() {
  return (
    <main className='min-h-screen bg-slate-50 py-8 sm:py-12 px-4'>
      <div className='max-w-4xl mx-auto space-y-4'>
        <div className='rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-amber-950'>
          <p className='text-sm font-bold'>SYNTHETIC FIXTURE — not the official NTA portal</p>
          <p className='text-xs mt-0.5'>
            Qualification Details fixture for Formlee testing. Class 10 / Class 12 groups are synthetic; nothing submits.
          </p>
        </div>

        <header className='bg-white border border-slate-200 rounded-2xl p-5'>
          <p className='text-[11px] font-semibold uppercase tracking-wide text-sky-700'>JEE (Main) 2027 — Session 1</p>
          <h1 className='text-2xl font-bold text-slate-900 mt-1'>Educational Qualification Details</h1>
          <p className='text-xs text-slate-500 mt-1'>
            Fixture page 2 of 2. The adapter may propose Class 10 / Class 12 board, passing year and roll number. Every
            other qualification field stays manual.
          </p>
          <nav className='mt-3 flex flex-wrap gap-2 text-xs font-semibold'>
            <Link
              href='/apply/agent/jee-main-2027-demo'
              className='px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50'
            >
              ← Personal Details fixture
            </Link>
            <span className='px-3 py-1.5 rounded-lg bg-sky-700 text-white'>Qualification Details</span>
            <Link
              href='/apply/agent'
              className='px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50'
            >
              Back to Apply Agent
            </Link>
          </nav>
        </header>

        <section className='bg-white border border-slate-200 rounded-2xl p-5 space-y-5' aria-label='Educational Qualification Details'>
          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-sm font-semibold text-slate-800'>Class 10 or Equivalent</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              <BoardField id='fixture-class10-board' label='School Board' />
              <PassingYearField id='fixture-class10-year' />
              <RollField id='fixture-class10-roll' />
              <div>
                <label htmlFor='fixture-class10-result-mode' className='block text-[11px] font-medium text-slate-600'>Result Mode</label>
                <select id='fixture-class10-result-mode' name='class10ResultMode' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select result mode</option>
                  <option value='PERCENTAGE'>Percentage</option>
                  <option value='GRADE'>Grade</option>
                  <option value='AWAITED'>Result Awaited</option>
                </select>
              </div>
              <div className='sm:col-span-2'>
                <label htmlFor='fixture-class10-school' className='block text-[11px] font-medium text-slate-600'>School/College Name &amp; Address</label>
                <input id='fixture-class10-school' name='class10School' type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-class10-pin' className='block text-[11px] font-medium text-slate-600'>School/College Address PIN code</label>
                <input id='fixture-class10-pin' name='class10Pin' type='text' inputMode='numeric' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
            </div>
          </fieldset>

          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-sm font-semibold text-slate-800'>Class 12 or Equivalent</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              <BoardField id='fixture-class12-board' label='School Board' />
              <PassingYearField id='fixture-class12-year' />
              <RollField id='fixture-class12-roll' />
              <div>
                <label htmlFor='fixture-class12-result-mode' className='block text-[11px] font-medium text-slate-600'>Result Mode</label>
                <select id='fixture-class12-result-mode' name='class12ResultMode' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select result mode</option>
                  <option value='PERCENTAGE'>Percentage</option>
                  <option value='GRADE'>Grade</option>
                  <option value='AWAITED'>Result Awaited</option>
                </select>
              </div>
              <div className='sm:col-span-2'>
                <label htmlFor='fixture-class12-school' className='block text-[11px] font-medium text-slate-600'>School/College Name &amp; Address</label>
                <input id='fixture-class12-school' name='class12School' type='text' autoComplete='off' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
            </div>
          </fieldset>

          <fieldset className='rounded-xl border border-slate-200 p-3'>
            <legend className='px-1 text-sm font-semibold text-slate-800'>Qualifying Examination</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div>
                <label htmlFor='fixture-qualifying-exam' className='block text-[11px] font-medium text-slate-600'>Qualifying Examination</label>
                <select id='fixture-qualifying-exam' name='qualifyingExam' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select qualifying examination</option>
                  <option value='10+2'>Final examination of the 10+2 system</option>
                  <option value='OTHER'>Other equivalent examination</option>
                </select>
              </div>
              <div>
                <label htmlFor='fixture-qualifying-state' className='block text-[11px] font-medium text-slate-600'>Qualifying Examination State</label>
                <input id='fixture-qualifying-state' name='qualifyingState' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-qualifying-district' className='block text-[11px] font-medium text-slate-600'>Qualifying Examination District</label>
                <input id='fixture-qualifying-district' name='qualifyingDistrict' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-school-type' className='block text-[11px] font-medium text-slate-600'>Type of School/College</label>
                <select id='fixture-school-type' name='schoolType' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select type</option>
                  <option value='GOVT'>Government</option>
                  <option value='PRIVATE'>Private</option>
                </select>
              </div>
              <div>
                <label htmlFor='fixture-place-school' className='block text-[11px] font-medium text-slate-600'>Place of School</label>
                <input id='fixture-place-school' name='placeOfSchool' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-schooling-medium' className='block text-[11px] font-medium text-slate-600'>Medium of Schooling in Qualifying Examination</label>
                <select id='fixture-schooling-medium' name='schoolingMedium' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select medium</option>
                  <option value='ENGLISH'>English</option>
                  <option value='HINDI'>Hindi</option>
                  <option value='OTHER'>Other</option>
                </select>
              </div>
              <div>
                <label htmlFor='fixture-family-income' className='block text-[11px] font-medium text-slate-600'>Annual Family Income</label>
                <input id='fixture-family-income' name='familyIncome' type='text' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm' />
              </div>
              <div>
                <label htmlFor='fixture-preparation-mode' className='block text-[11px] font-medium text-slate-600'>Mode of Preparation</label>
                <select id='fixture-preparation-mode' name='preparationMode' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select mode</option>
                  <option value='SCHOOL'>School</option>
                  <option value='COACHING'>Coaching</option>
                  <option value='SELF'>Self-study</option>
                </select>
              </div>
              <div>
                <label htmlFor='fixture-diabetic' className='block text-[11px] font-medium text-slate-600'>Are you Diabetic</label>
                <select id='fixture-diabetic' name='diabetic' className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'>
                  <option value=''>Select</option>
                  <option value='YES'>Yes</option>
                  <option value='NO'>No</option>
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset className='rounded-xl border border-red-200 bg-red-50/60 p-3'>
            <legend className='px-1 text-xs font-semibold text-red-700'>Safety-boundary controls (must never be filled)</legend>
            <div className='space-y-3'>
              <label className='flex items-start gap-2 text-[11px] text-slate-700'>
                <input type='checkbox' name='pwdStatus' className='mt-0.5' />
                <span>PwD/PwBD Status — the student must answer this; the agent never ticks it.</span>
              </label>
              <div>
                <label htmlFor='fixture-class10-certificate' className='block text-[11px] text-slate-600'>Upload Class 10 Certificate/Marksheet</label>
                <input id='fixture-class10-certificate' name='class10Certificate' type='file' accept='application/pdf' className='mt-1 w-full text-xs' />
              </div>
              <label className='flex items-start gap-2 text-[11px] text-slate-700'>
                <input type='checkbox' name='declaration' className='mt-0.5' />
                <span>Declaration — never ticked by the agent.</span>
              </label>
            </div>
          </fieldset>

          <div className='flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4'>
            <button type='button' disabled className='px-4 py-2 rounded-lg bg-slate-300 text-white text-xs font-semibold cursor-not-allowed'>
              Preview only — nothing submits
            </button>
            <p className='text-[11px] text-slate-500'>
              Official upload limits for guidance: Class 10 certificate PDF 50–300 kB; photograph JPG/JPEG 10–200 kB;
              signature JPG/JPEG 10–100 kB.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
