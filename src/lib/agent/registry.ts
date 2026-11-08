/**
 * Central examination-adapter registry for the Formlee Apply Agent.
 *
 * The registry owns two responsibilities:
 *
 *  1. Adapter selection: given a raw URL, return the single adapter whose
 *     classification matches. The first matching adapter wins; if multiple
 *     adapters matched the same URL that would be a registry bug, so adapters
 *     are encouraged to return null when they are not confident.
 *  2. Metadata exposure: provide adapter names, versions, statuses and
 *     documentation references to the Application Hub and the extension.
 *
 * Generic scanning/filling lives in mapper.ts and the content script; this
 * registry only supplies examination-specific policy.
 */

import type {
  AgentAdapter,
  AgentAdapterId,
  AgentAdapterStatus,
  AgentFieldDescriptorLike,
  AgentMappingDecision,
  AgentPageClassification,
  AgentPageKind,
} from './adapter-types'
import { jeeMainAdapter } from './jee-main'
import { viteeeAdapter } from './viteee'

export { jeeMainAdapter, viteeeAdapter }

export type { AgentAdapter, AgentAdapterId, AgentAdapterStatus }

export const ADAPTER_ORDER: AgentAdapterId[] = ['jee-main-2027', 'viteee-2027']

const ADAPTER_BY_ID: Record<AgentAdapterId, AgentAdapter | undefined> = {
  'jee-main-2027': jeeMainAdapter,
  'viteee-2027': viteeeAdapter,
  generic: undefined,
  none: undefined,
}

export function getAdapterById(id: AgentAdapterId): AgentAdapter | null {
  return ADAPTER_BY_ID[id] ?? null
}

export function listAdapters(): AgentAdapter[] {
  return ADAPTER_ORDER.map(id => ADAPTER_BY_ID[id]).filter((adapter): adapter is AgentAdapter => !!adapter)
}

export interface ClassifyUrlResult {
  adapter: AgentAdapter | null
  classification: AgentPageClassification
}

/**
 * Classify a URL against every registered adapter in priority order.
 *
 * - The first adapter that returns a non-null classification wins.
 * - If no adapter claims the URL, the result is `{ adapter: 'none', ... }`.
 * - Adapters must return null for URLs they do not explicitly recognise;
 *   broad matching is forbidden.
 */
export function classifyUrl(rawUrl: string): ClassifyUrlResult {
  for (const id of ADAPTER_ORDER) {
    const adapter = ADAPTER_BY_ID[id]
    if (!adapter) continue
    const classification = adapter.classifyUrl(rawUrl)
    if (classification) {
      return { adapter, classification }
    }
  }

  const sanitizedUrl = sanitizeUrl(rawUrl)
  return {
    adapter: null,
    classification: {
      adapter: 'none',
      sanitizedUrl,
      official: false,
      fixture: false,
      reason: 'UNSUPPORTED_ORIGIN',
    },
  }
}

function sanitizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin + url.pathname
  } catch {
    return null
  }
}

/**
 * Map a single field using the adapter selected for the page kind.
 * Falls back to a manual decision if the adapter does not support the page kind.
 */
export function mapFieldWithAdapter(
  adapter: AgentAdapter,
  descriptor: AgentFieldDescriptorLike,
  pageKind: AgentPageKind
): AgentMappingDecision {
  if (!adapter.isSupportedPageKind(pageKind)) {
    return {
      status: 'manual',
      canonical: null,
      ambiguous: [],
      needsReview: false,
      reason: adapter.pageNotice(pageKind),
    }
  }
  return adapter.mapField(descriptor, pageKind)
}
