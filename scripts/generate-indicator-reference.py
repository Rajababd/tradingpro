"""Generates tests/fixtures/indicator-reference.json: indicator values from TA-Lib and from an
independently written Python implementation, over a fixed 400-bar OHLCV series.

The TypeScript indicators are compared against this file by tests/indicatorReference.test.ts.
Re-run only if you want to regenerate the fixture:  python3 scripts/generate-indicator-reference.py
Requires: numpy, pandas, TA-Lib.
"""
import json, math, pathlib
import numpy as np
import pandas as pd
import talib

N = 400
rng = np.random.default_rng(20240101)

# --- a fixed OHLCV series, rounded like real quotes, with deliberate edge cases
close = np.empty(N); open_ = np.empty(N); high = np.empty(N); low = np.empty(N)
price = 100.0
for i in range(N):
    o = price
    c = max(1.0, o + rng.normal(0, 1.2))
    h = max(o, c) + abs(rng.normal(0, 0.5))
    l = max(0.5, min(o, c) - abs(rng.normal(0, 0.5)))
    open_[i], close[i], high[i], low[i] = round(o, 2), round(c, 2), round(h, 2), round(l, 2)
    price = close[i]
for i in (50, 51, 52):                       # unchanged closes (OBV adds nothing)
    close[i] = close[49]; open_[i] = close[49]; high[i] = close[49] + 0.3; low[i] = close[49] - 0.3
for i in (100, 101, 250):                    # zero-range bars (A/D must not divide by zero)
    open_[i] = close[i] = high[i] = low[i] = close[i - 1]
high = np.maximum.reduce([high, open_, close]); low = np.minimum.reduce([low, open_, close])
volume = rng.integers(1_000, 90_000, N).astype(float)
time = [1704067200 + 86400 * i for i in range(N)]

def clean(a):
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else float(x) for x in a]

# --- independent EMA with SMA seed, written as a plain loop (not TA-Lib, not pandas)
def ema_sma_seed(values, period):
    out = [None] * len(values); k = 2.0 / (period + 1); prev = None; seed = []
    for i, x in enumerate(values):
        if x is None: continue
        if prev is None:
            seed.append(x)
            if len(seed) == period:
                prev = sum(seed) / period; out[i] = prev
        else:
            prev = k * x + (1 - k) * prev; out[i] = prev
    return out

def macd_exact(c, fast, slow, sig):
    ef, es = ema_sma_seed(list(c), fast), ema_sma_seed(list(c), slow)
    macd = [None if (a is None or b is None) else a - b for a, b in zip(ef, es)]
    signal = ema_sma_seed(macd, sig)
    hist = [None if (m is None or s is None) else m - s for m, s in zip(macd, signal)]
    return macd, signal, hist

rsi14 = talib.RSI(close, 14)
ref = {
    "sma20_close": clean(talib.SMA(close, 20)),
    "sma5_close": clean(talib.SMA(close, 5)),
    "rsi14": clean(rsi14),
    "rsi5": clean(talib.RSI(close, 5)),
    # SMA of an indicator output, via pandas (NaN-aware: needs 20 real values)
    "sma20_of_rsi14": clean(pd.Series(rsi14).rolling(20).mean().to_numpy()),
    "obv": clean(talib.OBV(close, volume)),
    "ad": clean(talib.AD(high, low, close, volume)),
}
m, s, h = macd_exact(close, 12, 26, 9)
ref["macd_exact"] = {"macd": clean([x if x is not None else float("nan") for x in m]),
                     "signal": clean([x if x is not None else float("nan") for x in s]),
                     "histogram": clean([x if x is not None else float("nan") for x in h])}
tm, ts, th = talib.MACD(close, 12, 26, 9)
ref["macd_talib"] = {"macd": clean(tm), "signal": clean(ts), "histogram": clean(th)}
m2, s2, h2 = macd_exact(close, 5, 13, 4)
ref["macd_exact_5_13_4"] = {"macd": clean([x if x is not None else float("nan") for x in m2]),
                            "signal": clean([x if x is not None else float("nan") for x in s2]),
                            "histogram": clean([x if x is not None else float("nan") for x in h2])}

doc = {
    "meta": {"generator": "scripts/generate-indicator-reference.py", "talib": talib.__version__,
             "numpy": np.__version__, "pandas": pd.__version__, "bars": N},
    "candles": [{"time": time[i], "open": float(open_[i]), "high": float(high[i]), "low": float(low[i]),
                 "close": float(close[i]), "volume": float(volume[i])} for i in range(N)],
    "reference": ref,
}
out = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "indicator-reference.json"
out.write_text(json.dumps(doc))
print("wrote", out, f"({out.stat().st_size // 1024} KB), TA-Lib {talib.__version__}")
print("OBV[0] == volume[0]:", ref["obv"][0] == volume[0], "| first non-null TA-Lib MACD index:", next(i for i, v in enumerate(ref['macd_talib']['macd']) if v is not None),
      "| exact MACD:", next(i for i, v in enumerate(ref['macd_exact']['macd']['macd'] if False else ref['macd_exact']['macd']) if v is not None))
