import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStore } from './lib/store'
import * as pipeline from './lib/pipeline'
import { useEditor } from './editor/state'
import { useFonts } from './lib/fonts'
import './styles.css'

// Hook cho smoke test / debug từ DevTools
;(window as any).__laila = { store: useStore, pipeline, editor: useEditor, fonts: useFonts }

createRoot(document.getElementById('root')!).render(<App />)
