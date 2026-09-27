// Leitor da OLX.
// A pagina de busca ja vem com todos os anuncios em JSON dentro do HTML
// (payload do Next.js em self.__next_f.push). Muito mais confiavel do que
// ler o visual da pagina, que muda toda hora.

export const nome = 'OLX';
export const precisaNavegador = true; // a OLX bloqueia requisicao sem navegador

/** Junta os pedacos do payload do Next.js num texto so. */
function juntarPayload(html) {
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m, buf = '';
  while ((m = re.exec(html))) {
    try { buf += JSON.parse(m[1]); } catch { /* pedaco truncado: ignora */ }
  }
  return buf;
}

/** Recorta os objetos de anuncio de dentro de "ads":[ ... ] contando chaves. */
function recortarAnuncios(payload) {
  const inicio = payload.indexOf('"ads":[');
  if (inicio < 0) return [];

  const anuncios = [];
  let profundidade = 0, comeco = inicio;

  for (let i = inicio + 7; i < payload.length; i++) {
    const c = payload[i];
    if (c === '{') { if (profundidade === 0) comeco = i; profundidade++; }
    else if (c === '}') {
      profundidade--;
      if (profundidade === 0) {
        try {
          const a = JSON.parse(payload.slice(comeco, i + 1));
          if (a.listId && a.url) anuncios.push(a);
        } catch { /* objeto invalido: ignora */ }
      }
    } else if (c === ']' && profundidade === 0) break; // fim da lista
  }
  return anuncios;
}

/** Converte "R$ 4.500" em 4500 (number). Retorna null se nao houver preco. */
function precoEmNumero(texto) {
  if (!texto) return null;
  const digitos = String(texto).replace(/[^\d]/g, '');
  return digitos ? Number(digitos) : null;
}

/** Normaliza para o formato unico usado pelo robo (mesmo formato valera pro Enjoei). */
function padronizar(a) {
  return {
    id: `olx-${a.listId}`,
    titulo: (a.subject || '').trim(),
    preco: precoEmNumero(a.priceValue),
    precoTexto: a.priceValue || 'Sem preço',
    local: (a.location || '').replace(/\s+/g, ' ').trim(),
    url: a.url,
    imagem: a.images?.[0]?.original || null,
    idadeHoras: a.lastBumpAgeSecs != null ? Number(a.lastBumpAgeSecs) / 3600 : null,
    profissional: !!a.professionalAd,
    categoria: a.searchCategoryLevelOne ?? null, // ex: 8080 = Acessorios (onde ficam os relogios)
    categoriaNome: a.categoryName || null,
    fonte: 'OLX',
  };
}

/** Monta a URL da pagina N, forcando ordenacao por mais recentes (sf=1). */
export function montarUrl(urlBase, pagina = 1) {
  const u = new URL(urlBase);
  u.searchParams.set('sf', '1');            // ordena do mais novo pro mais antigo
  if (pagina > 1) u.searchParams.set('o', String(pagina));
  return u.toString();
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le as paginas pedidas e devolve tudo no formato padrao do robo. */
export async function buscar(busca, ctx) {
  const encontrados = [];
  const vistos = new Set();
  const maxPaginas = busca.paginas || 1;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const html = await ctx.navegador.abrir(montarUrl(busca.url, pagina));
    const anuncios = recortarAnuncios(juntarPayload(html));

    if (anuncios.length === 0) {
      throw new Error('A pagina abriu mas nenhum anuncio foi lido - a OLX pode ter mudado o formato');
    }

    for (const anuncio of anuncios) {
      if (vistos.has(anuncio.listId)) continue;
      vistos.add(anuncio.listId);
      encontrados.push(padronizar(anuncio));
    }

    if (pagina < maxPaginas) await dormir(2000);
  }

  return { anuncios: encontrados, total: null };
}
