# Ranking gratuito: Firebase + Apps Script + Google Sheets

O navegador usa `Leaderboard.begin(idToken, roomCode?)` na largada, guarda o ticket e chama `submit(idToken, ticket, result, proof)` ao terminar, antes de sair da sala. A prova é `{ laps: [tempo1, tempo2, tempo3], checkpoints: [[0,...,11],[0,...,11],[0,...,11]] }`. Tempos em segundos; cada volta inclui suas penalidades. A soma das voltas deve coincidir com `raceTime` e a menor com `bestLap`.

O servidor valida o Firebase ID token anônimo com `accounts:lookup`, confere projeto/emissor/expiração/UID, limita tamanho da requisição e emite um ticket com UID, prazo e nonce. O envio exige três voltas, checkpoints ordenados, limites de tempo e duração plausível frente ao relógio do servidor. O tempo mínimo é 8 s por volta e 24 s por corrida; o ticket expira em 22 minutos. Há tolerância de 8 s para o atraso da emissão e até 120 s para envio após a chegada. Até 30 tickets por usuário/hora. Nenhuma chave privada ou conta de serviço vai para o frontend.

## Multiplayer e pontuação

Para salas, o servidor consulta `/lobbies/{code}` no Realtime Database usando o token do jogador. O ticket fixa `race.startAt` e `race.roster`. Só é emitido entre 5 s antes e 15 s depois da largada, uma vez por UID/sala/largada. Na chegada, o servidor compara o resultado com `/receipts/{code}/{uid}`, uma chegada imutável pelas regras do Firebase.

Vitórias e pontos são calculados no servidor somente quando **todos** os membros do roster da largada enviaram resultados aceitos com seus tickets. A ordem é o tempo final, e empates exatos usam UID para desempate determinístico. Pontos: 100, 60, 30 e 10. Desconexões, DNFs ou jogadores que não enviam seu ticket deixam a sala sem pontos/vitórias; nenhum cliente escolhe posição ou número de participantes. Corridas de uma pessoa contam somente como treino, sem pontos/vitórias. A resposta pública identifica `mode: time-trial` ou `multiplayer`; os melhores tempos são comunitários e a classificação prioriza pontos.

As simulações e as provas são produzidas por clientes. As regras Firebase tornam identidade, roster e chegadas imutáveis, mas **não demonstram que um carro percorreu fisicamente a pista**. Clientes modificados e usuários que controlam várias identidades podem falsificar uma corrida plausível. O ranking oferece proteção básica, não competição com servidor autoritativo. Autenticação anônima também permite criar novas identidades; a limitação por UID não substitui proteção contra abuso distribuído.

## Implantação via CLASP

1. Instale `@google/clasp` e faça `clasp login`. Ative a API Apps Script na conta se solicitado. Não reutilize projetos de outros trabalhos.
2. Na pasta `apps-script`, execute `clasp create --type standalone --title "Velocity Rush Ranking"`. Preserve o manifesto `appsscript.json` deste repositório caso o CLASP o substitua. O arquivo `.clasp.json` gerado permanece fora do Git.
3. Configure nas **Script Properties** do projeto: `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`. A API key identifica o projeto Firebase; não é uma chave privada. Configure restrições compatíveis com chamadas servidor-a-servidor a Identity Toolkit. Não coloque credenciais administrativas no código do jogo.
4. Execute `clasp push`. Execute a função `setup` uma vez no editor Apps Script e autorize os escopos; ela cria uma planilha nova e guarda `SPREADSHEET_ID`. Alternativamente crie uma planilha própria nova e configure esse ID. Não compartilhe a planilha publicamente.
5. Publique como aplicativo web, executando como o proprietário, acesso **qualquer pessoa**, incluindo anônimos. O manifesto configura `USER_DEPLOYING` / `ANYONE_ANONYMOUS`. `clasp deploy --description "Velocity Rush ranking"` cria uma versão; dependendo da conta, a primeira autorização do proprietário exige ação manual no Google.
6. Configure a URL `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` no jogo. Teste `curl -L URL?action=list`, que deve retornar `{ "ok": true, "entries": [] }` em uma planilha vazia.

CLASP autentica gerenciamento do projeto; isso não equivale à autorização de escopos de execução do aplicativo web. Se a conta ou organização impedir acesso anônimo, a implantação não funciona para GitHub Pages até essa permissão ser resolvida. Não habilite faturamento; Firebase Spark e Apps Script/Sheets têm cotas gratuitas e o jogo deve mostrar indisponibilidade ao atingi-las.

## Transporte e consistência

O frontend envia POST com `Content-Type: text/plain;charset=UTF-8` e JSON no corpo para evitar preflight CORS, seguindo o redirecionamento do ContentService. Nenhuma credencial fica na query string do navegador. Se a resposta do POST não for legível, consulta `GET?action=status&requestId=UUID`; esse UUID é uma capacidade aleatória que deve permanecer local. Só uma resposta JSON `ok:true` confirma sucesso. Resposta opaca e timeout não são tratados como envio salvo. A consulta pública `GET?action=list` não requer token.

Um ScriptLock serializa a emissão e a gravação, e cada ticket é aceito uma vez. A planilha Results é o registro canônico; não existe um contador incrementado separadamente que possa duplicar vitórias após falha parcial. A agregação deduplica tickets e calcula classificação lendo esse registro. Requests mantém recibos das operações para recuperar resposta perdida. Names têm limite e neutralização de prefixos de fórmula antes da gravação. Tickets, tokens e capacidades não aparecem na listagem pública; tokens não são armazenados.

Esta versão lê os registros para agregação e é adequada a uso pequeno. O histórico ocupa a planilha e as cotas de execução; não há promessa de escala ilimitada. Não exclua Results se quiser manter o histórico. Antes de arquivar Tickets/Requests, preserve tickets ativos e a janela necessária de recuperação.

## Verificação

`npm test -- tests/ranking.test.ts` valida identidade/projeto, relógio, checkpoints, soma de voltas, neutralização de fórmulas, deduplicação e pontos derivados de sala completa. A validação pura em `apps-script/Validation.js` é executada por VM Node, sem emular serviços Google. Autorização real do proprietário, token de um projeto Firebase configurado e HTTP entre GitHub Pages e a implantação exigem teste integrado separado; testes unitários não comprovam CORS na implantação final.

Referências oficiais: [ContentService e redirecionamentos](https://developers.google.com/apps-script/guides/content), [aplicativos web Apps Script](https://developers.google.com/apps-script/guides/web), [Firebase accounts:lookup](https://firebase.google.com/docs/reference/rest/auth/#section-get-account-info).
