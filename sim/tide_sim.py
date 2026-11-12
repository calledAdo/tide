"""$TIDE governance simulation, tokenomics v2.

The sea: logistic growth with a strong Allee effect.
Boats: fleet power capped at MAX_TAKE of the stock per season, split by stake; fishing burns FUEL per staked token
       at full effort (Gordon 1954: effort has a cost). Catch is minted, fuel is burned.
Law:   fair share = QUOTA * stake / total stake (exiled stake still counts, so an exiled share stays in the sea).
Assembly (every ASSEMBLY_EVERY seasons): stage 1 needs > half of eligible boats; stage 2 each boat writes up to
       NAMES_PER_VOTER names; every name with >= QUORUM of eligible boats is exiled for EXILE_LEN seasons.
Agents: greedy (full effort while it pays), keepers (fair share), conditional cooperators (Fehr & Gaechter 2000:
       keep the quota while overfishing gets punished, defect when it goes unpunished), and an optional faction.

Run: python3 sim/tide_sim.py  -> table on stdout, sim/tide_runs.csv, sim/tide_stock.svg
The contract uses the same constants (see contract/src/params.rs).
"""
import csv

# ---- parameters (mirrored in the contract) ----
K, A, R = 1_000_000.0, 120_000.0, 0.6
MAX_TAKE = 0.25            # whole fleet at full effort takes at most 25% of the stock per season
FUEL = 0.002               # tokens burned per staked token per season at full effort
QUOTA_OF_MSY = 0.8
ASSEMBLY_EVERY, EXILE_LEN, NAMES_PER_VOTER, QUORUM = 3, 10, 3, 0.40
TOL = 0.10
N, SEASONS, SUPPLY = 20, 120, 100_000_000.0


def growth(s):
    return R * s * (1 - s / K) * (s - A) / K


def msy_stock():
    return max((K * i / 1000 for i in range(1001)), key=growth)


QUOTA = QUOTA_OF_MSY * growth(msy_stock())


def run(name, types, staked_frac, ostracism=False, two_stage=True, share_to_sea=True,
        coalition=(), quorum=QUORUM):
    stake = staked_frac * SUPPLY / N                    # equal boats
    T = stake * N
    s = 0.7 * K
    exiled, overage, defecting = {}, [0.0] * N, [False] * N
    net = [0.0] * N                                     # catch minted minus fuel burned, per boat
    stock, exiles, wrong, dead = [], 0, 0, None
    for t in range(SEASONS):
        active = [i for i in range(N) if exiled.get(i, -1) <= t]
        act_T = stake * len(active)
        share = QUOTA * stake / (T if share_to_sea else max(act_T, 1))
        full_per_token = MAX_TAKE * s / T               # catch per staked token at full effort
        catches, fuels = [0.0] * N, [0.0] * N
        for i in active:
            greedy = types[i] == 'greedy' or (types[i] == 'cc' and defecting[i])
            if full_per_token <= FUEL:
                f = 0.0                                         # nobody fishes at a loss
            elif greedy:
                f = 1.0                                         # flat out while it pays
            else:
                f = min(1.0, share / (full_per_token * stake))
            catches[i] = f * full_per_token * stake
            fuels[i] = f * FUEL * stake
        total = sum(catches)
        s = max(0.0, s - total)
        s = max(0.0, s + growth(s))
        if s < A and dead is None:
            dead = t + 1                                          # crossed the point of no return
        stock.append(s)
        for i in range(N):
            net[i] += catches[i] - fuels[i]
            overage[i] += max(0.0, catches[i] - share * 1.001)
        if not ostracism:
            frac_bad = sum(1 for i in active if catches[i] > share * 1.001) / max(1, len(active))
            for i in range(N):
                if types[i] == 'cc':
                    defecting[i] = frac_bad > TOL
        if ostracism and (t + 1) % ASSEMBLY_EVERY == 0:
            eligible = [i for i in range(N) if exiled.get(i, -1) <= t]
            honest = [i for i in eligible if i not in coalition and types[i] != 'greedy']
            offenders = sorted((i for i in eligible if overage[i] > 0), key=lambda i: -overage[i])
            yes = (len(honest) if offenders else 0) + sum(1 for i in coalition if i in eligible)
            if (yes > len(eligible) / 2) if two_stage else True:
                shards = {}
                for i in honest:
                    for o in offenders[:NAMES_PER_VOTER]:
                        shards[o] = shards.get(o, 0) + 1
                if coalition:
                    tg = [i for i in eligible if i not in coalition][:NAMES_PER_VOTER]
                    for i in coalition:
                        if i in eligible:
                            for o in tg:
                                shards[o] = shards.get(o, 0) + 1
                for tgt, n in shards.items():
                    if n >= quorum * len(eligible):
                        exiled[tgt] = t + 1 + EXILE_LEN
                        exiles += 1
                        wrong += overage[tgt] == 0
            punished = any(exiled.get(i, -1) > t for i in offenders)
            for i in range(N):
                if types[i] == 'cc':
                    defecting[i] = bool(offenders) and not punished
            overage = [0.0] * N
    years = SEASONS / 365
    apr = sum(net) / T / years * 100
    edge = None
    if coalition:
        c = sum(net[i] for i in coalition) / len(coalition)
        o = sum(net[i] for i in range(N) if i not in coalition) / (N - len(coalition))
        edge = c / o if o > 0 else float('inf')
    return dict(name=name, staked=staked_frac, final=round(stock[-1]), dead=dead, apr=apr,
                exiles=exiles, wrong=wrong, edge=edge, stock=stock)


def scenarios():
    mix = ['greedy'] * 5 + ['cc'] * 15
    keep = ['keep'] * 20
    coal = tuple(range(14, 20))
    out = []
    for frac in (0.10, 0.50):
        tag = f'{int(frac*100)}% staked'
        out += [
            run(f'{tag}: open access (5 greedy, 15 cond. coop.)', mix, frac),
            run(f'{tag}: TIDE, same crowd + ostracism', mix, frac, ostracism=True),
        ]
    out += [
        run('50% staked: benchmark, everyone keeps quota', keep, 0.50),
        run('50%: 30% faction, NAIVE rules (1-stage, redistribute)', keep, 0.50, ostracism=True,
            two_stage=False, share_to_sea=False, coalition=coal, quorum=0.25),
        run('50%: 30% faction, TIDE rules (2-stage, share to sea)', keep, 0.50, ostracism=True,
            coalition=coal, quorum=0.25),
        run('10% staked: all greedy + ostracism (no honest majority)', ['greedy'] * 20, 0.10, ostracism=True),
    ]
    return out


def svg(runs, path):
    W, H, P, PH = 860, 540, 50, 300
    cols = ['#d9534f', '#337ab7', '#e67e22', '#16a085', '#5cb85c', '#f0ad4e', '#9b59b6', '#555555']
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="sans-serif" font-size="11">',
         f'<rect width="{W}" height="{H}" fill="white"/>']
    xy = lambda t, v: (P + t * (W - 2 * P - 90) / (SEASONS - 1), 20 + PH - v / K * PH)
    for lvl, lab in ((msy_stock(), 'MSY stock'), (A, 'Allee threshold')):
        _, y = xy(0, lvl)
        o.append(f'<line x1="{P}" x2="{W-P-90}" y1="{y}" y2="{y}" stroke="#bbb" stroke-dasharray="4"/>'
                 f'<text x="{W-P-86}" y="{y+4}" fill="#888">{lab}</text>')
    for k, r in enumerate(runs):
        pts = ' '.join('%.1f,%.1f' % xy(t, v) for t, v in enumerate(r['stock']))
        o.append(f'<polyline fill="none" stroke="{cols[k % len(cols)]}" stroke-width="2" points="{pts}"/>')
        o.append(f'<text x="{P}" y="{PH+80+k*15}" fill="{cols[k % len(cols)]}">&#9632; {r["name"]}</text>')
    o.append(f'<text x="{W/2-80}" y="{PH+45}">season (day), {SEASONS} seasons</text>'
             f'<text x="6" y="14">fish stock (unminted supply)</text></svg>')
    open(path, 'w').write('\n'.join(o))


if __name__ == '__main__':
    runs = scenarios()
    print(f'MSY stock {msy_stock():,.0f}  MSY/season {growth(msy_stock()):,.0f}  quota {QUOTA:,.0f}')
    print(f"{'scenario':58} {'final stock':>11} {'below Allee@':>12} {'fisher APR':>10} {'exiles':>6} {'wrong':>5} {'faction edge':>12}")
    for r in runs:
        e = '' if r['edge'] is None else f"{r['edge']:.2f}x"
        print(f"{r['name']:58} {r['final']:>11,} {str(r['dead']):>12} {r['apr']:>+9.1f}% {r['exiles']:>6} {r['wrong']:>5} {e:>12}")
    with open('sim/tide_runs.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['season'] + [r['name'] for r in runs])
        for t in range(SEASONS):
            w.writerow([t] + [round(r['stock'][t]) for r in runs])
    svg(runs, 'sim/tide_stock.svg')
