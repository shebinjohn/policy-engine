/** Entry point: mounts the playground into #root. */
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
