# Velocity Rush Implementation Plan

> Execução: núcleo em sequência; módulos de apresentação e serviços isolados podem ser delegados conforme dispatching-parallel-agents. Testar antes de integrar cada etapa.

**Goal:** jogo arcade completo com treino e multiplayer gratuito.
**Architecture:** simulação independente do DOM; renderizador Three.js consome snapshots; Firebase sincroniza estados/eventos; Apps Script verifica resultados e agrega Sheets.
**Tech Stack:** TypeScript, Three.js, Cannon-es, Firebase, CLASP, Vite, Vitest.
**Spec:** ../specs/2026-11-24-velocity-rush-design.md

## Global Constraints
Até quatro jogadores; três voltas; zero serviços pagos; preservar arquivos existentes; sem automação de janelas. Não afirmar testes online que não foram executados.

## Review Focus
Entradas concorrentes na quarta vaga; desconexão do host; salto do checkpoint para burlar volta; roll da câmera no looping; duplicação de resultado/ranking.

## Etapas
1. [x] `src/track.ts`, `src/simulation.ts`, `tests/simulation.test.ts`: referencial contínuo, aceleração/direção/drift/Cannon, prova de inversão no loop.
2. [x] Corrida individual: contagem, três voltas, progresso ordenado, tempos, término; testes com passos fixos.
3. [x] Saltos/checkpoints/rotas: detectar quedas, penalidade, restaurar último checkpoint; testes de pouso e caminho alternativo.
4. [x] Boosters e armadilhas: cinco boosters/oito itens, duração, escudo/cooldown e efeitos; testes de aplicação/expiração.
5. [x] `src/network.ts`, `firebase/database.rules.json`, `tests/network.test.ts`: sala privada, transações quatro vagas, presença, largada única, snapshots e eventos. Teste emulador se disponível.
6. [x] `apps-script/`, `src/leaderboard.ts`: token Firebase, validação de resultados e idempotência, Sheets e CLASP; testes unitários da validação.
7. [x] `src/renderer.ts`, `src/main.ts`, `src/style.css`: visual, HUD, garagem/lobby/resultado/ranking, áudio procedural. Compilar e testar integração; documentar limites sem GUI.
8. [x] `README.md`, `.github/workflows/pages.yml`: instruções completas, publicar novo repositório e validar URL HTTP.

Cada etapa usa teste de comportamento RED→GREEN e execução da suíte. Atualizações registradas em `docs/PROGRESS.md`.
