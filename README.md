# Velocity Rush

Corrida arcade 3D no navegador: pista suspensa em neon com looping de 360°, salto sobre o vazio, túnel, descida, ponte estreita e atalhos. Três voltas, treino offline e salas privadas para até quatro pilotos.

**Jogar:** https://iapetec.github.io/velocity-rush/

Tecnologias: TypeScript, Three.js, Cannon-es, Vite, Firebase (Auth anônimo + Realtime Database, plano Spark gratuito), Apps Script + Google Sheets para o ranking e GitHub Pages para a hospedagem. Nenhum serviço pago. Os gráficos e os sons são gerados pelo próprio código, sem arquivos de terceiros.

## Modos

| Modo | O que precisa | Como funciona |
| --- | --- | --- |
| **Treino** | Nada | Corrida solo de 3 voltas. O recorde fica salvo no navegador. |
| **Sala privada** | Firebase configurado | "Criar sala privada" gera um código de 6 letras. Até 4 pilotos entram com o código, todos marcam "Estou pronto" e o anfitrião larga. |
| **Ranking global** | Firebase + Apps Script | Tempos validados no servidor. Pontos por sala completa: 100, 60, 30 e 10. |

## Controles

| Tecla | Ação |
| --- | --- |
| W / ↑ | Acelerar |
| S / ↓ | Frear / ré |
| A D / ← → | Direção |
| Espaço | Drift (recarrega o nitro) |
| Shift | Nitro |
| E | Usar item |
| R | Voltar ao checkpoint (+5 s) |
| C | Trocar câmera (atrás, cockpit, alta) |
| Esc | Pausar (só no treino) |

Em telas de toque aparecem botões na tela.

## Pista Neon Summit

- **Looping 360°**: o carro fica "magnetizado" na pista, até de cabeça para baixo.
- **Salto**: o vão exige uns 100 km/h. Há um booster dourado logo antes. Quem cai volta depois do vão, com +5 s.
- **Rota alternativa**: entre pela direita no primeiro desvio, depois do túnel.
- **Atalho secreto**: mais adiante, saia pela esquerda.
- **Ponte estreita** e **três obstáculos móveis**.

Ao voltar a um checkpoint, o carro nunca reaparece dentro do vão nem no meio do looping.

### Boosters (no chão)

Speed (aceleração), Nitro (+38% de nitro), Super (velocidade máxima de 403 km/h), Shield (bloqueia itens e obstáculos por 7 s) e Grip (aderência total por 7 s).

### Itens (tecla E, recarga de 5 s)

| Item | Efeito em quem é atingido |
| --- | --- |
| Oil Spill | Derrapa por 3,5 s |
| EMP Trap | Perde velocidade por 2,5 s |
| Ice Trap | Direção reduzida por 3 s |
| Road Block | Freada brusca |
| Shockwave | Empurra os rivais próximos para o lado |
| Slow Zone | Área de lentidão |
| Homing Orb | Persegue o rival logo à frente |
| Trap Switch | Os obstáculos móveis passam a frear os rivais |

## Ativar o modo online (Firebase, gratuito)

1. Faça login no Firebase CLI: `npx firebase login`.
2. Crie o projeto, o app web, o banco e o login anônimo, e publique as regras: `node scripts/setup-firebase.mjs`. O script grava `public/config.json`.
3. Publique: `git commit` e `git push`. O GitHub Actions recompila e publica o site.

Sem o script, faça o mesmo pelo console do Firebase. Crie um projeto no plano **Spark**. Ative **Authentication → Anonymous** e crie o **Realtime Database**. Publique `firebase/database.rules.json` com `npx firebase deploy --only database`. Por fim, cole o `firebaseConfig` do app web em `public/config.json`:

```json
{ "firebase": { "apiKey": "...", "authDomain": "...", "databaseURL": "...", "projectId": "...", "appId": "..." }, "leaderboardUrl": "" }
```

Os jogadores também podem colar essa configuração em **Configurações** dentro do jogo. A `apiKey` do Firebase é pública e não é uma senha. Nunca coloque chaves de conta de serviço no jogo.

O ranking global usa Apps Script + Google Sheets. Veja como publicar em [docs/RANKING.md](docs/RANKING.md).

## Desenvolvimento

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm test             # simulação, rede e validação do ranking
npm run test:rules   # regras do Firebase no emulador (requer Java 11+)
npm run build        # gera dist/
```

| Arquivo | Responsabilidade |
| --- | --- |
| `src/track.ts` | Geometria da pista, referenciais (inclusive invertidos), zonas, checkpoints, bifurcações |
| `src/simulation.ts` | Física arcade em passo fixo de 60 Hz, salto, quedas com Cannon-es, itens, voltas e prova de checkpoints |
| `src/renderer.ts` | Cena Three.js procedural, carros, partículas e câmeras |
| `src/network.ts` | Salas Firebase: vagas por transação, presença, eleição de anfitrião, snapshots a 10 Hz e recibo de chegada |
| `src/network-utils.ts` | Sanitização, interpolação e buffer de snapshots (testável sem Firebase) |
| `src/leaderboard.ts` | Cliente do ranking (POST sem preflight, recuperação por `requestId`) |
| `src/audio.ts` | Motor, vento, nitro e efeitos sintetizados com Web Audio |
| `src/main.ts` | Interface, HUD, lobby, resultados e laço do jogo |
| `firebase/database.rules.json` | Regras de segurança: identidade, formato, frequência e capacidade de 4 vagas |
| `apps-script/` | Validação e agregação do ranking no Google Sheets |

## Limites conhecidos

- Não há servidor autoritativo pago. Cada navegador simula o próprio carro. As regras do Firebase e o Apps Script barram dados malformados, duplicados ou implausíveis, mas um cliente modificado ainda consegue forjar uma corrida plausível.
- O login anônimo permite criar novas identidades. O ranking é para diversão entre amigos e turmas, não para competição oficial.
- Uma sala serve para uma largada. Para correr de novo, crie outra sala.
- As cotas gratuitas do Firebase Spark (100 conexões simultâneas) e do Apps Script limitam o uso a grupos pequenos.
