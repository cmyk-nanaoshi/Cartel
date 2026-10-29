import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Typographie Cartel : Schibsted Grotesk (interface), Spectral (titres d'œuvres et lecture),
// IBM Plex Mono (cotes, rubriques, renvois aux sources).
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/app.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
