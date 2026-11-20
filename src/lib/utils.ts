import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A v4 UUID for command idempotency (PR 4, DEBUG D-18). `crypto.randomUUID` exists only on secure pages (https or
 * localhost); opening the app by network address (http://192.168.x.x) falls back to `crypto.getRandomValues`.
 */
export function newCommandId(cryptoImpl: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === "function") return cryptoImpl.randomUUID()
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
