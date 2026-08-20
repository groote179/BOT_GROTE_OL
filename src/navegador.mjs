import { chromium } from 'playwright';

// A OLX fica atras do Cloudflare, que bloqueia por "impressao digital" da conexao.
// Testado: curl/Node puro levam 403. Chromium com estes ajustes passa (HTTP 200).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const ARGS = [
  '--disable-blink-features=AutomationControlled', // esconde o sinal de "navegador automatizado"
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

export async function abrirNavegador() {
  const navegador = await chromium.launch({ headless: true, args: ARGS });

  const contexto = await navegador.newContext({
    userAgent: UA, // sem isso o UA entrega "HeadlessChrome" e o Cloudflare barra
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
  });

  // Nao baixa imagem/css/fonte: a busca fica ~5x mais rapida e gasta menos banda.
  await contexto.route('**/*', (rota) => {
    const tipo = rota.request().resourceType();
    return ['image', 'font', 'media', 'stylesheet'].includes(tipo) ? rota.abort() : rota.continue();
  });

  const pagina = await contexto.newPage();

  return {
    pagina,
    async abrir(url) {
      const resposta = await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const status = resposta ? resposta.status() : 0;
      if (status !== 200) throw new Error(`HTTP ${status} ao abrir ${url}`);
      return pagina.content();
    },
    async fechar() {
      await navegador.close().catch(() => {});
    },
  };
}
