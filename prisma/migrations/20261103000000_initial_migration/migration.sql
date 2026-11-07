-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fullName" TEXT,
    "gender" TEXT,
    "dateOfBirth" TEXT,
    "email" TEXT,
    "mobileNumber" TEXT,
    "nationality" TEXT,
    "nationalityOther" TEXT,
    "fatherName" TEXT,
    "motherName" TEXT,
    "guardianName" TEXT,
    "guardianRelation" TEXT,
    "parentMobile" TEXT,
    "parentEmail" TEXT,
    "parentOccupation" TEXT,
    "permanentAddressLine" TEXT,
    "permanentCity" TEXT,
    "permanentDistrict" TEXT,
    "permanentState" TEXT,
    "permanentPinCode" TEXT,
    "permanentCountry" TEXT,
    "currentSameAsPermanent" BOOLEAN NOT NULL DEFAULT false,
    "currentAddressLine" TEXT,
    "currentCity" TEXT,
    "currentDistrict" TEXT,
    "currentState" TEXT,
    "currentPinCode" TEXT,
    "currentCountry" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "class10Board" TEXT,
    "class10SchoolName" TEXT,
    "class10PassingYear" INTEGER,
    "class10RollNumber" TEXT,
    "class10MarksKind" TEXT,
    "class10Marks" TEXT,
    "class10Percentage" TEXT,
    "class10Subjects" JSONB,
    "class12Status" TEXT,
    "class12Board" TEXT,
    "class12SchoolName" TEXT,
    "class12ExamYear" INTEGER,
    "class12PassingYear" INTEGER,
    "class12RollNumber" TEXT,
    "class12MarksKind" TEXT,
    "class12Marks" TEXT,
    "class12Percentage" TEXT,
    "class12Subjects" JSONB,
    "class12ResultDeclaredAt" TIMESTAMP(3),
    "class12ResultUpdatedAt" TIMESTAMP(3),
    "category" TEXT,
    "categoryOtherDetail" TEXT,
    "categoryConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "categoryConfirmedAt" TIMESTAMP(3),
    "pwdStatus" BOOLEAN NOT NULL DEFAULT false,
    "pwdStatusConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "pwdCertificateDocumentId" TEXT,
    "categoryCertificateType" TEXT,
    "categoryCertificateDocumentId" TEXT,
    "categoryCertificateNumber" TEXT,
    "categoryCertificateAuthority" TEXT,
    "categoryCertificateJurisdiction" TEXT,
    "categoryCertificateIssueDate" TEXT,
    "categoryCertificateValidUntil" TEXT,
    "categoryCertificateFinancialYear" TEXT,
    "categoryCertificateVerificationStatus" TEXT DEFAULT 'SELF_REPORTED',
    "categoryCertificateLastConfirmedAt" TIMESTAMP(3),
    "homeState" TEXT,
    "preferredExamCities" JSONB,
    "profileVersion" INTEGER NOT NULL DEFAULT 1,
    "lastMajorUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfileVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'PROFILE_UPDATE',
    "changedFields" JSONB,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "displayLabel" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "versions" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "certificateNumber" TEXT,
    "issuingAuthority" TEXT,
    "issuingState" TEXT,
    "issueDate" TEXT,
    "validUntil" TEXT,
    "financialYear" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'SELF_REPORTED',
    "lastConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "UploadedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_pairing_ticket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "agent_pairing_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_application" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "examSession" TEXT NOT NULL,
    "applicationYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "preferences" JSONB,
    "checklist" JSONB,
    "notes" TEXT,
    "deadlineDate" TEXT,
    "deadlineState" TEXT NOT NULL DEFAULT 'NOT_ANNOUNCED',
    "deadlineLabel" TEXT,
    "deadlineSourceLabel" TEXT,
    "deadlineSourceUrl" TEXT,
    "deadlineVerifiedAt" TIMESTAMP(3),
    "deadlineNeedsUpdate" BOOLEAN NOT NULL DEFAULT true,
    "studentSubmittedAt" TIMESTAMP(3),
    "portalReferenceRecordedAt" TIMESTAMP(3),
    "portalReference" TEXT,
    "profileSnapshot" JSONB,
    "profileSnapshotAt" TIMESTAMP(3),
    "profileVersion" INTEGER,
    "mappingReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "mappingChangedFields" JSONB,
    "mappingReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_session" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "plan" JSONB,
    "planAt" TIMESTAMP(3),

    CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_workspaceId_key" ON "StudentProfile"("workspaceId");

-- CreateIndex
CREATE INDEX "StudentProfile_workspaceId_updatedAt_idx" ON "StudentProfile"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "StudentProfileVersion_workspaceId_createdAt_idx" ON "StudentProfileVersion"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StudentProfileVersion_profileId_version_idx" ON "StudentProfileVersion"("profileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedDocument_storedName_key" ON "UploadedDocument"("storedName");

-- CreateIndex
CREATE INDEX "UploadedDocument_workspaceId_documentType_idx" ON "UploadedDocument"("workspaceId", "documentType");

-- CreateIndex
CREATE INDEX "UploadedDocument_workspaceId_documentType_isCurrent_idx" ON "UploadedDocument"("workspaceId", "documentType", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_userId_key" ON "workspace"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_pairing_ticket_code_key" ON "agent_pairing_ticket"("code");

-- CreateIndex
CREATE INDEX "agent_pairing_ticket_workspaceId_idx" ON "agent_pairing_ticket"("workspaceId");

-- CreateIndex
CREATE INDEX "exam_application_workspaceId_status_idx" ON "exam_application"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "exam_application_workspaceId_deadlineDate_idx" ON "exam_application"("workspaceId", "deadlineDate");

-- CreateIndex
CREATE INDEX "exam_application_workspaceId_mappingReviewRequired_idx" ON "exam_application"("workspaceId", "mappingReviewRequired");

-- CreateIndex
CREATE UNIQUE INDEX "exam_application_workspaceId_examId_sessionId_applicationYe_key" ON "exam_application"("workspaceId", "examId", "sessionId", "applicationYear");

-- CreateIndex
CREATE INDEX "agent_session_workspaceId_idx" ON "agent_session"("workspaceId");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
