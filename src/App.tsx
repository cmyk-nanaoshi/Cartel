import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConfigProvider, DemoRibbon, ToastProvider } from './components/ui';
import { t } from './i18n';
import { getSetting } from './lib/db';
import { Welcome } from './pages/Welcome';
import { Scan } from './pages/Scan';
import { Analyzing } from './pages/Analyzing';
import { Results } from './pages/Results';
import { LabelReview } from './pages/LabelReview';
import { Artwork } from './pages/Artwork';
import { Chat } from './pages/Chat';
import { Collection } from './pages/Collection';
import { Search } from './pages/Search';
import { Random } from './pages/Random';
import { Profile } from './pages/Profile';
import { NotFound } from './pages/NotFound';

// La carte (Leaflet) n'est chargée qu'à la demande.
const MapPage = lazy(() => import('./pages/MapPage'));

/** Navigation C2 : l'app s'ouvre sur le viseur. La première fois, l'écran de bienvenue passe avant. */
function Start() {
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  useEffect(() => {
    getSetting<boolean>('welcomed').then((w) => setWelcomed(!!w));
  }, []);
  if (welcomed === null) return null;
  return welcomed ? <Scan /> : <Welcome onDone={() => setWelcomed(true)} />;
}

export function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <BrowserRouter>
          <div className="app">
            <DemoRibbon />
            <Suspense fallback={<div className="page t-muted">{t('common.loading')}</div>}>
              <Routes>
                <Route path="/" element={<Start />} />
                <Route path="/scanner" element={<Scan />} />
                <Route path="/analyse" element={<Analyzing />} />
                <Route path="/resultats" element={<Results />} />
                <Route path="/cartel" element={<LabelReview />} />
                <Route path="/oeuvre/:key" element={<Artwork />} />
                <Route path="/oeuvre/:key/questions" element={<Chat />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/recherche" element={<Search />} />
                <Route path="/hasard" element={<Random />} />
                <Route path="/carte" element={<MapPage />} />
                <Route path="/profil" element={<Profile />} />
                {/* L'administration est une app séparée (admin.html), absente de cette version publique. */}
                <Route path="/admin" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ConfigProvider>
  );
}
