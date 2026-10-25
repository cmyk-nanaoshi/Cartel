import { lazy, Suspense } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ConfigProvider, DemoRibbon, Icon, ToastProvider } from './components/ui';
import { t } from './i18n';
import { Home } from './pages/Home';
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

// La carte (Leaflet) n'est chargée qu'à la demande.
const MapPage = lazy(() => import('./pages/MapPage'));

function TabBar() {
  const loc = useLocation();
  if (loc.pathname === '/scanner' || loc.pathname === '/analyse') return null;
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      <NavLink to="/" end className={cls}>
        <Icon name="home" />
        <span>{t('nav.home')}</span>
      </NavLink>
      <NavLink to="/carte" className={cls}>
        <Icon name="map" />
        <span>{t('nav.map')}</span>
      </NavLink>
      <NavLink to="/scanner" className="scan" aria-label={t('nav.scan')}>
        <span className="scan-disc">
          <Icon name="scan" />
        </span>
        <span>{t('nav.scan')}</span>
      </NavLink>
      <NavLink to="/collection" className={cls}>
        <Icon name="grid" />
        <span>{t('nav.collection')}</span>
      </NavLink>
      <NavLink to="/profil" className={cls}>
        <Icon name="user" />
        <span>{t('nav.profile')}</span>
      </NavLink>
    </nav>
  );
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
                <Route path="/" element={<Home />} />
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
                <Route path="*" element={<div className="page">Page introuvable.</div>} />
              </Routes>
            </Suspense>
            <TabBar />
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ConfigProvider>
  );
}
