import crypto from 'node:crypto'
import Razorpay from 'razorpay'

export interface RazorpayOrderResponse {
  id: string
  amount: number
  currency: string
  receipt: string | null
  status: string
}

export interface RazorpayPaymentResponse {
  id: string
  order_id: string
  amount: number
  currency: string
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
  method?: string
  captured?: boolean
}

export interface RazorpayOrderFetchResponse {
  id: string
  amount: number
  currency: string
  status: 'created' | 'attempted' | 'paid'
  receipt: string | null
}

function getInstance(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return null
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

export function isRazorpayConfigured(): boolean {
  return !!(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET
  )
}

export async function createRazorpayOrder(input: {
  amountPaise: number
  currency: string
  receipt: string
  notes?: Record<string, string>
}): Promise<RazorpayOrderResponse> {
  const instance = getInstance()
  if (!instance) {
    throw new Error('RAZORPAY_NOT_CONFIGURED')
  }

  const order = (await instance.orders.create({
    amount: input.amountPaise,
    currency: input.currency,
    receipt: input.receipt,
    notes: input.notes,
  })) as RazorpayOrderResponse

  return order
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrderFetchResponse | null> {
  const instance = getInstance()
  if (!instance) return null
  try {
    return (await instance.orders.fetch(orderId)) as RazorpayOrderFetchResponse
  } catch {
    return null
  }
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentResponse | null> {
  const instance = getInstance()
  if (!instance) return null
  try {
    return (await instance.payments.fetch(paymentId)) as RazorpayPaymentResponse
  } catch {
    return null
  }
}

export interface RazorpayRefundResponse {
  id: string
  payment_id: string
  status: string
  amount: number
}

export async function createRazorpayRefund(
  paymentId: string,
  amountPaise: number
): Promise<RazorpayRefundResponse | null> {
  const instance = getInstance()
  if (!instance) return null
  try {
    return (await instance.payments.refund(paymentId, { amount: amountPaise })) as RazorpayRefundResponse
  } catch {
    return null
  }
}

function safeTimingSafeEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'hex')
    const bBuf = Buffer.from(b, 'hex')
    if (aBuf.length !== bBuf.length) return false
    return crypto.timingSafeEqual(aBuf, bBuf)
  } catch {
    return false
  }
}

/**
 * Verifies the Razorpay payment signature using HMAC-SHA256.
 * orderId must come from the server-side PaymentOrder record.
 */
export function verifyPaymentSignature(input: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) return false
  const payload = `${input.paymentId}|${input.orderId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return safeTimingSafeEqual(expected, input.signature)
}

/**
 * Verifies the Razorpay webhook signature using HMAC-SHA256 over the raw body.
 */
export function verifyWebhookSignature(input: {
  rawBody: string
  signature: string
}): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return false
  const expected = crypto.createHmac('sha256', secret).update(input.rawBody).digest('hex')
  return safeTimingSafeEqual(expected, input.signature)
}
