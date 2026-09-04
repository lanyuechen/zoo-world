import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import BrowsePage from './pages/BrowsePage'
import HomePage from './pages/HomePage'
import ProvincePage from './pages/ProvincePage'
import SearchPage from './pages/SearchPage'
import SpeciesPage from './pages/SpeciesPage'
import './index.css'

registerSW({ immediate: true })

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <Routes>
        <Route element={<App />}>
          <Route index element={<HomePage />} />
          <Route path="browse/*" element={<BrowsePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="province" element={<ProvincePage />} />
          <Route path="species/:slug" element={<SpeciesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
