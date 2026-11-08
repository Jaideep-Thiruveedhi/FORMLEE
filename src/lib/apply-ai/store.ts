'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ApplicationRecord, ExamId } from './types'

interface ApplyStoreActions {
  beginApplication: (examId: ExamId) => void
  resetTracker: () => void
}

interface ApplyStoreState extends ApplyStoreActions {
  applications: Partial<Record<ExamId, ApplicationRecord>>
  /** Milestone-1 draft values, kept until imported into the server profile. */
  legacyProfileDraft?: Record<string, unknown>
  consumeLegacyDraft: () => void
}

/**
 * Client-side application tracker state. Milestone 2 moved profile + documents
 * to the server; this store now persists ONLY the per-exam "application
 * started" tracker flag (each exam's readiness is computed from server data).
 */
export const useApplyStore = create<ApplyStoreState>()(
  persist(
    (set) => ({
      applications: {},

      beginApplication: (examId) =>
        set(state => {
          const existing = state.applications[examId]
          const now = new Date().toISOString()
          return {
            applications: {
              ...state.applications,
              [examId]: existing
                ? { startedAt: existing.startedAt ?? now, updatedAt: now }
                : { startedAt: now, updatedAt: now },
            },
          }
        }),

      resetTracker: () => set({ applications: {} }),

      consumeLegacyDraft: () => set({ legacyProfileDraft: undefined }),
    }),
    {
      // Historical key retained so existing student drafts survive the rebrand.
      name: 'rankora-apply-ai-v1',
      version: 2,
      // v1 data carried the local profile/documents; profile values are kept as
      // a one-time legacy draft so students can import them to the server.
      migrate: state => {
        const legacy = state as {
          applications?: Partial<Record<ExamId, ApplicationRecord>>
          profile?: Record<string, unknown>
        }
        const draft = legacy.profile ?? {}
        return {
          applications: legacy.applications ?? {},
          legacyProfileDraft: Object.keys(draft).length > 0 ? draft : undefined,
        }
      },
    }
  )
)
