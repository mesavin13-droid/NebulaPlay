import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installApiCompatibility } from './apiCompatibility'
import './index.css'

installApiCompatibility()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
