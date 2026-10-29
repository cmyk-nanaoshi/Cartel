import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MapPlace } from '../../shared/types';
import {
  PLACE_KINDS,
  allowedVisibilities,
  defaultVisibility,
  kindLabel,
  registerDate,
  visibilityLabel,
  type Observation,
  type PlaceKind,
  type Visibility
} from '../../shared/observations';
import { frTypo } from '../../shared/typo';
import { db, uid } from '../lib/db';
import { api } from '../lib/api';
import { Icon, useToast } from './ui';

export interface ObservationContext {
  artworkKey: string;
  artworkTitle: string;
  artworkArtist: string;
  /** Lieu lu sur le cartel, lot lu sur une étiquette : propositions, jamais imposées. */
  hints?: { placeName?: string | null; lot?: string | null };
  geo?: { lat: number; lon: number };
  photo?: Blob;
}

const today = () => new Date().toISOString().slice(0, 10);
const NB = ' ';

/** Section « Vos observations » de la fiche. */
export function ObservationsSection(ctx: ObservationContext) {
  const list = useLiveQuery(() => db.observations.where('artworkKey').equals(ctx.artworkKey).toArray(), [ctx.artworkKey]);
  const [editing, setEditing] = useState<Observation | 'new' | null>(null);
  const items = (list ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="entry-section stack-16" aria-labelledby="obs-title">
      <div className="row-between">
        <h2 id="obs-title" style={{ marginBottom: 0 }}>Vos observations</h2>
        {items.length > 0 && (
          <span className="mono t-faint">
            {items.length} lieu{items.length > 1 ? 'x' : ''}
          </span>
        )}
      </div>

      {items.map((o) => (
        <article key={o.id} className="obs-card">
          <div className="row-between" style={{ alignItems: 'center' }}>
            <span className="kind kind-place">{kindLabel(o.kind)}</span>
            <span className="mono" style={{ color: 'var(--on-surface-2)' }}>{registerDate(o.date)}</span>
          </div>
          <div className="obs-name">{frTypo(o.placeName || kindLabel(o.kind))}</div>
          <div className="obs-meta">{frTypo(obsDetail(o))}</div>
          <div className="obs-foot">
            <span className="obs-vis">
              <Icon name={o.visibility === 'prive' ? 'lock' : 'globe'} size={14} />
              {visibilityLabel(o)}
            </span>
            <button className="linkbtn" style={{ color: 'var(--on-surface)' }} onClick={() => setEditing(o)}>
              Modifier
            </button>
          </div>
        </article>
      ))}

      <button className="btn btn-ghost btn-block" onClick={() => setEditing('new')}>
        <Icon name="plus" size={16} /> Ajouter un lieu où vous l’avez vue
      </button>
      <p className="t-small t-faint">Chaque observation garde la date, le lieu et votre photo. Mises bout à bout, elles tracent le parcours de l’œuvre.</p>

      {editing && <ObservationSheet ctx={ctx} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function obsDetail(o: Observation): string {
  const parts = [o.city];
  if (o.kind === 'vente') {
    if (o.lot) parts.push(`lot ${o.lot}`);
    if (o.saleMoment) parts.push(o.saleMoment === 'vente' ? 'pendant la vente' : 'exposition avant la vente');
  } else if (o.exhibition) parts.push(o.exhibition);
  return parts.filter(Boolean).join(' · ');
}

function ObservationSheet({ ctx, initial, onClose }: { ctx: ObservationContext; initial: Observation | null; onClose: () => void }) {
  const toast = useToast();
  const [o, setO] = useState<Observation>(
    () =>
      initial ?? {
        id: uid(),
        artworkKey: ctx.artworkKey,
        artworkTitle: ctx.artworkTitle,
        artworkArtist: ctx.artworkArtist,
        kind: 'musee',
        placeName: ctx.hints?.placeName ?? '',
        city: '',
        date: today(),
        lot: ctx.hints?.lot ?? undefined,
        visibility: 'public',
        photo: ctx.photo,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
  );
  // Tant que le visiteur n'a pas choisi lui-même, la visibilité suit le type de lieu.
  const [visTouched, setVisTouched] = useState(!!initial);
  const [nearby, setNearby] = useState<MapPlace[]>([]);
  const set = (patch: Partial<Observation>) => setO((cur) => ({ ...cur, ...patch }));

  const allowed = allowedVisibilities(o);
  useEffect(() => {
    if (!visTouched || !allowed.includes(o.visibility)) set({ visibility: defaultVisibility(o) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.kind, o.isOwner]);

  // Musées et lieux proches, seulement si la position a été autorisée.
  useEffect(() => {
    if (!ctx.geo) return;
    api
      .places(ctx.geo.lat, ctx.geo.lon, 1)
      .then((r) => setNearby(r.places.filter((p) => p.kind === 'musee').slice(0, 3)))
      .catch(() => setNearby([]));
  }, [ctx.geo?.lat, ctx.geo?.lon]);

  const meta = PLACE_KINDS.find((k) => k.id === o.kind)!;
  const isSale = o.kind === 'vente';
  const isPrivate = o.kind === 'collection_privee';
  const cityShown = o.city.trim() || 'ville';
  const visOptions = useMemo(() => {
    const full = isSale
      ? 'Maison de ventes et lot, visibles par tous'
      : isPrivate
        ? 'Nom de la collection, visible par tous'
        : 'Lieu complet, visible par tous';
    const cityOnly = `«${NB}${kindLabel(o.kind)}, ${cityShown}${NB}»${isSale ? ', sans nom ni lot' : isPrivate ? '' : ' sans le nom du lieu'}`;
    return [
      { id: 'public' as Visibility, title: isPrivate ? 'Public, nom de la collection' : 'Public', desc: isPrivate && !o.isOwner ? 'Réservé au propriétaire' : full },
      { id: 'public_ville' as Visibility, title: 'Public, ville seulement', desc: cityOnly },
      { id: 'prive' as Visibility, title: 'Privé', desc: '' }
    ];
  }, [o.kind, o.isOwner, cityShown, isSale, isPrivate]);

  async function submit() {
    const clean: Observation = {
      ...o,
      placeName: o.placeName.trim(),
      city: o.city.trim(),
      // Les champs propres à un autre type de lieu ne sont pas gardés.
      lot: isSale ? o.lot?.trim() || undefined : undefined,
      saleMoment: isSale ? o.saleMoment : undefined,
      saleDate: isSale ? o.saleDate || undefined : undefined,
      estimate: isSale ? o.estimate?.trim() || undefined : undefined,
      exhibition: !isSale && !isPrivate ? o.exhibition?.trim() || undefined : undefined,
      address: isPrivate ? o.address?.trim() || undefined : undefined,
      isOwner: isPrivate ? !!o.isOwner : undefined,
      updatedAt: Date.now()
    };
    await db.observations.put(clean);
    toast(initial ? 'Lieu modifié' : 'Lieu ajouté');
    onClose();
  }

  async function remove() {
    if (!initial || !confirm('Supprimer ce lieu de vos observations ?')) return;
    await db.observations.delete(initial.id);
    toast('Lieu supprimé');
    onClose();
  }

  // Rendu hors de la fiche : la feuille ne doit pas hériter des styles de section.
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="obs-sheet-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet-body stack-16"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="row-between" style={{ alignItems: 'center' }}>
          <h2 id="obs-sheet-title" className="t-head">{frTypo('Où l’avez-vous vue ?')}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>

        <fieldset className="plain-fieldset stack-8">
          <legend className="label-mono">Type de lieu</legend>
          <div className="chips">
            {PLACE_KINDS.map((k) => (
              <button key={k.id} type="button" className="chip" aria-pressed={o.kind === k.id} onClick={() => set({ kind: k.id as PlaceKind })}>
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>{meta.nameLabel}</span>
          <input className="input" value={o.placeName} onChange={(e) => set({ placeName: e.target.value })} placeholder={isPrivate ? 'facultatif' : undefined} />
          {!initial && ctx.hints?.placeName && o.placeName === ctx.hints.placeName && <span className="t-small t-faint">Proposé d’après le cartel.</span>}
          {nearby.length > 0 && o.kind === 'musee' && (
            <span className="chips" style={{ marginTop: 4 }}>
              {nearby.map((p) => (
                <button key={p.id} type="button" className="chip" onClick={() => set({ placeName: p.name })}>
                  {p.name}
                </button>
              ))}
            </span>
          )}
        </label>

        <div className="form-2">
          <label className="field">
            <span>Ville</span>
            <input className="input" value={o.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" />
          </label>
          <label className="field">
            <span>{isSale ? 'Vu le' : 'Date'}</span>
            <input className="input input-mono" type="date" value={o.date} onChange={(e) => set({ date: e.target.value || today() })} />
          </label>
        </div>

        {isSale && (
          <>
            <div className="form-2">
              <label className="field">
                <span>Numéro de lot</span>
                <input className="input input-mono" value={o.lot ?? ''} onChange={(e) => set({ lot: e.target.value })} inputMode="numeric" />
              </label>
              <label className="field">
                <span>Date de la vente</span>
                <input className="input input-mono" type="date" value={o.saleDate ?? ''} onChange={(e) => set({ saleDate: e.target.value })} />
              </label>
            </div>
            {!initial && ctx.hints?.lot && o.lot === ctx.hints.lot && <p className="t-small t-faint" style={{ marginTop: 4 }}>Lot lu sur l’étiquette visible sur votre photo.</p>}
            <fieldset className="plain-fieldset stack-8" style={{ marginTop: 16 }}>
              <legend className="label-mono">Moment</legend>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={o.saleMoment === 'exposition'} onClick={() => set({ saleMoment: 'exposition' })}>
                  Exposition avant la vente
                </button>
                <button type="button" className="chip" aria-pressed={o.saleMoment === 'vente'} onClick={() => set({ saleMoment: 'vente' })}>
                  Pendant la vente
                </button>
              </div>
            </fieldset>
            <label className="field">
              <span>Estimation, facultatif</span>
              <input className="input" value={o.estimate ?? ''} onChange={(e) => set({ estimate: e.target.value })} />
            </label>
          </>
        )}

        {!isSale && !isPrivate && (
          <label className="field">
            <span>Exposition ou salle, facultatif</span>
            <input className="input" value={o.exhibition ?? ''} onChange={(e) => set({ exhibition: e.target.value })} />
          </label>
        )}

        {isPrivate && (
          <>
            <label className="field">
              <span>Adresse, facultatif</span>
              <input className="input" value={o.address ?? ''} onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" />
              <span className="t-small t-faint row" style={{ gap: 6 }}>
                <Icon name="lock" size={14} /> Reste sur votre téléphone, jamais envoyée.
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!o.isOwner} onChange={(e) => set({ isOwner: e.target.checked })} />
              <span>
                <strong>Je suis le propriétaire de l’œuvre</strong>
                <span className="t-small t-faint">Sinon, la collection ne peut pas être rendue publique par vous.</span>
              </span>
            </label>
          </>
        )}

        <fieldset className="plain-fieldset">
          <legend className="label-mono">Qui peut voir ce lieu</legend>
          <div className="vis-list">
            {visOptions.map((v) => {
              const disabled = !allowed.includes(v.id);
              return (
                <label key={v.id} className="vis-option" data-disabled={disabled || undefined}>
                  <input
                    type="radio"
                    name="visibility"
                    value={v.id}
                    checked={o.visibility === v.id}
                    disabled={disabled}
                    onChange={() => {
                      setVisTouched(true);
                      set({ visibility: v.id });
                    }}
                  />
                  <span>
                    <strong>{v.title}</strong>
                    {v.desc && <span className="t-small t-faint">{v.desc}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <button type="submit" className="btn btn-block">
          Enregistrer
        </button>
        {initial && (
          <button type="button" className="linkbtn" onClick={remove}>
            Supprimer ce lieu
          </button>
        )}
      </form>
    </div>,
    document.body
  );
}
