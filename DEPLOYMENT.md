# Formlee deployment readiness

## Hosting model

The repository does not currently contain provider-specific deployment configuration. Run the App Router application as a Node.js server process on a host that supports the Next.js production server, Prisma's Node runtime, outbound TLS to PostgreSQL, and the configured document storage provider.

**Recommendation: Render Web Service with the Node runtime.** Formlee uses server-rendered pages, Route Handlers, Prisma, and Better Auth, so deploy it as a full Next.js server rather than a static export. Render documents this Node web-service model with build and start commands for full Next.js apps. Use `npm ci`, `npm run build`, and `npm start`. Prefer the existing R2 document-storage option for deployment so uploaded files do not depend on instance-local disk; Render also offers persistent disks, but attaching one changes its normal zero-downtime redeploy behavior. This is a recommendation only: no Render service or account has been configured.

Global response headers enable MIME sniffing protection, clickjacking protection, a strict referrer policy, and disable unused camera/microphone/location browser permissions. HSTS is enabled only for production responses and does not opt all subdomains into HSTS. An enforcing Content Security Policy is intentionally deferred: the billing UI loads Razorpay Checkout, and the extension has its own separate CSP/origin configuration. Finalize and browser-test a CSP with the separate payment and extension launch tasks before enabling it.

Next.js 16.3.6 requires Node.js 20.9.0 or newer. The package declares this minimum. Use a currently supported Node.js LTS release and run the same lockfile install and checks used by CI.

The app uses a system font stack and does not download Google Fonts during production builds. `npm run build` needs no runtime production secrets. The documented `npm start` command validates runtime configuration before starting Next.js.

## Production environment variables

Required before starting the production server. The production build itself does not require these runtime values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Application's PostgreSQL connection; use the environment's runtime/pooled endpoint where applicable. Must use TLS and must not target localhost. |
| `DIRECT_DATABASE_URL` | Direct PostgreSQL endpoint used by Prisma schema tools. Must use TLS and must not target localhost. |
| `BETTER_AUTH_SECRET` | Server-only authentication signing secret, at least 32 characters. Store in the host's secret manager. |
| `BETTER_AUTH_URL` | Public HTTPS origin used by Better Auth. |
| `DOCUMENT_STORAGE_PROVIDER` | Explicitly choose `local` or `r2`; production cannot silently inherit the development default. |
| `OPENROUTER_API_KEY` | Server-only OpenRouter API key. Never prefix it with `NEXT_PUBLIC_`. |
| `OPENROUTER_MODEL` | Explicit OpenRouter `provider/model` identifier. Avoid auto-routing to prevent unexpected model/cost selection. |
| `AGENT_MODEL_PROVIDER` | Production must use `openrouter`; local development defaults to Ollama unless explicitly set to `openrouter`. |

When `DOCUMENT_STORAGE_PROVIDER=local`, also set `FORMLEE_STORAGE_DIR` to a private path on a host volume confirmed to persist across restarts and releases. Local filesystem storage is for development or a host with a deliberately configured durable volume; it is not a safe default for ephemeral instances.

When `DOCUMENT_STORAGE_PROVIDER=r2`, set server-only `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. The endpoint is constructed as `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; the S3 client uses region `auto`. Credentials must only exist in the server runtime and host secret manager.

### Cloudflare R2 setup

1. In the Cloudflare dashboard, [create a dedicated bucket](https://developers.cloudflare.com/r2/buckets/) for Formlee private documents. R2 buckets are private by default; leave public bucket access disabled and do not enable the [`r2.dev` development URL](https://developers.cloudflare.com/r2/buckets/public-buckets/) or connect a public custom domain.
2. Create an [R2 API token](https://developers.cloudflare.com/r2/api/tokens/) with **Object Read & Write** permissions scoped to this bucket only. Cloudflare's permission covers read, write, and list operations; Formlee itself does not expose bucket listing. Do not use an account-wide admin token. Store the generated Access Key ID and Secret Access Key directly in the Render service's secret environment settings.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. The production startup validator checks that the required values exist and that the account ID and bucket name have valid shapes. It never prints credential values.
4. Formlee sends file bytes through its authenticated multipart API, validates the file signature and size on the server, and writes to R2 using a server-generated UUID key under the opaque workspace token. Downloads first check the current workspace and document row, then proxy the bytes through the API. No presigned URL or permanent object URL reaches the browser.
5. Browser-to-R2 CORS is not used or required for this flow. Do not add wildcard CORS rules.
6. In staging, verify upload, replacement/version history, download, cross-workspace denial, and deletion/retry behavior. Confirm objects are private by checking that an unsigned direct object request is denied. Verify R2 connectivity from the application without logging request headers or credentials.

Database metadata remains in the existing `UploadedDocument` model. Task 4 requires no Prisma schema change or migration.

### Safe document cleanup

Application deletion first marks the workspace-owned metadata row deleted, then removes the same validated object key. If R2 is unavailable, the API returns a retryable server error while the tombstone prevents further reads; repeating the owner's DELETE request retries idempotent object removal. Do not delete bucket objects by a client-provided key. For operator reconciliation, compare R2 object keys to `UploadedDocument.storedName` and its workspace prefix using read-only exports first. Remove only tombstoned objects past the agreed recovery window or orphan objects with no database row after a second verification; retain every live document and superseded version. Keep audit logs of reconciliation actions, and never use a bucket-wide bulk delete.

Razorpay billing may be disabled by leaving all four variables unset. To enable it, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `NEXT_PUBLIC_RAZORPAY_KEY_ID`; the public key must equal the server key ID. The `NEXT_PUBLIC_` key is intentionally public. All other credentials must remain server-only.

To enable production AI, add `AGENT_MODEL_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` in the Render service's **server-side Environment** settings. Do not expose the key through a `NEXT_PUBLIC_` variable. Startup fails clearly if the key or explicit model is absent; production never falls back to Ollama. Select a model and provider account limits that match the intended cost and data-handling policy. Development keeps the existing Ollama default; `OLLAMA_BASE_URL` and `OLLAMA_MODEL` configure that local provider. Hosted requests use bounded prompts, output tokens, and timeouts, with no automatic retry after a provider request.

## Build and release procedure

1. Configure separate production and staging secrets in the selected host. Use only the matching Neon branch endpoints for each environment; do not reuse local `.env` values.
2. Run `npm ci` and `npm run typecheck`, `npm run lint`, `npm run test:focused`, and `npm run build` in CI before release.
3. Back up the target database and review the pending Prisma migration SQL. Apply migrations as an explicit release step using the environment's direct URL and `npx prisma migrate deploy`. The build and start commands in this repository do not apply migrations.
4. Deploy the immutable build artifact and run `npm start` with the required production environment.
5. Check `/api/health` for process liveness and `/api/ready` for database readiness. The readiness endpoint reports only the dependency name and status, never connection details.
6. Verify authentication, R2 upload/download/deletion, document version history, cross-workspace denial, and any enabled payment flow in staging before promoting the same artifact to production.

## Rollback

For an application-only release, roll back to the previous immutable artifact and keep the database schema in place. Do not automatically roll back a migration. Prefer forward fixes; destructive or incompatible schema changes require a separately planned data recovery procedure and a verified backup. Check `/api/ready` after rollback.

## Launch checklist and deferred work

- [ ] Select and document the actual hosting provider, region, process model, custom domain, TLS termination, and secret-management method.
- [ ] Configure and verify production `DATABASE_URL` and `DIRECT_DATABASE_URL` against the production Neon branch without putting values in logs or source control.
- [ ] Create the private R2 bucket and bucket-scoped Object Read & Write token; store credentials as server-only Render environment secrets.
- [ ] Confirm anonymous and unrelated-workspace users cannot read, overwrite, finalize, or delete another workspace's document.
- [ ] Complete production AI provider integration before promising AI-assisted mapping in production.
- [ ] Configure Razorpay credentials and webhook URL only if credit purchases are part of the beta.
- [ ] Complete Chrome extension production-origin configuration and real-browser launch verification in their separate tasks.
- [ ] Confirm an operator receives host logs and alerts. This repository has no external error-tracking or metrics integration configured.
- [ ] Verify staged backup/restore and rollback procedures before public beta traffic.

The repository does not trigger a deployment, manage DNS, apply migrations, or configure an external observability service.
