import fs from 'fs';
import path from 'path';

const ARQUIVO = path.join(process.cwd(), 'dados', 'vistos.json');
const VALIDADE_DIAS = 30; // anuncio visto ha mais de 30 dias sai do arquivo

export function carregar() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return {
      // "Primeira vez" e nunca ter rodado de verdade - nao apenas o arquivo faltar.
      // Sem isso, um vistos.json vazio versionado no GitHub faria o robo achar que
      // ja rodou e disparar dezenas de alertas de anuncios antigos na estreia.
      primeiraVez: !dados.ultimaExecucao,
      vistos: dados.vistos || {},
      ultimaExecucao: dados.ultimaExecucao || null,
      // Buscas que ja rodaram alguma vez. Uma busca recem-adicionada tambem
      // merece estreia silenciosa, senao acrescentar uma marca nova despeja
      // centenas de anuncios antigos no Telegram de uma vez.
      buscasConhecidas: dados.buscasConhecidas || [],
      // Dia (AAAA-MM-DD) do ultimo "sinal de vida" enviado no Telegram.
      ultimoSinalDeVida: dados.ultimoSinalDeVida || null,
      // Quando (timestamp) cada busca avisou por ultimo que estava com problema.
      // Evita repetir o mesmo aviso a cada 15 minutos enquanto o problema persiste.
      ultimosAvisosDeErro: dados.ultimosAvisosDeErro || {},
    };
  } catch {
    return { primeiraVez: true, vistos: {}, ultimaExecucao: null, buscasConhecidas: [], ultimoSinalDeVida: null, ultimosAvisosDeErro: {} };
  }
}

export function salvar(estado) {
  // limpa registros antigos pra o arquivo nao crescer pra sempre
  const limite = Date.now() - VALIDADE_DIAS * 24 * 60 * 60 * 1000;
  const vistos = {};
  for (const [id, quando] of Object.entries(estado.vistos)) {
    if (quando >= limite) vistos[id] = quando;
  }

  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(
    ARQUIVO,
    JSON.stringify({
      ultimaExecucao: new Date().toISOString(),
      total: Object.keys(vistos).length,
      buscasConhecidas: estado.buscasConhecidas,
      ultimoSinalDeVida: estado.ultimoSinalDeVida,
      ultimosAvisosDeErro: estado.ultimosAvisosDeErro,
      vistos,
    }, null, 2)
  );
}

export function jaVisto(estado, id) {
  return Object.prototype.hasOwnProperty.call(estado.vistos, id);
}

export function marcarVisto(estado, id) {
  estado.vistos[id] = Date.now();
}

/** Uma busca que nunca rodou tambem ganha estreia silenciosa. */
export function buscaEhNova(estado, nomeDaBusca) {
  return !estado.buscasConhecidas.includes(nomeDaBusca);
}

export function marcarBuscaConhecida(estado, nomeDaBusca) {
  if (buscaEhNova(estado, nomeDaBusca)) estado.buscasConhecidas.push(nomeDaBusca);
}

const COOLDOWN_AVISO_ERRO_MS = 60 * 60 * 1000; // 1 hora

/** So deixa avisar de novo sobre a mesma busca quebrada depois de 1 hora. */
export function podeAvisarErro(estado, nomeDaBusca) {
  const ultimo = estado.ultimosAvisosDeErro[nomeDaBusca];
  return !ultimo || Date.now() - ultimo >= COOLDOWN_AVISO_ERRO_MS;
}

export function marcarAvisoDeErro(estado, nomeDaBusca) {
  estado.ultimosAvisosDeErro[nomeDaBusca] = Date.now();
}

/** Limpa o "em cooldown" quando a busca volta a funcionar. */
export function limparAvisoDeErro(estado, nomeDaBusca) {
  delete estado.ultimosAvisosDeErro[nomeDaBusca];
}
