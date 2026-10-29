// Schémas JSON pour les sorties structurées.
// Contraintes de l'API Claude : additionalProperties:false sur chaque objet, pas de minLength,
// pas de minimum/maximum, pas de schéma récursif.
// https://platform.claude.com/docs/build-with-claude/structured-outputs

const str = { type: 'string' };
const nstr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const strArr = { type: 'array', items: { type: 'string' } };

function obj(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export const OBJECT_KINDS = [
  'peinture', 'sculpture', 'photographie', 'dessin', 'estampe', 'installation',
  'objet_design', 'art_urbain', 'architecture', 'arts_decoratifs', 'autre'
];

const labelFields = {
  title: nstr,
  artist: nstr,
  artistDates: nstr,
  date: nstr,
  medium: nstr,
  dimensions: nstr,
  inventory: nstr,
  institution: nstr,
  creditLine: nstr,
  description: nstr,
  rawText: { ...str, description: 'Transcription intégrale du cartel, ligne par ligne, mot pour mot.' }
};

export const identifySchema = obj({
  isArtwork: { type: 'boolean', description: "Vrai si l'image montre une œuvre, un objet d'art ou de design, ou un monument." },
  label: {
    anyOf: [obj(labelFields), { type: 'null' }],
    description: 'Cartel du musée visible sur la photo, lu champ par champ, tel qu’il est écrit. null si aucun cartel n’est lisible.'
  },
  imageQualityIssue: { ...nstr, description: 'Problème empêchant l’analyse (flou, reflet, cadrage), sinon null.' },
  objectKind: { type: 'string', enum: OBJECT_KINDS },
  description: { ...str, description: 'Description factuelle de ce qui est visible, 2 à 4 phrases.' },
  visibleText: { ...strArr, description: 'Texte lisible dans l’image (cartel, titre), transcrit exactement.' },
  inscriptions: { ...strArr, description: 'Signatures, dates, monogrammes ou marques visibles sur l’œuvre elle-même.' },
  hypotheses: {
    type: 'array',
    description: 'Œuvres précises reconnues, de la plus probable à la moins probable. Vide si aucune reconnaissance réelle.',
    items: obj({
      title: { ...str, description: 'Titre usuel, en français si une traduction établie existe.' },
      artist: { ...str, description: 'Nom de l’artiste, ou « Anonyme » / atelier si c’est documenté.' },
      date: nstr,
      confidence: { type: 'number', description: 'Probabilité estimée entre 0 et 1.' },
      reasoning: { ...str, description: 'Indices visuels concrets qui fondent cette hypothèse.' },
      distinguishing: { ...str, description: 'Ce qui permettrait de la distinguer des autres hypothèses, versions ou copies.' }
    })
  },
  searchQueries: { ...strArr, description: 'Requêtes courtes pour vérifier dans des catalogues (titre original, titre anglais, artiste).' }
});

export const labelSchema = obj(labelFields);

const claim = obj({
  text: str,
  kind: { type: 'string', enum: ['fait', 'observation', 'interpretation', 'hypothese'] },
  sources: { ...strArr, description: 'Identifiants des notices fournies qui étayent la phrase (ex. "S1"). Vide si aucune.' }
});

export const entrySchema = obj({
  objectKind: { type: 'string', enum: OBJECT_KINDS },
  movement: { ...nstr, description: 'Mouvement ou école, en français, seulement si une source l’indique.' },
  technique: { ...nstr, description: 'Technique telle que donnée par le cartel, sinon par les notices, traduite en français (ex. « Estampe nishiki-e, format ōban »).' },
  artistLine: { ...nstr, description: 'Nom en écriture d’origine s’il figure dans les sources, nationalité et dates de l’artiste, en français (ex. « 葛飾 北斎, japonais, 1760-1849 »).' },
  sections: {
    type: 'array',
    items: obj({
      id: {
        type: 'string',
        enum: ['resume', 'contexte', 'analyse', 'technique', 'iconographie', 'demarche', 'provenance', 'localisation', 'inscriptions']
      },
      claims: { type: 'array', items: claim }
    })
  }
});
