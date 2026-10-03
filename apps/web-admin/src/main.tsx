import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { adminRoutes } from './adminRoutes'

const router = createBrowserRouter([{
  element: <App />,
  children: [...Object.values(adminRoutes), '/login', '*'].map(path => ({ path })),
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
