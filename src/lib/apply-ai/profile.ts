import type { ProfileSectionDef, ProfileSectionId } from './types'

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

export const STATE_OPTIONS = INDIAN_STATES.map(s => ({ value: s, label: s }))

export const COUNTRY_OPTIONS = [
  { value: 'India', label: 'India' },
  { value: 'Other', label: 'Other country' },
]

export const MARKS_KIND_OPTIONS = [
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'GRADE', label: 'Grade' },
  { value: 'CGPA', label: 'CGPA' },
]

export const CLASS12_STATUS_OPTIONS = [
  { value: 'APPEARING', label: 'Currently appearing in Class 12' },
  { value: 'RESULT_AWAITED', label: 'Class 12 examination completed — result awaited' },
  { value: 'PASSED', label: 'Class 12 already passed (including droppers)' },
]

export const CATEGORY_OPTIONS = [
  { value: 'GENERAL', label: 'General / UR' },
  { value: 'EWS', label: 'General-EWS' },
  { value: 'OBC_NCL', label: 'OBC-NCL' },
  { value: 'SC', label: 'SC' },
  { value: 'ST', label: 'ST' },
  { value: 'OTHER', label: 'Other (only where the examination explicitly supports it)' },
]

export const CERTIFICATE_TYPES = [
  { value: 'EWS', label: 'EWS certificate' },
  { value: 'OBC_NCL', label: 'OBC-NCL certificate' },
  { value: 'SC', label: 'SC certificate' },
  { value: 'ST', label: 'ST certificate' },
  { value: 'OTHER', label: 'Other category certificate' },
]

/**
 * Canonical Student Information Vault sections.
 *
 * Field `required` flags are general preparation hints. The authoritative
 * conditional rules live in requirements.ts (for example: Class 12 marks are
 * not required while a result is pending, and current-address fields are not
 * required when the student says both addresses are the same).
 */
export const PROFILE_SECTIONS: ProfileSectionDef[] = [
  {
    id: 'personal',
    title: 'Personal information',
    description: 'Identity and contact details reused across every examination application.',
    icon: '👤',
    fields: [
      { id: 'fullName', label: 'Full legal name', type: 'text', required: true, placeholder: 'As printed on official records' },
      { id: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
      {
        id: 'gender', label: 'Gender', type: 'select', required: false,
        help: 'Some examinations ask for it; leave empty if you are not sure yet.',
        options: [
          { value: 'MALE', label: 'Male' },
          { value: 'FEMALE', label: 'Female' },
          { value: 'TRANSGENDER', label: 'Transgender' },
        ],
      },
      { id: 'email', label: 'Email address', type: 'email', required: true, placeholder: 'you@example.com', help: 'Where examination bodies send admit cards and communications.' },
      { id: 'mobileNumber', label: 'Mobile number', type: 'tel', required: true, placeholder: 'e.g., 9876543210' },
      { id: 'nationality', label: 'Nationality', type: 'select', required: true, options: COUNTRY_OPTIONS },
      {
        id: 'nationalityOther', label: 'Nationality (please specify)', type: 'text', required: false,
        visibleWhen: { field: 'nationality', equals: ['Other'] },
      },
    ],
  },
  {
    id: 'family',
    title: 'Family / guardian information',
    description: 'Parent or guardian details. Provide the person who can be contacted about your applications.',
    icon: '👪',
    fields: [
      { id: 'fatherName', label: "Father's full name", type: 'text', required: false, placeholder: 'As printed on official records' },
      { id: 'motherName', label: "Mother's full name", type: 'text', required: false, placeholder: 'As printed on official records' },
      { id: 'guardianName', label: 'Guardian name (if applicable)', type: 'text', required: false },
      { id: 'guardianRelation', label: 'Guardian relationship', type: 'text', required: false, placeholder: 'e.g., Uncle, Aunt, Legal guardian' },
      { id: 'parentMobile', label: 'Parent / guardian mobile number', type: 'tel', required: false },
      { id: 'parentEmail', label: 'Parent / guardian email address', type: 'email', required: false },
      { id: 'parentOccupation', label: 'Parent / guardian occupation', type: 'text', required: false, help: 'Only some examinations ask for this; leave it empty if not known or not applicable.' },
    ],
  },
  {
    id: 'address',
    title: 'Permanent & current address',
    description: 'Store both addresses once. You can mark the current address as the same as your permanent address.',
    icon: '📍',
    fields: [
      { id: 'permanentAddressLine', label: 'Permanent address', type: 'address', required: true, placeholder: 'House / street / locality', wide: true },
      { id: 'permanentCity', label: 'Permanent city / town', type: 'text', required: true },
      { id: 'permanentDistrict', label: 'Permanent district', type: 'text', required: false },
      { id: 'permanentState', label: 'Permanent state', type: 'select', required: true, options: STATE_OPTIONS },
      { id: 'permanentPinCode', label: 'Permanent PIN code', type: 'text', required: true, placeholder: '6 digits' },
      { id: 'permanentCountry', label: 'Permanent country', type: 'select', required: true, options: COUNTRY_OPTIONS },
      { id: 'currentSameAsPermanent', label: 'My current address is the same as my permanent address', type: 'boolean', required: false, wide: true },
      {
        id: 'currentAddressLine', label: 'Current address', type: 'address', required: false,
        placeholder: 'House / street / locality', wide: true,
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
      {
        id: 'currentCity', label: 'Current city / town', type: 'text', required: false,
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
      {
        id: 'currentDistrict', label: 'Current district', type: 'text', required: false,
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
      {
        id: 'currentState', label: 'Current state', type: 'select', required: false, options: STATE_OPTIONS,
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
      {
        id: 'currentPinCode', label: 'Current PIN code', type: 'text', required: false, placeholder: '6 digits',
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
      {
        id: 'currentCountry', label: 'Current country', type: 'select', required: false, options: COUNTRY_OPTIONS,
        visibleWhen: { field: 'currentSameAsPermanent', equals: ['false'] },
      },
    ],
  },
  {
    id: 'class10',
    title: 'Class 10 details',
    description: 'Proof of identity and date of birth for most examinations.',
    icon: '🎓',
    fields: [
      { id: 'class10Board', label: 'Board', type: 'text', required: true, placeholder: 'e.g., CBSE, ICSE, State Board' },
      { id: 'class10SchoolName', label: 'School name', type: 'text', required: true, placeholder: 'As printed on your records' },
      { id: 'class10PassingYear', label: 'Passing year', type: 'number', required: true, placeholder: 'e.g., 2023' },
      { id: 'class10RollNumber', label: 'Roll number', type: 'text', required: false, placeholder: 'As printed on the certificate' },
      { id: 'class10MarksKind', label: 'Marks format', type: 'select', required: false, options: MARKS_KIND_OPTIONS, help: 'How your Class 10 result is recorded. Leave unchecked and enter the value raw if unsure.' },
      { id: 'class10Marks', label: 'Marks / grade', type: 'text', required: false, placeholder: 'e.g., 92.4 or A1', help: 'Enter exactly as printed — never alter or estimate.' },
      { id: 'class10Percentage', label: 'Percentage (if calculated separately)', type: 'text', required: false, placeholder: 'e.g., 92.4' },
      { id: 'class10Subjects', label: 'Class 10 subjects', type: 'subjects', required: false, subjectListKey: 'class10Subjects', subjectRequired: false, wide: true, help: 'Add the subjects you studied in Class 10. Individual marks/grades optional.' },
    ],
  },
  {
    id: 'class12',
    title: 'Class 12 details',
    description: 'Choose your current Class 12 status. Pending results never make your vault incomplete.',
    icon: '📘',
    fields: [
      { id: 'class12Status', label: 'Class 12 status', type: 'select', required: true, options: CLASS12_STATUS_OPTIONS, wide: true, help: 'Select the state that is true today. You can update it when results are declared without creating a duplicate record.' },
      { id: 'class12Board', label: 'Board', type: 'text', required: true, placeholder: 'e.g., CBSE, ICSE, State Board' },
      { id: 'class12SchoolName', label: 'School name', type: 'text', required: true, placeholder: 'As printed on your records' },
      {
        id: 'class12ExamYear', label: 'Class 12 examination year', type: 'number', required: false,
        placeholder: 'e.g., 2027',
        visibleWhen: { field: 'class12Status', equals: ['APPEARING', 'RESULT_AWAITED'] },
        help: 'The year in which you are appearing / appeared. Marks and passing details stay empty until they exist.',
      },
      {
        id: 'class12PassingYear', label: 'Passing year', type: 'number', required: false,
        placeholder: 'e.g., 2025',
        visibleWhen: { field: 'class12Status', equals: ['PASSED'] },
      },
      { id: 'class12RollNumber', label: 'Roll number', type: 'text', required: false, placeholder: 'As printed on the certificate' },
      {
        id: 'class12MarksKind', label: 'Marks format', type: 'select', required: false, options: MARKS_KIND_OPTIONS,
        visibleWhen: { field: 'class12Status', equals: ['PASSED'] },
        help: 'How your Class 12 result is recorded. Leave unchecked and enter the value raw if unsure.',
      },
      {
        id: 'class12Marks', label: 'Marks / grade', type: 'text', required: false,
        placeholder: 'e.g., 91.8 or A1',
        visibleWhen: { field: 'class12Status', equals: ['PASSED'] },
        help: 'Enter exactly as printed — never alter or estimate.',
      },
      {
        id: 'class12Percentage', label: 'Percentage (if calculated separately)', type: 'text', required: false,
        placeholder: 'e.g., 91.8',
        visibleWhen: { field: 'class12Status', equals: ['PASSED'] },
      },
      {
        id: 'class12Subjects', label: 'Class 12 subjects / stream', type: 'subjects', required: false,
        subjectListKey: 'class12Subjects', subjectRequired: false, wide: true,
        help: 'Add the subjects you study or studied. Marks are optional for appearing/result-awaited students.',
      },
    ],
  },
  {
    id: 'category',
    title: 'Category & certificates',
    description: 'Select and confirm your category yourself. Formlee never infers it from your name, surname or location.',
    icon: '🏷️',
    fields: [
      {
        id: 'category', label: 'Reservation category', type: 'select', required: true, options: CATEGORY_OPTIONS,
        help: 'Only choose a category you are entitled to claim. General/UR is also a selection — not an inference.',
      },
      {
        id: 'categoryOtherDetail', label: 'Other category (specify)', type: 'text', required: false,
        visibleWhen: { field: 'category', equals: ['OTHER'] },
        help: 'Only if an examination explicitly supports this category. Formlee does not decide eligibility.',
      },
      {
        id: 'categoryConfirmed', label: 'I confirm this is my category and I want Formlee to reuse it', type: 'boolean', required: false, wide: true,
        help: 'You remain responsible for the category and any certificate you claim on an official portal.',
      },
      {
        id: 'pwdStatus', label: 'I intend to claim PwBD / PwD provisions', type: 'boolean', required: false, wide: true,
        help: 'This is separate from your reservation category. Leave unchecked if it does not apply.',
      },
      {
        id: 'pwdStatusConfirmed', label: 'I confirm my PwBD / PwD answer', type: 'boolean', required: false, wide: true,
        visibleWhen: { field: 'pwdStatus', equals: ['true'] },
      },
      {
        id: 'categoryCertificateType', label: 'Certificate type', type: 'select', required: false, options: CERTIFICATE_TYPES,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateNumber', label: 'Certificate number', type: 'text', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateAuthority', label: 'Issuing authority', type: 'text', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateJurisdiction', label: 'Issuing state / jurisdiction', type: 'text', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateIssueDate', label: 'Issue date', type: 'date', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateValidUntil', label: 'Valid until (if the certificate states it)', type: 'date', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
        help: 'Formlee does not invent or assume certificate validity rules. Copy the dates printed on your certificate.',
      },
      {
        id: 'categoryCertificateFinancialYear', label: 'Financial year / validity period', type: 'text', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
      },
      {
        id: 'categoryCertificateVerificationStatus', label: 'Certificate verification', type: 'select', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
        options: [
          { value: 'SELF_REPORTED', label: 'Self-reported — not yet checked by me' },
          { value: 'STUDENT_CONFIRMED', label: 'I have checked the details against my certificate' },
        ],
        help: 'This is your own confirmation, not legal verification by Formlee or any examination body.',
      },
      {
        id: 'categoryCertificateDocumentId', label: 'Linked certificate document', type: 'select', required: false,
        visibleWhen: { field: 'category', equals: ['EWS', 'OBC_NCL', 'SC', 'ST', 'OTHER'] },
        help: 'Upload the certificate on the Documents page, then link it here. Replacing the file keeps the old version.',
      },
      {
        id: 'pwdCertificateDocumentId', label: 'Linked PwBD / UDID certificate document', type: 'select', required: false,
        visibleWhen: { field: 'pwdStatus', equals: ['true'] },
        help: 'Optional. You can link a PwBD/UDID certificate from your private document vault.',
      },
    ],
  },
  {
    id: 'preferences',
    title: 'Additional information',
    description: 'Planning preferences. Examination-specific choices still belong to each application record.',
    icon: '⚙️',
    fields: [
      { id: 'homeState', label: 'Home state', type: 'select', required: false, options: STATE_OPTIONS, help: 'Used for state-linked preferences; check what each examination asks for.' },
      { id: 'preferredExamCities', label: 'Preferred examination cities', type: 'cities', required: false, wide: true, help: 'Up to 6, comma-separated (e.g., Delhi, Patna, Hyderabad). Enter only cities you would accept — Formlee will not choose for you.' },
    ],
  },
]

export const PROFILE_SECTION_BY_ID: Record<ProfileSectionId, ProfileSectionDef> = Object.fromEntries(
  PROFILE_SECTIONS.map(section => [section.id, section])
) as Record<ProfileSectionId, ProfileSectionDef>

export const CLASS12_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  CLASS12_STATUS_OPTIONS.map(option => [option.value, option.label])
)

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map(option => [option.value, option.label])
)
