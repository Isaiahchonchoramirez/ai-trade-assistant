from fastapi import APIRouter
from app.services.price_fetcher import fetch_price

router = APIRouter()

@router.get("/price/{symbol}")
async def get_price(symbol: str):
    price = fetch_price(symbol)
    return {"symbol": symbol.upper(), "price": price}
