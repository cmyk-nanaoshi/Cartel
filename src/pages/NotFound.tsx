import { Link } from 'react-router-dom';
import { TopBar } from '../components/Chrome';

// Page introuvable : une adresse mal copiée ou une fiche qui n'existe plus.
export function NotFound() {
  return (
    <main>
      <TopBar back="Viseur" backTo="/" />
      <div className="page" style={{ paddingTop: 8 }}>
        <p className="rubric">Erreur 404</p>
        <h1 className="t-display">Cette page n’existe pas.</h1>
        <p className="t-muted measure" style={{ marginTop: 12 }}>
          L’adresse est peut-être incomplète, ou la page a été déplacée. Vos œuvres, elles, sont toujours dans votre collection.
        </p>
        <div className="stack-8" style={{ marginTop: 24, maxWidth: 420 }}>
          <Link className="btn btn-block" to="/">
            Photographier une œuvre
          </Link>
          <Link className="btn btn-secondary btn-block" to="/collection">
            Ouvrir la collection
          </Link>
        </div>
      </div>
    </main>
  );
}
