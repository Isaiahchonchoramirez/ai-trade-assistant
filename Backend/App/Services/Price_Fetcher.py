import yfinance as yf

def fetch_price(symbol: str):
    ticker = yf.Ticker(symbol)
    todays_data = ticker.history(period='1d')
    return round(todays_data['Close'].iloc[-1], 2)
