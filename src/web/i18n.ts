/**
 * Internacionalização — §61.
 *
 * REGRA ABSOLUTA: a tradução nunca pode alterar factos, números ou evidências.
 *
 * Por isso este módulo traduz **apenas a interface**: rótulos, botões, títulos
 * de secção e texto explicativo. Nunca toca em:
 *
 *   - títulos de artigos ou eventos (são o texto literal da fonte);
 *   - resumos fornecidos pelos feeds;
 *   - citações, medições, coordenadas, nomes de fontes;
 *   - a base (`basis`) de um score ou de uma relação do grafo.
 *
 * Um título em inglês continua em inglês com a interface em português, e
 * vice-versa. Traduzi-lo seria reescrever a evidência, que é exactamente o que
 * a especificação proíbe. `EventCard` e `EventPage` mostram sempre o original.
 */

export type Lang = 'pt' | 'en';
export const LANGS: Lang[] = ['pt', 'en'];
export const DEFAULT_LANG: Lang = 'pt';

type Dict = Record<string, string>;

const PT: Dict = {
  // navegação
  'nav.home': 'Home',
  'nav.today': 'Hoje',
  'nav.breaking': 'Breaking',
  'nav.trending': 'Trending',
  'nav.map': 'Mapa',
  'nav.brief': 'Daily Brief',
  'nav.my': 'My Intelligence',
  'nav.more': 'Mais',
  'nav.mostViewed': 'Mais Vistos',
  'nav.status': 'Estado do sistema',
  'nav.about': 'Metodologia',
  'nav.search': 'Pesquisar eventos…',
  'nav.searchLabel': 'Pesquisar eventos',
  'nav.mainLabel': 'Navegação principal',
  'nav.moreLabel': 'Mais secções',
  'nav.skip': 'Saltar para o conteúdo',

  // ordenação
  'sort.by': 'Ordenar por',
  'sort.recent': 'Mais recente',
  'sort.impact': 'Life Impact',
  'sort.confidence': 'Confidence',
  'sort.relevance': 'Relevance',
  'sort.desc': 'maior',
  'sort.asc': 'menor',
  'sort.naHint': 'Eventos sem score calculado (N/A) aparecem no fim.',
  'sort.tipDesc': 'Ordenado do maior para o menor — clique para inverter',
  'sort.tipAsc': 'Ordenado do menor para o maior — clique para inverter',
  'sort.tipSet': 'Ordenar por',

  // home
  'home.title': 'O que está a acontecer',
  'home.sub': 'Eventos construídos a partir de artigos de fontes reais, agrupados, verificados e pontuados. Cada número desta página tem origem rastreável.',
  'home.situation': 'Global Situation',
  'home.situationSub': 'Contadores directos da base de dados. Não é um índice científico.',
  'home.breaking': 'Breaking — últimas 12h',
  'home.top': 'Top Stories',
  'home.trending': 'Trending Now',
  'home.natural': 'Eventos Naturais',
  'home.conflict': 'Guerra e Conflito',
  'home.economy': 'Economia',
  'home.tech': 'Tecnologia',

  // contadores
  'count.published': 'Eventos publicados',
  'count.articles': 'Artigos ingeridos',
  'count.sourcesOnline': 'Fontes online',
  'count.conflicts': 'Conflitos abertos',
  'count.review': 'Em revisão humana',
  'count.audit': 'Registos de auditoria',

  // cartão
  'card.noLocation': 'Localização não indicada',
  'card.articles': 'artigo(s)',
  'card.groups': 'grupo(s)',
  'card.views': 'views',

  // estados vazios
  'empty.noData': 'NO VERIFIED DATA AVAILABLE',
  'empty.noDataSection': 'Nenhum evento publicado nesta secção neste momento. Nada é gerado para preencher o espaço.',
  'empty.noActivity': 'SEM ACTIVIDADE REAL REGISTADA',
  'empty.noFilter': 'Não existem eventos publicados que correspondam a este filtro.',

  // página de evento
  'ev.whatHappened': 'What happened?',
  'ev.whatWeKnow': 'What we know',
  'ev.whatWeDontKnow': "What we don't know",
  'ev.whyMatters': 'Why does it matter?',
  'ev.whatChanged': 'What changed?',
  'ev.sourceConflict': 'Source conflict',
  'ev.whatNext': 'What happens next?',
  'ev.sources': 'Fontes',
  'ev.timeline': 'Timeline',
  'ev.verification': 'Verificação e auditoria',
  'ev.related': 'Eventos relacionados',
  'ev.follow': 'Acompanhar',
  'ev.share': 'Partilhar',
  'ev.measurements': 'Medições da fonte',
  'ev.approxLocation': 'APPROXIMATE LOCATION',
  'ev.updated': 'Actualizado',
  'ev.lastVerified': 'Last verified',
  'ev.never': 'nunca',
  'ev.extracted': 'Afirmações extraídas e verificadas',

  // rodapé
  'foot.tagline': 'dados reais, fontes reais, eventos reais, rastreabilidade completa.',
  'foot.disclaimer': 'Esta plataforma não inventa acontecimentos. Quando não existem dados verificados, mostra NO VERIFIED DATA AVAILABLE. Quando as fontes divergem, mostra o conflito. Quando um score não pode ser calculado, mostra N/A.',
  'foot.method': 'Metodologia',
  'foot.status': 'Estado do sistema',
  'foot.api': 'API',
  'foot.support': '☕ Apoiar',
  'foot.sitemap': 'Sitemap',

  // tema e idioma
  'ui.theme': 'Tema',
  'ui.themeDark': 'Escuro',
  'ui.themeLight': 'Claro',
  'ui.themeToggle': 'Mudar para tema claro',
  'ui.themeToggleDark': 'Mudar para tema escuro',
  'ui.language': 'Idioma',

  // listas
  'list.allEvents': 'Todos os eventos',
  'list.today': 'Hoje no Mundo',
  'list.breaking': 'Breaking',
  'list.trending': 'Trending Now',
  'list.country': 'País',
  'list.search': 'Pesquisa',
  'list.notFound': 'Página não encontrada.',
};

const EN: Dict = {
  'nav.home': 'Home',
  'nav.today': 'Today',
  'nav.breaking': 'Breaking',
  'nav.trending': 'Trending',
  'nav.map': 'Map',
  'nav.brief': 'Daily Brief',
  'nav.my': 'My Intelligence',
  'nav.more': 'More',
  'nav.mostViewed': 'Most Viewed',
  'nav.status': 'System status',
  'nav.about': 'Methodology',
  'nav.search': 'Search events…',
  'nav.searchLabel': 'Search events',
  'nav.mainLabel': 'Main navigation',
  'nav.moreLabel': 'More sections',
  'nav.skip': 'Skip to content',

  'sort.by': 'Sort by',
  'sort.recent': 'Most recent',
  'sort.impact': 'Life Impact',
  'sort.confidence': 'Confidence',
  'sort.relevance': 'Relevance',
  'sort.desc': 'highest',
  'sort.asc': 'lowest',
  'sort.naHint': 'Events with no computed score (N/A) appear last.',
  'sort.tipDesc': 'Sorted highest to lowest — click to reverse',
  'sort.tipAsc': 'Sorted lowest to highest — click to reverse',
  'sort.tipSet': 'Sort by',

  'home.title': 'What is happening',
  'home.sub': 'Events built from articles by real sources: clustered, verified and scored. Every number on this page is traceable to its origin.',
  'home.situation': 'Global Situation',
  'home.situationSub': 'Direct counters from the database. Not a scientific index.',
  'home.breaking': 'Breaking — last 12h',
  'home.top': 'Top Stories',
  'home.trending': 'Trending Now',
  'home.natural': 'Natural Events',
  'home.conflict': 'War & Conflict',
  'home.economy': 'Economy',
  'home.tech': 'Technology',

  'count.published': 'Published events',
  'count.articles': 'Articles ingested',
  'count.sourcesOnline': 'Sources online',
  'count.conflicts': 'Open conflicts',
  'count.review': 'In human review',
  'count.audit': 'Audit records',

  'card.noLocation': 'Location not stated',
  'card.articles': 'article(s)',
  'card.groups': 'group(s)',
  'card.views': 'views',

  'empty.noData': 'NO VERIFIED DATA AVAILABLE',
  'empty.noDataSection': 'No published event in this section right now. Nothing is generated to fill the space.',
  'empty.noActivity': 'NO REAL ACTIVITY RECORDED',
  'empty.noFilter': 'There are no published events matching this filter.',

  'ev.whatHappened': 'What happened?',
  'ev.whatWeKnow': 'What we know',
  'ev.whatWeDontKnow': "What we don't know",
  'ev.whyMatters': 'Why does it matter?',
  'ev.whatChanged': 'What changed?',
  'ev.sourceConflict': 'Source conflict',
  'ev.whatNext': 'What happens next?',
  'ev.sources': 'Sources',
  'ev.timeline': 'Timeline',
  'ev.verification': 'Verification and audit',
  'ev.related': 'Related events',
  'ev.follow': 'Follow',
  'ev.share': 'Share',
  'ev.measurements': 'Provider measurements',
  'ev.approxLocation': 'APPROXIMATE LOCATION',
  'ev.updated': 'Updated',
  'ev.lastVerified': 'Last verified',
  'ev.never': 'never',
  'ev.extracted': 'Extracted and verified claims',

  'foot.tagline': 'real data, real sources, real events, full traceability.',
  'foot.disclaimer': 'This platform does not invent events. When there is no verified data it shows NO VERIFIED DATA AVAILABLE. When sources disagree it shows the conflict. When a score cannot be computed it shows N/A.',
  'foot.method': 'Methodology',
  'foot.status': 'System status',
  'foot.api': 'API',
  'foot.support': '☕ Support',
  'foot.sitemap': 'Sitemap',

  'ui.theme': 'Theme',
  'ui.themeDark': 'Dark',
  'ui.themeLight': 'Light',
  'ui.themeToggle': 'Switch to light theme',
  'ui.themeToggleDark': 'Switch to dark theme',
  'ui.language': 'Language',

  'list.allEvents': 'All events',
  'list.today': 'Today in the World',
  'list.breaking': 'Breaking',
  'list.trending': 'Trending Now',
  'list.country': 'Country',
  'list.search': 'Search',
  'list.notFound': 'Page not found.',
};

const DICTS: Record<Lang, Dict> = { pt: PT, en: EN };

/** Categorias — rótulos de interface, logo traduzíveis. */
export const CATEGORY_LABELS: Record<Lang, Record<string, string>> = {
  pt: {
    general_news: 'Notícias Gerais', natural_events: 'Eventos Naturais', conspiracy_claims: 'Alegações',
    politics: 'Política', war_conflict: 'Guerra e Conflito', economy: 'Economia', finance: 'Finanças',
    crypto: 'Cripto', technology: 'Tecnologia', ai: 'Inteligência Artificial', science: 'Ciência',
    space: 'Espaço', health: 'Saúde', environment: 'Ambiente', energy: 'Energia', business: 'Empresas',
    society: 'Sociedade', crime: 'Crime', transport: 'Transportes', sports: 'Desporto', culture: 'Cultura',
    unclassified: 'Por classificar',
  },
  en: {
    general_news: 'General News', natural_events: 'Natural Events', conspiracy_claims: 'Claims',
    politics: 'Politics', war_conflict: 'War & Conflict', economy: 'Economy', finance: 'Finance',
    crypto: 'Crypto', technology: 'Technology', ai: 'Artificial Intelligence', science: 'Science',
    space: 'Space', health: 'Health', environment: 'Environment', energy: 'Energy', business: 'Business',
    society: 'Society', crime: 'Crime', transport: 'Transport', sports: 'Sports', culture: 'Culture',
    unclassified: 'Unclassified',
  },
};

export function normaliseLang(v: unknown): Lang {
  const s = String(v ?? '').toLowerCase().slice(0, 2);
  return (LANGS as string[]).includes(s) ? (s as Lang) : DEFAULT_LANG;
}

/** Aceita o cabeçalho Accept-Language do browser como omissão. */
export function langFromHeader(header: string | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  for (const part of header.split(',')) {
    const code = part.split(';')[0].trim().toLowerCase();
    if (code.startsWith('pt')) return 'pt';
    if (code.startsWith('en')) return 'en';
  }
  return DEFAULT_LANG;
}

export interface Translator {
  (key: string, fallback?: string): string;
  lang: Lang;
  /** Rótulo de categoria no idioma corrente. */
  cat: (key: string) => string;
}

export function translator(lang: Lang): Translator {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LANG];
  const t = ((key: string, fallback?: string): string => {
    const v = dict[key] ?? DICTS[DEFAULT_LANG][key];
    // Uma chave em falta aparece como a própria chave: fica óbvio em revisão,
    // em vez de desaparecer silenciosamente.
    return v ?? fallback ?? key;
  }) as Translator;
  t.lang = lang;
  t.cat = (key: string) =>
    CATEGORY_LABELS[lang]?.[key] ?? CATEGORY_LABELS[DEFAULT_LANG][key] ?? key;
  return t;
}

export type Theme = 'dark' | 'light';
export function normaliseTheme(v: unknown): Theme {
  return String(v ?? '') === 'light' ? 'light' : 'dark';
}
