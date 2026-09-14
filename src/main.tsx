import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './ui/styles/tokens.css'
import './ui/styles/base.css'
import './ui/styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
