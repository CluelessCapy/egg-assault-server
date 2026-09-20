// Simple self-contained admin page for reviewing map submissions.
// No build step, no framework — just a string of HTML/CSS/JS served
// straight from the server at GET /admin. It asks for the admin key,
// stores it in-memory in the page (not localStorage) and uses it to
// call /api/pending, /api/approve/:id and /api/reject/:id.

module.exports = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Egg Assault — Map Review</title>
<style>
  :root{
    --bg:#12151c; --panel:#1b202b; --panel-line:#2a3140; --text:#eef2f7;
    --muted:#8b96a8; --accent:#f4c542; --accent-dark:#caa22f; --danger:#e5543f;
    --danger-dark:#b8402f; --ok:#4fbf7d; --ok-dark:#399460; --chip:#232a37;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif;
    padding:24px 16px 60px;
  }
  h1{font-size:20px; margin:0 0 4px}
  .sub{color:var(--muted); font-size:13px; margin:0 0 24px}
  .wrap{max-width:760px; margin:0 auto}

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

  .toolbar{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:18px}
  .toolbar button{
    background:var(--chip); color:var(--text); border:1px solid var(--panel-line);
    border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer;
  }
  .toolbar button:hover{border-color:var(--accent)}

  .empty{color:var(--muted); text-align:center; padding:60px 20px; font-size:14px}

  .card{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:14px;
    padding:16px 18px; margin-bottom:14px;
  }
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

  .actions{display:flex; gap:8px; margin-top:12px}
  .actions button{
    flex:1; padding:9px 12px; border-radius:8px; border:none; font-weight:700;
    font-size:13px; cursor:pointer;
  }
  .btn-approve{background:var(--ok); color:#062b16}
  .btn-approve:hover{background:var(--ok-dark)}
  .btn-reject{background:var(--danger); color:#2b0a05}
  .btn-reject:hover{background:var(--danger-dark)}
  .btn-approve:disabled, .btn-reject:disabled{opacity:.5; cursor:default}
</style>
</head>
<body>
<div id="gate">
  <h1>Egg Assault — Map Review</h1>
  <p class="sub" style="margin-top:6px">Enter the admin key to see pending submissions.</p>
  <input id="keyInput" type="password" placeholder="Admin key" autocomplete="off">
  <button id="gateBtn">Unlock</button>
  <div id="gateErr"></div>
</div>

<div class="wrap" id="app" hidden>
  <div class="toolbar">
    <div>
      <h1 style="margin-bottom:2px">Map submissions</h1>
      <p class="sub" style="margin:0" id="countLine">Loading…</p>
    </div>
    <button id="refreshBtn">Refresh</button>
  </div>
  <div id="list"></div>
</div>

<script>
(function(){
  var KEY = '';
  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var list = document.getElementById('list');
  var countLine = document.getElementById('countLine');
  var gateErr = document.getElementById('gateErr');

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function fmtDate(iso){
    try{
      var d = new Date(iso);
      return d.toLocaleString();
    }catch(e){ return iso || ''; }
  }

  function swatchesFor(colors){
    if(!colors) return '';
    var keys = ['wall','crate','pillar','floor','wallStripe'];
    return keys.filter(function(k){ return colors[k]; }).map(function(k){
      return '<div class="swatch" title="'+esc(k)+'" style="background:'+esc(colors[k])+'"></div>';
    }).join('');
  }

  function render(items){
    if(!items.length){
      list.innerHTML = '<div class="empty">No submissions yet. Once someone builds a map in the Map Studio and submits it, it\\'ll show up here.</div>';
      return;
    }
    // pending first, newest first within each group
    var pending = items.filter(function(s){ return s.status === 'pending'; }).reverse();
    var decided = items.filter(function(s){ return s.status !== 'pending'; }).reverse();
    var ordered = pending.concat(decided);

    list.innerHTML = ordered.map(function(s){
      var count = (s.objects && s.objects.length) || 0;
      var disabled = s.status !== 'pending';
      return '' +
        '<div class="card" data-id="'+esc(s.id)+'">' +
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
          '<div class="actions">' +
            '<button class="btn-approve" data-act="approve" '+(disabled?'disabled':'')+'>Approve</button>' +
            '<button class="btn-reject" data-act="reject" '+(disabled?'disabled':'')+'>Reject</button>' +
          '</div>' +
        '</div>';
    }).join('');

    countLine.textContent = pending.length + ' pending · ' + decided.length + ' decided';
  }

  function load(){
    countLine.textContent = 'Loading…';
    fetch('/api/pending?key=' + encodeURIComponent(KEY))
      .then(function(r){
        if(r.status === 401){ throw new Error('unauthorized'); }
        return r.json();
      })
      .then(render)
      .catch(function(e){
        if(e.message === 'unauthorized'){
          app.hidden = true;
          gate.hidden = false;
          gateErr.textContent = 'That key stopped working — try again.';
        } else {
          list.innerHTML = '<div class="empty">Couldn\\'t load submissions. Try refreshing.</div>';
        }
      });
  }

  list.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-act]');
    if(!btn) return;
    var card = e.target.closest('.card');
    var id = card && card.getAttribute('data-id');
    if(!id) return;
    var act = btn.getAttribute('data-act');
    btn.disabled = true;
    var sibling = btn.parentElement.querySelector('button[data-act="' + (act === 'approve' ? 'reject' : 'approve') + '"]');
    if(sibling) sibling.disabled = true;
    fetch('/api/' + act + '/' + encodeURIComponent(id) + '?key=' + encodeURIComponent(KEY), { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(){ load(); })
      .catch(function(){ load(); });
  });

  document.getElementById('refreshBtn').addEventListener('click', load);

  function tryUnlock(){
    var val = document.getElementById('keyInput').value.trim();
    if(!val) return;
    KEY = val;
    fetch('/api/pending?key=' + encodeURIComponent(KEY))
      .then(function(r){
        if(r.status === 401){ gateErr.textContent = 'Wrong key.'; return null; }
        return r.json();
      })
      .then(function(data){
        if(data == null) return;
        gate.hidden = true;
        app.hidden = false;
        render(data);
      })
      .catch(function(){ gateErr.textContent = 'Could not reach the server. Try again.'; });
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
