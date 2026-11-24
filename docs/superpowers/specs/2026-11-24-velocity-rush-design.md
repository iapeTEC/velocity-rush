# Velocity Rush — projeto

Construir jogo utilizável no navegador, em português, três voltas, treino e salas privadas de até quatro participantes. Tecnologias: TypeScript, Three.js, Cannon-es, Firebase Auth anônimo/Realtime Database Spark, Apps Script/Sheets via CLASP e GitHub Pages. Sem serviços pagos e sem recursos gráficos de terceiros.

Decisão: controlador arcade em coordenadas de pista com referencial tridimensional contínuo, aderência magnética e integração Cannon-es quando há salto/queda. Isso mantém loopings previsíveis em hardware modesto. Rede publica snapshots a 10 Hz e interpola remotos; eventos de itens têm validade e cooldown. Sem servidor autoritativo pago: regras limitam identidade, formato, frequência e capacidade; ranking valida tokens, tempos, checkpoints/recibos e duplicatas, mas não promete eliminar clientes modificados.

Pista: loop completo, curvas inclinadas, salto, altura, túnel, grande descida, ponte estreita, obstáculos móveis e duas bifurcações. Respawn acrescenta cinco segundos. Nitro/drift, cinco boosters e oito itens com efeitos visíveis. HUD completo, garagem, lobby, resultados e ranking. Low/Medium/High limitam pixel ratio, cenário e partículas.

Execução direta autorizada pelo usuário; não abrir/controlar UI gráfica. Verificar com testes Node de simulação, integração Firebase quando houver emulador e compilação. Publicar via CLI somente projeto novo. Não reutilizar credenciais/projetos de outros trabalhos.
