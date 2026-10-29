import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setPreference } from './theme/theme'

// Toute l'app est sombre : les anciennes pages suivent, sans passer au clair le jour
setPreference('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
