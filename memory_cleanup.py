
from memory_manager import get_all_memories, save_memory


def cleanup():

    data = get_all_memories()

    # Standardize profile keys
    profile = data.get("user_profile", {})

    if "planned_degree" in profile:
        profile.setdefault(
            "intended_degree",
            profile["planned_degree"]
        )
        del profile["planned_degree"]

    # Remove misleading profile entry
    if profile.get("preferred_language") == "Python":
        del profile["preferred_language"]

    # Remove exact duplicate memories
    memories = data.get("memories", [])
    seen = set()
    cleaned = []

    for memory in memories:

        content = memory.get("content", "").strip().lower()

        normalized = " ".join(
            content.replace(".", "").split()
        )

        normalized = normalized.removeprefix("the user is ")

        if not normalized or normalized in seen:
            continue

        seen.add(normalized)
        cleaned.append(memory)

    data["memories"] = cleaned

    save_memory(data)

    print("=== MEMORY CLEANUP COMPLETE ===")
    print("Profile:", data["user_profile"])
    print("Memories:")

    for memory in cleaned:
        print("-", memory["content"])


if __name__ == "__main__":
    cleanup()
