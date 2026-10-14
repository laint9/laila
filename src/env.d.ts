/// <reference types="vite/client" />
import type { LailaApi } from '../electron/preload'

declare global {
  interface Window {
    laila: LailaApi
  }
}
export {}


