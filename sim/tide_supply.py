"""$TIDE tokenomics v2: supply, burn and yield over one year.
Two changes vs v1 (both from Gordon 1954, where fishing has a COST per unit of effort):
  1. Fleet power is capped: the whole fleet at full effort can take at most 25% of the stock per season,
     split by stake. More stakers = thinner slices, never a bigger net.
  2. Fishing burns fuel: every unit of effort burns FUEL tokens per staked token. Catch is minted, fuel is burned.
Run: python3 sim/tide_supply.py
"""
K, A, R = 1_000_000.0, 120_000.0, 0.6
GENESIS = 100_000_000.0          # circulating supply at launch
MAX_TAKE = 0.25                  # fleet cap: share of stock per season at full effort
FUEL = 0.002                     # tokens burned per staked token per season at full effort
BUILD_BURN = 0.01                # 1% of stake burned when a boat is built (anti-churn, anti-sybil)
DAYS = 365

def g(s): return R * s * (1 - s / K) * (s - A) / K
MSY_S = max((K * i / 1000 for i in range(1001)), key=g)
QUOTA = 0.8 * g(MSY_S)

def run(stake_frac, mode):
    """mode: 'quota' everyone keeps the quota | 'greedy' open access, full effort | 'none' nobody fishes"""
    s, supply, minted, burned = 0.7 * K, GENESIS, 0.0, 0.0
    burned += BUILD_BURN * stake_frac * GENESIS; supply -= BUILD_BURN * stake_frac * GENESIS
    staked_yield, dead = 0.0, None
    for d in range(DAYS):
        T = stake_frac * supply
        full = MAX_TAKE * s                                  # what the whole fleet could take
        if mode == 'none': f = 0.0
        elif mode == 'quota': f = min(1.0, QUOTA / full) if full > 0 else 0.0
        else:  # greedy: fish at full effort while it pays, stop when catch per token < fuel (Gordon's open access)
            f = 1.0 if full / T > FUEL else 0.0
        catch, fuel = f * full, f * FUEL * T
        s = max(0.0, s - catch); s = max(0.0, s + g(s))
        supply += catch - fuel; minted += catch; burned += fuel
        staked_yield += (catch - fuel) / T if T else 0
        if s < 1 and dead is None: dead = d + 1
    return dict(net=(supply - GENESIS) / GENESIS * 100, apr=staked_yield * 100, stock=s,
                minted=minted, burned=burned, dead=dead)

if __name__ == '__main__':
    print(f"genesis {GENESIS:,.0f}  quota/season {QUOTA:,.0f}  ({QUOTA*365/GENESIS*100:.1f}%/yr gross if fully fished)")
    print(f"{'staked':>7} {'behaviour':>9} {'net supply 1y':>14} {'fisher APR':>11} {'minted':>12} {'burned':>12} {'stock end':>10} {'dead@':>6}")
    for frac in (0.2, 0.5, 0.7, 0.9):
        for mode in ('quota', 'greedy'):
            r = run(frac, mode)
            print(f"{frac:>7.0%} {mode:>9} {r['net']:>+13.1f}% {r['apr']:>+10.1f}% {r['minted']:>12,.0f} {r['burned']:>12,.0f} {r['stock']:>10,.0f} {str(r['dead']):>6}")
    # break-even: staked share where fuel burned = catch minted under quota
    for frac in [x / 100 for x in range(50, 101)]:
        if run(frac, 'quota')['net'] <= 0: print(f"\nquota-keeping fleet becomes net DEFLATIONARY at ~{frac:.0%} of supply staked"); break
