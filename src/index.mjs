import fs from 'fs';
import path from 'path';

// Carrega o arquivo .env quando rodando no PC. No GitHub as credenciais
// vem dos "Secrets", entao a ausencia do .env nao e problema.
try { process.loadEnvFile('.env'); } catch { /* sem .env: segue o jogo */ }

import { abrirNavegador } from './navegador.mjs';
import * as olx from './fontes/olx.mjs';
import * as enjoei from './fontes/enjoei.mjs';
import * as estadoDb from './estado.mjs';
import * as telegram from './notificacao/telegram.mjs';

const FONTES = { olx, enjoei };

// --modo-teste: nao envia nada, so mostra o que faria
const MODO_TESTE = process.argv.includes('--modo-teste');
// --avisar-tudo: na primeira execucao, avisa em vez de so registrar o que ja existe
const AVISAR_TUDO = process.argv.includes('--avisar-tudo');

const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), '|', ...a);
const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000));

function textoNormalizado(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // tira acentos
}

/**
 * Procura o termo no texto casando PALAVRA INTEIRA.
 * Assim "tag" acha "TAG Heuer" mas nao acha "vanTAGem".
 */
function contemTermo(texto, termo) {
  const alvo = textoNormalizado(termo).trim();
  if (!alvo) return false;
  const escapado = alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escapado}([^a-z0-9]|$)`, 'i').test(texto);
}

/** Aplica os filtros da busca. Retorna null se passou, ou o motivo da recusa. */
function motivoParaDescartar(anuncio, busca, opcoes) {
  const titulo = textoNormalizado(anuncio.titulo);

  // Filtro por categoria: muito mais confiavel que palavra no titulo.
  // Ex: "Chevrolet Omega GLS" contem "omega", mas esta na categoria de carros.
  const permitidas = busca.categoriasPermitidas || [];
  if (permitidas.length && anuncio.categoria != null && !permitidas.includes(anuncio.categoria)) {
    return `categoria errada: ${anuncio.categoriaNome || anuncio.categoria}`;
  }

  const proibida = (busca.excluirPalavras || []).find((p) => contemTermo(titulo, p));
  if (proibida) return `palavra excluída: "${proibida}"`;

  const exigidas = busca.exigirPalavras || [];
  if (exigidas.length && !exigidas.some((p) => contemTermo(titulo, p))) {
    return 'não é do que você procura';
  }

  const limiteHoras = busca.idadeMaximaHoras ?? opcoes.idadeMaximaHoras;
  if (limiteHoras && anuncio.idadeHoras != null && anuncio.idadeHoras > limiteHoras) {
    return `anúncio antigo (${Math.round(anuncio.idadeHoras)}h)`;
  }

  return null;
}

async function principal() {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
  const opcoes = config.opcoes || {};
  const estado = estadoDb.carregar();

  if (estado.primeiraVez && !AVISAR_TUDO) {
    log('PRIMEIRA EXECUÇÃO: vou apenas registrar os anúncios atuais, sem alertar.');
    log('A partir da próxima rodada, você recebe só o que for novo.');
  }
  if (!telegram.estaConfigurado() && !MODO_TESTE) {
    log('AVISO: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID não configurados — rodando sem enviar alertas.');
  }

  const novidades = [];
  const problemas = []; // linhas de log/e-mail: TODA falha entra aqui, sem cooldown
  const problemasParaAvisar = []; // subconjunto que efetivamente vai virar mensagem no Telegram

  // O navegador so e aberto se alguma busca precisar dele (a OLX precisa, o
  // Enjoei nao). Assim uma rodada so de Enjoei nem carrega o Chromium.
  const ctx = { navegador: null };
  const precisaNavegador = config.buscas.some((b) => FONTES[b.fonte || 'olx']?.precisaNavegador);

  try {
    if (precisaNavegador) {
      log('Abrindo o navegador (necessário para a OLX)...');
      ctx.navegador = await abrirNavegador();
    }

    for (const busca of config.buscas) {
      const fonte = FONTES[busca.fonte || 'olx'];
      if (!fonte) {
        const msg = `Fonte desconhecida em "${busca.nome}": ${busca.fonte}`;
        problemas.push(msg);
        if (estadoDb.podeAvisarErro(estado, busca.nome)) { problemasParaAvisar.push(msg); estadoDb.marcarAvisoDeErro(estado, busca.nome); }
        continue;
      }

      // Busca recem-adicionada: registra o acervo atual calado, como na estreia.
      const estreando = estadoDb.buscaEhNova(estado, busca.nome) && !AVISAR_TUDO;

      log(`Buscando: ${busca.nome}  [${fonte.nome}]${estreando ? '  (estreia: não vai alertar)' : ''}`);
      let achadosNaBusca = 0;

      try {
        const { anuncios, total } = await fonte.buscar(busca, ctx);
        log(`  ${anuncios.length} anúncios lidos${total != null ? ` (de ${total} no total)` : ''}`);

        for (const anuncio of anuncios) {
          if (estadoDb.jaVisto(estado, anuncio.id)) continue;
          estadoDb.marcarVisto(estado, anuncio.id);

          const motivo = motivoParaDescartar(anuncio, busca, opcoes);
          if (motivo) { log(`    ✗ ${anuncio.titulo.slice(0, 40)} — ${motivo}`); continue; }

          achadosNaBusca++;
          if (estreando) continue; // ja ficou marcado como visto; so nao avisa
          novidades.push({ anuncio, nomeBusca: busca.nome });
          log(`    ★ NOVO: ${anuncio.precoTexto} — ${anuncio.titulo.slice(0, 45)}`);
        }

        estadoDb.marcarBuscaConhecida(estado, busca.nome);
        estadoDb.limparAvisoDeErro(estado, busca.nome); // voltou a funcionar: reseta o cooldown de aviso
        log(estreando
          ? `  → ${achadosNaBusca} anúncio(s) registrados em silêncio (alertas começam na próxima rodada)`
          : `  → ${achadosNaBusca} novidade(s) nesta busca`);
      } catch (erro) {
        const msg = `Busca "${busca.nome}": ${erro.message}`;
        problemas.push(msg);
        log(`  ERRO: ${erro.message}`);
        // So repete o aviso no Telegram 1x por hora por busca - senao uma
        // madrugada ruim da OLX vira uma dezena de mensagens identicas.
        if (estadoDb.podeAvisarErro(estado, busca.nome)) {
          problemasParaAvisar.push(msg);
          estadoDb.marcarAvisoDeErro(estado, busca.nome);
        } else {
          log('  (aviso no Telegram represado: ja avisei sobre esta busca na última hora)');
        }
      }

      await dormir(opcoes.pausaEntreBuscasSegundos ?? 4);
    }
  } finally {
    if (ctx.navegador) await ctx.navegador.fechar();
  }

  // Na primeira execucao so registra, pra nao disparar 50 mensagens de uma vez.
  const deveAvisar = (!estado.primeiraVez || AVISAR_TUDO) && !MODO_TESTE && telegram.estaConfigurado();

  if (deveAvisar && novidades.length) {
    const maximo = opcoes.maxAlertasPorRodada ?? 12;
    const enviar = novidades.slice(0, maximo);

    for (const { anuncio, nomeBusca } of enviar) {
      try {
        await telegram.enviarAnuncio(anuncio, nomeBusca);
        await dormir(0.6); // respeita o limite de mensagens do Telegram
      } catch (erro) {
        problemas.push(`Telegram: ${erro.message}`);
      }
    }
    if (novidades.length > maximo) {
      await telegram.enviarAviso(`… e mais ${novidades.length - maximo} anúncio(s) novo(s) não listados nesta rodada.`).catch(() => {});
    }
    log(`${enviar.length} alerta(s) enviado(s) no Telegram.`);
  }

  if (problemas.length) {
    log('Problemas:', problemas.join(' | '));
    if (deveAvisar && problemasParaAvisar.length) {
      await telegram.enviarAviso(`⚠️ <b>Robô OLX</b>\n${problemasParaAvisar.map((p) => '• ' + p).join('\n')}`).catch(() => {});
    }
  }

  // No modo teste nada e gravado, entao da pra rodar quantas vezes quiser
  // sem "queimar" os anuncios (eles continuam contando como novos).
  if (MODO_TESTE) {
    // Mostra como ficariam as mensagens (sem as marcacoes <b>/<a> do Telegram).
    const amostra = novidades.slice(0, 3);
    for (const { anuncio, nomeBusca } of amostra) {
      const texto = telegram
        .montarMensagem(anuncio, nomeBusca)
        .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2: $1')
        .replace(/<\/?[bi]>/g, '');
      console.log('\n┌─ prévia da mensagem no Telegram ─────────────');
      for (const linha of texto.split('\n')) console.log('│ ' + linha);
      console.log('└──────────────────────────────────────────────');
    }
    log(`MODO TESTE: nada enviado, nada gravado. (${novidades.length} mensagens seriam montadas)`);
  } else {
    // Sinal de vida: UMA mensagem por dia, na primeira rodada depois das 8h (horario
    // de Sao Paulo). Cobre o unico defeito que nenhum alerta pega: o robo nao rodar.
    // Se a mensagem da manha nao vier, algo travou (agendador, permissao, conta).
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
    const hora = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
    if (telegram.estaConfigurado() && estado.ultimoSinalDeVida !== hoje && hora >= 8) {
      const [ano, mes, dia] = hoje.split('-');
      const buscasOk = config.buscas.length - problemas.length;
      await telegram
        .enviarAviso(
          `✅ <b>Robô ativo</b> — ${dia}/${mes}/${ano}\n` +
          `${buscasOk} de ${config.buscas.length} buscas OK · ${Object.keys(estado.vistos).length} anúncios na memória` +
          (novidades.length ? ` · ${novidades.length} novidade(s) nesta rodada` : ''),
        )
        .then(() => { estado.ultimoSinalDeVida = hoje; log('Sinal de vida enviado.'); })
        .catch((e) => log('Nao consegui enviar o sinal de vida:', e.message));
    }

    estadoDb.salvar(estado);
  }
  log(`Fim. ${novidades.length} novidade(s) | ${Object.keys(estado.vistos).length} anúncios na memória.`);

  // falha a execucao se TUDO deu errado (util pro GitHub avisar por e-mail)
  if (problemas.length && problemas.length >= config.buscas.length) process.exitCode = 1;
}

principal().catch(async (erro) => {
  console.error('ERRO FATAL:', erro);
  // Erro antes/fora das buscas (navegador nao abriu, config.json invalido...):
  // ainda assim tenta avisar no Telegram, senao so o e-mail do GitHub contaria.
  if (!MODO_TESTE && telegram.estaConfigurado()) {
    await telegram
      .enviarAviso(`🛑 <b>Robô parou antes de buscar</b>\n${String(erro.message || erro).slice(0, 500)}`)
      .then(() => console.error('Aviso de erro enviado no Telegram.'))
      .catch((e) => console.error('Nao consegui avisar no Telegram:', e.message));
  }
  process.exit(1);
});
