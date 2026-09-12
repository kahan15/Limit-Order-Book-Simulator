# Limit Order Book Simulator

An interactive limit order book that implements exchange matching semantics in the
browser, and can run against either synthetic order flow or live market data.

## Matching engine
- Price-time priority: bids descending, asks ascending, FIFO queue at each price level
- Limit orders cross and consume opposite levels best-first; any remainder rests
- Market orders sweep until filled or the book empties; leftover quantity is cancelled
- Partial fills, order cancellation, and automatic empty-level cleanup
- Trades execute at the resting order's price the book is never left crossed

## Simulation mode
Configurable synthetic order flow with adjustable rate and aggression, generating
limit orders clustered around the touch, market orders, and random cancellations,
so the book churns realistically.

## Live mode
Streams level-2 depth and trades from Kraken's public WebSocket (BTC/USD, ETH/USD,
SOL/USD) no API key required. Handles snapshot and incremental updates, level
deletions, connection state, and bounded auto-reconnect.

## Interface
Depth ladder with cumulative size bars, trade tape, trade price chart, and a live
metrics strip showing spread, mid, book imbalance, volume, and VWAP.

## Paper trading
Orders in live mode are simulated locally against streamed liquidity nothing is
ever sent to an exchange. Tracks net position, average entry, and realized and
unrealized PnL.
