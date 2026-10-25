import type { fr } from './fr';

// Traduction anglaise partielle : les clés absentes retombent sur le français.
export const en: Partial<Record<keyof typeof fr, string>> = {
  'nav.home': 'Home',
  'nav.map': 'Map',
  'nav.scan': 'Scan',
  'nav.collection': 'Collection',
  'nav.profile': 'Profile',
  'home.scanTitle': 'Photograph an artwork',
  'home.scanText': 'Painting, sculpture, object, street art. Or the label next to it.',
  'home.random': 'Random',
  'home.recent': 'Your latest finds',
  'scan.artwork': 'Artwork',
  'scan.label': 'Label',
  'scan.import': 'Import',
  'entry.save': 'Add to my collection',
  'entry.saved': 'In my collection',
  'entry.ask': 'Ask a question',
  'common.back': 'Back'
};
