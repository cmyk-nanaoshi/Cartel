// Préparation des photos côté téléphone, avant tout envoi :
// redimensionnement à 1568 px de grand côté (au-delà, l'API réduit l'image et facture quand même
// l'envoi), compression JPEG et vignette pour la collection.

export async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    } catch {
      /* format non pris en charge par createImageBitmap (HEIC sur certains navigateurs) */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible. Essayez une photo au format JPEG ou PNG.'));
    img.src = url;
  });
}

export async function resizeToJpeg(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, cw, ch);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Compression impossible.'))), 'image/jpeg', quality)
  );
}

export async function preparePhoto(file: Blob) {
  if (file.size > 40 * 1024 * 1024) throw new Error('Fichier trop lourd (40 Mo maximum).');
  const upload = await resizeToJpeg(file, 1568, 0.85);
  const thumb = await resizeToJpeg(file, 640, 0.8);
  return { upload, thumb };
}

export async function sha256Hex(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function blobUrl(blob?: Blob | null) {
  return blob ? URL.createObjectURL(blob) : undefined;
}
