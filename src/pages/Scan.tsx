import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/ui';
import { session } from '../lib/session';
import { preparePhoto } from '../lib/image';
import { getSetting } from '../lib/db';
import { t } from '../i18n';

export function Scan() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [mode, setMode] = useState<'artwork' | 'label'>(params.get('mode') === 'cartel' ? 'label' : 'artwork');
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let s: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(t('scan.noCamera'));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((ms) => {
        if (cancelled) return ms.getTracks().forEach((tr) => tr.stop());
        s = ms;
        setStream(ms);
      })
      .catch((e: any) =>
        setCamError(
          e?.name === 'NotAllowedError'
            ? 'Accès à la caméra refusé. Autorisez-le dans les réglages de Safari, ou utilisez « Ouvrir l’appareil photo ».'
            : t('scan.noCamera')
        )
      );
    return () => {
      cancelled = true;
      s?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  // La vidéo n'existe dans la page qu'une fois le flux obtenu : on l'y branche à ce moment-là.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream]);

  async function handle(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const { upload, thumb } = await preparePhoto(blob);
      stream?.getTracks().forEach((tr) => tr.stop());
      const prev = session.get();
      session.reset(mode);
      // Un cartel photographié juste après l'œuvre peut lui être associé : on garde l'analyse précédente.
      if (mode === 'label' && prev.response) session.set({ response: prev.response, thumb: prev.thumb, photo: prev.photo });
      session.set(mode === 'label' ? { mode, labelPhoto: upload } : { mode, photo: upload, thumb });
      const wantsGeo = await getSetting<boolean>('saveLocation');
      if (wantsGeo && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => session.set({ geo: { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy } }),
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      }
      nav('/analyse', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Photo illisible.');
      setBusy(false);
    }
  }

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return captureRef.current?.click();
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => b && handle(b), 'image/jpeg', 0.92);
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handle(f);
    e.target.value = '';
  };

  return (
    <div className="scan-screen">
      <div className="scan-top">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label="Fermer">
          <Icon name="close" />
        </button>
        <div className="segmented" role="group" aria-label="Que photographiez-vous ?">
          <button aria-pressed={mode === 'artwork'} onClick={() => setMode('artwork')}>
            {t('scan.artwork')}
          </button>
          <button aria-pressed={mode === 'label'} onClick={() => setMode('label')}>
            {t('scan.label')}
          </button>
        </div>
        <span style={{ width: 44 }} />
      </div>

      <div className="viewfinder">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted />
        ) : (
          <div className="stack-16" style={{ padding: 32, textAlign: 'center', maxWidth: 360 }}>
            <p style={{ color: 'var(--wall-ink-2)' }}>{camError ?? 'Ouverture de la caméra…'}</p>
            {camError && (
              <button className="btn btn-wall" onClick={() => captureRef.current?.click()}>
                Ouvrir l’appareil photo
              </button>
            )}
          </div>
        )}
        <div className={`corners ${mode === 'label' ? 'label' : ''}`} aria-hidden>
          <i />
        </div>
        <p className="scan-hint">{busy ? 'Préparation de la photo…' : error ?? (mode === 'artwork' ? t('scan.hintArtwork') : t('scan.hintLabel'))}</p>
      </div>

      <div className="scan-bottom">
        <button className="scan-side" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="image" />
          {t('scan.import')}
        </button>
        <button className="shutter" onClick={shoot} disabled={busy} aria-label={t('scan.take')}>
          <i />
        </button>
        <span />
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} data-testid="file-input" />
      <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    </div>
  );
}
