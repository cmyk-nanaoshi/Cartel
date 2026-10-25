import type { SavedArtwork, ThemeCollection } from './db';

// Export de la collection : CSV (tableur) et PDF (catalogue imprimable).

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV au séparateur point-virgule, avec BOM UTF-8, pour une ouverture correcte dans Excel en français. */
export function collectionToCsv(items: SavedArtwork[], collections: ThemeCollection[]): string {
  const colName = new Map(collections.map((c) => [c.id, c.name]));
  const head = [
    'Titre', 'Artiste', 'Date', 'Nature', 'Mouvement', 'Technique', 'Dimensions', 'Institution',
    'Inventaire', 'Tags', 'Collections', 'Notes', 'Ajoutée le', 'Latitude', 'Longitude', 'Sources'
  ];
  const rows = items.map((a) => {
    const e = a.entry;
    return [
      e.title, e.artist, e.date, e.objectKind, e.movement, e.technique, e.dimensions, e.institution, e.inventory,
      a.tags.join(', '), a.collectionIds.map((id) => colName.get(id)).filter(Boolean).join(', '), a.notes,
      new Date(a.createdAt).toLocaleDateString('fr-FR'), a.geo?.lat, a.geo?.lon, e.sources.map((s) => s.url).join(' ')
    ];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(b);
  });
}

/**
 * Catalogue PDF A4. Grille : marges 18 mm, 2 colonnes de 81 mm, gouttière 12 mm, ligne de base 4,5 pt × 1,25.
 * Une œuvre par demi-page : photo à gauche, cartel à droite.
 */
export async function collectionToPdf(items: SavedArtwork[], title = 'Ma collection'): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 18;
  const COL = 81;
  const G = 12;
  const W = 210;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(title, M, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${items.length} œuvre${items.length > 1 ? 's' : ''}. Exporté le ${new Date().toLocaleDateString('fr-FR')} depuis Cartel.`, M, 39);
  doc.setLineWidth(0.3);
  doc.line(M, 43, W - M, 43);

  let y = 52;
  const blockH = 112;
  for (const a of items) {
    if (y + blockH > 297 - M) {
      doc.addPage();
      y = M;
    }
    const e = a.entry;
    if (a.photo) {
      try {
        const url = await blobToDataUrl(a.photo);
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = url;
        });
        const ratio = img.width / img.height;
        let w = COL;
        let h = COL / ratio;
        if (h > blockH - 8) {
          h = blockH - 8;
          w = h * ratio;
        }
        doc.addImage(url, 'JPEG', M, y, w, h);
      } catch {
        /* photo illisible : on continue sans */
      }
    }
    const x = M + COL + G;
    let ty = y + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(doc.splitTextToSize(e.artist, COL), x, ty);
    ty += 6;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(12);
    const tl = doc.splitTextToSize(e.title, COL);
    doc.text(tl, x, ty);
    ty += tl.length * 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = [e.date, e.technique, e.dimensions, e.institution, e.inventory ? `Inv. ${e.inventory}` : null].filter(Boolean) as string[];
    for (const l of lines) {
      const s = doc.splitTextToSize(l, COL);
      doc.text(s, x, ty);
      ty += s.length * 4.5;
    }
    const summary = e.sections.find((s) => s.id === 'resume')?.claims.map((c) => c.text).join(' ');
    if (summary) {
      ty += 3;
      const s = doc.splitTextToSize(summary, COL).slice(0, 8);
      doc.text(s, x, ty);
      ty += s.length * 4.5;
    }
    if (a.notes) {
      ty += 3;
      doc.setFont('helvetica', 'italic');
      const s = doc.splitTextToSize(`Note : ${a.notes}`, COL).slice(0, 5);
      doc.text(s, x, ty);
      ty += s.length * 4.5;
      doc.setFont('helvetica', 'normal');
    }
    if (e.sources[0]) {
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      doc.text(doc.splitTextToSize(`Source : ${e.sources[0].sourceLabel}, ${e.sources[0].url}`, COL).slice(0, 2), x, Math.min(ty + 4, y + blockH - 6));
      doc.setTextColor(0);
    }
    y += blockH + 8;
  }
  return doc.output('blob');
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
