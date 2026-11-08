# Formlee

**Your exam applications, made easier.**

Formlee is an AI-assisted examination application assistant. Students can organize a reusable profile and application documents, track supported exam applications, and use a browser extension that reviews field mappings before filling supported forms.

The initial target audience is Indian students applying for examinations such as JEE Main, BITSAT, VITEEE, MET and CUET-UG. A rank or examination result is **never required** to create an account or complete a profile.

## What works today

- **Accounts and sessions** — email/password registration, sign-in, sign-out and account menu (Better Auth).
- **Workspaces** — a browser workspace is created automatically; an existing anonymous workspace can be explicitly claimed and saved to an account.
- **Student profile** — personal, contact, Class 10/Class 12 and preference details with draft saves and validation.
- **Document manager** — private uploads, replacement, metadata, authorised streaming and deletion.
- **Application Hub** (`/apply/applications`) — server-persisted applications per workspace, one per exam/session/year, with support status, preparation status, published requirements, progress derived from real records, verified deadline sources, in-app reminders and explicit submission recording.
- **Application readiness** — per-exam preparation checklists computed from configured requirements (no invented deadlines, fees or eligibility rules).
- **Apply Agent V1.1** — a Manifest V3 Chrome extension that pairs with the workspace, detects form fields, shows a field-by-field plan, fills only what the student approves, verifies each field, and stops before submission.
- **JEE Main 2027 (Session 1) adapter — Beta** — documentation-backed detection and strict mapping for the official Personal Details and Qualification Details sections only. The live portal is login-gated and has not been inspected end to end.
- **Demonstration forms** — the existing local synthetic form plus clearly labelled synthetic JEE Main fixtures for reproducible agent testing.

The Apply Agent's generic workflow has been validated end to end against Formlee's local demonstration form. The JEE Main adapter is backed by official NTA documentation but **has not been validated on the live portal**, so Formlee makes no claim of complete or official compatibility.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- Prisma + PostgreSQL
- Better Auth
- Zustand + TanStack Query
- Chrome Manifest V3 extension

## Local development

1. Start PostgreSQL:

   ```
   docker compose up -d
   ```

2. Configure environment variables in `.env` (never committed):

   ```
   DATABASE_URL=postgresql://...
   BETTER_AUTH_SECRET=...
   BETTER_AUTH_URL=http://localhost:3000
   # optional: FORMLEE_STORAGE_DIR=/absolute/private/path
   # optional: OLLAMA_BASE_URL / OLLAMA_MODEL for the local mapping tier
   ```

3. Install and prepare:

   ```
   npm install
   npx prisma generate
   npx prisma db push
   ```

4. Run:

   ```
   npm run dev
   ```

Open `http://localhost:3000`.

### Application Hub tests

The hub API tests are integration tests and require an isolated server and database. They create
and remove their own anonymous workspaces; never point them at the development database.

```
docker compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE formlee_hub_test;"
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/formlee_hub_test?schema=public'
$env:FORMLEE_STORAGE_DIR='C:\Temp\formlee-hub-test-storage'
npx prisma db push
npx next dev -p 3100
```

In a second terminal:

```
$env:APPLICATION_HUB_TEST_BASE_URL='http://localhost:3100'
node --test scripts/tests/application-hub-api.test.mjs
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run db:generate` | Prisma client |
| `npm run db:push` | Push schema to the development database |
| `npm run db:migrate` | Create a development migration |
| `npm run db:studio` | Prisma Studio |

## Application Hub

`/apply/applications` is the workspace-owned application tracker. It is deliberately separate from
the older `/apply` readiness dashboard and from the legacy local "application started" flags.

- **Persistence and isolation** — applications live in the `exam_application` table. Every read and
  write filters by the resolved workspace; the database also enforces one record per
  `[workspaceId, examId, sessionId, applicationYear]`. A different workspace gets a 404 for another
  workspace's id and can track the same exam session independently.
- **Catalog and support status** — `Supported`, `Beta`, `Demo only`, `Coming soon`, `Track only`,
  `Application closed` and `Dates not announced` are separate from deadline state. For example,
  JEE Main has an announced Session 1 deadline but only Beta form-filling support.
- **Verified deadlines** — each session stores a deadline snapshot with its official URL and
  verification date. `ANNOUNCED`, `TENTATIVE` and `NOT_ANNOUNCED` are distinct. A new cycle never
  inherits an old cycle's date; BITSAT 2027, MET 2027 and CUET-UG 2027 are explicitly
  `NOT_ANNOUNCED`, and JEE Main 2027 Session 2 does not reuse the Session 1 deadline.
- **Requirements and progress** — only exams with published current official instructions have a
  checklist (JEE Main 2027 Session 1 and VITEEE 2027). Other exams show "official checklist not
  published" instead of invented requirements. Progress is recomputed from the saved profile,
  uploaded documents and manual confirmations; when there is no published checklist the API returns
  `progressPercent: null`.
- **Submission distinction** — normal status updates cannot set a submission state. Only
  `POST /api/apply/applications/[id]/submission` can record `SUBMITTED_STUDENT_CONFIRMED` or
  `PORTAL_CONFIRMATION_RECORDED`, and both carry a student-attested label. Filling fields or
  completing a checklist never marks an application submitted. Once recorded, a submission state
  must be explicitly cleared before preparation status can change again.
- **Reminders** — computed in-app from deadlines, missing requirements and stale records. No SMS,
  email, push or other external delivery is used.

## Browser extension

The unpacked extension lives in `extensions/formlee-apply-agent/`.

1. Open `chrome://extensions` and enable Developer mode.
2. **Load unpacked** → select `extensions/formlee-apply-agent`.
3. On `/apply/agent`, generate a 15-minute pairing code.
4. Paste it into the extension popup. The session lasts 30 minutes and can be revoked from either side.
5. Open `/apply/agent/demo-form` to try inspection, review and fill with the existing generic demo.
6. For the JEE Main adapter, open `/apply/agent/jee-main-2027-demo` (Personal Details) or `/apply/agent/jee-main-2027-demo/qualification` (Qualification Details). These fixtures reuse documented labels but are synthetic and never submit.

The extension declares only the local Formlee origins and the exact official JEE Main 2027 application path (`https://examinationservices.nic.in/JeeMaink2027/*`). Lookalike domains and unrelated sites are rejected by the worker's origin gate. The extension stores only the short-lived agent session token in `chrome.storage.local`. The httpOnly workspace cookie never becomes extension-visible. The content script never submits a form and never touches password, OTP, CAPTCHA, payment, upload, declaration or final-submission controls.

## Safety boundaries

- Fill requires an explicit click inside the extension after the student reviews the plan.
- Model-suggested mappings start unchecked; the model sees labels/option text only, never saved values.
- Unsupported, ambiguous and missing fields are reported, not guessed.
- Official submission, payment, CAPTCHA, OTP and legal declarations remain the student's responsibility.
- Document contents are never sent to any AI model.

## Project structure

```
src/app/            pages and API routes (apply workspace, agent, auth)
src/components/     UI components (workspace, documents, agent)
src/lib/apply-ai/   profile, documents, requirements, storage, workspace
src/lib/agent/      pairing/session, field mapping, local model tier, values
prisma/             schema
extensions/         Manifest V3 browser extension
storage/            private uploads (git-ignored)
```

## Status

This is a development build. Authentication, profile, documents and the generic demonstration-form workflow are implemented and tested. The JEE Main 2027 adapter is **Beta**: its rules are documentation-backed, but the live application form is login-gated and has not been verified end to end. Do not present Formlee as officially affiliated with NTA or as fully compatible with the live JEE Main portal until a supervised pilot has verified the real form without submitting a real application.
