import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ShareApp } from './share-view.js';
import './styles.css';

// A review link (/s/<token>, then /share) opens only the read-only share page, never the full workspace.
const shared = window.location.pathname === '/share' || window.location.pathname.startsWith('/s/');
// The workspace locks the page to the viewport; the share page is a plain document and must scroll.
if (shared) document.documentElement.classList.add('is-share');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {shared ? <ShareApp /> : <App />}
  </React.StrictMode>,
);
