from link_harvester import get_current_week

print("Testing get_current_week for ID 70381 (Super Lig)...")
week = get_current_week(70381)
print(f"Result: {week}")

print("\nTesting get_current_week for ID 67238 (Ligue 1)...")
week = get_current_week(67238)
print(f"Result: {week}")
