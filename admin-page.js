// Self-contained admin page: map submission review plus a few live-server extras (stats,
// who's playing right now, and a way to clear out a stuck room). No build step, no
// framework -- just a string of HTML/CSS/JS served straight from the server at GET /admin.
// It asks for the admin key, keeps it in-memory in the page (never localStorage) and uses
// it on every /api/* call below.

module.exports = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Egg Assault — Admin</title>
<style>
  :root{
    --bg:#12151c; --panel:#1b202b; --panel-line:#2a3140; --text:#eef2f7;
    --muted:#8b96a8; --accent:#f4c542; --accent-dark:#caa22f; --danger:#e5543f;
    --danger-dark:#b8402f; --ok:#4fbf7d; --ok-dark:#399460; --chip:#232a37;
    --info:#4fa8d6; --info-dark:#3a84ab;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif;
    padding:24px 16px 60px;
  }
  h1{font-size:20px; margin:0 0 4px}
  h2{font-size:15px; margin:0 0 12px; color:var(--text)}
  .sub{color:var(--muted); font-size:13px; margin:0 0 24px}
  .wrap{max-width:860px; margin:0 auto}

  #gate{
    max-width:340px; margin:80px auto; background:var(--panel);
    border:1px solid var(--panel-line); border-radius:14px; padding:24px;
    text-align:center;
  }
  #gate h1{font-size:18px}
  #gate input{
    width:100%; margin-top:14px; padding:10px 12px; border-radius:8px;
    border:1px solid var(--panel-line); background:var(--bg); color:var(--text);
    font-size:14px;
  }
  #gate button{
    width:100%; margin-top:10px; padding:10px 12px; border-radius:8px;
    border:none; background:var(--accent); color:#2b2308; font-weight:700;
    cursor:pointer; font-size:14px;
  }
  #gate button:hover{background:var(--accent-dark)}
  #gateErr{color:var(--danger); font-size:13px; min-height:18px; margin-top:8px}

  [hidden]{display:none!important}

  .toolbar{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:18px; flex-wrap:wrap}
  .toolbar button{
    background:var(--chip); color:var(--text); border:1px solid var(--panel-line);
    border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer;
  }
  .toolbar button:hover{border-color:var(--accent)}
  .toolbar .right{display:flex; align-items:center; gap:8px}
  .auto-label{display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted); cursor:pointer; user-select:none}

  .stats-row{display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:10px; margin-bottom:22px}
  .stat{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:12px;
    padding:12px 14px;
  }
  .stat .n{font-size:22px; font-weight:800; line-height:1.1}
  .stat .l{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-top:3px}
  .stat.pending .n{color:var(--accent)}
  .stat.approved .n{color:var(--ok)}
  .stat.rejected .n{color:var(--danger)}
  .stat.live .n{color:var(--info)}

  .section{margin-bottom:30px}

  .filter-row{display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; align-items:center}
  .chip-btn{
    background:var(--chip); color:var(--muted); border:1px solid var(--panel-line);
    border-radius:100px; padding:6px 13px; font-size:12.5px; cursor:pointer; font-weight:600;
  }
  .chip-btn.sel{background:var(--accent); color:#2b2308; border-color:var(--accent)}
  #searchInput{
    flex:1; min-width:140px; background:var(--chip); border:1px solid var(--panel-line);
    border-radius:100px; padding:7px 14px; color:var(--text); font-size:13px;
  }
  #searchInput::placeholder{color:var(--muted)}

  .empty{color:var(--muted); text-align:center; padding:50px 20px; font-size:14px}

  .card{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:14px;
    padding:16px 18px; margin-bottom:14px; display:flex; gap:16px;
  }
  .card-main{flex:1; min-width:0}
  .card-top{display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap}
  .card-name{font-size:17px; font-weight:700; margin:0}
  .card-tag{color:var(--muted); font-size:13px; margin:2px 0 0}
  .status{
    font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
    padding:3px 9px; border-radius:100px; white-space:nowrap;
  }
  .status.pending{background:#3a3320; color:var(--accent)}
  .status.approved{background:#1e3a2a; color:var(--ok)}
  .status.rejected{background:#3a2320; color:var(--danger)}

  .meta{display:flex; flex-wrap:wrap; gap:8px 18px; margin:12px 0; font-size:13px; color:var(--muted)}
  .meta b{color:var(--text); font-weight:600}

  .swatches{display:flex; gap:6px; margin:10px 0}
  .swatch{width:22px; height:22px; border-radius:6px; border:1px solid rgba(255,255,255,.15)}

  .preview{
    flex:none; width:120px; height:120px; border-radius:10px; border:1px solid var(--panel-line);
  }

  .actions{display:flex; gap:8px; margin-top:12px; flex-wrap:wrap}
  .actions button{
    flex:1; min-width:90px; padding:9px 12px; border-radius:8px; border:none; font-weight:700;
    font-size:13px; cursor:pointer;
  }
  .btn-approve{background:var(--ok); color:#062b16}
  .btn-approve:hover{background:var(--ok-dark)}
  .btn-reject{background:var(--danger); color:#2b0a05}
  .btn-reject:hover{background:var(--danger-dark)}
  .btn-revert{background:var(--info); color:#07202f}
  .btn-revert:hover{background:var(--info-dark)}
  .btn-delete{background:var(--chip); color:var(--danger); border:1px solid var(--danger)!important}
  .actions button:disabled{opacity:.5; cursor:default}

  .room-card{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:14px;
    padding:14px 18px; margin-bottom:12px; display:flex; justify-content:space-between;
    align-items:center; gap:14px; flex-wrap:wrap;
  }
  .room-left b{font-size:15px}
  .room-players{color:var(--muted); font-size:12.5px; margin-top:4px}
  .room-players span{color:var(--text); margin-right:10px}
  .room-players .dead{color:var(--danger); text-decoration:line-through}
  .kick-btn{
    background:var(--danger); color:#2b0a05; border:none; border-radius:8px;
    padding:8px 14px; font-weight:700; font-size:12.5px; cursor:pointer;
  }
  .kick-btn:hover{background:var(--danger-dark)}
  .kick-btn:disabled{opacity:.5; cursor:default}
</style>
</head>
<body>
<div id="gate">
  <h1>Egg Assault — Admin</h1>
  <p class="sub" style="margin-top:6px">Enter the admin key to continue.</p>
  <input id="keyInput" type="password" placeholder="Admin key" autocomplete="off">
  <button id="gateBtn">Unlock</button>
  <div id="gateErr"></div>
</div>

<div class="wrap" id="app" hidden>
  <div class="toolbar">
    <div>
      <h1 style="margin-bottom:2px">Egg Assault — Admin</h1>
      <p class="sub" style="margin:0" id="uptimeLine">Loading…</p>
    </div>
    <div class="right">
      <label class="auto-label"><input type="checkbox" id="autoChk" checked> Auto-refresh</label>
      <button id="refreshBtn">Refresh</button>
    </div>
  </div>

  <div class="stats-row" id="statsRow"></div>

  <div class="section">
    <h2>Live rooms</h2>
    <div id="roomsList"></div>
  </div>

  <div class="section">
    <h2>Map submissions</h2>
    <div class="filter-row">
      <button class="chip-btn sel" data-f="all">All</button>
      <button class="chip-btn" data-f="pending">Pending</button>
      <button class="chip-btn" data-f="approved">Approved</button>
      <button class="chip-btn" data-f="rejected">Rejected</button>
      <input id="searchInput" type="text" placeholder="Search name or submitter…">
    </div>
    <div id="list"></div>
  </div>
</div>

<script>
(function(){
  var KEY = '';
  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var list = document.getElementById('list');
  var roomsList = document.getElementById('roomsList');
  var statsRow = document.getElementById('statsRow');
  var uptimeLine = document.getElementById('uptimeLine');
  var gateErr = document.getElementById('gateErr');
  var filterStatus = 'all';
  var searchQuery = '';
  var lastSubs = [];
  var autoTimer = null;

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function fmtDate(iso){
    try{ return new Date(iso).toLocaleString(); }catch(e){ return iso || ''; }
  }

  function fmtUptime(sec){
    sec = sec|0;
    var d = Math.floor(sec/86400); sec -= d*86400;
    var h = Math.floor(sec/3600); sec -= h*3600;
    var m = Math.floor(sec/60);
    var parts = [];
    if(d) parts.push(d+'d'); if(h||d) parts.push(h+'h'); parts.push(m+'m');
    return parts.join(' ');
  }

  function swatchesFor(colors){
    if(!colors) return '';
    var keys = ['wall','crate','pillar','floor','wallStripe'];
    return keys.filter(function(k){ return colors[k]; }).map(function(k){
      return '<div class="swatch" title="'+esc(k)+'" style="background:'+esc(colors[k])+'"></div>';
    }).join('');
  }

  /* ---- tiny top-down preview: draws each piece's footprint, colour-coded by the same
     wall/crate/pillar grouping the game itself uses -- gives a quick "what does this map
     look like" glance without opening the Map Studio. Rotation is approximated the same
     way the game and editor do (swap w/d on a 90/270 turn), which is plenty for a thumbnail. */
  var RADIAL = {barrel:1, sphere:1, cone:1};
  var COLOR_KEY = {wall:'wall',halfwall:'wall',arch:'wall',crate:'crate',ramp:'crate',
    stairs:'crate',barrel:'crate',cone:'crate',pillar:'pillar',sphere:'pillar',platform:'pillar'};
  function footprint(o){
    if(RADIAL[o.type]) return {w:o.w, d:o.w};
    var steps = Math.round((o.rot||0)/90);
    var odd = (((steps%2)+2)%2)===1;
    return odd ? {w:o.d, d:o.w} : {w:o.w, d:o.d};
  }
  function drawPreview(canvas, s){
    var objs = s.objects || [];
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var colors = s.colors || {};
    ctx.fillStyle = colors.bg || '#1b2838';
    ctx.fillRect(0,0,W,H);
    if(!objs.length) return;
    var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    objs.forEach(function(o){
      var f = footprint(o);
      minX = Math.min(minX, o.x-f.w/2); maxX = Math.max(maxX, o.x+f.w/2);
      minZ = Math.min(minZ, o.z-f.d/2); maxZ = Math.max(maxZ, o.z+f.d/2);
    });
    var spanX = Math.max(1, maxX-minX), spanZ = Math.max(1, maxZ-minZ);
    var pad = 8;
    var scale = Math.min((W-pad*2)/spanX, (H-pad*2)/spanZ);
    var offX = (W - spanX*scale)/2, offZ = (H - spanZ*scale)/2;
    objs.forEach(function(o){
      var f = footprint(o);
      var key = COLOR_KEY[o.type] || 'crate';
      ctx.fillStyle = o.color || colors[key] || '#8a93a3';
      var px = offX + (o.x-f.w/2-minX)*scale;
      var pz = offZ + (o.z-f.d/2-minZ)*scale;
      var pw = Math.max(1, f.w*scale), pd = Math.max(1, f.d*scale);
      ctx.fillRect(px, pz, pw, pd);
    });
  }

  function statBox(cls, n, label){
    return '<div class="stat '+cls+'"><div class="n">'+n+'</div><div class="l">'+esc(label)+'</div></div>';
  }
  function renderStats(st){
    if(!st) return;
    statsRow.innerHTML =
      statBox('pending', st.pending, 'Pending') +
      statBox('approved', st.approved, 'Approved') +
      statBox('rejected', st.rejected, 'Rejected') +
      statBox('', st.total, 'Total maps') +
      statBox('live', st.players, 'Players online') +
      statBox('live', st.rooms, 'Active rooms');
    uptimeLine.textContent = 'Server up ' + fmtUptime(st.uptimeSec);
  }

  function renderRooms(rooms){
    if(!rooms.length){
      roomsList.innerHTML = '<div class="empty">Nobody\\'s playing right now.</div>';
      return;
    }
    roomsList.innerHTML = rooms.map(function(r){
      var playersHtml = r.players.length
        ? r.players.map(function(p){
            return '<span class="'+(p.alive?'':'dead')+'">'+esc(p.name)+' ('+p.kills+' kills)</span>';
          }).join('')
        : '<span style="color:var(--muted)">empty</span>';
      return '' +
        '<div class="room-card" data-room="'+esc(r.code)+'">' +
          '<div class="room-left">' +
            '<b>Room '+esc(r.code)+'</b> <span style="color:var(--muted);font-size:12.5px">&middot; '+esc(r.mapId||'?')+' &middot; '+r.players.length+' player'+(r.players.length===1?'':'s')+'</span>' +
            '<div class="room-players">'+playersHtml+'</div>' +
          '</div>' +
          '<button class="kick-btn" data-room="'+esc(r.code)+'">Disconnect room</button>' +
        '</div>';
    }).join('');
  }

  function matchesFilter(s){
    if(filterStatus!=='all' && s.status!==filterStatus) return false;
    if(searchQuery){
      var q = searchQuery.toLowerCase();
      if((s.name||'').toLowerCase().indexOf(q)<0 && (s.submitter||'').toLowerCase().indexOf(q)<0) return false;
    }
    return true;
  }

  function renderSubs(items){
    lastSubs = items;
    var filtered = items.filter(matchesFilter);
    if(!filtered.length){
      list.innerHTML = '<div class="empty">'+(items.length?'Nothing matches that filter.':'No submissions yet. Once someone builds a map in the Map Studio and submits it, it\\'ll show up here.')+'</div>';
      return;
    }
    var pending = filtered.filter(function(s){ return s.status === 'pending'; }).reverse();
    var decided = filtered.filter(function(s){ return s.status !== 'pending'; }).reverse();
    var ordered = pending.concat(decided);

    list.innerHTML = ordered.map(function(s){
      var count = (s.objects && s.objects.length) || 0;
      var isPending = s.status === 'pending';
      var actionsHtml = isPending
        ? '<button class="btn-approve" data-act="approve">Approve</button><button class="btn-reject" data-act="reject">Reject</button>'
        : '<button class="btn-revert" data-act="revert">Back to pending</button><button class="btn-delete" data-act="delete">Delete</button>';
      return '' +
        '<div class="card" data-id="'+esc(s.id)+'">' +
          '<canvas class="preview" width="120" height="120"></canvas>' +
          '<div class="card-main">' +
            '<div class="card-top">' +
              '<div>' +
                '<p class="card-name">'+esc(s.name)+'</p>' +
                '<p class="card-tag">'+esc(s.tag)+'</p>' +
              '</div>' +
              '<span class="status '+esc(s.status)+'">'+esc(s.status)+'</span>' +
            '</div>' +
            '<div class="meta">' +
              '<span><b>By</b> '+esc(s.submitter)+'</span>' +
              '<span><b>Pieces</b> '+count+'</span>' +
              '<span><b>Theme</b> '+esc(s.theme || 'custom')+'</span>' +
              '<span><b>Size</b> '+esc(s.mapSize || 'medium')+'</span>' +
              '<span><b>Submitted</b> '+esc(fmtDate(s.submittedAt))+'</span>' +
            '</div>' +
            '<div class="swatches">'+swatchesFor(s.colors)+'</div>' +
            '<div class="actions">'+actionsHtml+'</div>' +
          '</div>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('.card'), function(card){
      var id = card.getAttribute('data-id');
      var s = ordered.filter(function(x){ return x.id===id; })[0];
      var canvas = card.querySelector('canvas.preview');
      if(s && canvas) drawPreview(canvas, s);
    });
  }

  function fetchJSON(path){
    return fetch(path + (path.indexOf('?')>=0?'&':'?') + 'key=' + encodeURIComponent(KEY))
      .then(function(r){
        if(r.status === 401){ var e = new Error('unauthorized'); throw e; }
        return r.json();
      });
  }

  function load(){
    Promise.all([fetchJSON('/api/stats'), fetchJSON('/api/pending'), fetchJSON('/api/rooms')])
      .then(function(results){
        renderStats(results[0]);
        renderSubs(results[1]);
        renderRooms(results[2]);
      })
      .catch(function(e){
        if(e && e.message === 'unauthorized'){
          stopAuto();
          app.hidden = true;
          gate.hidden = false;
          gateErr.textContent = 'That key stopped working — try again.';
        } else {
          list.innerHTML = '<div class="empty">Couldn\\'t load. Try refreshing.</div>';
        }
      });
  }

  function startAuto(){
    stopAuto();
    autoTimer = setInterval(load, 4000);
  }
  function stopAuto(){
    if(autoTimer){ clearInterval(autoTimer); autoTimer = null; }
  }

  list.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-act]');
    if(!btn) return;
    var card = e.target.closest('.card');
    var id = card && card.getAttribute('data-id');
    if(!id) return;
    var act = btn.getAttribute('data-act');
    Array.prototype.forEach.call(card.querySelectorAll('button[data-act]'), function(b){ b.disabled = true; });
    var endpoint = act === 'delete' ? '/api/delete/' : (act === 'revert' ? '/api/revert/' : '/api/' + act + '/');
    fetch(endpoint + encodeURIComponent(id) + '?key=' + encodeURIComponent(KEY), { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(){ load(); })
      .catch(function(){ load(); });
  });

  roomsList.addEventListener('click', function(e){
    var btn = e.target.closest('.kick-btn');
    if(!btn) return;
    var code = btn.getAttribute('data-room');
    if(!confirm('Disconnect everyone in room "'+code+'"?')) return;
    btn.disabled = true;
    fetch('/api/kick-room/' + encodeURIComponent(code) + '?key=' + encodeURIComponent(KEY), { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(){ load(); })
      .catch(function(){ load(); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip-btn'), function(btn){
    btn.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.chip-btn'), function(b){ b.classList.remove('sel'); });
      btn.classList.add('sel');
      filterStatus = btn.getAttribute('data-f');
      renderSubs(lastSubs);
    });
  });
  document.getElementById('searchInput').addEventListener('input', function(e){
    searchQuery = e.target.value.trim();
    renderSubs(lastSubs);
  });

  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('autoChk').addEventListener('change', function(e){
    if(e.target.checked) startAuto(); else stopAuto();
  });

  function tryUnlock(){
    var val = document.getElementById('keyInput').value.trim();
    if(!val) return;
    KEY = val;
    fetchJSON('/api/stats')
      .then(function(st){
        gate.hidden = true;
        app.hidden = false;
        renderStats(st);
        load();
        if(document.getElementById('autoChk').checked) startAuto();
      })
      .catch(function(e){
        if(e && e.message === 'unauthorized'){ gateErr.textContent = 'Wrong key.'; }
        else { gateErr.textContent = 'Could not reach the server. Try again.'; }
      });
  }

  document.getElementById('gateBtn').addEventListener('click', tryUnlock);
  document.getElementById('keyInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') tryUnlock();
  });
})();
</script>
</body>
</html>
`;
