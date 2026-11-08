/**
 * Shared Formlee Pet core.
 *
 * Extracted from content/pet.js so the floating pet and the Chrome Side
 * Panel share exactly one state vocabulary and one mascot drawing —
 * there must never be two competing pet designs or two progress
 * vocabularies.
 *
 * The pet never fabricates progress: every state a caller asks for must
 * correspond to an actual extension event (scan started, plan returned,
 * fill started, verified, failed...). There is deliberately NO "success
 * after N seconds" timer logic anywhere in this module.
 */

const FormleePetCore = (function () {
  'use strict'

  /**
   * Pet states. The panel uses cssTone for its wrapper classes; the
   * floating pet keeps its own class module but reads the same state ids.
   */
  const STATES = {
    idle: { label: 'Idle', tone: 'neutral', motion: 'none' },
    greeting: { label: 'Greeting', tone: 'info', motion: 'bob' },
    ready: { label: 'Ready', tone: 'info', motion: 'none' },
    scanning: { label: 'Scanning', tone: 'accent', motion: 'bob' },
    thinking: { label: 'Thinking', tone: 'accent', motion: 'bob' },
    reviewing: { label: 'Reviewing', tone: 'accent', motion: 'none' },
    waiting: { label: 'Waiting for you', tone: 'warning', motion: 'none' },
    filling: { label: 'Filling', tone: 'accent', motion: 'bounce' },
    verifying: { label: 'Verifying', tone: 'accent', motion: 'bounce' },
    success: { label: 'Done', tone: 'success', motion: 'bounce' },
    warning: { label: 'Needs attention', tone: 'warning', motion: 'none' },
    unsupported: { label: 'Unsupported page', tone: 'neutral', motion: 'none' },
    error: { label: 'Error', tone: 'error', motion: 'shake' },
  }

  /** Default honest first message per state (used when a caller omits text). */
  const DEFAULT_MESSAGES = {
    idle: 'Hello — I’m Formlee. Open a supported exam page and I’ll help you fill it safely.',
    greeting: 'Hello! I’m your Formlee assistant.',
    ready: 'Ready when you are — scan the form to begin.',
    scanning: 'Scanning this form for fields I can help with…',
    thinking: 'Thinking about how these fields map to your profile…',
    reviewing: 'Review the detected fields and tick the ones I may fill.',
    waiting: 'Your approval is needed before anything is filled.',
    filling: 'Filling the approved fields…',
    verifying: 'Reading the fields back to verify what was written…',
    success: 'Done. Nothing was submitted — always check the form yourself.',
    warning: 'Something needs your attention before continuing.',
    unsupported: 'This page is not supported — Formlee only helps on matched examination portals and demo pages.',
    error: 'Something went wrong.',
  }

  function stateMeta(stateId) {
    return STATES[stateId] || null
  }

  function defaultMessage(stateId) {
    const meta = STATES[stateId]
    if (!meta) return DEFAULT_MESSAGES.idle
    return DEFAULT_MESSAGES[stateId] || DEFAULT_MESSAGES.idle
  }

  function motionClass(stateId) {
    const meta = STATES[stateId]
    return meta && meta.motion !== 'none' ? 'pet-motion-' + meta.motion : ''
  }

  function toneClass(stateId) {
    const meta = STATES[stateId]
    return meta ? 'pet-tone-' + meta.tone : 'pet-tone-neutral'
  }

  /**
   * The mascot face — a friendly rounded robot wearing a graduation cap,
   * matching my "school-badge blue" identity. This is the single drawing
   * used by both the floating pet and the side panel (each renders it in
   * its own DOM tree, so the gradient ids cannot collide).
   */
  function mascotSVG() {
    return `
      <svg class="pet-face" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="petBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#eef2ff;stop-opacity:1" />
          </linearGradient>
          <linearGradient id="petCapGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#3730a3;stop-opacity:1" />
          </linearGradient>
        </defs>
        <!-- left ear -->
        <circle class="pet-body" cx="11" cy="34" r="6" fill="url(#petBodyGrad)"/>
        <!-- right ear -->
        <circle class="pet-body" cx="53" cy="34" r="6" fill="url(#petBodyGrad)"/>
        <!-- antenna -->
        <line class="pet-antenna-line" x1="32" y1="12" x2="32" y2="4"/>
        <circle class="pet-antenna-bulb" cx="32" cy="4" r="3"/>
        <!-- head -->
        <rect class="pet-body" x="12" y="16" width="40" height="38" rx="18" ry="18" fill="url(#petBodyGrad)"/>
        <!-- graduation cap -->
        <path class="pet-cap" d="M14 22 L32 14 L50 22 L32 30 Z" fill="url(#petCapGrad)"/>
        <rect class="pet-cap" x="30" y="28" width="4" height="7" fill="#312e81"/>
        <circle class="pet-cap-tassel" cx="34" cy="35" r="1.8" fill="#fbbf24"/>
        <!-- eyes -->
        <ellipse class="pet-eye" cx="24" cy="36" rx="3.8" ry="4.8"/>
        <ellipse class="pet-eye" cx="40" cy="36" rx="3.8" ry="4.8"/>
        <!-- blush -->
        <circle cx="19" cy="43" r="2.2" fill="#fca5a5" opacity="0.6"/>
        <circle cx="45" cy="43" r="2.2" fill="#fca5a5" opacity="0.6"/>
        <!-- mouth -->
        <path class="pet-mouth" d="M27 47 Q32 52 37 47"/>
        <!-- F emblem -->
        <text x="32" y="30" text-anchor="middle" font-size="8" font-weight="800" fill="#4f46e5" font-family="ui-sans-serif, system-ui, sans-serif">F</text>
      </svg>
    `
  }

  return {
    STATES,
    DEFAULT_MESSAGES,
    stateMeta,
    defaultMessage,
    motionClass,
    toneClass,
    mascotSVG,
  }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = FormleePetCore
