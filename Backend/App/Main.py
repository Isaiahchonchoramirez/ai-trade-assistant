from fastapi import FastAPI
from app.api.v1.routes import router as api_router

app = FastAPI(
    title="AI Trade Assistant",
    description="Get AI-driven trading insights and signals",
    version="0.1.0"
)

# Include the API routes
app.include_router(api_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI Trade Assistant API!"}
