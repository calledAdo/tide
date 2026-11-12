(function () {
  'use strict';

  /* Config + mode */
  // Read the selected network, contract, and mode from configuration and the URL.
  const cfg = window.TIDE_CONFIG || {
    network: 'testnet',
    contract: '',
    boats: []
  };
  const qs = new URLSearchParams(location.search);
  const forced = qs.has('demo');
  const urlContract = qs.get('contract') || '';
  const contract = urlContract || cfg.contract || '';
  const network = qs.get('network') || cfg.network || 'testnet';
  const rpc = qs.get('rpc') || cfg.rpc || (
    network === 'mainnet' ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com'
  );
  const live = Boolean(contract) && !forced;
  const C = window.TideSim.constants;
  const $ = id => document.getElementById(id);

  let eng = window.TideSim.create('tide');
  let scenario = 'tide';
  let playing = false;
  let speed = 1;
  let timer = null;
  let liveState = null;
  let history = [];
  let log = [];
  let oldStatus = {};
  const loggedAssemblyCycles = new Set();
  let lawlessRun = null;
  let tideWallet = null;
  let account = null;
  let balances = null;
  let userBoat = null;
  let playerBusy = false;
  let playerBusyAction = null;
  let settling = false;
  let settledTicks = 0;
  let settlementTotal = 0;
  let settlementMessage = '';
  let effortBps = 10000;
  let knownAccounts = new Set();
  const userActions = {};
  const historyKey = 'tide-history:' + network + ':' + contract;

  (cfg.boats || []).forEach(name => knownAccounts.add(name));
  if (qs.has('boats')) {
    qs.get('boats').split(',').filter(Boolean).forEach(name => knownAccounts.add(name));
  }

  /* Formatting helpers */
  // Format numeric values using compact notation for large values.
  function fmt(n) {
    n = Number(n) || 0;
    return Math.abs(n) >= 1000000
      ? (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
      : Math.round(n).toLocaleString('en-US');
  }

  function balanceFmt(n) {
    return Number(n || 0).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  // Escape values before inserting them into generated HTML.
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  }

  // Convert a yoctoNEAR RPC value to a number.
  function tok(n) {
    return Number(n && typeof n === 'object' && '0' in n ? n[0] : n || 0) / 1e18;
  }

  function yocto(n) {
    return BigInt(Math.max(0, Math.round(Number(n) || 0))) * 1000000000000000000n;
  }

  function faucetKey() {
    return 'tide-faucet-claimed:' + contract + ':' + account;
  }

  function devWalletMode() {
    return (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      && localStorage.getItem('tide-dev-account') === account
      && Boolean(localStorage.getItem('tide-chip-key:' + account));
  }

  function actionKey(kind, cycle) {
    return kind + ':' + account + ':' + cycle;
  }

  function rememberAction(key, value) {
    userActions[key] = value;
    try {
      localStorage.setItem('tide-user-action:' + key, JSON.stringify(value));
    } catch (_) {}
  }

  function storedAction(key) {
    if (Object.prototype.hasOwnProperty.call(userActions, key)) {
      return userActions[key];
    }
    try {
      const value = JSON.parse(localStorage.getItem('tide-user-action:' + key));
      if (value !== null) {
        userActions[key] = value;
        return value;
      }
    } catch (_) {}
    return undefined;
  }

  function loadHistory() {
    if (!live || !contract) {
      return [];
    }
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
      if (!Array.isArray(saved)) {
        return [];
      }
      const bySeason = new Map();
      saved.filter(p => p && Number.isFinite(+p.season) && Number.isFinite(+p.stock))
        .forEach(p => bySeason.set(+p.season, { season: +p.season, stock: +p.stock }));
      return Array.from(bySeason.values())
        .sort((a, b) => a.season - b.season)
        .slice(-500);
    } catch (_) {
      return [];
    }
  }

  function rememberHistory(point) {
    const found = history.find(p => p.season === point.season);
    if (found) {
      found.stock = point.stock;
    } else {
      history.push(point);
    }
    history.sort((a, b) => a.season - b.season);
    if (history.length > 500) {
      history = history.slice(-500);
    }
    try {
      localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (_) {}
  }

  history = loadHistory();

  // Apply the active mode and its corresponding controls and status text.
  function mode() {
    $('demo-mode').classList.toggle('active', !live);
    $('live-mode').classList.toggle('active', live);
    $('demo-mode').setAttribute('aria-pressed', String(!live));
    $('live-mode').setAttribute('aria-pressed', String(live));
    $('live-mode').disabled = !contract;
    $('live-mode').title = contract
      ? 'Read deployed contract views'
      : 'Configure a contract to enable live mode';
    $('app').classList.toggle('live', live);
    $('notice').classList.toggle('live', live);
    $('live-notice').textContent = 'LIVE MODE · ' + contract + ' · ' + network;
    $('hero-play').disabled = false;
    $('hero-play').textContent = live ? 'CONNECT WALLET' : 'PLAY THE DEMO';
    $('mode-note').textContent = live
      ? 'Live contract · polling every 10 seconds'
      : 'Animated demo · ' + (2 * speed) + ' seasons per second';
    document.querySelectorAll('[data-speed]').forEach(button => {
      button.setAttribute('aria-pressed', String(+button.dataset.speed === speed));
    });
  }

  /* Chart rendering */
  // Map stock values to the SVG chart path coordinates.
  function path(a) {
    const l = 52;
    const r = 794;
    const t = 24;
    const b = 330;
    const points = a.map((v, i) => typeof v === 'object'
      ? { season: +v.season, stock: +v.stock }
      : { season: i, stock: +v });
    const min = points.length ? points[0].season : 0;
    const max = points.length ? points[points.length - 1].season : 0;
    return points.map((v, i) => {
      const x = l + (min === max ? (r - l) / 2 : (v.season - min) * (r - l) / (max - min));
      const y = t + (1 - Math.max(0, Math.min(C.K, v.stock)) / C.K) * (b - t);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  // Render the stock history, reference levels, and optional comparison path.
  function chart(a, ghost) {
    const l = 52;
    const r = 794;
    const t = 24;
    const b = 330;
    const y = v => t + (1 - v / C.K) * (b - t);
    let h = '<line class="axis" x1="' + l + '" y1="' + t + '" x2="' + l;
    h += '" y2="' + b + '"/><line class="axis" x1="' + l + '" y1="' + b;
    h += '" x2="' + r + '" y2="' + b + '"/>';
    [1000000, 500000, 0].forEach(v => {
      h += '<text x="8" y="' + (y(v) + 4) + '">';
      h += v === 1000000 ? '1m' : v === 0 ? '0' : '500k';
      h += '</text>';
    });
    h += '<line class="reference" x1="' + l + '" x2="' + r + '" y1="' + y(C.MSY_STOCK);
    h += '" y2="' + y(C.MSY_STOCK) + '"/><rect class="reference-band" x="638" y="';
    h += (y(C.MSY_STOCK) - 20) + '" width="170" height="15"/>';
    h += '<text class="reference-label" x="644" y="' + (y(C.MSY_STOCK) - 8);
    h += '">SUSTAINABLE LEVEL 689K</text><line class="reference danger-reference" x1="';
    h += l + '" x2="' + r + '" y1="' + y(C.A) + '" y2="' + y(C.A);
    h += '"/><text class="reference-label danger-label" x="633" y="' + (y(C.A) - 7);
    h += '">POINT OF NO RETURN 120K</text>';
    if (ghost) {
      h += '<path class="ghost" d="' + path(ghost) + '"/>';
    }
    if (a.length > 0) {
      const points = a.map((v, i) => typeof v === 'object'
        ? { season: +v.season, stock: +v.stock }
        : { season: i, stock: +v });
      const min = points[0].season;
      const max = points[points.length - 1].season;
      const p = path(a);
      const last = min === max ? (l + r) / 2 : r;
      if (a.length > 1) {
        h += '<path class="stockarea" d="' + p + ' L' + last.toFixed(1) + ' ' + b;
        h += ' L52 ' + b + ' Z"/><path class="stockline" d="' + p + '"/>';
      } else {
        const yPoint = t + (1 - Math.max(0, Math.min(C.K, points[0].stock)) / C.K) * (b - t);
        h += '<rect x="' + (last - 5) + '" y="' + (yPoint - 5);
        h += '" width="10" height="10" fill="var(--signal)"/>';
      }
      if (live) {
        h += '<text x="' + l + '" y="' + (b + 22) + '">SEASON ' + min + '</text>';
        if (max !== min) {
          h += '<text x="' + r + '" y="' + (b + 22) + '" text-anchor="end">SEASON ' + max + '</text>';
        }
        if (a.length < 2) {
          h += '<text x="410" y="190" text-anchor="middle">HISTORY BUILDS AS YOU WATCH';
          h += ' · ONE POINT PER SEASON</text>';
        }
      }
    }
    if (live && a.length < 2 && a.length === 0) {
      h += '<text x="410" y="190" text-anchor="middle">HISTORY BUILDS AS YOU WATCH';
      h += ' · ONE POINT PER SEASON</text>';
    }
    $('chart-content').innerHTML = h;
    $('ghostlegend').classList.toggle('hidden', !ghost);
  }

  /* Stats */
  // Update the numerical sea statistics and quota progress bar.
  function stats(s, catchv, minted, burned, apr, down) {
    const quota = s.quota || C.QUOTA;
    $('day').textContent = s.season || 0;
    $('stock').textContent = fmt(s.stock);
    $('catch').textContent = fmt(catchv);
    $('catchnote').textContent = catchv > quota ? 'over quota' : 'fleet catch';
    $('catchfill').style.width = Math.min(100, catchv / quota * 50) + '%';
    $('minted').textContent = fmt(minted);
    $('burned').textContent = fmt(burned);
    $('apr').textContent = (Number(apr) || 0).toFixed(1) + '%';
    $('countdown').textContent = down || '';
  }

  /* Fleet */
  // Render boat status cards and remember changes for their transition state.
  function fleet(boats, season) {
    $('fleet').innerHTML = (boats || []).map(b => {
      const you = account && b.name === account;
      const ex = live
        ? b.exiledUntil != null && b.exiledUntil > season
        : b.status === 'EXILED' || b.exiledUntil != null && b.exiledUntil > season;
      const ind = b.indictedThisCycle || b.status === 'INDICTED';
      const fac = b.status === 'FACTION' || b.type === 'faction';
      const status = ex
        ? 'EXILED until day ' + b.exiledUntil
        : ind
          ? 'INDICTED ' + (b.fairShare ? (b.lastCatch / b.fairShare).toFixed(1) : '—') + 'x'
          : fac
            ? 'FACTION'
            : 'FAIR';
      const changed = oldStatus[b.name] && oldStatus[b.name] !== status;
      oldStatus[b.name] = status;
      return '<article class="boat ' + (ex ? 'exiled ' : '') + (fac ? 'faction ' : '')
        + (you ? 'you ' : '') + (changed ? 'changed' : '') + '"><div class="boatname" title="'
        + esc(b.name) + '">'
        + esc(b.name) + '</div><div class="stake"><i></i></div><div class="boatmeta">'
        + '<span>today</span><strong>' + fmt(b.lastCatch) + '</strong></div><span class="chip '
        + (ex ? 'exiled' : ind ? 'indicted' : fac ? 'faction' : '') + '">' + (you ? 'YOU · ' : '')
        + esc(status)
        + '</span></article>';
    }).join('');
  }

  /* Assembly */
  // Render assembly votes, shard progress, and the current assembly outcome.
  function assembly(a, eligible, season, exiles) {
    a = a || { hold_yes: 0, hold_no: 0, held: false, shards: {}, exiled: [] };
    const currentYes = +a.hold_yes || 0;
    const currentNo = +a.hold_no || 0;
    const currentShards = a.shards || {};
    const currentNames = Array.isArray(currentShards)
      ? currentShards.filter(p => Array.isArray(p) && p.length)
      : Object.keys(currentShards).map(n => [n, currentShards[n]]);
    const last = a.last_result;
    const showingLast = live && !currentYes && !currentNo && !currentNames.length && last;
    const view = showingLast ? last : a;
    const yes = +view.hold_yes || 0;
    const no = +view.hold_no || 0;
    const el = +view.eligible || eligible || 20;
    const total = showingLast ? Math.max(1, el) : Math.max(1, yes + no);
    const q = +view.quorum_shards || Math.max(1, Math.ceil(C.QUORUM * el));
    const shards = showingLast ? {} : currentShards;
    const names = Array.isArray(shards)
      ? shards.filter(p => Array.isArray(p) && p.length)
      : Object.keys(shards).map(n => [n, shards[n]]);
    const breadcrumb = document.querySelector('#assembly .breadcrumb');
    breadcrumb.textContent = showingLast
      ? 'LAST ASSEMBLY · CYCLE ' + view.cycle
      : '$TIDE · EVERY THIRD SEASON';
    $('holdyes').style.width = yes / total * 100 + '%';
    $('holdno').style.width = no / total * 100 + '%';
    $('holdcount').textContent = yes + ' yes · ' + no + ' no';
    $('quorum').textContent = 'quorum ' + q;
    $('shards').innerHTML = names.length
      ? names.map(pair => {
        const n = pair[0];
        const v = +pair[1];
        return '<div class="shard"><span title="' + esc(n) + '">' + esc(n)
          + '</span><div class="shardtrack"><div class="shardfill" style="width:'
          + Math.min(100, v / q * 100) + '%"></div><i class="qline"></i></div><strong>'
          + v + '</strong></div>';
      }).join('')
      : '<span class="kicker">No names written in the current cycle.</span>';
    const exileUntil = new Map((exiles || []).map(p => [p[0], +p[1]]));
    const ex = (view.exiled || []).map(n => {
      const until = exileUntil.get(n);
      if (!Number.isFinite(until)) {
        return n;
      }
      return n + (until > season
        ? ' (UNTIL SEASON ' + until + ')'
        : ' (RETURNED SEASON ' + until + ')');
    });
    $('result').textContent = ex.length
      ? 'EXILED: ' + ex.join(', ').toUpperCase()
      : 'NO OSTRACISM HELD';
    $('assembly-status').textContent = yes || no || names.length
      ? 'latest tally'
      : 'waiting for cycle ' + (Math.floor(season / 3) + 1);
    $('holdcard').classList.toggle('highlight', Boolean(yes || no));
    $('shardcard').classList.toggle('highlight', Boolean(names.length || ex.length));
  }

  // Render the connected boat's controls for the current assembly stage.
  function renderAssemblyActions(a, season) {
    if (!account || !liveState) {
      $('assembly-actions').innerHTML = '';
      return;
    }
    const stage = a && a.stage;
    const cycle = a && +a.cycle || Math.floor(season / 3);
    const voteKey = actionKey('vote', cycle);
    const shardKey = actionKey('shard', cycle);
    const vote = storedAction(voteKey);
    const shard = storedAction(shardKey);
    const hasVote = vote !== undefined;
    const blocked = seaBehind();
    const disabled = blocked || playerBusy ? ' disabled' : '';
    if (stage === 'hold') {
      $('assembly-actions').innerHTML = hasVote
        ? '<p class="player-note">YOU VOTED ' + (vote ? 'YES' : 'NO') + ' ON THIS HOLD.</p>'
        : '<div class="desk-actions"><button class="primary" data-action="vote-yes"' + disabled
          + '>VOTE YES</button><button class="control" data-action="vote-no"' + disabled
          + '>VOTE NO</button></div>'
          + (blocked ? '<p class="desk-reason blocked">Settle the sea first</p>' : '');
      return;
    }
    if (stage === 'shards') {
      const held = (+a.hold_yes || 0) * 2 > (+a.eligible || 0);
      if (!held) {
        $('assembly-actions').innerHTML = '<p class="player-note">STAGE 1 FAILED · NO SHARDS '
          + 'THIS CYCLE.</p>';
        return;
      }
      if (shard) {
        $('assembly-actions').innerHTML = '<p class="player-note">YOU WROTE: '
          + esc(shard.join(', ')) + '.</p>';
        return;
      }
      const indicted = (liveState.indictments || []).map(pair => pair[0]);
      const boats = liveState.boats.filter(boat => boat.stake > 0).map(boat => boat.name);
      const names = indicted.concat(boats.filter(name => !indicted.includes(name)));
      $('assembly-actions').innerHTML = '<p class="player-note">PICK UP TO 3 NAMES · INDICTED FIRST.</p>'
        + '<div class="name-picker">' + names.map(name => '<label><input type="checkbox" '
          + 'name="shard-name" value="' + esc(name) + '"' + disabled + '>' + esc(name)
          + '</label>').join('') + '</div><button class="primary" data-action="write-shard"'
        + disabled + '>WRITE SHARD · BURNS 1 TIDE PER NAME</button>'
        + (blocked ? '<p class="desk-reason blocked">Settle the sea first</p>' : '');
      return;
    }
    const rem = (2 - season % 3 + 3) % 3 || 3;
    const seconds = rem * (liveState.seasonLen || 60);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    $('assembly-actions').innerHTML = '<p class="player-note">NEXT ASSEMBLY IN ' + rem
      + ' SEASONS (≈ ' + mm + ':' + ss + ').</p>';
  }

  /* Log */
  // Render the most recent simulation or live-mode events.
  function renderLog(events) {
    const a = (events || []).slice(0, 200);
    $('logcount').textContent = a.length + ' events';
    $('log').innerHTML = a.length
      ? a.map(e => '<div class="entry"><span class="entry-day">DAY ' + esc(e.season)
        + '</span><i class="dot ' + esc(e.kind) + '"></i><span>'
        + esc(e.text) + (e.url ? ' <a class="entry-link" href="' + esc(e.url)
          + '" target="_blank" rel="noreferrer">TX &#8599;</a>' : '')
        + '</span></div>').join('')
      : '<div class="kicker log-empty">Play the replay to populate the log.</div>';
  }

  /* Demo playback */
  // Stop demo playback and restore the play control.
  function stop() {
    playing = false;
    clearInterval(timer);
    timer = null;
    $('play').textContent = 'PLAY';
    $('hero-play').textContent = 'PLAY THE DEMO';
  }

  // Advance the demo at the selected playback speed.
  function start() {
    if (eng.season >= C.SEASONS) {
      return;
    }
    playing = true;
    $('play').textContent = 'PAUSE';
    $('hero-play').textContent = 'PAUSE THE DEMO';
    timer = setInterval(() => {
      if (eng.season >= C.SEASONS) {
        return stop();
      }
      eng.step();
      demoRender();
    }, 1000 / (2 * speed));
  }

  // Restart the selected demo scenario from its initial state.
  function restart() {
    stop();
    eng = window.TideSim.create(scenario);
    oldStatus = {};
    demoRender();
  }

  // Render the current demo simulation state.
  function demoRender() {
    const s = eng.state;
    if (scenario === 'tide' && !lawlessRun) {
      lawlessRun = window.TideSim.runToEnd('lawless');
    }
    chart(eng.history, lawlessRun && scenario === 'tide' ? lawlessRun.stock : null);
    stats(s, eng.lastCatch, s.minted, s.burned, s.aprSoFar, '');
    $('chartbox').classList.toggle('isdead', s.dead);
    $('dead').classList.toggle('hidden', !s.dead);
    $('deadtext').textContent = s.dead
      ? 'Crossed the point of no return on day ' + eng.deadAt
      : '';
    $('sea-title').textContent = 'The sea';
    $('sea-copy').textContent = 'Unminted $TIDE supply, regrowing every season.';
    fleet(s.boats, eng.season);
    assembly(s.assembly, null, eng.season);
    renderLog(eng.events);
  }

  /* Live mode (RPC) */
  // Call a read-only contract method over JSON-RPC.
  function rpcCall(method, args) {
    const data = new TextEncoder().encode(JSON.stringify(args || {}));
    let bin = '';
    data.forEach(b => bin += String.fromCharCode(b));
    return fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: contract,
          method_name: method,
          args_base64: btoa(bin)
        }
      })
    }).then(r => {
      if (!r.ok) {
        throw Error('RPC HTTP ' + r.status);
      }
      return r.json();
    }).then(p => {
      if (p.error) {
        throw Error(p.error.message || 'RPC error');
      }
      if (!p.result || !p.result.result) {
        throw Error('Empty RPC result for ' + method);
      }
      return JSON.parse(new TextDecoder().decode(new Uint8Array(p.result.result)));
    });
  }

  // Query account balances through the same RPC endpoint used by contract views.
  function rpcQuery(requestType, params) {
    return fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'query',
        params: Object.assign({ request_type: requestType, finality: 'final' }, params)
      })
    }).then(r => {
      if (!r.ok) {
        throw Error('RPC HTTP ' + r.status);
      }
      return r.json();
    }).then(p => {
      if (p.error) {
        throw Error(p.error.message || 'RPC error');
      }
      return p.result;
    });
  }

  function readPlayer(accountId) {
    if (!accountId) {
      return Promise.resolve(null);
    }
    return Promise.all([
      rpcQuery('view_account', { account_id: accountId }),
      rpcCall('storage_balance_of', { account_id: accountId }),
      rpcCall('ft_balance_of', { account_id: accountId }),
      rpcCall('get_boat', { account_id: accountId })
    ]).then(v => ({
      near: tok(v[0].amount),
      storage: v[1],
      tide: tok(v[2]),
      boat: v[3]
    }));
  }

  function playerText(text) {
    return '<p class="player-note">' + text + '</p>';
  }

  function seaBehind() {
    return Boolean(liveState && liveState.behind > 40);
  }

  function settlementBar(id) {
    const bar = $(id);
    if (!bar || !seaBehind()) {
      if (bar) {
        bar.classList.remove('show');
        bar.innerHTML = '';
      }
      return;
    }
    const behind = liveState.behind;
    const total = Math.ceil((behind - 40) / 40);
    const progress = settling
      ? 'SETTLING ' + Math.min(settledTicks + 1, settlementTotal) + '/' + settlementTotal + '…'
      : settlementMessage;
    const status = progress ? '<p class="settle-status">' + esc(progress) + '</p>' : '';
    const action = account
      ? '<button class="primary" data-action="settle-sea"'
        + (settling || playerBusy ? ' disabled' : '')
        + '>SETTLE THE SEA (' + total + ' TX)</button>'
      : '<p class="settle-help">Connect a wallet to settle it, or anyone can call tick().</p>';
    bar.innerHTML = '<div class="settle-copy"><strong>THE SEA IS ' + behind
      + ' SEASONS BEHIND · THE NEXT ACTION WOULD LAND IN A PAST SEASON</strong>'
      + status + '</div>' + action;
    bar.classList.add('show');
  }

  function renderSettlementBars() {
    settlementBar('player-settle');
    settlementBar('assembly-settle');
  }

  function ensureSettlementBars() {
    const playerBar = document.createElement('div');
    playerBar.id = 'player-settle';
    playerBar.className = 'settle-bar';
    $('player-section').insertBefore(playerBar, $('player-panel'));
    const assemblyBar = document.createElement('div');
    assemblyBar.id = 'assembly-settle';
    assemblyBar.className = 'settle-bar';
    $('assembly').insertBefore(assemblyBar, document.querySelector('#assembly .assemblygrid'));
  }

  function setPlayerRow(id, html, hidden) {
    $(id).innerHTML = html;
    $(id).classList.toggle('hidden', Boolean(hidden));
  }

  function renderFishing() {
    if (!live || !account || !userBoat || !userBoat.boat) {
      $('fishing-desk').classList.add('hidden');
      return;
    }
    const fullCatch = tok(userBoat.full_effort_catch);
    const fullFuel = tok(userBoat.full_effort_fuel);
    const fair = tok(userBoat.fair_share);
    const effort = Math.max(1, Math.min(10000, effortBps));
    const catchv = Math.floor(fullCatch * effort / 10000);
    const fuel = Math.floor(fullFuel * effort / 10000);
    const over = catchv > fair;
    const reason = fishReason(userBoat);
    const blocked = seaBehind();
    $('fishing-desk').classList.remove('hidden');
    $('fishing-content').innerHTML = '<div class="fishing-grid"><label class="effort-control">EFFORT '
      + '<output id="effort-output">' + Math.round(effort / 100) + '%</output><input id="effort" '
      + 'type="range" min="1" max="10000" value="' + effort + '"></label><div class="preview '
      + (over ? 'amber' : '') + '"><span>CATCH <strong>' + fmt(catchv) + '</strong></span><span>FUEL '
      + '<strong>' + fmt(fuel) + '</strong></span><span>NET <strong>' + fmt(catchv - fuel)
      + '</strong></span><b>' + (fair ? (catchv / fair).toFixed(1) : '0.0') + 'X YOUR FAIR SHARE</b>'
      + (over ? '<em>THIS WILL BE PUBLICLY INDICTED</em>' : '') + '</div></div><div class="desk-actions">'
      + '<button class="control" data-action="fair">SET TO FAIR SHARE</button><button class="primary" '
      + 'data-action="fish" ' + (userBoat.can_fish_now && !blocked ? '' : 'disabled') + '>FISH</button></div>'
      + '<p class="desk-reason ' + (reason ? 'blocked' : '') + '">' + esc(reason || 'READY TO FISH')
      + ' · SEASON ' + esc(liveState.season) + ' · ' + esc(liveState.left) + 'S LEFT</p>';
    $('effort').oninput = event => {
      effortBps = +event.target.value;
      renderFishing();
    };
  }

  function fishReason(boat) {
    if (seaBehind()) {
      return 'Settle the sea first';
    }
    if (liveState && liveState.dead) {
      return 'SEA IS DEAD';
    }
    if (boat.exiled_until && +boat.exiled_until > liveState.season) {
      return 'EXILED UNTIL SEASON ' + boat.exiled_until;
    }
    if (!boat.boat || !+boat.boat.stake) {
      return 'BUILD A BOAT FIRST';
    }
    if (+boat.boat.stake_season >= liveState.season) {
      return 'BUILT THIS SEASON · FISH NEXT SEASON';
    }
    if (boat.boat.last_fished === liveState.season) {
      return 'ALREADY FISHED THIS SEASON';
    }
    if (!boat.can_fish_now) {
      return 'FISHING IS CURRENTLY UNAVAILABLE';
    }
    return '';
  }

  function renderPlayer() {
    if (!live) {
      return;
    }
    if (!account) {
      setPlayerRow('connect-content', '<button class="primary" data-action="connect">CONNECT TESTNET '
        + 'WALLET</button>');
      setPlayerRow('faucet-content', playerText('CONNECT FIRST TO REGISTER AND CLAIM THE FAUCET.'));
      setPlayerRow('tap-content', playerText('CONNECT FIRST. ONE APPROVAL ENABLES POPUP-FREE '
        + 'FISHING AND VOTING.'));
      setPlayerRow('boat-content', playerText('CLAIM TIDE FIRST, THEN BUILD YOUR BOAT.'));
      $('fishing-desk').classList.add('hidden');
      renderPlayerBusy();
      return;
    }
    const near = balances ? balanceFmt(balances.near) + ' NEAR' : '—';
    const tide = balances ? fmt(balances.tide) + ' TIDE' : '—';
    setPlayerRow('connect-content', '<div class="account-readout"><code>' + esc(account)
      + '</code><span>NEAR ' + esc(near) + '</span><span>TIDE ' + esc(tide)
      + '</span><button class="control" data-action="disconnect">DISCONNECT</button></div>');

    const registered = balances && balances.storage !== null;
    const claimed = localStorage.getItem(faucetKey()) === '1';
    if (claimed) {
      setPlayerRow('faucet-content', playerText('FAUCET CLAIMED · YOUR TIDE BALANCE IS ' + tide + '.'),
        true);
    } else if (devWalletMode()) {
      setPlayerRow('faucet-content', playerText('WALLET-ONLY ACTION · NOT AVAILABLE IN DEV MODE.'));
    } else if (!registered) {
      setPlayerRow('faucet-content', playerText('REGISTER THE TOKEN ACCOUNT AND CLAIM IN ONE WALLET '
        + 'APPROVAL.')
        + '<button class="primary" data-action="claim">REGISTER &amp; CLAIM</button>');
    } else {
      setPlayerRow('faucet-content', playerText('TOKEN ACCOUNT REGISTERED · CLAIM ONCE FOR 100,000 TIDE.')
        + '<button class="primary" data-action="claim">CLAIM 100,000 TIDE</button>');
    }

    setPlayerRow('tap-content', tideWallet && tideWallet.oneTap
      ? playerText('ONE-TAP ENABLED · FISHING, VOTING, SHARDS, TICK AND BOAT CALLS NEED NO POPUPS.')
      : devWalletMode()
        ? playerText('WALLET-ONLY ACTION · NOT AVAILABLE IN DEV MODE.')
      : playerText('ONE APPROVAL; THEN FISHING AND VOTING NEED NO POPUPS; THE KEY CAN ONLY CALL THESE '
        + '6 METHODS ON THIS CONTRACT AND HOLDS NO FUNDS.')
        + '<button class="control" data-action="one-tap">ENABLE ONE-TAP</button>');

    const stake = userBoat && userBoat.boat ? tok(userBoat.boat.stake) : 0;
    const blocked = seaBehind();
    const settleReason = blocked ? '<p class="desk-reason blocked">Settle the sea first</p>' : '';
    setPlayerRow('boat-content', '<p class="player-note">1% IS BURNED TO BUILD THE BOAT · YOUR BOAT '
      + 'FISHES FROM NEXT SEASON' + (stake ? ' · CURRENT STAKE ' + fmt(stake) + ' TIDE' : '') + '</p>'
      + '<div class="amount-control"><label>STAKE TIDE <input id="stake-amount" type="number" min="1000" '
      + 'step="1000" value="50000"></label><div class="presets"><button class="control" '
      + 'data-amount="10000">10K</button><button class="control" data-amount="50000">50K</button>'
      + '<button class="control" data-amount="100000">100K</button></div><button class="primary" '
      + 'data-action="stake"' + (blocked ? ' disabled' : '') + '>BUILD / TOP UP</button></div>'
      + settleReason + '<div class="amount-control unstake-control">'
      + '<label>UNSTAKE TIDE <input id="unstake-amount" type="number" min="1" step="1000" '
      + 'value="1000"></label><button class="control" data-action="unstake" '
      + (stake && !blocked ? '' : 'disabled')
      + '>UNSTAKE</button></div>');
    renderFishing();
    renderPlayerBusy();
  }

  function renderPlayerBusy() {
    document.querySelectorAll('#player-section [data-action], #assembly-actions [data-action], '
      + '#tick-button')
      .forEach(button => {
        const settlesFirst = seaBehind() && [
          'fish', 'stake', 'unstake', 'vote-yes', 'vote-no', 'write-shard'
        ].includes(button.dataset.action);
        button.disabled = playerBusy || settlesFirst;
        if (playerBusy && button.dataset.action === playerBusyAction
          && playerBusyAction !== 'settle-sea') {
          button.textContent = 'SENDING…';
        }
      });
    renderSettlementBars();
  }

  function renderLiveControls() {
    renderPlayer();
    renderAssemblyActions(liveState.assembly, liveState.season);
  }

  // Display a recoverable live-mode error and mark unavailable stats clearly.
  function error(e) {
    $('banner').textContent = 'Live data unavailable: ' + e + '. Showing the last known state.';
    $('banner').classList.add('show');
    ['day', 'stock', 'catch', 'minted', 'burned', 'apr'].forEach(id => {
      $(id).textContent = '—';
    });
    $('catchfill').style.width = '0%';
    $('catchnote').textContent = 'NO LIVE DATA';
  }

  // Convert live contract boat data into the display model used by the fleet renderer.
  function liveBoat(n, v, ind, ex, season) {
    const b = v && v.boat;
    const x = (ex || []).find(p => p[0] === n && +p[1] > season);
    const i = (ind || []).find(p => p[0] === n);
    return {
      name: n,
      type: n.indexOf('faction-') === 0 ? 'faction' : n.indexOf('greedy-') === 0 ? 'greedy' : 'keep',
      status: x ? 'EXILED' : i ? 'INDICTED' : n.indexOf('faction-') === 0 ? 'FACTION' : 'FAIR',
      exiledUntil: x ? +x[1] : null,
      lastCatch: 0,
      fairShare: tok(v && v.fair_share),
      indictedThisCycle: Boolean(i),
      stake: tok(b && b.stake)
    };
  }

  // Render the last finalized live contract state.
  function liveRender() {
    if (!liveState) {
      return;
    }
    const st = liveState.boats.reduce((n, b) => n + b.stake, 0);
    const apr = liveState.apr || (st && liveState.season
      ? (liveState.minted - liveState.burned) / st / (liveState.season / 365) * 100
      : 0);
    chart(history, null);
    stats(
      liveState,
      liveState.caught,
      liveState.minted,
      liveState.burned,
      apr,
      'season ' + liveState.season + ', ' + liveState.left + 's left'
    );
    $('chartbox').classList.toggle('isdead', liveState.dead);
    $('dead').classList.toggle('hidden', !liveState.dead);
    $('deadtext').textContent = liveState.dead
      ? 'Crossed the point of no return on day ' + liveState.died
      : '';
    $('sea-title').textContent = 'The sea · live';
    $('sea-copy').textContent = 'Finalized contract view on ' + network + '.';
    $('fleetnote').textContent = liveState.boats.length + ' configured boats · '
      + (liveState.synced ? 'synced' : liveState.behind + ' seasons behind');
    fleet(liveState.boats, liveState.season);
    assembly(
      liveState.assembly,
      liveState.assembly && liveState.assembly.eligible,
      liveState.season,
      liveState.exiles
    );
    renderLog(log);
    renderSettlementBars();
  }

  // Add each finalized assembly to the live public record once per cycle.
  function recordAssembly(a, season) {
    const result = a && a.last_result;
    const cycle = result && +result.cycle;
    if (!Number.isFinite(cycle) || loggedAssemblyCycles.has(cycle)) {
      return;
    }
    loggedAssemblyCycles.add(cycle);
    const exiled = (result.exiled || []).join(', ');
    log.unshift({
      season: season,
      kind: result.held ? 'exiled' : 'assembly',
      text: 'Cycle ' + cycle + ' · assembly ' + (result.held ? 'held ' : 'not held ')
        + (+result.hold_yes || 0) + '-' + (+result.hold_no || 0) + ' · '
        + (exiled ? 'exiled ' + exiled : 'no exile')
    });
  }

  // Poll the configured contract and rebuild the live-mode display model.
  function poll(rethrow) {
    if (!live) {
      return Promise.resolve();
    }
    return rpcCall('get_sea').then(s => Promise.all([
      s,
      rpcCall('get_assembly'),
      rpcCall('get_exiles'),
      rpcCall('get_indictments', { cycle: Math.floor((+s.season || 0) / 3) })
    ])).then(v => {
      const s = v[0];
      const a = v[1];
      const season = +s.season || 0;
      const ex = v[2] || [];
      const ind = v[3] || [];
      ex.forEach(pair => knownAccounts.add(pair[0]));
      ind.forEach(pair => knownAccounts.add(pair[0]));
      (a.shards || []).forEach(pair => knownAccounts.add(pair[0]));
      (a.last_result && a.last_result.exiled || []).forEach(name => knownAccounts.add(name));
      if (account) {
        knownAccounts.add(account);
      }
      const names = Array.from(knownAccounts);
      return Promise.all(names.map(name => rpcCall('get_boat', { account_id: name }))).then(boats => {
        liveState = {
          season: season,
          stock: +s.stock_fish || 0,
          dead: !!s.dead,
          died: s.died_season,
          caught: +s.caught_this_season || 0,
          minted: tok(s.minted_catch),
          burned: tok(s.burned_fuel),
          synced: !!s.synced,
          behind: +s.seasons_behind || 0,
          left: +s.seconds_left_in_season || 0,
          seasonLen: +s.season_len_sec || 60,
          boats: names.map((n, i) => liveBoat(n, boats[i], ind, ex, season)),
          assembly: a,
          exiles: ex,
          indictments: ind
        };
        userBoat = account ? boats[names.indexOf(account)] : null;
        return readPlayer(account).catch(e => {
          if (account) {
            error(e.message || 'account request failed');
          }
          return null;
        });
      });
    }).then(player => {
      if (account && player) {
        balances = player;
        userBoat = player.boat;
      }
      rememberHistory({ season: liveState.season, stock: liveState.stock });
      recordAssembly(liveState.assembly, liveState.season);
      log = [{
        season: liveState.season,
        kind: 'catch',
        text: 'Season ' + liveState.season + ' · stock ' + fmt(liveState.stock)
          + ' · catch ' + fmt(liveState.caught)
      }].concat(log).slice(0, 200);
      liveRender();
      renderLiveControls();
      $('banner').classList.remove('show');
    }).catch(e => {
      error(e.message || 'request failed');
      if (rethrow) {
        throw e;
      }
    });
  }

  function recordTx(label, result) {
    log.unshift({
      season: liveState ? liveState.season : 0,
      kind: 'action',
      text: label,
      url: result && result.url
    });
    log = log.slice(0, 200);
  }

  function setAccount(next) {
    account = next || null;
    balances = null;
    userBoat = null;
    if (account) {
      knownAccounts.add(account);
    }
    if (live) {
      $('hero-play').textContent = account ? 'YOUR BOAT ↓' : 'CONNECT WALLET';
      $('tick-button').disabled = !account;
    }
    renderPlayer();
    poll().catch(e => error(e.message || 'account refresh failed'));
  }

  function settleSea() {
    if (!account || !tideWallet || settling || playerBusy || !seaBehind()) {
      return Promise.resolve();
    }
    settling = true;
    settledTicks = 0;
    settlementTotal = Math.ceil((liveState.behind - 40) / 40);
    settlementMessage = '';
    playerBusy = true;
    playerBusyAction = 'settle-sea';
    renderPlayerBusy();
    return (function nextTick() {
      if (!seaBehind() || settledTicks >= 10) {
        return Promise.resolve();
      }
      return tideWallet.call('tick', {}).then(result => {
        settledTicks += 1;
        if (result && (result.url || result.hash)) {
          recordTx('Sea settled', result);
        }
        return poll(true);
      }).then(nextTick);
    }()).then(() => poll(true)).then(() => {
      if (seaBehind()) {
        settlementMessage = '10 TICKS COMPLETE · CLICK TO CONTINUE';
      }
    }).catch(e => {
      settlementMessage = 'SETTLEMENT STOPPED · CLICK TO TRY AGAIN';
      error(e.message || 'settlement failed');
    }).then(() => {
      settling = false;
      playerBusy = false;
      playerBusyAction = null;
      renderPlayer();
      renderSettlementBars();
    });
  }

  function performPlayerAction(action) {
    if (action === 'settle-sea') {
      return settleSea();
    }
    if (playerBusy) {
      $('banner').textContent = 'Another transaction is still pending.';
      $('banner').classList.add('show');
      return Promise.resolve();
    }
    if (action === 'fair') {
      const full = tok(userBoat && userBoat.full_effort_catch);
      const fair = tok(userBoat && userBoat.fair_share);
      effortBps = full ? Math.max(1, Math.floor(fair * 10000 / full)) : 1;
      renderFishing();
      return Promise.resolve();
    }
    if (!tideWallet) {
      return Promise.resolve();
    }
    playerBusy = true;
    playerBusyAction = action;
    renderPlayer();
    let operation;
    if (action === 'connect') {
      operation = tideWallet.connect();
    } else if (action === 'disconnect') {
      operation = tideWallet.disconnect();
    } else if (action === 'claim') {
      if (devWalletMode()) {
        operation = Promise.reject(new Error('Wallet-only action not available in dev mode.'));
      } else {
        const defs = [];
        if (!balances || balances.storage === null) {
          defs.push({
            method: 'storage_deposit',
            args: { account_id: account, registration_only: true },
            deposit: '1250000000000000000000'
          });
        }
        defs.push({ method: 'claim_faucet', args: {}, deposit: 0 });
        operation = tideWallet.batch(defs).then(result => {
          localStorage.setItem(faucetKey(), '1');
          return result;
        });
      }
    } else if (action === 'one-tap') {
      operation = devWalletMode()
        ? Promise.reject(new Error('Wallet-only action not available in dev mode.'))
        : tideWallet.enableOneTap();
    } else if (action === 'stake' || action === 'unstake') {
      const input = $(action === 'stake' ? 'stake-amount' : 'unstake-amount');
      const amount = Number(input && input.value);
      if (!Number.isFinite(amount) || amount < (action === 'stake' ? 1000 : 1)) {
        operation = Promise.reject(new Error('Enter a valid TIDE amount.'));
      } else {
        operation = tideWallet.call(action, { amount: String(yocto(amount)) });
      }
    } else if (action === 'fish') {
      operation = tideWallet.call('fish', { effort_bps: effortBps });
    } else if (action === 'vote-yes' || action === 'vote-no') {
      operation = tideWallet.call('vote_hold', { yes: action === 'vote-yes' });
    } else if (action === 'write-shard') {
      const names = Array.from(document.querySelectorAll('input[name="shard-name"]:checked'))
        .map(input => input.value).slice(0, 3);
      operation = names.length
        ? tideWallet.call('write_shard', { names })
        : Promise.reject(new Error('Select one to three names.'));
    } else if (action === 'tick') {
      operation = tideWallet.call('tick', {});
    } else {
      operation = Promise.resolve();
    }
    return operation.then(result => {
      if (action === 'vote-yes' || action === 'vote-no') {
        const cycle = liveState.assembly.cycle;
        rememberAction(actionKey('vote', cycle), action === 'vote-yes');
      }
      if (action === 'write-shard') {
        const cycle = liveState.assembly.cycle;
        rememberAction(actionKey('shard', cycle), Array.from(
          document.querySelectorAll('input[name="shard-name"]:checked')
        ).map(input => input.value).slice(0, 3));
      }
      const labels = {
        claim: 'Faucet claimed',
        'one-tap': 'One-tap key enabled',
        stake: 'Boat built or topped up',
        unstake: 'TIDE unstaked',
        fish: 'Fishing trip completed',
        'vote-yes': 'Vote YES recorded',
        'vote-no': 'Vote NO recorded',
        'write-shard': 'Shard written',
        tick: 'Sea settled'
      };
      if (result && (result.url || result.hash)) {
        recordTx(labels[action] || action, result);
      }
      playerBusy = false;
      playerBusyAction = null;
      renderPlayer();
      poll().catch(e => error(e.message || 'account refresh failed'));
      return result;
    }).catch(e => {
      playerBusy = false;
      playerBusyAction = null;
      renderPlayer();
      if (action === 'claim' && /already claimed/i.test(e.message || '')) {
        localStorage.setItem(faucetKey(), '1');
        poll().catch(err => error(err.message || 'account refresh failed'));
        return;
      }
      error(e.message || 'transaction failed');
      throw e;
    });
  }

  function loadWallet() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/@near-wallet-selector/modal-ui@10.1.4/styles.css';
    document.head.appendChild(css);
    return import('./wallet.js').then(module => {
      tideWallet = module.createTideWallet({ contract, rpc, onChange: setAccount });
      setAccount(tideWallet.account);
    }).catch(e => error(e.message || 'wallet setup failed'));
  }

  // Render wallet command examples and wire their copy buttons.
  function actions() {
    const pre = 'near contract call-function as-transaction ' + contract + ' ';
    const suf = ' prepaid-gas \'30 Tgas\' attached-deposit \'0 NEAR\' sign-as <your-account>'
      + ' network-config ' + network + ' sign-with-keychain send';
    const cs = [
      ['fish', pre + 'fish json-args \'{"effort_bps":3344}\'' + suf],
      ['stake', pre + 'stake json-args \'{"amount":"1000000000000000000000"}\'' + suf],
      ['vote_hold', pre + 'vote_hold json-args \'{"yes":true}\'' + suf],
      ['write_shard', pre + 'write_shard json-args \'{"names":["greedy-1.near"]}\'' + suf],
      ['tick', pre + 'tick json-args \'{}\'' + suf]
    ];
    $('action-list').innerHTML = cs.map(x => '<div class="actionrow"><code>' + esc(x[1])
      + '</code><button class="copy" data-command="' + esc(x[1]) + '">Copy</button></div>').join('');
    $('action-list').querySelectorAll('.copy').forEach(b => b.onclick = () => {
      const v = b.dataset.command;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(v).catch(e => error(e.message || 'copy failed'));
      } else {
        prompt('Copy command', v);
      }
      b.textContent = 'Copied';
      setTimeout(() => b.textContent = 'Copy', 1200);
    });
  }

  // Load immutable contract parameters for the live-mode rules panel.
  function rules() {
    rpcCall('get_params').then(r => {
      $('ruleslist').innerHTML = Object.keys(r).map(k => '<div><strong class="'
        + (k === 'admin' ? 'admin' : '') + '">' + esc(k.replace(/_/g, ' ')) + ':</strong> '
        + esc(typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k])
        + '</div>').join('');
    }).catch(e => error(e.message || 'rules request failed'));
  }

  /* Keyboard shortcuts */
  // Register keyboard shortcuts for play/pause and restart.
  function keyboardShortcuts() {
    document.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea,button')) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        playing ? stop() : start();
      }
      if (e.key.toLowerCase() === 'r') {
        restart();
      }
    });
  }

  /* Init */
  // Wire controls, select the initial scenario, and start the selected mode.
  function init() {
    mode();
    if (!live) {
      $('scenarios').innerHTML = window.TideSim.SCENARIOS.map(s => '<button data-id="' + s.id
        + '">' + esc(s.label) + '</button>').join('');
      $('scenarios').querySelectorAll('button').forEach(b => b.onclick = () => {
        scenario = b.dataset.id;
        $('scenarios').querySelectorAll('button').forEach(x => {
          const active = x === b;
          x.classList.toggle('active', active);
          x.setAttribute('aria-pressed', String(active));
        });
        $('blurb').textContent = window.TideSim.SCENARIOS.find(s => s.id === scenario).blurb;
        restart();
      });
      $('scenarios').querySelector('[data-id="tide"]').click();
      $('play').onclick = () => playing ? stop() : start();
      $('hero-play').onclick = () => playing ? stop() : start();
      $('restart').onclick = restart;
      document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
        speed = +b.dataset.speed;
        document.querySelectorAll('[data-speed]').forEach(x => {
          const active = x === b;
          x.classList.toggle('active', active);
          x.setAttribute('aria-pressed', String(active));
        });
        $('mode-note').textContent = 'Animated demo · ' + (2 * speed) + ' seasons per second';
        if (playing) {
          stop();
          start();
        }
      });
      keyboardShortcuts();
    } else {
      ensureSettlementBars();
      $('tick-button').dataset.action = 'settle-sea';
      $('tick-button').disabled = !account;
      actions();
      rules();
      loadWallet();
      poll().catch(e => error(e.message || 'initial live request failed'));
      setInterval(() => poll().catch(e => error(e.message || 'live refresh failed')), 10000);
    }
    $('replay-link').onclick = () => {
      if (live) {
        location.href = location.pathname + '?demo';
      }
    };
    $('hero-play').onclick = () => {
      if (!live) {
        playing ? stop() : start();
      } else if (account) {
        $('player-section').scrollIntoView({ behavior: 'smooth' });
      } else {
        performPlayerAction('connect').catch(() => {});
      }
    };
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button || !live) {
        return;
      }
      if (button.dataset.amount) {
        const input = $('stake-amount');
        if (input) {
          input.value = button.dataset.amount;
        }
        return;
      }
      performPlayerAction(button.dataset.action).catch(() => {});
    });
    document.addEventListener('change', event => {
      if (!event.target.matches('input[name="shard-name"]')) {
        return;
      }
      const selected = document.querySelectorAll('input[name="shard-name"]:checked');
      if (selected.length > 3) {
        event.target.checked = false;
      }
    });
    $('demo-mode').onclick = () => {
      if (live) {
        location.href = location.pathname + '?demo';
      }
    };
    $('live-mode').onclick = () => {
      if (contract && !live) {
        location.href = location.pathname + '?contract=' + encodeURIComponent(contract);
      }
    };
  }

  init();
}());
