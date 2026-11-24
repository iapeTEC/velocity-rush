# Progresso

Plano: docs/superpowers/plans/2026-11-24-velocity-rush.md

- Projeto novo isolado em C:/Users/dell2/velocity-rush. Não há código anterior.
- Usuário dispensa perguntas e autoriza publicação; conservar fluxo por CLI.
- Contratos compartilhados em src/types.ts. Simulação usa metros/segundos; rede usa epoch milissegundos; resultado usa segundos.

## 24/11/2026: conclusão (Claude Code, continuando o Codex)

Publicado em https://iapetec.github.io/velocity-rush/ (repositório iapeTEC/velocity-rush, deploy via GitHub Actions a cada push na main).

Corrigido em relação ao que o Codex deixou:
- Não compilava (`network.finish` inexistente); `Multiplayer.finish` agora grava estado final + recibo sem disputar com o publish periódico.
- Regras do Firebase não carregavam (`numChildren` não existe em regras RTDB).
- Direção invertida: o vetor `right` da pista apontava para a esquerda do piloto.
- Fim do circuito chegava à largada no sentido oposto (giro de 180°) e sobreposto à reta inicial.
- Salto: voo em linha reta pelo Cannon não pousava na curva; agora é balístico em coordenadas de pista (precisa de ~100 km/h).
- Respawn podia cair dentro do vão (loop infinito de quedas) ou no meio do looping; agora `Track.safeDistance`.
- Bifurcações flutuavam sobre a pista principal e a rota alternativa terminava na ponte sem proteção; refeitas como saídas laterais.
- Guard-rails por lado (exceto ponte estreita e atalho secreto) e funil antes da ponte.
- Cliente quebraria com vaga vazia no meio (RTDB devolve array com `null`).
- Layout: rodapé cobria "Entrar" em telas baixas; controles de toque só apareciam em celulares estreitos.
- Treino solo nunca enviava tempo ao ranking.
- Manifesto do Apps Script implantado sem acesso anônimo (v1 exige login Google).

Verificação: 27 testes unitários (`npm test`), 6 de integração no emulador (`npm run test:rules`, Java 21 portátil em ~/tools/jre21), incluindo partida de 4 clientes reais. Partida de 2 jogadores pela interface testada em Chromium headless contra o emulador.

Pendente (depende de login do dono):
- `npx firebase login` e depois `node scripts/setup-firebase.mjs`: cria projeto Spark, banco, login anônimo, regras, grava public/config.json e atualiza o Apps Script.
- Abrir uma vez a URL do Apps Script logado como dono, para autorizar Planilhas e UrlFetch.
