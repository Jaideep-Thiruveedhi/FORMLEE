import type {
  ExamDeadline,
  ExamDefinition,
  ExamId,
  ExamRequirementDefinition,
  ExamSource,
  ExamSupportStatus,
  ProfileSectionId,
} from './types'

/**
 * Examination catalog for Formlee's Application Hub.
 *
 * Two different kinds of information live here and must never be conflated:
 *
 *  1. Identity/support metadata — what an exam is, whether Formlee has an agent
 *     adapter, and what the student can do in the hub.
 *  2. Official application facts — sessions and deadlines, each carrying the
 *     official URL and the date it was verified. When no current official date
 *     exists the deadline is explicitly NOT_ANNOUNCED; an old cycle's dates are
 *     never reused as current.
 *
 * Per-exam requirements are included only where the current official
 * instructions support them. Exams without a published 2027 bulletin show an
 * explicit "not published" state instead of an invented checklist.
 */

const VERIFIED_ON = '2026-10-31'

function source(label: string, url: string, verifiedOn = VERIFIED_ON): ExamSource {
  return { label, url, verifiedOn }
}

const JEE_HOME_SOURCE = source(
  'JEE (Main) 2027 official homepage',
  'https://jeemain.nta.nic.in/'
)
const JEE_APPLICATION_SOURCE = source(
  'Online Application Form for JEE (Main) 2027 — Session 1',
  'https://jeemain.nta.nic.in/online-application-form-for-jee-main-2027-session-1/'
)
const JEE_BULLETIN_SOURCE = source(
  'JEE (Main) 2027 Information Bulletin (official PDF)',
  'https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/202610241890224107.pdf'
)
const JEE_NOTICE_SOURCE = source(
  'NTA public notice dated 24 October 2026 (official PDF)',
  'https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/20261024390682350.pdf'
)
const VIT_SOURCE = source(
  'VITEEE 2027 official website — Important Dates and Application Process',
  'https://viteee.vit.ac.in/'
)
const BITS_SOURCE = source(
  'BITS Pilani First Degree admissions — AY 2027–28 cycle notice',
  'https://bitsadmission.com/FD/FD.html'
)
const MET_SOURCE = source(
  'MAHE Admissions 2027 — Important Dates',
  'https://www.manipal.edu/admissions/important-dates'
)
const CUET_SOURCE = source(
  'CUET-UG official website — Information Bulletin',
  'https://cuet.nta.nic.in/information-bulletin/'
)

const ALL_SECTIONS: ProfileSectionId[] = [
  'personal',
  'family',
  'address',
  'class10',
  'class12',
  'category',
  'preferences',
]
const BASE_DOCS: ExamDefinition['requiredDocIds'] = ['PHOTO', 'SIGNATURE', 'CLASS10_MARKSHEET', 'CLASS12_MARKSHEET']

function notAnnouncedDeadline(
  label: string,
  sourceValue: ExamSource,
  note: string
): ExamDeadline {
  return {
    state: 'NOT_ANNOUNCED',
    date: null,
    label,
    source: sourceValue,
    needsUpdate: true,
    note,
  }
}

const JEE_REQUIREMENTS: ExamRequirementDefinition[] = [
  {
    id: 'jee-profile-personal',
    kind: 'profile-section',
    category: 'PROFILE',
    label: 'Personal information',
    detail: 'Name, date of birth, gender, category and contact details exactly as required by the application form.',
    sectionId: 'personal',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-family',
    kind: 'profile-section',
    category: 'PROFILE',
    label: 'Parent / guardian information',
    detail: 'Father/guardian and mother/guardian names and contact details, where the form asks for them. Formlee never invents family details.',
    sectionId: 'family',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-address',
    kind: 'profile-section',
    category: 'CONTACT',
    label: 'Permanent and current address',
    detail: 'Address components exactly as required by the form. The State of Eligibility for Class 12 is not the same as your home state and remains a manual choice.',
    sectionId: 'address',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-category',
    kind: 'profile-section',
    category: 'PROFILE',
    label: 'Category & certificate confirmation',
    detail: 'Your explicitly selected and confirmed category. Formlee never infers category from name, surname or location, and never claims a certificate is legally valid.',
    sectionId: 'category',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-class10',
    kind: 'profile-section',
    category: 'EDUCATION',
    label: 'Class 10 details',
    detail: 'Board, passing year, roll number and marks as printed on your Class 10 certificate.',
    sectionId: 'class10',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-class12',
    kind: 'profile-section',
    category: 'EDUCATION',
    label: 'Class 12 / qualifying examination details',
    detail: 'Board, passing year, roll number, subjects and marks as printed on your records. Formlee never decides your eligibility.',
    sectionId: 'class12',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-profile-preferences',
    kind: 'profile-section',
    category: 'PREFERENCES',
    label: 'Paper and examination-city preferences',
    detail: 'Your preferred paper(s) and cities. Availability and final allotment are decided by NTA, not by Formlee.',
    sectionId: 'preferences',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-doc-photo',
    kind: 'document',
    category: 'PHOTOGRAPH',
    label: 'Photograph',
    detail: 'JPG/JPEG, 10–200 kB, colour, 80% face with ears, white background. The portal also captures a live photograph.',
    documentType: 'PHOTO',
    documentSpec: {
      mimeTypes: ['image/jpeg', 'image/jpg', 'image/png'],
      minBytes: 10 * 1024,
      maxBytes: 200 * 1024,
      spec: 'JPG/JPEG, 10–200 kB, colour, 80% face with ears, white background.',
    },
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-doc-signature',
    kind: 'document',
    category: 'SIGNATURE',
    label: 'Signature',
    detail: 'JPG/JPEG, 10–100 kB, clearly legible.',
    documentType: 'SIGNATURE',
    documentSpec: {
      mimeTypes: ['image/jpeg', 'image/jpg', 'image/png'],
      minBytes: 10 * 1024,
      maxBytes: 100 * 1024,
      spec: 'JPG/JPEG, 10–100 kB, clearly legible.',
    },
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-doc-class10',
    kind: 'document',
    category: 'IDENTITY',
    label: 'Class 10 certificate / marksheet',
    detail: 'PDF, 50–300 kB, clearly legible.',
    documentType: 'CLASS10_MARKSHEET',
    documentSpec: {
      mimeTypes: ['application/pdf'],
      minBytes: 50 * 1024,
      maxBytes: 300 * 1024,
      spec: 'PDF, 50–300 kB, clearly legible.',
    },
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-doc-pwd',
    kind: 'document',
    category: 'IDENTITY',
    label: 'Disability / UDID certificate (if applicable)',
    detail: 'PDF, 50–300 kB, where applicable. Appears only when your profile says you intend to claim a PwD provision.',
    documentType: 'PWD_CERTIFICATE',
    conditional: 'PWD',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-manual-bulletin',
    kind: 'manual',
    category: 'VERIFICATION',
    label: 'Read the official Information Bulletin',
    detail: 'Confirm the current rules, document specifications and declaration on the official bulletin before filling.',
    manualInstruction:
      'I have read the official JEE (Main) 2027 Information Bulletin and will verify every rule on the official portal.',
    source: JEE_BULLETIN_SOURCE,
  },
  {
    id: 'jee-manual-preview',
    kind: 'manual',
    category: 'VERIFICATION',
    label: 'Review the official preview before final submission',
    detail: 'Formlee never submits. Check every field and the declaration on NTA’s confirmation page yourself.',
    manualInstruction:
      'I have reviewed my entries and the declaration on the official JEE (Main) portal. This is my own check, not a Formlee verification.',
    source: JEE_APPLICATION_SOURCE,
  },
]

const VITEEE_REQUIREMENTS: ExamRequirementDefinition[] = [
  {
    id: 'viteee-profile-personal',
    kind: 'profile-section',
    category: 'PROFILE',
    label: 'Personal and contact information',
    detail: 'Name, date of birth, gender, parent/guardian, correspondence address, email and mobile number.',
    sectionId: 'personal',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-profile-class10',
    kind: 'profile-section',
    category: 'EDUCATION',
    label: 'Class 10 information',
    detail: 'Name, register/roll number and year of passing as printed on the Class 10 mark sheet.',
    sectionId: 'class10',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-profile-class12',
    kind: 'profile-section',
    category: 'EDUCATION',
    label: 'Class 12 / HSC details',
    detail: 'Board, medium, year of passing, school details and subject preference (MPCEA / BPCEA).',
    sectionId: 'class12',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-doc-photo',
    kind: 'document',
    category: 'PHOTOGRAPH',
    label: 'Photograph',
    detail: 'A recent photograph in the format accepted by the VITEEE portal. The portal also performs photo capture/face registration.',
    documentType: 'PHOTO',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-doc-signature',
    kind: 'document',
    category: 'SIGNATURE',
    label: 'Signature',
    detail: 'A clear scanned signature in the format accepted by the VITEEE portal.',
    documentType: 'SIGNATURE',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-doc-class10',
    kind: 'document',
    category: 'IDENTITY',
    label: 'Class 10 mark sheet',
    detail: 'Scan and upload the original Class 10 mark sheet as instructed by VIT.',
    documentType: 'CLASS10_MARKSHEET',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-doc-address',
    kind: 'document',
    category: 'IDENTITY',
    label: 'Address / identity proof',
    detail: 'One of the documents accepted by VIT: Aadhaar, passport, voter ID, driving licence, ration card, domicile certificate, bank/post-office passbook or school ID with address.',
    documentType: 'ADDRESS_PROOF',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-manual-face',
    kind: 'manual',
    category: 'VERIFICATION',
    label: 'Complete the portal’s photo capture / face registration',
    detail: 'This step happens on the official VITEEE portal and cannot be completed inside Formlee.',
    manualInstruction:
      'I have completed the live photo capture / face registration step on the official VITEEE portal.',
    source: VIT_SOURCE,
  },
  {
    id: 'viteee-manual-download',
    kind: 'manual',
    category: 'VERIFICATION',
    label: 'Download and save the completed application',
    detail: 'VIT asks applicants to download and save the filled-in application for reference and correspondence.',
    manualInstruction:
      'I have downloaded and saved the completed VITEEE application from the official portal.',
    source: VIT_SOURCE,
  },
]

export const EXAMS: ExamDefinition[] = [
  {
    id: 'JEE_MAIN',
    name: 'JEE Main',
    fullName: 'Joint Entrance Examination — Main',
    organizer: 'National Testing Agency (NTA)',
    description:
      'Accepted by NITs, IIITs, GFTIs and other participating institutions for undergraduate engineering admissions.',
    icon: '🎯',
    officialWebsite: 'https://jeemain.nta.nic.in/',
    supportStatus: 'BETA',
    supportNote:
      'Documentation-backed agent for Personal Details and Qualification Details only. The live portal is login-gated and has not been verified end to end.',
    agentAdapterId: 'jee-main-2027',
    applicationSessions: [
      {
        id: 'jee-main-2027-session-1',
        label: 'Session 1 (January 2027)',
        applicationYear: 2027,
        opensOn: '2026-10-24',
        deadline: {
          state: 'ANNOUNCED',
          date: '2026-11-22',
          label: 'Application closes',
          source: JEE_NOTICE_SOURCE,
          needsUpdate: false,
          note:
            'Late-fee window 23–26 November 2026; correction window 27–29 November 2026. Confirm the exact closing time on the official portal.',
        },
      },
      {
        id: 'jee-main-2027-session-2',
        label: 'Session 2 (April 2027)',
        applicationYear: 2027,
        opensOn: null,
        deadline: notAnnouncedDeadline(
          'Application window',
          JEE_HOME_SOURCE,
          'NTA has not announced the Session 2 application window. Do not use the Session 1 deadline or an old cycle date for Session 2.'
        ),
      },
    ],
    requirementsPublished: true,
    requirementsNote:
      'Checklist backed by the JEE (Main) 2027 Information Bulletin and the Session 1 application notice. It is a preparation checklist, not an eligibility determination.',
    requirements: JEE_REQUIREMENTS,
    preferenceFields: [
      {
        id: 'paperPreference',
        label: 'Paper preference(s)',
        placeholder: 'e.g. Paper 1 (B.E./B.Tech)',
        help: 'Copy the exact option shown on the official portal. NTA decides availability.',
        maxLength: 80,
      },
      {
        id: 'examCityPreference',
        label: 'Examination city preference(s)',
        placeholder: 'e.g. Patna, Delhi, Hyderabad',
        help: 'Use the exact city names listed by NTA. Your profile cities are only a starting point.',
        maxLength: 200,
      },
    ],
    catalogVerifiedOn: VERIFIED_ON,
    requiredSections: ALL_SECTIONS,
    requiredDocIds: BASE_DOCS,
  },
  {
    id: 'BITSAT',
    name: 'BITSAT',
    fullName: 'Birla Institute of Technology and Science Admission Test',
    organizer: 'BITS Pilani',
    description: 'Admission test for first-year undergraduate programmes across BITS campuses.',
    icon: '🧪',
    officialWebsite: 'https://admissions.bits-pilani.ac.in/',
    supportStatus: 'COMING_SOON',
    supportNote:
      'Application tracking is available now. No BITSAT form-filling adapter is available, and the 2027 BITSAT bulletin has not been published.',
    applicationSessions: [
      {
        id: 'bitsat-2027',
        label: '2027 admissions (Session 1 / Session 2)',
        applicationYear: 2027,
        opensOn: null,
        deadline: notAnnouncedDeadline(
          'Application window',
          BITS_SOURCE,
          'BITS states that the AY 2027–28 First Degree admission cycle will open in December 2026 (tentatively). No 2027 application deadline is published; 2026 dates are not reused.'
        ),
      },
    ],
    requirementsPublished: false,
    requirementsNote:
      'The official BITSAT 2027 information bulletin has not been published. Formlee will not turn the 2026 bulletin into a 2027 checklist; use your reusable profile and document workspace until the official requirements are available.',
    requirements: [],
    preferenceFields: [
      {
        id: 'programmePreference',
        label: 'Programme preference(s)',
        placeholder: 'e.g. B.E. Computer Science, B.E. Mechanical',
        help: 'Copy the exact programme names from the official portal when you fill the form.',
        maxLength: 200,
      },
    ],
    catalogVerifiedOn: VERIFIED_ON,
    requiredSections: ALL_SECTIONS,
    requiredDocIds: BASE_DOCS,
  },
  {
    id: 'VITEEE',
    name: 'VITEEE',
    fullName: 'VIT Engineering Entrance Examination',
    organizer: 'VIT',
    description: 'Admission test for undergraduate engineering programmes across VIT campuses.',
    icon: '⚙️',
    officialWebsite: 'https://viteee.vit.ac.in/',
    supportStatus: 'BETA',
    supportNote:
      'Documentation-backed / demo-only adapter for Personal Details and Qualification Details. The live VITEEE portal has not been verified end to end.',
    agentAdapterId: 'viteee-2027',
    applicationSessions: [
      {
        id: 'viteee-2027',
        label: '2027 single session',
        applicationYear: 2027,
        opensOn: '2026-10-20',
        deadline: {
          state: 'TENTATIVE',
          date: '2027-03-31',
          label: 'Last date for online application',
          source: VIT_SOURCE,
          needsUpdate: false,
          note:
            'The official Important Dates list 31 March 2027; VIT’s FAQ describes the application window as tentative. The examination dates (27 April–2 May 2027) are also tentative.',
        },
      },
    ],
    requirementsPublished: true,
    requirementsNote:
      'Checklist backed by the VITEEE 2027 official application process. It is a preparation checklist, not an eligibility determination; VIT verifies eligibility separately.',
    requirements: VITEEE_REQUIREMENTS,
    preferenceFields: [
      {
        id: 'subjectPreference',
        label: 'Subject preference (MPCEA / BPCEA)',
        placeholder: 'e.g. MPCEA',
        help: 'Use the exact option shown on the official VITEEE form.',
        maxLength: 40,
      },
    ],
    catalogVerifiedOn: VERIFIED_ON,
    requiredSections: ALL_SECTIONS,
    requiredDocIds: BASE_DOCS,
  },
  {
    id: 'MET',
    name: 'MET',
    fullName: 'Manipal Entrance Test',
    organizer: 'Manipal Academy of Higher Education (MAHE)',
    description: 'Admission test for undergraduate programmes across MAHE institutions.',
    icon: '🏛️',
    officialWebsite: 'https://www.manipal.edu/',
    supportStatus: 'TRACK_ONLY',
    supportNote:
      'Track your preparation and status. No MET form-filling adapter is available, and MAHE had not exposed a verifiable 2027 deadline when this catalog was checked.',
    applicationSessions: [
      {
        id: 'met-2027-phase-1',
        label: 'Phase 1 (2027)',
        applicationYear: 2027,
        opensOn: null,
        deadline: notAnnouncedDeadline(
          'Phase 1 application window',
          MET_SOURCE,
          'MAHE’s official pages did not expose a verifiable 2027 Phase 1 deadline when checked. Secondary reports are not used as official dates.'
        ),
      },
      {
        id: 'met-2027-phase-2',
        label: 'Phase 2 (2027)',
        applicationYear: 2027,
        opensOn: null,
        deadline: notAnnouncedDeadline(
          'Phase 2 application window',
          MET_SOURCE,
          'MAHE has not published a verifiable Phase 2 application window for 2027. Do not rely on previous-year dates.'
        ),
      },
    ],
    requirementsPublished: false,
    requirementsNote:
      'A current official MET 2027 requirement list is not available on the verified MAHE page. Formlee will not invent one; keep your reusable profile and documents ready and verify the form instructions when published.',
    requirements: [],
    preferenceFields: [
      {
        id: 'programmePreference',
        label: 'Programme / campus preference(s)',
        placeholder: 'e.g. B.Tech CSE — Manipal',
        help: 'Copy the exact options available on the official application form.',
        maxLength: 200,
      },
    ],
    catalogVerifiedOn: VERIFIED_ON,
    requiredSections: ALL_SECTIONS,
    requiredDocIds: BASE_DOCS,
  },
  {
    id: 'CUET_UG',
    name: 'CUET-UG',
    fullName: 'Common University Entrance Test — Undergraduate',
    organizer: 'National Testing Agency (NTA)',
    description: 'Entrance test used by participating universities for undergraduate admissions.',
    icon: '📚',
    officialWebsite: 'https://cuet.nta.nic.in/',
    supportStatus: 'DATES_NOT_ANNOUNCED',
    supportNote:
      'Catalog and application tracking only. NTA has not published the CUET-UG 2027 information bulletin; Formlee does not reuse 2026 dates or requirements.',
    applicationSessions: [
      {
        id: 'cuet-ug-2027',
        label: '2027',
        applicationYear: 2027,
        opensOn: null,
        deadline: notAnnouncedDeadline(
          'Application window',
          CUET_SOURCE,
          'The official CUET-UG information bulletin page lists only the 2026 bulletin (last updated 12 October 2026). No 2027 application dates are published.'
        ),
      },
    ],
    requirementsPublished: false,
    requirementsNote:
      'The CUET-UG 2027 information bulletin has not been published. Formlee will not reuse the 2026 bulletin as a current requirement list.',
    requirements: [],
    preferenceFields: [
      {
        id: 'subjectCombination',
        label: 'Subjects / university programmes you plan to choose',
        placeholder: 'e.g. Physics, Chemistry, Mathematics; University A — B.Sc. Physics',
        help: 'Self-entered planning note only. The official portal’s subject and university choices are authoritative.',
        maxLength: 300,
      },
    ],
    catalogVerifiedOn: VERIFIED_ON,
    requiredSections: ALL_SECTIONS,
    requiredDocIds: BASE_DOCS,
  },
]

export const EXAM_BY_ID: Record<ExamId, ExamDefinition> = Object.fromEntries(
  EXAMS.map(exam => [exam.id, exam])
) as Record<ExamId, ExamDefinition>

export function findExamSession(examId: ExamId, sessionId: string) {
  return EXAM_BY_ID[examId].applicationSessions.find(session => session.id === sessionId) ?? null
}

export const SUPPORT_STATUS_DEFINITIONS: Record<
  ExamSupportStatus,
  { label: string; description: string }
> = {
  SUPPORTED: {
    label: 'Supported',
    description: 'Form-filling support has been validated against the current official portal.',
  },
  BETA: {
    label: 'Beta',
    description: 'Documentation-backed support; the live official portal has not been fully verified.',
  },
  DEMO_ONLY: {
    label: 'Demo only',
    description: 'Only synthetic demonstration fixtures are available; no live-portal support is claimed.',
  },
  COMING_SOON: {
    label: 'Coming soon',
    description: 'Tracking is available; form-filling support is planned but not available yet.',
  },
  TRACK_ONLY: {
    label: 'Track only',
    description: 'Track deadlines, requirements and status in Formlee; fill the form on the official portal yourself.',
  },
  APPLICATION_CLOSED: {
    label: 'Application closed',
    description: 'The official application window for this session has closed.',
  },
  DATES_NOT_ANNOUNCED: {
    label: 'Dates not announced',
    description: 'The official body has not published the current application dates.',
  },
}

export const DEADLINE_STATE_LABELS = {
  ANNOUNCED: 'Announced',
  TENTATIVE: 'Tentative',
  NOT_ANNOUNCED: 'Not announced',
} as const

/** Shown on every exam surface — dates are never inferred or reused from old cycles. */
export const OFFICIAL_SOURCE_NOTE =
  'Formlee shows a date only beside its official source and the date it was last checked. Deadlines, fees, eligibility rules and document specifications must always be confirmed on the official portal. Checklist completion never proves eligibility.'
