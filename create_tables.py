from config import supabase

def create_tables():
    """Veritabanı tablolarının durumunu kontrol eder."""

    tables = ["matches", "match_queue", "match_stats", "match_h2h"]
    for table in tables:
        try:
            supabase.table(table).select("id").limit(1).execute()
            print(f"✅ Tablo mevcut: {table}")
        except Exception as e:
            print(f"⚠️ Tablo yok veya erişilemiyor: {table} — {e}")

    print("\n📋 Yeni tablolar için SQL:")
    print("   sql/create_match_stats_h2h.sql dosyasını Supabase SQL Editor'da çalıştırın.")

if __name__ == "__main__":
    create_tables()
