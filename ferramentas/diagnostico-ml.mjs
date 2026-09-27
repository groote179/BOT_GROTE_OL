// Diagnostico do Mercado Livre: roda igual no PC e no GitHub Actions,
// grava o resultado em JSON para dar pra comparar os dois ambientes.
//
//   node ferramentas/diagnostico-ml.mjs            (no PC)
//   xvfb-run -a node ferramentas/diagnostico-ml.mjs (no GitHub, sem monitor)
//
// Descoberta ate aqui: o muro de login do ML e por "pontuacao de robo", decidida
// no servidor. Chromium headless e barrado; Chrome DE VERDADE COM JANELA passa.
// A pergunta que este arquivo responde agora: isso vale tambem saindo do IP do
// GitHub, com o Chrome rodando numa tela virtual?

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ONDE = process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'PC local';
const relatorio = { ambiente: ONDE, quando: new Date().toISOString(), rede: {}, api: {}, headless: {}, chrome_com_janela: {} };

// --- de onde estamos saindo para a internet ---
try {
  const r = await fetch('https://ipinfo.io/json');
  const j = await r.json();
  relatorio.rede = { ip: j.ip, pais: j.country, regiao: j.region, provedor: j.org };
} catch (e) { relatorio.rede = { erro: e.message }; }

// --- API (referencia; sabemos que esta fechada) ---
for (const [nome, url] of Object.entries({
  busca: 'https://api.mercadolibre.com/sites/MLB/search?q=tag+heuer&limit=5',
  domain_discovery: 'https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=tag+heuer',
})) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    relatorio.api[nome] = { status: r.status, corpo: (await r.text()).slice(0, 100).replace(/\s+/g, ' ') };
  } catch (e) { relatorio.api[nome] = { erro: e.message }; }
}

const ALVOS = {
  listagem: 'https://lista.mercadolivre.com.br/tag-heuer',
  listagem_usados_preco: 'https://lista.mercadolivre.com.br/tag-heuer_PriceRange_1500-7000_ITEM*CONDITION_2230581',
  ofertas: 'https://www.mercadolivre.com.br/ofertas',
};

async function medir(pg) {
  const resp = await pg.goto(pg._alvo, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pg.waitForTimeout(3000);
  const cards = await pg.$$eval('li.ui-search-layout__item, div.poly-card', (e) => e.length).catch(() => 0);
  const total = await pg.$eval('.ui-search-search-result__quantity-results', (e) => e.textContent.trim()).catch(() => null);
  return {
    status: resp?.status() ?? null,
    barrado: /account-verification|challenge/.test(pg.url()),
    anuncios: cards,
    total,
    titulo: (await pg.title()).slice(0, 60),
  };
}

async function rodarLote(destino, launch) {
  let nav;
  try {
    nav = await chromium.launch(launch);
  } catch (e) {
    destino._erro_launch = e.message.split('\n')[0].slice(0, 120);
    return;
  }
  for (const [nome, url] of Object.entries(ALVOS)) {
    const ctx = await nav.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1536, height: 864 } });
    const pg = await ctx.newPage();
    pg._alvo = url;
    try { destino[nome] = await medir(pg); }
    catch (e) { destino[nome] = { erro: e.message.split('\n')[0].slice(0, 80) }; }
    finally { await ctx.close(); }
    await new Promise((s) => setTimeout(s, 1500));
  }
  await nav.close();
}

// 1) como o robo faz hoje: Chromium headless (esperado: barrado)
await rodarLote(relatorio.headless, {
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
});

// 2) o que passou no PC: Chrome de verdade, com janela (no GitHub, dentro do xvfb)
await rodarLote(relatorio.chrome_com_janela, {
  channel: 'chrome',
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
});

const destino = path.join(process.cwd(), 'dados', `diagnostico-ml-${ONDE === 'PC local' ? 'local' : 'github'}.json`);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
console.log(JSON.stringify(relatorio, null, 2));
console.log('\nGravado em:', destino);
