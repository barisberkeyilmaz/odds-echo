import os
import sys
import logging
from dotenv import load_dotenv
from supabase import create_client, Client

logger = logging.getLogger("config")

# .env Yükle
load_dotenv()

# Ayarları Al
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", 20))

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("HATA: .env dosyasında SUPABASE_URL veya SUPABASE_KEY eksik!")
    sys.exit(1)

# Global Supabase İstemcisi
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)