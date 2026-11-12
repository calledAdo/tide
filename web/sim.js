(function (root) {
  'use strict';

  const K = 1000000.0;
  const A = 120000.0;
  const R = 0.6;
  const MAX_TAKE = 0.25;
  const FUEL = 0.002;
  const QUOTA_OF_MSY = 0.8;
  const ASSEMBLY_EVERY = 3;
  const EXILE_LEN = 10;
  const NAMES_PER_VOTER = 3;
  const QUORUM = 0.40;
  const N = 20;
  const SEASONS = 120;
  const SUPPLY = 100000000.0;

  function growth(s) {
    return R * s * (1 - s / K) * (s - A) / K;
  }

  function msyStock() {
    let best = 0;
    let bestGrowth = growth(0);
    for (let i = 0; i <= 1000; i += 1) {
      const candidate = K * i / 1000;
      const candidateGrowth = growth(candidate);
      if (candidateGrowth > bestGrowth) {
        best = candidate;
        bestGrowth = candidateGrowth;
      }
    }
    return best;
  }

  const MSY_STOCK = msyStock();
  const QUOTA = QUOTA_OF_MSY * growth(MSY_STOCK);

  const SCENARIOS = [
    { id: 'lawless', label: 'Lawless sea', blurb: 'Open access: overfishing goes unpunished.' },
    { id: 'tide', label: '$TIDE: the sea polices itself', blurb: 'Assemblies indict and exile the greedy.' },
    { id: 'faction-naive', label: 'Faction attack, naive rules', blurb: 'A faction can capture one-stage governance.' },
    { id: 'faction-tide', label: 'Faction attack, $TIDE rules', blurb: 'Two stages and stake-in-the-sea stop capture.' }
  ];

  const firstNames = ['ana', 'ben', 'cora', 'dani', 'eli', 'faye', 'gia', 'hugo', 'iva', 'jo', 'kai', 'luz', 'mina', 'noa', 'pax'];

  function scenarioConfig(id) {
    const mix = Array(5).fill('greedy').concat(Array(15).fill('cc'));
    const keep = Array(20).fill('keep');
    const coalition = [14, 15, 16, 17, 18, 19];
    if (id === 'lawless') return { types: mix, staked: 0.10, ostracism: false, twoStage: true, shareToSea: true, coalition: [], quorum: QUORUM };
    if (id === 'tide') return { types: mix, staked: 0.10, ostracism: true, twoStage: true, shareToSea: true, coalition: [], quorum: QUORUM };
    if (id === 'faction-naive') return { types: keep, staked: 0.50, ostracism: true, twoStage: false, shareToSea: false, coalition: coalition, quorum: 0.25 };
    if (id === 'faction-tide') return { types: keep, staked: 0.50, ostracism: true, twoStage: true, shareToSea: true, coalition: coalition, quorum: QUORUM };
    throw new Error('Unknown $TIDE scenario: ' + id);
  }

  function boatName(index, faction) {
    if (index < 5) return 'greedy-' + (index + 1) + '.near';
    if (faction && index >= 14) return 'faction-' + (index - 13) + '.near';
    return firstNames[index - 5] + '.near';
  }

  function comma(value) {
    return Math.round(value).toLocaleString('en-US');
  }

  function makeEvent(season, kind, text) {
    return { season: season, kind: kind, text: text };
  }

  function create(id) {
    const cfg = scenarioConfig(id);
    const faction = id.indexOf('faction-') === 0;
    const stake = cfg.staked * SUPPLY / N;
    const totalStake = stake * N;
    const boats = Array.from({ length: N }, function (_, i) {
      return {
        name: boatName(i, faction),
        type: cfg.types[i] === 'greedy' ? 'greedy' : (faction && i >= 14 ? 'faction' : cfg.types[i]),
        status: faction && i >= 14 ? 'FACTION' : 'FAIR',
        exiledUntil: null,
        lastCatch: 0,
        fairShare: QUOTA * stake / totalStake,
        indictedThisCycle: false
      };
    });
    const engine = {
      id: id,
      config: cfg,
      season: 0,
      stock: 0.7 * K,
      dead: false,
      deadAt: null,
      exiled: Object.create(null),
      overage: Array(N).fill(0.0),
      defecting: Array(N).fill(false),
      net: Array(N).fill(0.0),
      exileCount: 0,
      wrongCount: 0,
      history: [0.7 * K],
      minted: 0,
      burned: 0,
      assembly: null,
      lastCatch: 0,
      events: [],
      state: null
    };

    function stateBoats() {
      return boats.map(function (boat, i) {
        const until = engine.exiled[i] == null ? null : engine.exiled[i];
        const exiledNow = until != null && until > engine.season;
        let status = boat.indictedThisCycle ? 'INDICTED' : boat.status === 'FACTION' ? 'FACTION' : 'FAIR';
        if (exiledNow) status = 'EXILED';
        return {
          name: boat.name,
          type: boat.type,
          status: status,
          exiledUntil: until,
          lastCatch: boat.lastCatch,
          fairShare: boat.fairShare,
          indictedThisCycle: boat.indictedThisCycle
        };
      });
    }

    function refreshState() {
      engine.state = {
        season: engine.season,
        stock: engine.stock,
        dead: engine.dead,
        boats: stateBoats(),
        minted: engine.minted,
        burned: engine.burned,
        aprSoFar: engine.season ? engine.net.reduce(function (a, b) { return a + b; }, 0) / totalStake / (engine.season / 365) * 100 : 0,
        assembly: engine.assembly
      };
    }

    engine.step = function () {
      if (engine.season >= SEASONS) return [];
      const t = engine.season;
      const events = [];
      const active = [];
      for (let i = 0; i < N; i += 1) {
        if ((engine.exiled[i] == null ? -1 : engine.exiled[i]) <= t) active.push(i);
      }
      const actT = stake * active.length;
      const share = QUOTA * stake / (cfg.shareToSea ? totalStake : Math.max(actT, 1));
      const fullPerToken = MAX_TAKE * engine.stock / totalStake;
      const catches = Array(N).fill(0.0);
      const fuels = Array(N).fill(0.0);

      for (const i of active) {
        const greedy = cfg.types[i] === 'greedy' || (cfg.types[i] === 'cc' && engine.defecting[i]);
        const f = fullPerToken <= FUEL ? 0.0 : greedy ? 1.0 : Math.min(1.0, share / (fullPerToken * stake));
        catches[i] = f * fullPerToken * stake;
        fuels[i] = f * FUEL * stake;
      }
      const total = catches.reduce(function (a, b) { return a + b; }, 0);
      engine.stock = Math.max(0.0, engine.stock - total);
      engine.stock = Math.max(0.0, engine.stock + growth(engine.stock));
      if (engine.stock < A && engine.deadAt === null) {
        engine.deadAt = t + 1;
        engine.dead = true;
      }
      engine.history.push(engine.stock);
      engine.lastCatch = total;
      engine.minted += total;
      engine.burned += fuels.reduce(function (a, b) { return a + b; }, 0);

      for (let i = 0; i < N; i += 1) {
        engine.net[i] += catches[i] - fuels[i];
        engine.overage[i] += Math.max(0.0, catches[i] - share * 1.001);
        boats[i].lastCatch = catches[i];
        boats[i].fairShare = share;
        boats[i].indictedThisCycle = engine.overage[i] > 0;
      }

      const day = t + 1;
      events.push(makeEvent(day, 'catch', 'Day ' + day + ' · fleet caught ' + comma(total) + ' · sea ' + comma(engine.stock)));
      for (let i = 0; i < N; i += 1) {
        if (catches[i] > share * 1.001) {
          events.push(makeEvent(day, 'indicted', 'Day ' + day + ' · ' + boats[i].name + ' indicted: caught ' + (catches[i] / share).toFixed(1) + 'x its fair share'));
        }
      }

      if (!cfg.ostracism) {
        const fracBad = active.filter(function (i) { return catches[i] > share * 1.001; }).length / Math.max(1, active.length);
        for (let i = 0; i < N; i += 1) {
          if (cfg.types[i] === 'cc') engine.defecting[i] = fracBad > 0.10;
        }
      }

      if (cfg.ostracism && (t + 1) % ASSEMBLY_EVERY === 0) {
        const eligible = [];
        for (let i = 0; i < N; i += 1) {
          if ((engine.exiled[i] == null ? -1 : engine.exiled[i]) <= t) eligible.push(i);
        }
        const honest = eligible.filter(function (i) { return cfg.coalition.indexOf(i) === -1 && cfg.types[i] !== 'greedy'; });
        const offenders = eligible.filter(function (i) { return engine.overage[i] > 0; }).sort(function (a, b) { return engine.overage[b] - engine.overage[a]; });
        const yes = (offenders.length ? honest.length : 0) + cfg.coalition.filter(function (i) { return eligible.indexOf(i) !== -1; }).length;
        const held = cfg.twoStage ? yes > eligible.length / 2 : true;
        const shards = Object.create(null);
        if (held) {
          honest.forEach(function (i) {
            offenders.slice(0, NAMES_PER_VOTER).forEach(function (o) { shards[o] = (shards[o] || 0) + 1; });
          });
          if (cfg.coalition.length) {
            const targets = eligible.filter(function (i) { return cfg.coalition.indexOf(i) === -1; }).slice(0, NAMES_PER_VOTER);
            cfg.coalition.forEach(function (i) {
              if (eligible.indexOf(i) !== -1) targets.forEach(function (o) { shards[o] = (shards[o] || 0) + 1; });
            });
          }
        }
        const exiledNow = [];
        Object.keys(shards).forEach(function (key) {
          const i = Number(key);
          if (shards[i] >= cfg.quorum * eligible.length) {
            engine.exiled[i] = t + 1 + EXILE_LEN;
            exiledNow.push(i);
            engine.exileCount += 1;
            if (engine.overage[i] === 0) engine.wrongCount += 1;
          }
        });
        exiledNow.sort(function (a, b) { return a - b; });
        const shardText = Object.keys(shards).sort(function (a, b) { return Number(a) - Number(b); }).map(function (key) {
          return boats[Number(key)].name + ' ' + shards[key];
        });
        engine.assembly = {
          eligible: eligible.length,
          hold_yes: yes,
          hold_no: eligible.length - yes,
          held: held,
          shards: Object.fromEntries(Object.keys(shards).map(function (key) { return [boats[Number(key)].name, shards[key]]; })),
          exiled: exiledNow.map(function (i) { return boats[i].name; })
        };
        const holdText = 'Day ' + day + ' · Assembly: hold ' + yes + '-' + (eligible.length - yes) + '. ';
        if (!held) {
          events.push(makeEvent(day, 'assembly', holdText + 'The assembly voted not to hold an ostracism.'));
        } else {
          events.push(makeEvent(day, 'assembly', holdText + 'Shards: ' + (shardText.length ? shardText.join(', ') : 'none') + '. ' + (exiledNow.length ? 'Exiled until day ' + (t + 1 + EXILE_LEN) + '.' : 'No boat reached quorum.')));
          exiledNow.forEach(function (i) {
            events.push(makeEvent(day, 'exiled', 'Day ' + day + ' · ' + boats[i].name + ' exiled until day ' + engine.exiled[i] + '.'));
          });
        }
        const punished = offenders.some(function (i) { return engine.exiled[i] != null && engine.exiled[i] > t; });
        for (let i = 0; i < N; i += 1) {
          if (cfg.types[i] === 'cc') engine.defecting[i] = Boolean(offenders.length) && !punished;
          boats[i].indictedThisCycle = false;
        }
        engine.overage = Array(N).fill(0.0);
      }

      for (let i = 0; i < N; i += 1) {
        if (engine.exiled[i] != null && engine.exiled[i] <= day && engine.exiled[i] > t) {
          events.push(makeEvent(day, 'returned', 'Day ' + day + ' · ' + boats[i].name + ' returned from exile.'));
        }
      }
      if (engine.deadAt === day) events.push(makeEvent(day, 'sea_died', 'Day ' + day + ' · THE SEA IS DEAD below the 120,000 fish threshold.'));
      engine.season = day;
      engine.events = events.concat(engine.events);
      refreshState();
      return events;
    };

    refreshState();
    return engine;
  }

  function runToEnd(id) {
    const engine = create(id);
    while (engine.season < SEASONS) engine.step();
    const cfg = engine.config;
    const totalStake = cfg.staked * SUPPLY;
    const net = engine.net.reduce(function (a, b) { return a + b; }, 0);
    const coalition = cfg.coalition;
    let edge = null;
    if (coalition.length) {
      const coalitionNet = coalition.reduce(function (sum, i) { return sum + engine.net[i]; }, 0) / coalition.length;
      const outsiders = Array.from({ length: N }, function (_, i) { return i; }).filter(function (i) { return coalition.indexOf(i) === -1; });
      const outsiderNet = outsiders.reduce(function (sum, i) { return sum + engine.net[i]; }, 0) / outsiders.length;
      edge = outsiderNet > 0 ? coalitionNet / outsiderNet : Infinity;
    }
    return {
      final: Math.round(engine.stock),
      deadAt: engine.deadAt,
      apr: net / totalStake / (SEASONS / 365) * 100,
      exiles: engine.exileCount,
      wrong: engine.wrongCount,
      edge: edge,
      stock: engine.history
    };
  }

  const api = {
    SCENARIOS: SCENARIOS,
    constants: { K: K, A: A, R: R, MAX_TAKE: MAX_TAKE, FUEL: FUEL, QUOTA_OF_MSY: QUOTA_OF_MSY, QUOTA: QUOTA, MSY_STOCK: MSY_STOCK, ASSEMBLY_EVERY: ASSEMBLY_EVERY, EXILE_LEN: EXILE_LEN, NAMES_PER_VOTER: NAMES_PER_VOTER, QUORUM: QUORUM, N: N, SEASONS: SEASONS, SUPPLY: SUPPLY },
    create: create,
    runToEnd: runToEnd
  };
  root.TideSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
