/* Pure validation shared by Apps Script V8 and the Node test harness. Times are seconds. */
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function safeCell(value) {
  var text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function verifyClaims(claims, project, uid, now) {
  requireValue(claims && claims.aud === project && claims.iss === 'https://securetoken.google.com/' + project, 'Projeto Firebase inválido.');
  requireValue(claims.sub === uid && typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 'Identidade inválida.');
  requireValue(Number.isFinite(claims.exp) && claims.exp * 1000 > now && Number.isFinite(claims.iat) && claims.iat * 1000 <= now + 30000, 'Token expirado.');
  requireValue(claims.firebase && claims.firebase.sign_in_provider === 'anonymous', 'Use autenticação anônima do jogo.');
  return uid;
}

function validateRace(result, proof, ticket, uid, now) {
  requireValue(ticket && ticket.uid === uid && result && result.uid === uid, 'Ticket pertence a outro jogador.');
  requireValue(now >= ticket.issuedAt && now <= ticket.expiresAt, 'Ticket expirado.');
  ['raceTime', 'bestLap', 'penalty'].forEach(function(key) {
    requireValue(typeof result[key] === 'number' && Number.isFinite(result[key]), 'Tempo inválido.');
  });
  requireValue(result.raceTime >= 24 && result.raceTime <= 1200 && result.bestLap >= 8 && result.penalty >= 0 && result.penalty <= 600 && result.penalty % 5 === 0, 'Tempo fora dos limites.');
  var drivingTime = result.raceTime - result.penalty;
  var elapsed = (now - ticket.issuedAt) / 1000;
  requireValue(drivingTime >= 24 && drivingTime <= elapsed + 8 && elapsed <= drivingTime + 120, 'Tempo incompatível com a largada registrada.');
  requireValue(proof && Array.isArray(proof.laps) && proof.laps.length === 3 && Array.isArray(proof.checkpoints) && proof.checkpoints.length === 3, 'Prova de três voltas obrigatória.');
  proof.laps.forEach(function(lap) { requireValue(typeof lap === 'number' && Number.isFinite(lap) && lap >= 8 && lap <= 1200, 'Volta inválida.'); });
  proof.checkpoints.forEach(function(lap) {
    requireValue(Array.isArray(lap) && lap.length === 12 && lap.every(function(cp, i) { return cp === i; }), 'Checkpoints fora de ordem.');
  });
  requireValue(Math.abs(proof.laps.reduce(function(a,b) {return a+b;},0) - result.raceTime) < 0.15, 'Soma das voltas inválida.');
  requireValue(Math.abs(Math.min.apply(null, proof.laps) - result.bestLap) < 0.15, 'Melhor volta inválida.');
  var name = safeCell(result.name);
  requireValue(name.length > 0, 'Nome obrigatório.');
  return { uid:uid, name:name, raceTime:result.raceTime, bestLap:result.bestLap, penalty:result.penalty, finishedAt:now, participants:1, position:1, victories:0, score:0, mode:'time-trial' };
}

function aggregateResults(records) {
  var seen = {}, players = {}, rooms = {};
  records.forEach(function(row) {
    if (seen[row.ticket]) return;
    seen[row.ticket] = true;
    var p = players[row.uid];
    if (!p) p = players[row.uid] = {uid:row.uid,name:row.name,bestLap:row.bestLap,bestRace:row.raceTime,races:0,victories:0,score:0,updatedAt:row.finishedAt,mode:'time-trial'};
    p.races++;
    p.bestLap = Math.min(p.bestLap,row.bestLap);
    p.bestRace = Math.min(p.bestRace,row.raceTime);
    if (row.finishedAt >= p.updatedAt) { p.name = row.name; p.updatedAt = row.finishedAt; }
    if (row.roomKey && Array.isArray(row.roster) && row.roster.length >= 2) {
      if (!rooms[row.roomKey]) rooms[row.roomKey] = {roster:row.roster, results:{}};
      if (!rooms[row.roomKey].results[row.uid]) rooms[row.roomKey].results[row.uid] = row;
    }
  });
  Object.keys(rooms).forEach(function(key) {
    var room = rooms[key];
    if (!room.roster.every(function(uid) { return !!room.results[uid]; })) return;
    var ordered = room.roster.map(function(uid) {return room.results[uid];}).sort(function(a,b) {return a.raceTime-b.raceTime || a.uid.localeCompare(b.uid);});
    ordered.forEach(function(row,index) {
      var p = players[row.uid];
      p.mode = 'multiplayer';
      p.score += [100,60,30,10][index] || 0;
      if (index === 0) p.victories++;
    });
  });
  return Object.keys(players).map(function(key) {return players[key];}).sort(function(a,b) {return b.score-a.score || a.bestRace-b.bestRace || a.uid.localeCompare(b.uid);}).slice(0,100);
}
