/**
 * Common adapter interface for the Formly Apply Agent.
 *
 * A single adapter encapsulates everything examination-specific: URL policy,
 * page classification, field mapping, document guidance and support status.
 * The generic deterministic engine and AI tier handle everything else.
 */

export type AgentAdapterId = 'generic' | 'jee-main-2027' | 'viteee-2027' | 'none'

export type AgentPageKind =
  | 'generic'
  | 'personal'
  | 'qualification'
  | 'exam'
  | 'documents'
  | 'declaration'
  | 'login'
  | 'unknown'

export type AgentAdapterStatus =
  | 'FULLY_TESTED'
  | 'LIMITED_BETA'
  | 'DOCUMENTATION_BACKED'
  | 'DEMO_ONLY'
  | 'COMING_SOON'
  | 'UNSUPPORTED'

export interface AgentPageClassification {
  adapter: AgentAdapterId
  sanitizedUrl: string | null
  official: boolean
  fixture: boolean
  reason: string
}

export interface AgentPageContext {
  /** Origin + pathname only. Query strings can contain one-time portal
   * tokens and are rejected by the route. */
  url: string
  kind: AgentPageKind
  fingerprint?: string
}

export interface AgentFieldDescriptorLike {
  kind: string
  label: string
  group?: string
  inputName?: string
  inputId?: string
  options?: { text: string; value: string }[]
  required?: boolean
}

export interface AgentMappingDecision {
  status: 'mapped' | 'ambiguous' | 'manual' | 'unsafe' | 'unmapped'
  canonical: string | null
  ambiguous: string[]
  needsReview: boolean
  reason: string
}

export interface AgentAdapterSource {
  label: string
  url: string
}

export interface AgentAdapterDocumentSpec {
  label: string
  spec: string
}

export interface AgentAdapter {
  /** Stable adapter identifier used by the registry and stored plans. */
  id: AgentAdapterId
  /** Application Hub exam id this adapter belongs to, if any. */
  examId?: string
  /** Human-readable name. */
  name: string
  /** Adapter version string. */
  version: string
  /** Evidence-based support status. */
  status: AgentAdapterStatus
  /** Short user-facing status line. */
  statusLabel: string
  /** Human-readable last-verified date. */
  verifiedOn: string
  /** Exact official origins this adapter recognises. */
  officialDomains: string[]
  /** Path prefixes on those origins. */
  supportedPaths: string[]
  /** Page kinds the adapter can fill. */
  fillablePageKinds: AgentPageKind[]
  /** Canonical profile fields this adapter may ever map. */
  fillableCanonicals: readonly string[]
  /** Official documentation references. */
  sources: AgentAdapterSource[]
  /** Document specifications for advisory checks. */
  documentSpecs: AgentAdapterDocumentSpec[]
  /** Classify a raw URL; return null to let the registry try the next adapter. */
  classifyUrl(rawUrl: string): AgentPageClassification | null
  /** Whether the given page kind is supported by this adapter. */
  isSupportedPageKind(kind: AgentPageKind): boolean
  /** User-facing notice for an unsupported/unsupported page kind. */
  pageNotice(kind: AgentPageKind): string
  /** Map one detected field to a canonical profile field. */
  mapField(descriptor: AgentFieldDescriptorLike, pageKind: AgentPageKind): AgentMappingDecision
}

/** Normalised decision used internally by the mapper. */
export interface NormalisedMappingDecision extends AgentMappingDecision {
  firedByAi: boolean
}
