import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

// Global unhandled-rejection handler. React error boundaries only catch
// errors thrown during render / lifecycle; async promise rejections that
// bubble out of event handlers don't hit them. We log to console (per
// OBSERVABILITY.md, no automatic reporting) so a curious user in DevTools
// can see what died silently.
window.addEventListener('unhandledrejection', (evt) => {
  console.error('Weft unhandled promise rejection:', evt.reason);
});

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
