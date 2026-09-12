import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  CircleAlert,
  CircleHelp,
  Clock3,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';

type Side = 'buy' | 'sell';
type OrderKind = 'limit' | 'market';

type Order = {
  id: string;
  side: Side;
  type: 'limit';
  price: number;
  quantity: number;
  sequence: number;
  createdAt: number;
  source?: 'live' | 'paper';
};

type Trade = {
  id: string;
  price: number;
  quantity: number;
  aggressor: Side;
  timestamp: number;
  source?: 'live' | 'you';
};

type BookState = {
  bids: Order[];
  asks: Order[];
  trades: Trade[];
  nextOrderId: number;
  nextTradeId: number;
  nextSequence: number;
};

type MatchResult = {
  book: BookState;
  filledQuantity: number;
  fillCount: number;
  restingId?: string;
  cancelledQuantity: number;
  message: string;
};

type AppMode = 'sim' | 'live';
type LiveStatus = 'disconnected' | 'connecting' | 'live' | 'error';
type PositionState = {
  quantity: number;
  averageEntryPrice: number;
  realizedPnl: number;
};

const now = () => Date.now();
const money = (value: number) => value.toFixed(2);
const quantityText = (value: number) => value.toFixed(value % 1 ? 2 : 0);

function blankBook(): BookState {
  return { bids: [], asks: [], trades: [], nextOrderId: 1001, nextTradeId: 1, nextSequence: 1 };
}

function nextOrder(book: BookState, side: Side, price: number, quantity: number): Order {
  return {
    id: `O-${book.nextOrderId}`,
    side,
    type: 'limit',
    price,
    quantity,
    sequence: book.nextSequence,
    createdAt: now(),
  };
}

function sortBook(side: Side, orders: Order[]) {
  return [...orders].sort((a, b) =>
    side === 'buy' ? b.price - a.price || a.sequence - b.sequence : a.price - b.price || a.sequence - b.sequence,
  );
}

function executeOrder(book: BookState, incoming: Order, isMarket: boolean): MatchResult {
  const next: BookState = {
    ...book,
    bids: [...book.bids],
    asks: [...book.asks],
    trades: [...book.trades],
    nextOrderId: book.nextOrderId + 1,
    nextSequence: book.nextSequence + 1,
  };
  const opposingSide = incoming.side === 'buy' ? 'asks' : 'bids';
  const ownSide = incoming.side === 'buy' ? 'bids' : 'asks';
  const opposing = sortBook(incoming.side === 'buy' ? 'sell' : 'buy', next[opposingSide]);
  let remaining = incoming.quantity;
  let filledQuantity = 0;
  let fillCount = 0;
  let tradeId = next.nextTradeId;

  while (remaining > 0 && opposing.length > 0) {
    const resting = opposing[0];
    const canMatch = isMarket || (incoming.side === 'buy' ? incoming.price >= resting.price : incoming.price <= resting.price);
    if (!canMatch) break;

    const fill = Math.min(remaining, resting.quantity);
    remaining -= fill;
    filledQuantity += fill;
    fillCount += 1;
    next.trades.unshift({
      id: `T-${String(tradeId).padStart(4, '0')}`,
      price: resting.price,
      quantity: fill,
      aggressor: incoming.side,
      timestamp: now(),
    });
    tradeId += 1;
    if (fill === resting.quantity) opposing.shift();
    else opposing[0] = { ...resting, quantity: resting.quantity - fill };
  }

  next.nextTradeId = tradeId;
  next[opposingSide] = sortBook(incoming.side === 'buy' ? 'sell' : 'buy', opposing);
  let restingId: string | undefined;
  if (remaining > 0 && !isMarket) {
    const restingOrder = { ...incoming, quantity: remaining };
    restingId = restingOrder.id;
    next[ownSide] = sortBook(incoming.side, [...next[ownSide], restingOrder]);
  } else {
    next[ownSide] = sortBook(incoming.side, next[ownSide]);
  }

  const cancelledQuantity = isMarket ? remaining : 0;
  const action = incoming.side === 'buy' ? 'BUY' : 'SELL';
  const summary = isMarket ? `${action} ${quantityText(incoming.quantity)} @ MKT` : `${action} ${quantityText(incoming.quantity)} @ ${money(incoming.price)}`;
  const message = fillCount
    ? `${summary} · ${fillCount} fill${fillCount === 1 ? '' : 's'}`
    : isMarket
      ? `${summary} · no liquidity`
      : `${summary} · resting at ${incoming.id}`;

  return { book: next, filledQuantity, fillCount, restingId, cancelledQuantity, message };
}

export function addLimitOrder(book: BookState, side: Side, price: number, quantity: number): MatchResult {
  const incoming = nextOrder(book, side, price, quantity);
  return executeOrder(book, incoming, false);
}

export function addMarketOrder(book: BookState, side: Side, quantity: number): MatchResult {
  const incoming = nextOrder(book, side, 0, quantity);
  return executeOrder(book, incoming, true);
}

export function cancelOrder(book: BookState, orderId: string): { book: BookState; cancelled: Order | undefined } {
  const cancelled = [...book.bids, ...book.asks].find((order) => order.id.toUpperCase() === orderId.trim().toUpperCase());
  if (!cancelled) return { book, cancelled: undefined };
  return {
    cancelled,
    book: {
      ...book,
      bids: book.bids.filter((order) => order.id !== cancelled.id),
      asks: book.asks.filter((order) => order.id !== cancelled.id),
    },
  };
}

function seedBook(): BookState {
  let seeded = blankBook();
  const randomSize = () => Math.floor(Math.random() * 491) + 10;
  const seed: Array<[Side, number, number]> = [];
  for (let level = 1; level <= 20; level += 1) {
    seed.push(['sell', Number((100 + level * 0.01).toFixed(2)), randomSize()]);
    seed.push(['buy', Number((100 - level * 0.01).toFixed(2)), randomSize()]);
  }
  seed.forEach(([side, price, quantity]) => {
    const result = addLimitOrder(seeded, side, price, quantity);
    seeded = result.book;
    seeded = { ...seeded, trades: [] };
  });
  return seeded;
}

function getBookTop(book: BookState) {
  const bestBid = book.bids.length ? Math.max(...book.bids.map((order) => order.price)) : undefined;
  const bestAsk = book.asks.length ? Math.min(...book.asks.map((order) => order.price)) : undefined;
  return {
    bestBid,
    bestAsk,
    spread: bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : undefined,
    midpoint: bestBid !== undefined && bestAsk !== undefined ? (bestAsk + bestBid) / 2 : undefined,
  };
}

function randomQuantity(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensureLiquidity(book: BookState): BookState {
  let next = book;
  let { bestBid, bestAsk } = getBookTop(next);
  if (!next.bids.length) {
    const anchor = bestAsk ?? 100;
    for (let level = 1; level <= 8; level += 1) {
      const result = addLimitOrder(next, 'buy', Number((anchor - level * 0.01).toFixed(2)), randomQuantity(10, 300));
      next = result.book;
    }
    bestBid = getBookTop(next).bestBid;
  }
  if (!next.asks.length) {
    const anchor = bestBid ?? 100;
    for (let level = 1; level <= 8; level += 1) {
      const result = addLimitOrder(next, 'sell', Number((anchor + level * 0.01).toFixed(2)), randomQuantity(10, 300));
      next = result.book;
    }
  }
  return next;
}

function randomLimitPrice(book: BookState, side: Side) {
  const { bestBid, bestAsk } = getBookTop(book);
  const reference = side === 'buy'
    ? bestBid ?? (bestAsk !== undefined ? bestAsk - 0.01 : 100)
    : bestAsk ?? (bestBid !== undefined ? bestBid + 0.01 : 100);
  const nearTouch = Math.random() < 0.86;
  const offset = nearTouch
    ? Math.floor(Math.random() * 9) - 4
    : (Math.floor(Math.random() * 15) + 6) * (Math.random() < 0.5 ? -1 : 1);
  return Number(Math.max(0.01, reference + offset * 0.01).toFixed(2));
}

function liveOrderId(symbol: string, side: Side, price: number) {
  return `L-${symbol.replace('/', '')}-${side}-${price.toFixed(8)}`;
}

function createLiveOrder(symbol: string, side: Side, price: number, quantity: number, sequence: number): Order {
  return {
    id: liveOrderId(symbol, side, price),
    side,
    type: 'limit',
    price,
    quantity,
    sequence,
    createdAt: now(),
    source: 'live',
  };
}

function liveOrdersFromLevels(
  symbol: string,
  side: Side,
  levels: Array<{ price?: string | number; qty?: string | number }>,
  startingSequence: number,
) {
  return levels
    .map((level, index) => {
      const price = Number(level.price);
      const quantity = Number(level.qty);
      return Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0
        ? createLiveOrder(symbol, side, price, quantity, startingSequence + index)
        : undefined;
    })
    .filter((order): order is Order => Boolean(order));
}

function applyLiveBookMessage(
  book: BookState,
  symbol: string,
  type: 'snapshot' | 'update',
  data: Array<{
    bids?: Array<{ price?: string | number; qty?: string | number }>;
    asks?: Array<{ price?: string | number; qty?: string | number }>;
  }>,
) {
  const payload = data[0];
  if (!payload) return book;
  const paperBids = book.bids.filter((order) => order.source !== 'live');
  const paperAsks = book.asks.filter((order) => order.source !== 'live');
  const liveBids = book.bids.filter((order) => order.source === 'live');
  const liveAsks = book.asks.filter((order) => order.source === 'live');

  if (type === 'snapshot') {
    return {
      ...book,
      bids: sortBook('buy', [...paperBids, ...liveOrdersFromLevels(symbol, 'buy', payload.bids ?? [], book.nextSequence).slice(0, 10)]),
      asks: sortBook('sell', [...paperAsks, ...liveOrdersFromLevels(symbol, 'sell', payload.asks ?? [], book.nextSequence + 10).slice(0, 10)]),
      nextSequence: book.nextSequence + 20,
    };
  }

  const applyUpdates = (
    existing: Order[],
    levels: Array<{ price?: string | number; qty?: string | number }>,
    side: Side,
  ) => {
    const byPrice = new Map(existing.map((order) => [order.price.toFixed(8), order]));
    levels.forEach((level, index) => {
      const price = Number(level.price);
      const quantity = Number(level.qty);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity)) return;
      const key = price.toFixed(8);
      if (quantity <= 0) {
        byPrice.delete(key);
      } else {
        byPrice.set(key, createLiveOrder(symbol, side, price, quantity, book.nextSequence + index));
      }
    });
    return [...byPrice.values()];
  };

  const nextBids = applyUpdates(liveBids, payload.bids ?? [], 'buy').sort((a, b) => b.price - a.price).slice(0, 10);
  const nextAsks = applyUpdates(liveAsks, payload.asks ?? [], 'sell').sort((a, b) => a.price - b.price).slice(0, 10);
  return {
    ...book,
    bids: sortBook('buy', [...paperBids, ...nextBids]),
    asks: sortBook('sell', [...paperAsks, ...nextAsks]),
    nextSequence: book.nextSequence + 20,
  };
}

function appendLiveTrades(
  book: BookState,
  data: Array<{ price?: string | number; qty?: string | number; side?: string; timestamp?: string }>,
) {
  let next = { ...book, trades: [...book.trades] };
  data.forEach((trade) => {
    const price = Number(trade.price);
    const quantity = Number(trade.qty);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) return;
    const aggressor: Side = trade.side === 'sell' ? 'sell' : 'buy';
    const timestamp = trade.timestamp ? Date.parse(trade.timestamp) : now();
    next.trades.unshift({
      id: `T-${String(next.nextTradeId).padStart(4, '0')}`,
      price,
      quantity,
      aggressor,
      timestamp: Number.isFinite(timestamp) ? timestamp : now(),
      source: 'live',
    });
    next.nextTradeId += 1;
  });
  return next;
}

type PaperMatchResult = MatchResult & { fills: Trade[] };

function markPaperMatch(result: MatchResult): PaperMatchResult {
  const fills = result.book.trades.slice(0, result.fillCount).map((trade) => ({ ...trade, source: 'you' as const }));
  const paperTrades = result.book.trades.map((trade, index) => (index < result.fillCount ? { ...trade, source: 'you' as const } : trade));
  const markResting = (order: Order) => order.id === result.restingId ? { ...order, source: 'paper' as const } : order;
  return {
    ...result,
    fills,
    book: {
      ...result.book,
      trades: paperTrades,
      bids: result.book.bids.map(markResting),
      asks: result.book.asks.map(markResting),
    },
  };
}

function sweepLiveBook(book: BookState, side: Side, quantity: number): PaperMatchResult {
  const next: BookState = {
    ...book,
    bids: [...book.bids],
    asks: [...book.asks],
    trades: [...book.trades],
    nextTradeId: book.nextTradeId,
  };
  const opposingSide = side === 'buy' ? 'asks' : 'bids';
  const opposing = sortBook(side === 'buy' ? 'sell' : 'buy', next[opposingSide].filter((order) => order.source === 'live'));
  const consumed = new Map<string, number>();
  const fills: Trade[] = [];
  let remaining = quantity;
  let filledQuantity = 0;

  for (const resting of opposing) {
    if (remaining <= 0) break;
    const fill = Math.min(remaining, resting.quantity);
    remaining -= fill;
    filledQuantity += fill;
    consumed.set(resting.id, resting.quantity - fill);
    const trade: Trade = {
      id: `T-${String(next.nextTradeId).padStart(4, '0')}`,
      price: resting.price,
      quantity: fill,
      aggressor: side,
      timestamp: now(),
      source: 'you',
    };
    next.nextTradeId += 1;
    next.trades.unshift(trade);
    fills.push(trade);
  }

  next[opposingSide] = sortBook(side === 'buy' ? 'sell' : 'buy', next[opposingSide].flatMap((order) => {
    if (!consumed.has(order.id)) return [order];
    const remainingAtLevel = consumed.get(order.id) ?? 0;
    return remainingAtLevel > 0 ? [{ ...order, quantity: remainingAtLevel }] : [];
  }));

  return {
    book: next,
    filledQuantity,
    fillCount: fills.length,
    cancelledQuantity: remaining,
    message: `${side === 'buy' ? 'BUY' : 'SELL'} ${quantityText(quantity)} @ MKT · ${fills.length ? `${fills.length} fill${fills.length === 1 ? '' : 's'}` : 'no liquidity'}`,
    fills,
  };
}

function applyPositionFills(position: PositionState, fills: Trade[]): PositionState {
  const next = { ...position };
  fills.forEach((fill) => {
    const quantity = fill.quantity;
    const price = fill.price;
    if (fill.aggressor === 'buy') {
      if (next.quantity >= 0) {
        next.averageEntryPrice = next.quantity + quantity > 0
          ? ((next.averageEntryPrice * next.quantity) + price * quantity) / (next.quantity + quantity)
          : 0;
        next.quantity += quantity;
      } else {
        const closing = Math.min(-next.quantity, quantity);
        next.realizedPnl += (next.averageEntryPrice - price) * closing;
        const remaining = quantity - closing;
        next.quantity += closing;
        if (remaining > 0) {
          next.quantity = remaining;
          next.averageEntryPrice = price;
        } else if (next.quantity === 0) {
          next.averageEntryPrice = 0;
        }
      }
    } else if (next.quantity <= 0) {
      const shortSize = Math.abs(next.quantity);
      next.averageEntryPrice = shortSize + quantity > 0
        ? ((next.averageEntryPrice * shortSize) + price * quantity) / (shortSize + quantity)
        : 0;
      next.quantity -= quantity;
    } else {
      const closing = Math.min(next.quantity, quantity);
      next.realizedPnl += (price - next.averageEntryPrice) * closing;
      const remaining = quantity - closing;
      next.quantity -= closing;
      if (remaining > 0) {
        next.quantity = -remaining;
        next.averageEntryPrice = price;
      } else if (next.quantity === 0) {
        next.averageEntryPrice = 0;
      }
    }
  });
  return next;
}

function PriceChart({ prices }: { prices: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(dpr, dpr);
    const width = bounds.width;
    const height = bounds.height;
    const padding = { top: 12, right: 14, bottom: 17, left: 14 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    context.clearRect(0, 0, width, height);

    context.strokeStyle = 'hsl(220 19% 18% / .65)';
    context.lineWidth = 1;
    for (let row = 1; row <= 2; row += 1) {
      const y = padding.top + (plotHeight * row) / 3;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
    }

    if (prices.length < 2) {
      context.fillStyle = 'hsl(216 13% 57%)';
      context.font = '10px "DM Mono", monospace';
      context.fillText('Trade prices will plot here', padding.left, height / 2);
      return;
    }

    const minimum = Math.min(...prices);
    const maximum = Math.max(...prices);
    const range = Math.max(maximum - minimum, 0.01);
    const xFor = (index: number) => padding.left + (index / (prices.length - 1)) * plotWidth;
    const yFor = (price: number) => padding.top + ((maximum - price) / range) * plotHeight;

    context.beginPath();
    prices.forEach((price, index) => {
      const x = xFor(index);
      const y = yFor(price);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = 'hsl(183 86% 54%)';
    context.lineWidth = 1.6;
    context.shadowColor = 'hsl(183 86% 54% / .35)';
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;

    const lastX = xFor(prices.length - 1);
    const lastY = yFor(prices[prices.length - 1]);
    context.fillStyle = 'hsl(183 86% 54%)';
    context.beginPath();
    context.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    context.fill();
    context.font = '9px "DM Mono", monospace';
    context.fillStyle = 'hsl(210 24% 91%)';
    context.fillText(money(maximum), width - padding.right - 42, padding.top - 2);
    context.fillStyle = 'hsl(216 13% 57%)';
    context.fillText(money(minimum), width - padding.right - 42, height - 3);
  }, [prices]);

  return (
    <div className="price-chart" aria-label="Last 200 trade prices">
      <div className="chart-label"><span>trade price / last 200</span><span className="mono">{prices.length ? money(prices[prices.length - 1]) : '—'}</span></div>
      <canvas ref={canvasRef} role="img" aria-label="Trade price line chart" />
    </div>
  );
}

function MetricsStrip({ book }: { book: BookState }) {
  const { bestBid, bestAsk, spread, midpoint } = getBookTop(book);
  const bidSize = book.bids.reduce((total, order) => total + order.quantity, 0);
  const askSize = book.asks.reduce((total, order) => total + order.quantity, 0);
  const totalSize = bidSize + askSize;
  const imbalance = totalSize ? (bidSize / totalSize) * 100 : 50;
  const volume = book.trades.reduce((total, trade) => total + trade.quantity, 0);
  const vwap = volume ? book.trades.reduce((total, trade) => total + trade.price * trade.quantity, 0) / volume : undefined;
  const lastTrade = book.trades[0];
  const previousTrade = book.trades[1];
  const lastDelta = lastTrade && previousTrade ? lastTrade.price - previousTrade.price : 0;

  return (
    <section className="metrics-strip panel" aria-label="Live market metrics">
      <div className="metric"><span className="metric-label">best bid</span><strong className="metric-value bid-text">{bestBid !== undefined ? money(bestBid) : '—'}</strong></div>
      <div className="metric"><span className="metric-label">best ask</span><strong className="metric-value ask-text">{bestAsk !== undefined ? money(bestAsk) : '—'}</strong></div>
      <div className="metric"><span className="metric-label">spread / ticks</span><strong className="metric-value">{spread !== undefined ? `${money(spread)} · ${Math.round(spread / 0.01)}t` : '—'}</strong></div>
      <div className="metric"><span className="metric-label">mid price</span><strong className="metric-value">{midpoint !== undefined ? money(midpoint) : '—'}</strong></div>
      <div className="metric imbalance-metric">
        <div className="metric-label-row"><span className="metric-label">book imbalance</span><strong className="metric-value">{imbalance.toFixed(0)}% bid</strong></div>
        <div className="imbalance-bar" aria-label={`${imbalance.toFixed(0)} percent bid imbalance`}><span style={{ width: `${imbalance}%` }} /></div>
      </div>
      <div className="metric"><span className="metric-label">trades</span><strong className="metric-value">{book.trades.length}</strong></div>
      <div className="metric"><span className="metric-label">volume</span><strong className="metric-value">{quantityText(volume)}</strong></div>
      <div className="metric"><span className="metric-label">vwap</span><strong className="metric-value">{vwap !== undefined ? money(vwap) : '—'}</strong></div>
      <div className="metric"><span className="metric-label">last trade</span><strong className={`metric-value ${lastDelta > 0 ? 'bid-text' : lastDelta < 0 ? 'ask-text' : ''}`}>{lastTrade ? money(lastTrade.price) : '—'}</strong></div>
    </section>
  );
}

function pnlText(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${money(value)}`;
}

function PositionPanel({
  position,
  midpoint,
  onFlatten,
}: {
  position: PositionState;
  midpoint?: number;
  onFlatten: () => void;
}) {
  const unrealizedPnl = position.quantity && midpoint !== undefined
    ? (midpoint - position.averageEntryPrice) * position.quantity
    : position.quantity ? undefined : 0;
  return (
    <section className="position-panel" aria-label="Paper position">
      <div className="position-heading"><span>paper position</span><span className="live-label"><span className="pulse-dot" />live book</span></div>
      <div className="position-grid">
        <div><span>net position</span><strong className={position.quantity > 0 ? 'bid-text' : position.quantity < 0 ? 'ask-text' : ''}>{quantityText(position.quantity)}</strong></div>
        <div><span>avg entry</span><strong>{position.quantity ? money(position.averageEntryPrice) : '—'}</strong></div>
        <div><span>realized pnl</span><strong className={position.realizedPnl >= 0 ? 'bid-text' : 'ask-text'}>{pnlText(position.realizedPnl)}</strong></div>
        <div><span>unrealized pnl</span><strong className={unrealizedPnl === undefined || unrealizedPnl >= 0 ? 'bid-text' : 'ask-text'}>{pnlText(unrealizedPnl)}</strong></div>
      </div>
      <button data-testid="button-flatten-position" className="flatten-button" onClick={onFlatten} disabled={!position.quantity}>Flatten position</button>
    </section>
  );
}

function FlowControls({
  mode,
  liveStatus,
  liveStatusText,
  symbol,
  running,
  speed,
  aggression,
  onModeChange,
  onSymbolChange,
  onRunningChange,
  onSpeedChange,
  onAggressionChange,
  onBigMarket,
}: {
  mode: AppMode;
  liveStatus: LiveStatus;
  liveStatusText: string;
  symbol: string;
  running: boolean;
  speed: number;
  aggression: number;
  onModeChange: (mode: AppMode) => void;
  onSymbolChange: (symbol: string) => void;
  onRunningChange: (running: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onAggressionChange: (aggression: number) => void;
  onBigMarket: () => void;
}) {
  return (
    <section className={`flow-controls panel ${mode === 'live' ? 'live-controls' : ''}`} aria-label="Market mode and order flow controls">
      <div className="mode-control">
        <div className="mode-toggle" role="group" aria-label="Market data mode">
          <button data-testid="button-mode-sim" className={`mode-button ${mode === 'sim' ? 'active' : ''}`} onClick={() => onModeChange('sim')}>Sim</button>
          <button data-testid="button-mode-live" className={`mode-button ${mode === 'live' ? 'active live' : ''}`} onClick={() => onModeChange('live')}>Live</button>
        </div>
        <div className={`connection-status ${liveStatus}`}><span className="connection-dot" />{liveStatusText}</div>
        {mode === 'live' && <select data-testid="select-live-symbol" className="symbol-select" value={symbol} onChange={(event) => onSymbolChange(event.target.value)} aria-label="Live market symbol">
          {['BTC/USD', 'ETH/USD', 'SOL/USD'].map((option) => <option key={option} value={option}>{option}</option>)}
        </select>}
      </div>
      {mode === 'sim' ? <>
        <div className="flow-title"><Activity size={14} /><span>random order flow</span><span className={`flow-status ${running ? 'active' : ''}`}><span className="pulse-dot" />{running ? 'running' : 'paused'}</span></div>
        <button data-testid="button-flow-toggle" className={`flow-toggle ${running ? 'pause' : ''}`} onClick={() => onRunningChange(!running)}>
          {running ? <Pause size={12} /> : <Play size={12} />} {running ? 'Pause' : 'Start'}
        </button>
        <label className="range-control"><span>speed <strong>{speed} / sec</strong></span><input data-testid="input-flow-speed" type="range" min="1" max="20" step="1" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))} /></label>
        <label className="range-control"><span>aggression <strong>{aggression}%</strong></span><input data-testid="input-flow-aggression" type="range" min="0" max="100" step="1" value={aggression} onChange={(event) => onAggressionChange(Number(event.target.value))} /></label>
      </> : <div className="live-context"><Activity size={14} /><span>paper trading against live book</span></div>}
      <button data-testid="button-big-market-order" className="big-market-button" onClick={onBigMarket}><Zap size={12} /> Buy 2,000 MKT</button>
    </section>
  );
}

function OrderEntry({
  mode,
  position,
  midpoint,
  side,
  kind,
  price,
  quantity,
  onSideChange,
  onKindChange,
  onPriceChange,
  onQuantityChange,
  onSubmit,
  onSeed,
  onClear,
  onCancel,
  onFlatten,
  cancelId,
  setCancelId,
}: {
  mode: AppMode;
  position: PositionState;
  midpoint?: number;
  side: Side;
  kind: OrderKind;
  price: string;
  quantity: string;
  onSideChange: (side: Side) => void;
  onKindChange: (kind: OrderKind) => void;
  onPriceChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onSubmit: () => void;
  onSeed: () => void;
  onClear: () => void;
  onCancel: () => void;
  onFlatten: () => void;
  cancelId: string;
  setCancelId: (value: string) => void;
}) {
  return (
    <section className="panel order-panel" aria-label="Order entry">
      <div className="panel-heading">
        <div className="panel-title"><SlidersHorizontal size={14} /> order entry</div>
        <span className="panel-note mono">{mode === 'live' ? 'LIVE / PAPER' : 'LOCAL SIM'}</span>
      </div>
      <div className="panel-block">
        <div className="segmented">
          <button data-testid="button-buy-side" className={`segment ${side === 'buy' ? 'active-buy' : ''}`} onClick={() => onSideChange('buy')}>Buy</button>
          <button data-testid="button-sell-side" className={`segment ${side === 'sell' ? 'active-sell' : ''}`} onClick={() => onSideChange('sell')}>Sell</button>
        </div>
        <div className="order-type">
          <button data-testid="button-limit-type" className={`type-tab ${kind === 'limit' ? 'active' : ''}`} onClick={() => onKindChange('limit')}>Limit</button>
          <button data-testid="button-market-type" className={`type-tab ${kind === 'market' ? 'active' : ''}`} onClick={() => onKindChange('market')}>Market</button>
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="order-price"><span>Price</span>{kind === 'market' && <span className="field-hint">market order</span>}</label>
          <input data-testid="input-order-price" id="order-price" className="terminal-input" type="number" min="0.01" step="0.01" value={kind === 'market' ? '' : price} onChange={(event) => onPriceChange(event.target.value)} disabled={kind === 'market'} placeholder="100.00" />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="order-quantity"><span>Quantity</span><span className="field-hint">whole units</span></label>
          <input data-testid="input-order-quantity" id="order-quantity" className="terminal-input" type="number" min="1" step="1" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} placeholder="10" />
          <div className="quick-sizes">
            {[5, 10, 25, 50].map((size) => <button data-testid={`button-quick-size-${size}`} className="quick-size" key={size} onClick={() => onQuantityChange(String(size))}>{size}</button>)}
          </div>
        </div>
        <button data-testid="button-submit-order" className={`submit-button ${side}`} onClick={onSubmit}>
          {side === 'buy' ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}
          Submit {side} {kind}{mode === 'live' ? ' paper' : ''}
        </button>
        <p className="micro-copy"><CircleHelp size={12} /> {mode === 'live' ? 'Paper orders stay local and never reach the exchange.' : 'Orders execute immediately when they cross. Resting orders follow FIFO time priority.'}</p>
      </div>
      {mode === 'sim' ? <div className="panel-block">
        <div className="field-label"><span>Book controls</span><span className="live-label"><span className="pulse-dot" /> live</span></div>
        <div className="control-row">
          <button data-testid="button-seed-book" className="control-button" onClick={onSeed}><Play size={12} /> Seed book</button>
          <button data-testid="button-clear-book" className="control-button danger" onClick={onClear}><Trash2 size={12} /> Clear</button>
        </div>
      </div> : <PositionPanel position={position} midpoint={midpoint} onFlatten={onFlatten} />}
      <div className="panel-block">
        <div className="field-label"><span>Cancel by order ID</span><span className="field-hint">resting only</span></div>
        <div className="cancel-wrap">
          <input data-testid="input-cancel-id" className="terminal-input" value={cancelId} onChange={(event) => setCancelId(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onCancel()} placeholder="O-1001" />
          <button data-testid="button-cancel-order" className="control-button danger" onClick={onCancel}><X size={12} /> Cancel</button>
        </div>
      </div>
    </section>
  );
}

function DepthRow({ order, cumulative, maxCumulative }: { order: Order; cumulative: number; maxCumulative: number }) {
  const depth = Math.max(4, (cumulative / maxCumulative) * 100);
  return (
    <div className={`book-row ${order.side}`} data-testid={`row-book-${order.id}`}>
      <span className={`depth-fill ${order.side === 'buy' ? 'bid-fill' : 'ask-fill'}`} style={{ width: `${depth}%` }} />
      <span className="price">{money(order.price)}</span>
      <span className="size">{quantityText(order.quantity)}</span>
      <span className="total">{quantityText(cumulative)}</span>
    </div>
  );
}

function BookLadder({ book, tradePrices }: { book: BookState; tradePrices: number[] }) {
  const asks = useMemo(() => [...book.asks].sort((a, b) => b.price - a.price).slice(0, 10), [book.asks]);
  const bids = useMemo(() => [...book.bids].sort((a, b) => b.price - a.price).slice(0, 10), [book.bids]);
  const askTotal = asks.reduce((sum, order) => sum + order.quantity, 0);
  const bidTotal = bids.reduce((sum, order) => sum + order.quantity, 0);
  const maxCumulative = Math.max(askTotal, bidTotal, 1);
  const bestAsk = book.asks.length ? Math.min(...book.asks.map((order) => order.price)) : undefined;
  const bestBid = book.bids.length ? Math.max(...book.bids.map((order) => order.price)) : undefined;
  const midpoint = bestAsk !== undefined && bestBid !== undefined ? (bestAsk + bestBid) / 2 : undefined;
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : undefined;

  return (
    <section className="panel book-panel" aria-label="Limit order book">
      <div className="panel-heading">
        <div className="panel-title"><BookOpen size={14} /> price ladder</div>
        <div className="book-toolbar"><span>10 × 10</span><span className="mono">USD</span></div>
      </div>
      <PriceChart prices={tradePrices} />
      <div className="book-head"><span>Price</span><span>Size</span><span>Cum. depth</span></div>
      <div className="book-side" aria-label="Ask orders">
        {asks.length ? (() => {
          let cumulative = 0;
          return asks.map((order) => {
            cumulative += order.quantity;
            return <DepthRow key={order.id} order={order} cumulative={cumulative} maxCumulative={maxCumulative} />;
          });
        })() : <div className="book-row empty">No resting asks</div>}
      </div>
      <div className="spread">
        <span className="spread-line" />
        <div className="spread-center">
          <div className="spread-price mono">{spread !== undefined ? `${money(spread)} spread` : '—'}</div>
          <div className="spread-detail">
            <strong>{bestBid !== undefined ? money(bestBid) : '—'}</strong>
            <span>{midpoint !== undefined ? `mid ${money(midpoint)}` : 'mid —'}</span>
            <strong>{bestAsk !== undefined ? money(bestAsk) : '—'}</strong>
          </div>
        </div>
        <span className="spread-line" />
      </div>
      <div className="book-side" aria-label="Bid orders">
        {bids.length ? (() => {
          let cumulative = 0;
          return bids.map((order) => {
            cumulative += order.quantity;
            return <DepthRow key={order.id} order={order} cumulative={cumulative} maxCumulative={maxCumulative} />;
          });
        })() : <div className="book-row empty">No resting bids</div>}
      </div>
      <div className="bottom-stats">
        <div className="stat"><div className="stat-label">bid depth</div><div className="stat-value">{quantityText(bidTotal)}</div></div>
        <div className="stat"><div className="stat-label">levels</div><div className="stat-value">{book.bids.length + book.asks.length}</div></div>
        <div className="stat"><div className="stat-label">ask depth</div><div className="stat-value">{quantityText(askTotal)}</div></div>
      </div>
    </section>
  );
}

function TradeTape({ trades }: { trades: Trade[] }) {
  return (
    <section className="panel tape-panel" aria-label="Recent trades">
      <div className="panel-heading">
        <div className="panel-title"><Activity size={14} /> trade tape</div>
        <span className="panel-note mono">NEWEST FIRST</span>
      </div>
      {trades.length ? <div className="tape-list">
        {trades.slice(0, 24).map((trade) => (
          <div className={`tape-row ${trade.source === 'you' ? 'tape-you' : trade.aggressor === 'buy' ? 'tape-buy' : 'tape-sell'}`} key={trade.id} data-testid={`row-trade-${trade.id}`}>
            <div><div className="tape-price">{money(trade.price)}</div><div className="tape-side">{trade.source === 'you' ? 'YOU' : `${trade.aggressor} aggressor`}</div></div>
            <div className="tape-qty">{quantityText(trade.quantity)} units</div>
            <div className="tape-time">{new Date(trade.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</div>
          </div>
        ))}
      </div> : <div className="empty-state"><div className="empty-icon"><Zap size={15} /></div><p>Waiting for a match</p><small>Submit a crossing order to print the first trade.</small></div>}
    </section>
  );
}

function OpenOrders({ book, mode, onCancel }: { book: BookState; mode: AppMode; onCancel: (id: string) => void }) {
  const orders = [...book.bids, ...book.asks]
    .filter((order) => mode === 'sim' || order.source !== 'live')
    .sort((a, b) => b.sequence - a.sequence);
  return (
    <details className="panel orders-section">
      <summary className="panel-heading">
        <div className="panel-title"><Layers3 size={14} /> open orders</div>
        <span className="panel-note mono">{orders.length} resting</span>
      </summary>
      {orders.length ? <div style={{ overflowX: 'auto' }}>
        <table className="orders-table">
          <thead><tr><th>ID</th><th>Side</th><th>Price</th><th>Qty</th><th /></tr></thead>
          <tbody>{orders.map((order) => <tr key={order.id} data-testid={`row-open-order-${order.id}`}>
            <td className="order-id">{order.id}</td>
            <td className={order.side === 'buy' ? 'order-buy' : 'order-sell'}>{order.side.toUpperCase()}</td>
            <td>{money(order.price)}</td>
            <td>{quantityText(order.quantity)}</td>
            <td><button data-testid={`button-cancel-${order.id}`} aria-label={`Cancel ${order.id}`} className="cancel-order" onClick={() => onCancel(order.id)}><X size={13} /></button></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="empty-state"><div className="empty-icon"><CircleAlert size={15} /></div><p>No resting orders</p><small>Limit orders that do not cross will appear here.</small></div>}
    </details>
  );
}

function App() {
  const [book, setBook] = useState<BookState>(() => seedBook());
  const [mode, setMode] = useState<AppMode>('sim');
  const [symbol, setSymbol] = useState('BTC/USD');
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('disconnected');
  const [liveStatusText, setLiveStatusText] = useState('disconnected');
  const [position, setPosition] = useState<PositionState>({ quantity: 0, averageEntryPrice: 0, realizedPnl: 0 });
  const [side, setSide] = useState<Side>('buy');
  const [kind, setKind] = useState<OrderKind>('limit');
  const [price, setPrice] = useState('100.25');
  const [quantity, setQuantity] = useState('10');
  const [cancelId, setCancelId] = useState('');
  const [flowRunning, setFlowRunning] = useState(false);
  const [flowSpeed, setFlowSpeed] = useState(8);
  const [aggression, setAggression] = useState(45);
  const [toast, setToast] = useState<{ text: string; tone?: 'warn' | 'error' } | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!flowRunning || mode !== 'sim') return;
    const interval = window.setInterval(() => {
      setBook((current) => {
        const incomingSide: Side = Math.random() < 0.5 ? 'buy' : 'sell';
        const incomingQuantity = randomQuantity(10, 300);
        const isMarket = Math.random() * 100 < aggression;
        let next = isMarket
          ? addMarketOrder(current, incomingSide, incomingQuantity).book
          : addLimitOrder(current, incomingSide, randomLimitPrice(current, incomingSide), incomingQuantity).book;

        if (Math.random() < 0.2) {
          const restingOrders = [...next.bids, ...next.asks];
          if (restingOrders.length) {
            const target = restingOrders[Math.floor(Math.random() * restingOrders.length)];
            next = cancelOrder(next, target.id).book;
          }
        }
        return ensureLiquidity(next);
      });
    }, 1000 / flowSpeed);
    return () => window.clearInterval(interval);
  }, [aggression, flowRunning, flowSpeed, mode]);

  useEffect(() => {
    if (mode !== 'live') {
      setLiveStatus('disconnected');
      setLiveStatusText('disconnected');
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    let attempts = 0;
    let socket: WebSocket | undefined;

    const setConnection = (status: LiveStatus, text: string) => {
      if (cancelled) return;
      setLiveStatus(status);
      setLiveStatusText(text);
    };

    const subscribe = () => {
      socket?.send(JSON.stringify({
        method: 'subscribe',
        params: { channel: 'book', symbol: [symbol], depth: 10, snapshot: true },
      }));
      socket?.send(JSON.stringify({
        method: 'subscribe',
        params: { channel: 'trade', symbol: [symbol] },
      }));
    };

    const connect = () => {
      if (cancelled) return;
      attempts += 1;
      setConnection('connecting', attempts === 1 ? 'connecting' : `retry ${attempts}/3`);
      socket = new WebSocket('wss://ws.kraken.com/v2');
      liveSocketRef.current = socket;

      socket.onopen = () => {
        attempts = 0;
        setConnection('live', 'live');
        subscribe();
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(event.data as string) as {
            channel?: string;
            type?: string;
            data?: Array<{
              symbol?: string;
              bids?: Array<{ price?: string | number; qty?: string | number }>;
              asks?: Array<{ price?: string | number; qty?: string | number }>;
              price?: string | number;
              qty?: string | number;
              side?: string;
              timestamp?: string;
            }>;
          };
          if (!message.channel || message.channel === 'heartbeat' || message.channel === 'status' || 'method' in message) return;
          if (message.channel === 'book' && (message.type === 'snapshot' || message.type === 'update')) {
            setBook((current) => applyLiveBookMessage(current, symbol, message.type as 'snapshot' | 'update', message.data ?? []));
          } else if (message.channel === 'trade' && message.type === 'update') {
            setBook((current) => appendLiveTrades(current, message.data ?? []));
          }
        } catch {
          setConnection('error', 'invalid feed message');
        }
      };

      socket.onerror = () => {
        setConnection('error', 'connection error');
      };

      socket.onclose = () => {
        if (cancelled) return;
        liveSocketRef.current = null;
        if (attempts < 3) {
          setConnection('error', `reconnecting (${attempts}/3)`);
          retryTimer = window.setTimeout(connect, 3000);
        } else {
          setConnection('error', 'Live feed unavailable — switch to Sim');
        }
      };
    };

    setBook(blankBook());
    setConnection('connecting', 'connecting');
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ method: 'unsubscribe', params: { channel: 'book', symbol: [symbol], depth: 10 } }));
        socket.send(JSON.stringify({ method: 'unsubscribe', params: { channel: 'trade', symbol: [symbol] } }));
      }
      socket?.close();
      if (liveSocketRef.current === socket) liveSocketRef.current = null;
    };
  }, [mode, symbol]);

  const changeMode = (nextMode: AppMode) => {
    if (nextMode === mode) return;
    setFlowRunning(false);
    if (nextMode === 'live') {
      setBook(blankBook());
      setLiveStatus('connecting');
      setLiveStatusText('connecting');
      setMode('live');
      setToast({ text: `Connecting to Kraken ${symbol} live data.` });
    } else {
      setBook(seedBook());
      setLiveStatus('disconnected');
      setLiveStatusText('disconnected');
      setMode('sim');
      setToast({ text: 'Live feed disconnected. Simulated book reseeded.' });
    }
  };

  const changeSymbol = (nextSymbol: string) => {
    setBook(blankBook());
    setLiveStatus('connecting');
    setLiveStatusText('connecting');
    setSymbol(nextSymbol);
    setToast({ text: `Switching live feed to ${nextSymbol}.` });
  };

  const submitOrder = () => {
    const numericQuantity = Number(quantity);
    const numericPrice = Number(price);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setToast({ text: 'Enter a quantity greater than zero.', tone: 'error' });
      return;
    }
    if (kind === 'limit' && (!Number.isFinite(numericPrice) || numericPrice <= 0)) {
      setToast({ text: 'Enter a valid limit price.', tone: 'error' });
      return;
    }
    const result = mode === 'live'
      ? kind === 'limit'
        ? markPaperMatch(addLimitOrder(book, side, numericPrice, numericQuantity))
        : sweepLiveBook(book, side, numericQuantity)
      : kind === 'limit'
        ? addLimitOrder(book, side, numericPrice, numericQuantity)
        : addMarketOrder(book, side, numericQuantity);
    setBook(result.book);
    if (mode === 'live') {
      setPosition((current) => applyPositionFills(current, (result as PaperMatchResult).fills));
    }
    setToast({ text: result.cancelledQuantity ? `${result.message} · ${quantityText(result.cancelledQuantity)} cancelled` : result.message, tone: result.cancelledQuantity ? 'warn' : undefined });
    setQuantity('10');
  };

  const seed = () => {
    setBook(seedBook());
    setToast({ text: 'Book reseeded around 100.00.' });
  };

  const clear = () => {
    setBook(blankBook());
    setToast({ text: 'Book cleared. Ready for orders.', tone: 'warn' });
  };

  const bigMarketOrder = () => {
    const result = mode === 'live' ? sweepLiveBook(book, 'buy', 2000) : addMarketOrder(book, 'buy', 2000);
    setBook(result.book);
    if (mode === 'live') setPosition((current) => applyPositionFills(current, (result as PaperMatchResult).fills));
    setToast({
      text: result.cancelledQuantity
        ? `BUY 2,000 @ MKT · ${result.filledQuantity} filled · ${quantityText(result.cancelledQuantity)} cancelled`
        : `BUY 2,000 @ MKT · ${result.fillCount} fills`,
      tone: result.cancelledQuantity ? 'warn' : undefined,
    });
  };

  const flatten = () => {
    if (mode !== 'live' || !position.quantity) return;
    const flattenSide: Side = position.quantity > 0 ? 'sell' : 'buy';
    const result = sweepLiveBook(book, flattenSide, Math.abs(position.quantity));
    setBook(result.book);
    setPosition((current) => applyPositionFills(current, result.fills));
    setToast({
      text: result.cancelledQuantity
        ? `Flattened ${result.filledQuantity} · ${quantityText(result.cancelledQuantity)} still open`
        : `Position flattened with ${result.fillCount} fill${result.fillCount === 1 ? '' : 's'}.`,
      tone: result.cancelledQuantity ? 'warn' : undefined,
    });
  };

  const cancel = (id = cancelId) => {
    if (!id.trim()) {
      setToast({ text: 'Enter an order ID to cancel.', tone: 'error' });
      return;
    }
    const result = cancelOrder(book, id);
    if (!result.cancelled) {
      setToast({ text: `${id.trim().toUpperCase()} is not resting in the book.`, tone: 'error' });
      return;
    }
    setBook(result.book);
    setCancelId('');
    setToast({ text: `${result.cancelled.id} cancelled.` });
  };

  const tradePrices = useMemo(() => book.trades.slice(0, 200).reverse().map((trade) => trade.price), [book.trades]);
  const midpoint = getBookTop(book).midpoint;

  return (
    <div className="terminal-shell">
      <header className="topbar">
        <div className="brand-mark">
          <div className="brand-glyph"><BarChart3 size={16} /></div>
          <div><div className="brand-name">Market / Lab</div><div className="brand-sub">microstructure simulator</div></div>
        </div>
        <div className={`market-badge ${mode === 'live' ? `status-${liveStatus}` : ''}`}><span className={mode === 'live' ? 'connection-dot' : 'pulse-dot'} /> {mode === 'live' ? liveStatusText : 'matching engine online'}</div>
        <div className="top-actions">
          <button data-testid="button-help" className="icon-button" title="Simulator guide" onClick={() => setToast({ text: 'Crossing orders trade at the resting price; equal prices fill FIFO.' })}><CircleHelp size={16} /></button>
          <button data-testid="button-reset-session" className="icon-button" title="Reset session" onClick={() => mode === 'live' ? changeMode('sim') : seed()}><RotateCcw size={16} /></button>
          <ShieldCheck size={15} color="hsl(140 62% 65%)" />
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-heading">
          <div><div className="eyebrow">{mode === 'live' ? `Live market / Kraken · ${symbol}` : 'Training venue / XNAS-SIM'}</div><h1 className="page-title">Limit order book</h1><p className="page-caption">{mode === 'live' ? 'Public market data with local paper execution. No orders are sent to the exchange.' : 'Watch price-time priority resolve in real time. Every fill uses the resting order\'s price.'}</p></div>
          <div className="session-meta"><span><Clock3 size={12} /> session</span><strong className="mono">{mode === 'live' ? 'LIVE–01' : 'SIM–01'}</strong><span className="mono">{mode === 'live' ? symbol : 'USD / units'}</span></div>
        </div>
        <MetricsStrip book={book} />
        <FlowControls mode={mode} liveStatus={liveStatus} liveStatusText={liveStatusText} symbol={symbol} running={flowRunning} speed={flowSpeed} aggression={aggression} onModeChange={changeMode} onSymbolChange={changeSymbol} onRunningChange={setFlowRunning} onSpeedChange={setFlowSpeed} onAggressionChange={setAggression} onBigMarket={bigMarketOrder} />
        <div className="grid-layout">
          <OrderEntry mode={mode} position={position} midpoint={midpoint} side={side} kind={kind} price={price} quantity={quantity} onSideChange={setSide} onKindChange={setKind} onPriceChange={setPrice} onQuantityChange={setQuantity} onSubmit={submitOrder} onSeed={seed} onClear={clear} onCancel={() => cancel()} onFlatten={flatten} cancelId={cancelId} setCancelId={setCancelId} />
          <BookLadder book={book} tradePrices={tradePrices} />
          <TradeTape trades={book.trades} />
        </div>
        <OpenOrders book={book} mode={mode} onCancel={cancel} />
      </main>
      {toast && <div className={`toast-message ${toast.tone ?? ''}`} role="status" data-testid="status-toast">{toast.text}</div>}
    </div>
  );
}

export default App;