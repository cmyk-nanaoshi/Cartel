import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MapPlace } from '../../shared/types';
import { db } from '../lib/db';
import { api } from '../lib/api';
import { Icon, Notice } from '../components/ui';

// Fond de carte OpenStreetMap (attribution obligatoire). Pour un usage intensif, la politique
// d'utilisation des tuiles OSM demande un autre fournisseur : VITE_TILE_URL permet d'en changer.
const TILE_URL = (import.meta.env.VITE_TILE_URL as string) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = (import.meta.env.VITE_TILE_ATTRIBUTION as string) || '© contributeurs OpenStreetMap';
const DEFAULT_CENTER: [number, number] = [48.8606, 2.3376]; // Paris, vue par défaut annoncée comme telle

const icon = (cls: string) => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export default function MapPage() {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ musee: L.LayerGroup; oeuvre_publique: L.LayerGroup; mine: L.LayerGroup } | null>(null);
  const nav = useNavigate();
  const mine = useLiveQuery(() => db.artworks.filter((a) => !!a.geo).toArray(), []);
  const [show, setShow] = useState({ musee: true, oeuvre_publique: true, mine: true });
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'warn'; text: string } | null>({
    kind: 'info',
    text: 'Vue par défaut : Paris. Utilisez « Me localiser » ou déplacez la carte puis « Chercher ici ».'
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false }).setView(DEFAULT_CENTER, 14);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(m);
    layers.current = { musee: L.layerGroup().addTo(m), oeuvre_publique: L.layerGroup().addTo(m), mine: L.layerGroup().addTo(m) };
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Mes découvertes géolocalisées (uniquement si l'utilisateur a activé l'enregistrement du lieu).
  useEffect(() => {
    const g = layers.current?.mine;
    if (!g || !mine) return;
    g.clearLayers();
    for (const a of mine) {
      const mk = L.marker([a.geo!.lat, a.geo!.lon], { icon: icon('pin-mine') });
      mk.bindPopup(
        `<strong>${esc(a.entry.artist)}</strong><br><em>${esc(a.entry.title)}</em><br><span style="color:#777">Découverte le ${new Date(a.createdAt).toLocaleDateString('fr-FR')}${a.geo!.accuracy ? `, précision ±${Math.round(a.geo!.accuracy)} m` : ''}</span><br><a href="/oeuvre/${encodeURIComponent(a.id)}" data-nav>Ouvrir la fiche</a>`
      );
      mk.on('popupopen', (e: any) => {
        e.popup.getElement()?.querySelector('[data-nav]')?.addEventListener('click', (ev: Event) => {
          ev.preventDefault();
          nav(`/oeuvre/${encodeURIComponent(a.id)}`);
        });
      });
      g.addLayer(mk);
    }
    if (mine.length && map.current && status?.text.startsWith('Vue par défaut')) {
      map.current.fitBounds(L.latLngBounds(mine.map((a) => [a.geo!.lat, a.geo!.lon] as [number, number])).pad(0.3), { maxZoom: 15 });
      setStatus({ kind: 'info', text: `${mine.length} découverte${mine.length > 1 ? 's' : ''} géolocalisée${mine.length > 1 ? 's' : ''}. « Chercher ici » affiche les musées et œuvres publiques de la zone.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  useEffect(() => {
    const m = map.current;
    const ls = layers.current;
    if (!m || !ls) return;
    (Object.keys(show) as (keyof typeof show)[]).forEach((k) => (show[k] ? ls[k].addTo(m) : ls[k].remove()));
  }, [show]);

  async function searchHere() {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter();
    const radius = Math.min(25, Math.max(1, m.distance(c, m.getBounds().getNorthEast()) / 1000));
    setLoading(true);
    try {
      const { places, error } = await api.places(c.lat, c.lng, Math.round(radius * 10) / 10);
      draw(places);
      setStatus(
        error
          ? { kind: 'error', text: error }
          : { kind: 'info', text: `${places.filter((p) => p.kind === 'musee').length} musées et ${places.filter((p) => p.kind === 'oeuvre_publique').length} œuvres publiques dans un rayon de ${radius.toFixed(1)} km (source : Wikidata).` }
      );
    } catch (e: any) {
      setStatus({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  function draw(places: MapPlace[]) {
    const ls = layers.current!;
    ls.musee.clearLayers();
    ls.oeuvre_publique.clearLayers();
    for (const p of places) {
      const mk = L.marker([p.lat, p.lon], { icon: icon(p.kind === 'musee' ? 'pin-musee' : 'pin-oeuvre') });
      mk.bindPopup(
        `<strong>${esc(p.name)}</strong>${p.description ? `<br>${esc(p.description)}` : ''}<br><a href="${esc(p.url)}" target="_blank" rel="noreferrer">Notice Wikidata</a>${p.website ? ` · <a href="${esc(p.website)}" target="_blank" rel="noreferrer">Site</a>` : ''}`
      );
      ls[p.kind].addLayer(mk);
    }
  }

  function locate() {
    if (!navigator.geolocation) return setStatus({ kind: 'error', text: 'La géolocalisation n’est pas disponible sur cet appareil.' });
    setStatus({ kind: 'info', text: 'Localisation en cours…' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        map.current?.setView([p.coords.latitude, p.coords.longitude], 15);
        L.circle([p.coords.latitude, p.coords.longitude], { radius: p.coords.accuracy, color: '#8f7330', weight: 1, fillOpacity: 0.08 }).addTo(map.current!);
        searchHere();
      },
      () => setStatus({ kind: 'error', text: 'Position refusée ou indisponible. La carte reste utilisable en la déplaçant à la main.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  return (
    <main className="map-wrap">
      <div ref={el} className="map" aria-label="Carte des musées et œuvres" />
      <div className="map-panel">
        <button className="chip" onClick={locate}>
          <Icon name="locate" size={16} /> Me localiser
        </button>
        <button className="chip" onClick={searchHere} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="search" size={16} />} Chercher ici
        </button>
        <button className="chip" aria-pressed={show.musee} onClick={() => setShow({ ...show, musee: !show.musee })}>
          <span className="pin pin-musee" style={{ width: 10, height: 10, borderWidth: 1 }} /> Musées
        </button>
        <button className="chip" aria-pressed={show.oeuvre_publique} onClick={() => setShow({ ...show, oeuvre_publique: !show.oeuvre_publique })}>
          <span className="pin pin-oeuvre" style={{ width: 10, height: 10, borderWidth: 1 }} /> Œuvres publiques
        </button>
        <button className="chip" aria-pressed={show.mine} onClick={() => setShow({ ...show, mine: !show.mine })}>
          <span className="pin pin-mine" style={{ width: 10, height: 10, borderWidth: 1 }} /> Mes découvertes
        </button>
      </div>
      {status && (
        <div className="map-status">
          <Notice kind={status.kind}>{status.text}</Notice>
        </div>
      )}
    </main>
  );
}
