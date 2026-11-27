import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Typographie Cartel : IBM Plex Sans (interface), Spectral (titres d'œuvres et lecture),
// IBM Plex Mono (cotes, rubriques, renvois aux sources).
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/app.css';
import { App } from './App';
import { applyAppearance } from './lib/theme';

applyAppearance();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyAppearance());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
