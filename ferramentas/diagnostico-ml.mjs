// Diagnostico do Mercado Livre: roda igual no PC e no GitHub Actions,
// grava o resultado em JSON para dar pra comparar os dois ambientes.
//
//   node ferramentas/diagnostico-ml.mjs
//
// A pergunta que ele responde: o muro de login do ML e por IP/regiao
// (entao o GitHub pode ter sorte diferente) ou e para todo mundo?

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ONDE = process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'PC local';

const relatorio = { ambiente: ONDE, quando: new Date().toISOString(), rede: {}, api: {}, site: {} };

// --- de onde estamos saindo para a internet ---
try {
  const r = await fetch('https://ipinfo.io/json', { headers: { 'User-Agent': UA } });
  const j = await r.json();
  relatorio.rede = { ip: j.ip, pais: j.country, regiao: j.region, provedor: j.org };
} catch (e) {
  relatorio.rede = { erro: e.message };
}

// --- endpoints de API ---
const API = {
  sites_MLB: 'https://api.mercadolibre.com/sites/MLB',
  busca: 'https://api.mercadolibre.com/sites/MLB/search?q=tag+heuer&limit=5',
  catalogo: 'https://api.mercadolibre.com/products/search?site_id=MLB&status=active&q=tag+heuer',
  domain_discovery: 'https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=tag+heuer',
};

for (const [nome, url] of Object.entries(API)) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const corpo = (await r.text()).slice(0, 120).replace(/\s+/g, ' ');
    relatorio.api[nome] = { status: r.status, corpo };
  } catch (e) {
    relatorio.api[nome] = { erro: e.message };
  }
  await new Promise((s) => setTimeout(s, 400));
}

// --- site, com navegador de verdade ---
const navegador = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
});

const SITE = {
  home: 'https://www.mercadolivre.com.br/',
  listagem: 'https://lista.mercadolivre.com.br/tag-heuer',
  listagem_com_preco: 'https://lista.mercadolivre.com.br/tag-heuer_PriceRange_1500-7000',
  ofertas: 'https://www.mercadolivre.com.br/ofertas',
};

for (const [nome, url] of Object.entries(SITE)) {
  const ctx = await navegador.newContext({ userAgent: UA, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1366, height: 768 } });
  const pg = await ctx.newPage();
  try {
    const resp = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await pg.waitForTimeout(1500);
    const urlFinal = pg.url();
    const cards = await pg.$$eval('li.ui-search-layout__item, div.poly-card', (e) => e.length).catch(() => 0);
    relatorio.site[nome] = {
      status: resp?.status() ?? null,
      barrado: /account-verification|challenge/.test(urlFinal),
      anuncios: cards,
      titulo: (await pg.title()).slice(0, 60),
    };
  } catch (e) {
    relatorio.site[nome] = { erro: e.message.split('\n')[0].slice(0, 80) };
  } finally {
    await ctx.close();
  }
  await new Promise((s) => setTimeout(s, 1500));
}

await navegador.close();

const destino = path.join(process.cwd(), 'dados', `diagnostico-ml-${ONDE === 'PC local' ? 'local' : 'github'}.json`);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));

console.log(JSON.stringify(relatorio, null, 2));
console.log('\nGravado em:', destino);
