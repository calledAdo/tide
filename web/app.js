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
  const live = Boolean(urlContract) && !forced;
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
  const historyKey = 'tide-history:' + network + ':' + contract;

  /* Formatting helpers */
  // Format numeric values using compact notation for large values.
  function fmt(n) {
    n = Number(n) || 0;
    return Math.abs(n) >= 1000000
      ? (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
      : Math.round(n).toLocaleString('en-US');
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
    $('hero-play').disabled = live;
    $('mode-note').textContent = live
      ? 'Live read-only view · polling every 10 seconds'
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
      const ex = live
        ? b.exiledUntil != null && b.exiledUntil > season
        : b.status === 'EXILED' || b.exiledUntil != null && b.exiledUntil > season;
      const ind = b.indictedThisCycle || b.status === 'INDICTED';
      const fac = b.status === 'FACTION' || b.type === 'faction';
      const status = ex
        ? 'EXILED until day ' + b.exiledUntil
        : ind
          ? 'INDICTED ' + (b.lastCatch / b.fairShare).toFixed(1) + 'x'
          : fac
            ? 'FACTION'
            : 'FAIR';
      const changed = oldStatus[b.name] && oldStatus[b.name] !== status;
      oldStatus[b.name] = status;
      return '<article class="boat ' + (ex ? 'exiled ' : '') + (fac ? 'faction ' : '')
        + (changed ? 'changed' : '') + '"><div class="boatname" title="' + esc(b.name) + '">'
        + esc(b.name) + '</div><div class="stake"><i></i></div><div class="boatmeta">'
        + '<span>today</span><strong>' + fmt(b.lastCatch) + '</strong></div><span class="chip '
        + (ex ? 'exiled' : ind ? 'indicted' : fac ? 'faction' : '') + '">' + esc(status)
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

  /* Log */
  // Render the most recent simulation or live-mode events.
  function renderLog(events) {
    const a = (events || []).slice(0, 200);
    $('logcount').textContent = a.length + ' events';
    $('log').innerHTML = a.length
      ? a.map(e => '<div class="entry"><span class="entry-day">DAY ' + esc(e.season)
        + '</span><i class="dot ' + esc(e.kind) + '"></i><span>'
        + esc(e.text) + '</span></div>').join('')
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
  function poll() {
    const raw = qs.has('boats') ? qs.get('boats') : (cfg.boats || []).join(',');
    const names = raw.split(',').map(x => x.trim()).filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i);
    rpcCall('get_sea').then(s => Promise.all([
      s,
      rpcCall('get_assembly'),
      rpcCall('get_exiles'),
      rpcCall('get_indictments', { cycle: Math.floor((+s.season || 0) / 3) })
    ].concat(names.map(n => rpcCall('get_boat', { account_id: n }))))).then(v => {
      const s = v[0];
      const a = v[1];
      const season = +s.season || 0;
      const ex = v[2] || [];
      const ind = v[3];
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
        boats: names.map((n, i) => liveBoat(n, v[4 + i], ind, ex, season)),
        assembly: a,
        exiles: ex
      };
      rememberHistory({ season: liveState.season, stock: liveState.stock });
      recordAssembly(a, liveState.season);
      log = [{
        season: liveState.season,
        kind: 'catch',
        text: 'Season ' + liveState.season + ' · stock ' + fmt(liveState.stock)
          + ' · catch ' + fmt(liveState.caught)
      }].concat(log).slice(0, 200);
      liveRender();
      $('banner').classList.remove('show');
    }).catch(e => error(e.message || 'request failed'));
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
        navigator.clipboard.writeText(v);
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
      actions();
      rules();
      poll();
      setInterval(poll, 10000);
    }
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
