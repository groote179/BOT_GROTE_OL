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
    };
  } catch {
    return { primeiraVez: true, vistos: {}, ultimaExecucao: null };
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
    JSON.stringify({ ultimaExecucao: new Date().toISOString(), total: Object.keys(vistos).length, vistos }, null, 2)
  );
}

export function jaVisto(estado, id) {
  return Object.prototype.hasOwnProperty.call(estado.vistos, id);
}

export function marcarVisto(estado, id) {
  estado.vistos[id] = Date.now();
}
