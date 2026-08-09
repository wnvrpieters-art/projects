import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "CAPS Accounting AI Grader"
    API_V1_STR: str = "/api/v1"
    
    # API Keys loaded from .env
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()