import { useNavigate } from 'react-router-dom';
import { LogoGrand } from '../components/Brand';
import { setSetting } from '../lib/db';

// Première ouverture (maquette « Bienvenue ») : dire ce que fait l'app avant de demander la caméra.
// Photo : Hokusai, « Sous la vague au large de Kanagawa », Art Institute of Chicago 1925.3245, domaine public.
export function Welcome({ onDone }: { onDone: () => void }) {
  const nav = useNavigate();
  async function start() {
    await setSetting('welcomed', true);
    onDone();
    nav('/', { replace: true });
  }
  return (
    <main className="welcome">
      <div className="welcome-logo">
        <LogoGrand size={40} />
      </div>
      <h1 className="t-title">Photographiez une œuvre. Artcol vous dit ce que c’est et d’où cela vient.</h1>
      <div className="photo">
        <img src="/accueil.jpg" alt="Une estampe de Hokusai accrochée au mur d’un musée, avec son cartel" />
      </div>
      <ul className="checks">
        <li>Il lit le cartel posé à côté de l’œuvre.</li>
        <li>Il retrouve l’œuvre et son histoire.</li>
        <li>Il garde vos œuvres et les lieux où vous les avez vues.</li>
      </ul>
      <button className="btn btn-block" onClick={start}>
        Commencer
      </button>
    </main>
  );
}
