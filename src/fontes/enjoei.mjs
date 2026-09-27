// Leitor do Enjoei.
//
// O site e renderizado no navegador, mas a busca vem de uma API GraphQL
// "persisted query" chamada por GET - da pra consultar direto, sem navegador.
// Testado: o fetch do Node passa sem bloqueio (ao contrario da OLX).
//
// Sem ordenacao por data: a API aceita "sort", mas so como objeto GraphQL,
// que o gateway GET nao transporta. Em compensacao ela informa o "total" e
// pagina por cursor, entao o robo varre a busca inteira e deixa a deduplicacao
// por id decidir o que e novo. Para buscas de nicho isso e barato: sao poucas
// centenas de itens, em JSON.

const BASE = 'https://enjusearch.enjoei.com.br/graphql-search-x';

// Identificador da consulta salva no servidor do Enjoei. Se um dia o site for
// atualizado e este id mudar, a busca passa a voltar vazia - e o ponto a checar.
const QUERY_ID = 'c5faa5f85fb47bf0beaa97b67d8a9189';

const POR_PAGINA = 50; // o servidor limita em ~50, pedir mais nao adianta
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export const nome = 'Enjoei';
export const precisaNavegador = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultar(parametros) {
  const p = new URLSearchParams({
    operation_name: 'searchProducts',
    query_id: QUERY_ID,
    search_context: 'products_search_default',
    first: String(POR_PAGINA),
    ...parametros,
  });

  const resposta = await fetch(`${BASE}?${p}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Origin: 'https://www.enjoei.com.br',
      Referer: 'https://www.enjoei.com.br/',
    },
  });

  if (!resposta.ok) throw new Error(`HTTP ${resposta.status} na API do Enjoei`);

  const json = await resposta.json();
  if (json.errors?.length) throw new Error(`API do Enjoei: ${json.errors[0].message}`);

  return json?.data?.search?.products || {};
}

/** Monta a URL da foto. O id ja vem em base64 e entra na URL como esta. */
function urlDaFoto(produto) {
  const id = produto?.photo?.image_public_id;
  return id ? `https://photos.enjoei.com.br/public/800x800/${id}` : null;
}

function precoEmTexto(preco) {
  if (preco?.current == null) return 'Sem preço';
  const atual = `R$ ${preco.current.toLocaleString('pt-BR')}`;
  // mostra o "de/por" quando ha desconto real
  return preco.original && preco.original > preco.current
    ? `${atual} (de R$ ${preco.original.toLocaleString('pt-BR')})`
    : atual;
}

/** Converte para o mesmo formato usado pela fonte da OLX. */
function padronizar(p) {
  const loja = p.store?.displayable?.name || p.store?.path || '';
  return {
    id: `enjoei-${p.id}`,
    titulo: (p.title?.name || '').trim(),
    preco: p.price?.current ?? null,
    precoTexto: precoEmTexto(p.price),
    local: loja ? `loja ${loja}` : 'Enjoei',
    url: `https://www.enjoei.com.br/p/${p.path}`,
    imagem: urlDaFoto(p),
    idadeHoras: null, // o Enjoei nao informa a data; a deduplicacao por id cobre isso
    profissional: false,
    categoria: null,
    categoriaNome: p.brand?.displayable_name || null,
    fonte: 'Enjoei',
  };
}

/**
 * Varre a busca inteira (respeitando o teto de paginas) e devolve tudo
 * no formato padrao do robo.
 */
export async function buscar(busca) {
  const filtros = { term: busca.termo };
  if (busca.precoMin != null) filtros.price_min = String(busca.precoMin);
  if (busca.precoMax != null) filtros.price_max = String(busca.precoMax);

  const maxPaginas = busca.paginas || 4;
  const encontrados = [];
  const vistos = new Set();
  let cursor = null;
  let total = null;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const resultado = await consultar(cursor ? { ...filtros, after: cursor } : filtros);
    const arestas = resultado.edges || [];
    if (total == null) total = resultado.total ?? null;
    if (arestas.length === 0) break;

    for (const aresta of arestas) {
      if (!aresta.node?.id || vistos.has(aresta.node.id)) continue;
      vistos.add(aresta.node.id);
      encontrados.push(padronizar(aresta.node));
    }

    cursor = arestas[arestas.length - 1].cursor;
    if (total != null && encontrados.length >= total) break; // ja pegou tudo
    if (pagina < maxPaginas) await dormir(800); // gentileza com o servidor
  }

  if (encontrados.length === 0) {
    throw new Error('A API respondeu mas nao veio nenhum produto - o query_id pode ter mudado');
  }

  return { anuncios: encontrados, total };
}
