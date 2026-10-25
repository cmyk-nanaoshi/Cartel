import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import './styles/app.css';
import { App } from './App';
import { getSetting } from './lib/db';

getSetting<string>('theme').then((t) => {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
