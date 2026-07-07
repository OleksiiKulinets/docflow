from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(DATABASE_URL, echo=False)
Base = declarative_base()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)