
from memory_manager import (
    add_memory,
    update_profile,
    get_all_memories,
    delete_memory
)

print("=== SAM MEMORY TEST ===")

# 1. Save a memory
print("\n[1] Saving memory...")
result = add_memory(
    "The user is learning Python.",
    "education"
)
print("Saved:", result)

# 2. Save profile information
print("\n[2] Updating profile...")
update_profile("preferred_language", "Python")
print("Profile updated.")

# 3. Retrieve memories
print("\n[3] Reading memories...")
data = get_all_memories()
print(data)

# 4. Delete test memory
print("\n[4] Deleting test memory...")
result = delete_memory("The user is learning Python.")
print("Deleted:", result)

print("\n=== TEST COMPLETE ===")

