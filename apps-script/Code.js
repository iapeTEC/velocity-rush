/* Deploy as execute-as USER_DEPLOYING, access ANYONE_ANONYMOUS. Never log tokens. */
var VR_HEADERS = {
  Tickets:['ticket','uid','issuedAt','expiresAt','roomKey','roomCode','roster','requestId'],
  Results:['ticket','uid','name','raceTime','bestLap','penalty','finishedAt','roomKey','roster'],
  Requests:['requestId','response','createdAt']
};

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) {
    props.setProperty('SPREADSHEET_ID', SpreadsheetApp.create('Velocity Rush — ranking').getId());
  }
  Object.keys(VR_HEADERS).forEach(function(name) { sheet_(name); });
  return { spreadsheetId:props.getProperty('SPREADSHEET_ID') };
}

/* Script Properties override the public defaults that scripts/setup-firebase.mjs writes to Config.js. */
function config_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var defaults = typeof VR_CONFIG === 'object' && VR_CONFIG ? VR_CONFIG : {};
  Object.keys(defaults).forEach(function(key) { if (!p[key] && defaults[key]) p[key] = defaults[key]; });
  requireValue(p.FIREBASE_API_KEY && p.FIREBASE_PROJECT_ID, 'Ranking ainda não configurado.');
  return p;
}

function hasSpreadsheet_() {
  return !!PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
}

function sheet_(name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  // Only doPost (under the script lock) or setup reach here without a spreadsheet; create it once.
  if (!id) { id = SpreadsheetApp.create('Velocity Rush — ranking').getId(); props.setProperty('SPREADSHEET_ID', id); }
  var book = SpreadsheetApp.openById(id);
  var sheet = book.getSheetByName(name);
  if (!sheet) { sheet = book.insertSheet(name); sheet.appendRow(VR_HEADERS[name]); sheet.setFrozenRows(1); }
  return sheet;
}

function rows_(name) {
  var sheet = sheet_(name);
  if (sheet.getLastRow() < 2) return [];
  var headers = VR_HEADERS[name];
  return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().map(function(values) {
    var row={}; headers.forEach(function(key,index) {row[key] = values[index];});
    if (row.roster) row.roster = JSON.parse(row.roster);
    return row;
  });
}

function append_(name, value) {
  sheet_(name).appendRow(VR_HEADERS[name].map(function(key) {
    var v=value[key]; return Array.isArray(v) ? JSON.stringify(v) : v == null ? '' : v;
  }));
  SpreadsheetApp.flush();
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(event) {
  try {
    var p = event && event.parameter || {};
    if (!hasSpreadsheet_()) return json_(p.action === 'status' ? {ok:false,pending:true} : {ok:true,entries:[]});
    if (p.action === 'status') {
      requireValue(/^[a-f0-9-]{36}$/.test(p.requestId || ''), 'Identificador inválido.');
      var receipt = rows_('Requests').filter(function(row) {return row.requestId === p.requestId;})[0];
      return json_(receipt ? JSON.parse(receipt.response) : {ok:false,pending:true});
    }
    requireValue(!p.action || p.action === 'list', 'Ação desconhecida.');
    return json_({ok:true,entries:aggregateResults(rows_('Results'))});
  } catch (error) { return json_({ok:false,error:String(error.message || error)}); }
}

function authenticate_(token, config) {
  requireValue(typeof token === 'string' && token.length >= 100 && token.length <= 8192, 'Token inválido.');
  // accounts:lookup verifies signature, expiry and the API key's Firebase project on Google's server.
  var response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(config.FIREBASE_API_KEY), {
    method:'post',contentType:'application/json',payload:JSON.stringify({idToken:token}),muteHttpExceptions:true
  });
  requireValue(response.getResponseCode() === 200, 'Autenticação recusada.');
  var user = JSON.parse(response.getContentText()).users;
  requireValue(user && user.length === 1 && !user[0].disabled, 'Usuário inválido.');
  var parts=token.split('.');
  requireValue(parts.length === 3, 'Token inválido.');
  var claims=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
  return verifyClaims(claims,config.FIREBASE_PROJECT_ID,user[0].localId,Date.now());
}

function database_(path,token,config) {
  var base = config.FIREBASE_DATABASE_URL || '';
  requireValue(/^https:\/\/[a-z0-9-]+\.(?:firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)\/?$/.test(base), 'URL Firebase inválida.');
  var response=UrlFetchApp.fetch(base.replace(/\/$/,'')+'/'+path+'.json?auth='+encodeURIComponent(token),{muteHttpExceptions:true});
  requireValue(response.getResponseCode()===200,'Não foi possível verificar a sala.');
  return JSON.parse(response.getContentText());
}

function roomEvidence_(code,uid,token,config) {
  requireValue(/^[A-Z0-9]{6}$/.test(code),'Código de sala inválido.');
  var lobby=database_('lobbies/'+code,token,config);
  requireValue(lobby && lobby.race && ['countdown','racing','finished'].indexOf(lobby.race.status)>=0,'Corrida não iniciada.');
  var roster=Object.keys(lobby.race.roster || {}).sort().map(function(key) {return lobby.race.roster[key];});
  requireValue(roster.length>=1 && roster.length<=4 && new Set(roster).size===roster.length && roster.indexOf(uid)>=0,'Jogador fora da largada.');
  requireValue(typeof lobby.race.startAt==='number' && Number.isFinite(lobby.race.startAt),'Largada inválida.');
  return {roomKey:code+':'+lobby.race.startAt,roster:roster,startAt:lobby.race.startAt};
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  var request, response;
  try {
    var raw = event && event.postData && event.postData.contents || '';
    requireValue(raw.length>0 && raw.length<=20000,'Requisição muito grande ou vazia.');
    request=JSON.parse(raw);
    requireValue(/^[a-f0-9-]{36}$/.test(request.requestId || ''),'Identificador inválido.');
    requireValue(request.action==='begin' || request.action==='submit','Ação inválida.');
    var config=config_();
    var uid=authenticate_(request.idToken,config);
    requireValue(lock.tryLock(20000),'Ranking ocupado; tente novamente.');
    var prior=rows_('Requests').filter(function(row) {return row.requestId===request.requestId;})[0];
    if (prior) return json_(JSON.parse(prior.response));
    var now=Date.now();
    var tickets=rows_('Tickets');
    if (request.action==='begin') {
      var existing=tickets.filter(function(row) {return row.uid===uid && row.requestId===request.requestId;})[0];
      if (existing) response={ok:true,ticket:existing.ticket};
      else {
        requireValue(tickets.filter(function(row) {return row.uid===uid && row.issuedAt>now-3600000;}).length<30,'Limite de largadas por hora atingido.');
        var evidence=request.roomCode ? roomEvidence_(request.roomCode,uid,request.idToken,config) : null;
        if (evidence) {
          requireValue(now>=evidence.startAt-5000 && now-evidence.startAt<=15000,'Peça o ticket na largada.');
          requireValue(!tickets.some(function(row) {return row.uid===uid && row.roomKey===evidence.roomKey;}),'Ticket desta corrida já emitido.');
        }
        var ticket={ticket:Utilities.getUuid(),uid:uid,issuedAt:evidence ? evidence.startAt : now,expiresAt:now+1320000,roomKey:evidence ? evidence.roomKey : '',roomCode:request.roomCode || '',roster:evidence ? evidence.roster : [],requestId:request.requestId};
        append_('Tickets',ticket);
        response={ok:true,ticket:ticket.ticket};
      }
    } else {
      requireValue(/^[a-f0-9-]{36}$/.test(request.ticket || ''),'Ticket inválido.');
      var active=tickets.filter(function(row) {return row.ticket===request.ticket && row.uid===uid;})[0];
      requireValue(active,'Ticket desconhecido.');
      var recorded=rows_('Results').filter(function(row) {return row.ticket===request.ticket;})[0];
      if (recorded) response={ok:true,accepted:true,duplicate:true,mode:recorded.roomKey?'multiplayer':'time-trial'};
      else {
        var clean=validateRace(request.result,request.proof,active,uid,now);
        if (active.roomKey) {
          var room=roomEvidence_(active.roomCode,uid,request.idToken,config);
          requireValue(room.roomKey===active.roomKey && JSON.stringify(room.roster)===JSON.stringify(active.roster),'Largada alterada.');
          var finish=database_('receipts/'+active.roomCode+'/'+uid,request.idToken,config);
          requireValue(finish && finish.finished===true && finish.lap>=3,'Chegada não confirmada no Firebase.');
          ['raceTime','bestLap','penalty'].forEach(function(key) {requireValue(typeof finish[key]==='number' && Math.abs(finish[key]-clean[key])<0.15,'Chegada difere do resultado.');});
          clean.roomKey=active.roomKey; clean.roster=active.roster;
        }
        clean.ticket=active.ticket;
        append_('Results',clean);
        response={ok:true,accepted:true,mode:active.roomKey?'multiplayer':'time-trial',pendingRoom:!!active.roomKey};
      }
    }
    append_('Requests',{requestId:request.requestId,response:JSON.stringify(response),createdAt:now});
    return json_(response);
  } catch (error) {
    return json_({ok:false,error:String(error.message || error)});
  } finally { if (lock.hasLock()) lock.releaseLock(); }
}
