"""
Kadın futbolu verilerini DB'den temizleyen script.

Kullanım:
  python scripts/cleanup_womens_football.py          # Dry-run (sadece göster)
  python scripts/cleanup_womens_football.py --apply  # Gerçekten sil

Bu script:
1. matches tablosundan kadın futbolu maçlarını siler
2. match_queue tablosundan ilgili kayıtları siler
3. seasons tablosunda kadın ligi sezonlarını deaktif eder (is_active = FALSE)
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config import supabase

WOMENS_KEYWORD = "Kadın"


def find_womens_matches():
    """matches tablosundaki kadın futbolu maçlarını bul."""
    all_codes = set()

    # league field'ında "Kadın" aranır
    for field in ("league", "league_display"):
        offset = 0
        batch = 1000
        while True:
            resp = (
                supabase.table("matches")
                .select("match_code, league, league_display")
                .ilike(field, f"%{WOMENS_KEYWORD}%")
                .range(offset, offset + batch - 1)
                .execute()
            )
            if not resp.data:
                break
            for row in resp.data:
                all_codes.add(row["match_code"])
            if len(resp.data) < batch:
                break
            offset += batch

    return all_codes


def find_womens_seasons():
    """seasons tablosunda kadın ligi sezonlarını bul."""
    resp = (
        supabase.table("seasons")
        .select("id, mackolik_id, season_year, is_active, leagues(name)")
        .eq("is_active", True)
        .execute()
    )
    womens = []
    for s in resp.data or []:
        league_name = s.get("leagues", {}).get("name", "")
        if WOMENS_KEYWORD in league_name:
            womens.append(s)
    return womens


def delete_matches(match_codes, dry_run=True):
    """matches tablosundan sil."""
    if not match_codes:
        return 0

    code_list = list(match_codes)
    deleted = 0

    for i in range(0, len(code_list), 200):
        chunk = code_list[i : i + 200]
        if dry_run:
            deleted += len(chunk)
        else:
            resp = (
                supabase.table("matches")
                .delete()
                .in_("match_code", chunk)
                .execute()
            )
            deleted += len(resp.data) if resp.data else len(chunk)

    return deleted


def delete_queue_entries(match_codes, dry_run=True):
    """match_queue tablosundan sil."""
    if not match_codes:
        return 0

    code_list = list(match_codes)
    deleted = 0

    for i in range(0, len(code_list), 200):
        chunk = code_list[i : i + 200]
        if dry_run:
            # Kaç tanesi kuyrukta var kontrol et
            resp = (
                supabase.table("match_queue")
                .select("match_code", count="exact")
                .in_("match_code", chunk)
                .execute()
            )
            deleted += resp.count or 0
        else:
            resp = (
                supabase.table("match_queue")
                .delete()
                .in_("match_code", chunk)
                .execute()
            )
            deleted += len(resp.data) if resp.data else 0

    return deleted


def deactivate_seasons(seasons, dry_run=True):
    """Kadın ligi sezonlarını deaktif et."""
    if not seasons:
        return 0

    count = 0
    for s in seasons:
        if dry_run:
            count += 1
        else:
            supabase.table("seasons").update({"is_active": False}).eq("id", s["id"]).execute()
            count += 1

    return count


def main():
    apply = "--apply" in sys.argv

    print("🔍 Kadın futbolu verileri taranıyor...\n")

    # 1. Kadın futbolu maçlarını bul
    match_codes = find_womens_matches()
    print(f"📊 matches tablosunda {len(match_codes)} kadın futbolu maçı bulundu.")

    # 2. Kadın ligi sezonlarını bul
    womens_seasons = find_womens_seasons()
    print(f"📊 seasons tablosunda {len(womens_seasons)} aktif kadın ligi sezonu bulundu:")
    for s in womens_seasons:
        league_name = s.get("leagues", {}).get("name", "?")
        print(f"   - {league_name} {s['season_year']} (mackolik_id={s['mackolik_id']})")

    if not match_codes and not womens_seasons:
        print("\n✅ Temizlenecek kadın futbolu verisi bulunamadı.")
        return

    prefix = "[DRY-RUN]" if not apply else "[APPLY]"

    # 3. match_queue'dan sil
    queue_deleted = delete_queue_entries(match_codes, dry_run=not apply)
    print(f"\n{prefix} match_queue: {queue_deleted} kayıt silindi")

    # 4. matches'dan sil
    matches_deleted = delete_matches(match_codes, dry_run=not apply)
    print(f"{prefix} matches: {matches_deleted} kayıt silindi")

    # 5. Sezonları deaktif et
    seasons_deactivated = deactivate_seasons(womens_seasons, dry_run=not apply)
    print(f"{prefix} seasons: {seasons_deactivated} sezon deaktif edildi")

    if not apply:
        print(f"\n⚠️  Dry-run modu. Değişiklik yapılmadı.")
        print(f"    Uygulamak için: python scripts/cleanup_womens_football.py --apply")
    else:
        print(f"\n✅ Temizlik tamamlandı!")


if __name__ == "__main__":
    main()
