import { createContext, useContext } from 'react'
import type { BrandElement } from '../../shared/types'
import type { SceneRunner } from '../engine/player'

export interface EditorCtx {
  runner: SceneRunner
  W: number
  H: number
  elements: BrandElement[]
}

export const EditorContext = createContext<EditorCtx | null>(null)
export const useEditorCtx = () => useContext(EditorContext)!

export const MAC_FONTS = [
  'SF Pro Display',
  'SF Pro Rounded',
  'Helvetica Neue',
  'Avenir Next',
  'Futura',
  'Gill Sans',
  'Optima',
  'Didot',
  'Baskerville',
  'Georgia',
  'American Typewriter',
  'Menlo',
  'Inter'
]
