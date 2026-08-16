/**
 * Deterministic classifier — Section 1 (CLASSIFICATION).
 *
 * Rule-based and fully explainable: every assignment records which term fired.
 * If nothing fires and the source declares no single category, the article is
 * 'unclassified' — it is NOT forced into a bucket to make the UI look full.
 */
import type { SourceDef } from '../ingestion/sources.js';

export const CATEGORIES = [
  'general_news', 'natural_events', 'conspiracy_claims', 'politics', 'war_conflict',
  'economy', 'finance', 'crypto', 'technology', 'ai', 'science', 'space', 'health',
  'environment', 'energy', 'business', 'society', 'crime', 'transport', 'sports', 'culture',
] as const;
export type Category = (typeof CATEGORIES)[number] | 'unclassified';

export const CATEGORY_LABELS_PT: Record<string, string> = {
  general_news: 'Notícias Gerais', natural_events: 'Eventos Naturais', conspiracy_claims: 'Alegações',
  politics: 'Política', war_conflict: 'Guerra e Conflito', economy: 'Economia', finance: 'Finanças',
  crypto: 'Cripto', technology: 'Tecnologia', ai: 'Inteligência Artificial', science: 'Ciência',
  space: 'Espaço', health: 'Saúde', environment: 'Ambiente', energy: 'Energia', business: 'Empresas',
  society: 'Sociedade', crime: 'Crime', transport: 'Transportes', sports: 'Desporto', culture: 'Cultura',
  unclassified: 'Por classificar',
};

const RULES: Array<{ category: Category; terms: string[]; weight: number }> = [
  { category: 'natural_events', weight: 3, terms: ['earthquake', 'sismo', 'terramoto', 'magnitude', 'volcano', 'vulcão', 'tsunami', 'hurricane', 'furacão', 'typhoon', 'wildfire', 'incêndio florestal', 'flood', 'cheias', 'inundaç', 'landslide', 'drought', 'seca', 'storm surge', 'tempestade', 'aviso meteorológico', 'heatwave', 'onda de calor'] },
  { category: 'war_conflict', weight: 3, terms: ['war', 'guerra', 'airstrike', 'ataque aéreo', 'missile', 'míssil', 'drone strike', 'ceasefire', 'cessar-fogo', 'troops', 'tropas', 'offensive', 'ofensiva', 'militar', 'military operation', 'insurgent', 'bombardment', 'bombardeamento'] },
  { category: 'space', weight: 3, terms: ['nasa', 'esa', 'spacecraft', 'satellite', 'satélite', 'launch vehicle', 'rocket', 'foguetão', 'orbit', 'órbita', 'asteroid', 'asteroide', 'telescope', 'telescópio', 'mars', 'marte', 'lunar', 'iss'] },
  { category: 'ai', weight: 3, terms: ['artificial intelligence', 'inteligência artificial', 'machine learning', 'neural network', 'large language model', ' llm ', 'openai', 'anthropic', 'deepmind', 'chatgpt', 'transformer model'] },
  { category: 'crypto', weight: 3, terms: ['bitcoin', 'ethereum', 'blockchain', 'crypto', 'cripto', 'stablecoin', 'defi', ' nft'] },
  { category: 'health', weight: 3, terms: ['outbreak', 'surto', 'epidemic', 'pandemic', 'pandemia', 'vaccine', 'vacina', 'who ', 'oms ', 'disease', 'doença', 'hospital', 'clinical trial', 'ensaio clínico', 'cholera', 'measles', 'influenza'] },
  { category: 'economy', weight: 3, terms: ['inflation', 'inflação', 'gdp', 'pib', 'unemployment', 'desemprego', 'interest rate', 'taxa de juro', 'central bank', 'banco central', 'ecb', 'bce', 'federal reserve', 'recession', 'recessão', 'monetary policy'] },
  { category: 'finance', weight: 2, terms: ['stock market', 'bolsa', 'index fell', 'index rose', 'nasdaq', 'ftse', 'psi 20', 'bond yield', 'commodit', 'shares', 'acções', 'ipo'] },
  { category: 'energy', weight: 3, terms: ['oil price', 'petróleo', 'natural gas', 'gás natural', 'opec', 'opep', 'refinery', 'refinaria', 'nuclear plant', 'central nuclear', 'electricity grid', 'rede eléctrica', 'renewable', 'renovávei', 'blackout', 'apagão'] },
  { category: 'environment', weight: 2, terms: ['climate', 'clima', 'emissions', 'emissões', 'deforestation', 'desflorestação', 'biodiversity', 'biodiversidade', 'pollution', 'poluição', 'ocean warming', 'cop3', 'ipcc'] },
  { category: 'science', weight: 2, terms: ['study published', 'estudo publicado', 'researchers', 'investigadores', 'peer-reviewed', 'nature ', 'science journal', 'physics', 'física', 'quantum', 'genome', 'genoma', 'arxiv', 'preprint'] },
  { category: 'technology', weight: 2, terms: ['software', 'hardware', 'semiconductor', 'chip', 'smartphone', 'app ', 'cyberattack', 'ciberataque', 'data breach', 'telecom', 'internet outage'] },
  { category: 'crime', weight: 2, terms: ['arrested', 'detido', 'charged with', 'acusado', 'convicted', 'condenado', 'homicide', 'homicídio', 'fraud', 'fraude', 'trafficking', 'tráfico', 'police investigation', 'polícia'] },
  { category: 'transport', weight: 2, terms: ['airport', 'aeroporto', 'flight', 'voo', 'airline', 'companhia aérea', 'derailment', 'descarrilamento', 'train', 'comboio', 'port of', 'shipping lane', 'motorway', 'auto-estrada', 'plane crash'] },
  { category: 'politics', weight: 2, terms: ['election', 'eleiç', 'parliament', 'parlamento', 'government', 'governo', 'minister', 'ministro', 'president', 'presidente', 'sanctions', 'sanções', 'summit', 'cimeira', 'legislation', 'legislação', 'diplomat'] },
  { category: 'business', weight: 2, terms: ['acquisition', 'aquisição', 'merger', 'fusão', 'bankruptcy', 'insolvência', 'quarterly results', 'resultados trimestrais', 'layoffs', 'despedimentos', 'ceo '] },
  { category: 'society', weight: 1, terms: ['protest', 'protesto', 'strike', 'greve', 'education', 'educação', 'migration', 'migração', 'demograph', 'housing', 'habitação'] },
  { category: 'sports', weight: 2, terms: ['football', 'futebol', 'championship', 'campeonato', 'olympic', 'olímpic', 'world cup', 'mundial de'] },
  { category: 'culture', weight: 1, terms: ['film', 'filme', 'museum', 'museu', 'album', 'festival', 'literature', 'literatura'] },
];

export interface Classification {
  category: Category;
  basis: string;
  confidence: 'high' | 'medium' | 'low';
}

const ESC = /[.*+?^${}()|[\]\\]/g;
const boundaryCache = new Map<string, RegExp>();

/**
 * Terms must match whole words. Plain substring matching produced real
 * misclassifications (e.g. a swimming report tagged 'space' because "esa"
 * appears inside a Portuguese word). Multi-word and trailing-space terms are
 * matched as phrases.
 */
function termMatches(hay: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  let re = boundaryCache.get(t);
  if (!re) {
    // Letters/digits at the edges get a boundary; punctuation-ended stems don't.
    const left = /^[a-z0-9]/.test(t) ? '(?<![a-zà-ÿ0-9])' : '';
    const right = /[a-z0-9]$/.test(t) ? '(?![a-zà-ÿ0-9])' : '';
    re = new RegExp(`${left}${t.replace(ESC, '\\$&')}${right}`, 'i');
    boundaryCache.set(t, re);
  }
  return re.test(hay);
}

export function classify(title: string, summary: string | null, source?: Pick<SourceDef, 'categories' | 'origin_type'>): Classification {
  const hay = ` ${title} ${summary ?? ''} `.toLowerCase();
  const hits = new Map<Category, { score: number; terms: string[] }>();

  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (termMatches(hay, term)) {
        const cur = hits.get(rule.category) ?? { score: 0, terms: [] };
        cur.score += rule.weight;
        cur.terms.push(term.trim());
        hits.set(rule.category, cur);
      }
    }
  }

  // A single-category source acts as a prior, recorded explicitly.
  const declared = (source?.categories ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (declared.length === 1) {
    const cat = declared[0] as Category;
    const cur = hits.get(cat) ?? { score: 0, terms: [] };
    cur.score += 2;
    cur.terms.push(`source declares category=${cat}`);
    hits.set(cat, cur);
  }

  if (hits.size === 0) {
    return { category: 'unclassified', basis: 'no classification rule matched; not forced into a category', confidence: 'low' };
  }
  const ranked = [...hits.entries()].sort((a, b) => b[1].score - a[1].score);
  const [cat, info] = ranked[0];
  const runnerUp = ranked[1]?.[1].score ?? 0;
  const confidence = info.score >= 6 && info.score > runnerUp ? 'high' : info.score >= 3 ? 'medium' : 'low';
  return {
    category: cat,
    basis: `matched: ${[...new Set(info.terms)].slice(0, 6).join(', ')} (score ${info.score}${runnerUp ? `, runner-up ${ranked[1][0]} ${runnerUp}` : ''})`,
    confidence,
  };
}
