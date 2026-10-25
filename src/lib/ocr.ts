import { parseLabelText } from '../../shared/labelParse';
import type { LabelFields } from '../../shared/types';

// OCR local et gratuit (Tesseract.js), utilisé quand l'IA n'est pas disponible.
// Le moteur et les données de langue (~2 à 4 Mo) sont téléchargés au premier usage depuis un CDN.
export async function ocrLabel(image: Blob, onProgress?: (p: number) => void): Promise<LabelFields> {
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker(['fra', 'eng'], 1, {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    }
  });
  try {
    const { data } = await worker.recognize(image);
    return parseLabelText(data.text ?? '');
  } finally {
    await worker.terminate();
  }
}
