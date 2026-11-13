"""Small dependency-free model of the v2 reckoning.

The model keeps the economic units in whole TIDE/fish for readable output. It
is intentionally separate from the older governance simulation: this script
shows the wreck, reseed, capacity decay, and recovery tax in one trace.
"""

K = 1_000_000.0
A = 120_000.0
R = 0.6
BPS = 10_000.0
MAX_TAKE = 0.25
QUOTA_OF_MSY = 0.8
WRECK_BURN = 0.5
K_DECAY = 0.8
RESEED_COST = 1_000_000.0
HEALTHY = 0.7
RECOVERY_TAX = 0.5
BOAT_COUNT = 6
STARTING_SUPPLY = 60_000_000.0
INITIAL_WALLET = STARTING_SUPPLY / BOAT_COUNT
INITIAL_STAKE = 9_900_000.0


def growth(stock, capacity):
    return R * stock * (1 - stock / capacity) * (stock - A) / capacity


def msy(capacity):
    return max((capacity * i / 1000.0 for i in range(1001)),
               key=lambda stock: growth(stock, capacity))


def quota(capacity):
    return QUOTA_OF_MSY * growth(msy(capacity), capacity)


def next_stock(stock, caught, capacity):
    after = max(0.0, stock - caught)
    return max(0.0, after + growth(after, capacity))


def restake(wallets, supply):
    stakes = []
    for i, wallet in enumerate(wallets):
        amount = min(INITIAL_STAKE / 2, wallet)
        build_burn = amount * 0.01
        wallets[i] -= amount + build_burn
        supply -= build_burn
        stakes.append(amount)
    return stakes, supply


def run():
    wallets = [INITIAL_WALLET - INITIAL_STAKE - INITIAL_STAKE * 0.01
               for _ in range(BOAT_COUNT)]
    stakes = [INITIAL_STAKE for _ in range(BOAT_COUNT)]
    supply = STARTING_SUPPLY - BOAT_COUNT * INITIAL_STAKE * 0.01
    capacity = K
    stock = 0.7 * K
    rows = []
    cumulative = [0.0 for _ in wallets]
    last_grab = 0.0
    last_loss = 0.0
    recovery_left = 0

    for generation in range(3):
        start_wealth = [wallets[i] + stakes[i] for i in range(BOAT_COUNT)]
        last_grab = 0.0
        last_loss = sum(stakes) * WRECK_BURN
        for _season in range(1, 101):
            fleet = sum(stakes)
            full_per_token = MAX_TAKE * stock / fleet
            fair = quota(capacity) / BOAT_COUNT
            catches = []
            for i, stake in enumerate(stakes):
                if i == 0:
                    catch = full_per_token * stake
                    last_grab = catch
                else:
                    catch = min(full_per_token * stake, fair)
                catches.append(catch)
                minted = catch * (1 - RECOVERY_TAX) if recovery_left else catch
                # The recovery tax affects minting only; all fish still count
                # against the stock.
                wallets[i] += minted
            total = sum(catches)
            stock = next_stock(stock, total, capacity)
            recovery_left = max(0, recovery_left - 1)
            if stock < A:
                burned = sum(stakes) * WRECK_BURN
                supply -= burned
                last_loss = burned
                for i, stake in enumerate(stakes):
                    wallets[i] += stake * (1 - WRECK_BURN)
                stakes = [0.0 for _ in stakes]
                break

        gained = [wallets[i] - start_wealth[i] for i in range(BOAT_COUNT)]
        cumulative = [cumulative[i] + gained[i] for i in range(BOAT_COUNT)]
        rows.append((generation, stock, supply, capacity, cumulative[0],
                     sum(cumulative[1:]) / (BOAT_COUNT - 1), last_grab,
                     last_loss))

        # A funded community reseed pays for the next, permanently smaller sea.
        if generation < 2:
            contributor = min(RESEED_COST, wallets[1])
            wallets[1] -= contributor
            supply -= contributor
            capacity *= K_DECAY
            stock = HEALTHY * capacity
            stakes, supply = restake(wallets, supply)
            recovery_left = 30

    print("generation  stock     supply    capacity   raider gain  keeper gain  final grab  wreck loss")
    for row in rows:
        generation, stock, supply, capacity, raider, keeper, grab, loss = row
        print(f"{generation:>10} {stock:>8,.0f} {supply:>11,.0f} {capacity:>10,.0f} "
              f"{raider:>12,.0f} {keeper:>12,.0f} {grab:>11,.0f} {loss:>11,.0f}")

    print()
    print("Finding A: the raider's final grab is "
          f"{last_loss / max(last_grab, 1):,.0f}x smaller than its wreck loss.")
    print("Finding B: as stock approaches the line, expected wreck loss rises "
          "relative to the available grab, so the rational endgame flips from "
          "race to grab to pull back.")
    print("stock probe: " + ", ".join(
        f"{stock:,.0f} -> {last_loss / max(MAX_TAKE * stock / BOAT_COUNT, 1):,.1f}x loss/grab"
        for stock in (700_000.0, 300_000.0, A)))


if __name__ == "__main__":
    run()
