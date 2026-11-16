
import json
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).resolve().parent
MEMORY_FILE = BASE / "memory.json"


def empty_memory():
    return {
        "user_profile": {},
        "memories": [],
        "profile_meta": {},
        "last_updated": None
    }


def load_memory():
    if not MEMORY_FILE.exists():
        return empty_memory()

    try:
        with open(MEMORY_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)

        if not isinstance(data, dict):
            return empty_memory()

        data.setdefault("user_profile", {})
        data.setdefault("memories", [])
        data.setdefault("last_updated", None)
        data.setdefault("profile_meta", {})

        return data

    except (json.JSONDecodeError, OSError):
        return empty_memory()


def save_memory(data):
    data["last_updated"] = datetime.now(
        timezone.utc
    ).isoformat()

    with open(MEMORY_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)


def add_memory(content, category="general"):
    data = load_memory()
    content = content.strip()

    if not content:
        return False

    for memory in data["memories"]:
        if memory["content"].lower() == content.lower():
            return False

    data["memories"].append({
        "content": content,
        "category": category,
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    save_memory(data)
    return True


def edit_memory(old_content, new_content):
    data = load_memory()

    old_content = old_content.strip().lower()
    new_content = new_content.strip()

    if not new_content:
        return False

    for memory in data["memories"]:
        if memory["content"].lower() == old_content:
            memory["content"] = new_content
            memory["updated_at"] = datetime.now(
                timezone.utc
            ).isoformat()

            save_memory(data)
            return True

    return False


def delete_memory(content):
    data = load_memory()
    original_count = len(data["memories"])

    data["memories"] = [
        memory for memory in data["memories"]
        if memory["content"].lower() != content.strip().lower()
    ]

    if len(data["memories"]) == original_count:
        return False

    save_memory(data)
    return True


def update_profile(key, value):
    data = load_memory()
    now = datetime.now(timezone.utc).isoformat()

    meta = data["profile_meta"].setdefault(key, {})

    if key not in data["user_profile"]:
        meta["created_at"] = now
    elif data["user_profile"][key] != value:
        meta.setdefault("created_at", now)
        meta["updated_at"] = now

    data["user_profile"][key] = value

    save_memory(data)
    return True


def delete_profile(key):
    data = load_memory()

    if key not in data["user_profile"]:
        return False

    del data["user_profile"][key]
    data["profile_meta"].pop(key, None)
    save_memory(data)
    return True


def get_all_memories():
    return load_memory()


def format_memory_context():
    data = load_memory()

    profile = data.get("user_profile", {})
    memories = data.get("memories", [])

    context = []

    if profile:
        context.append("USER PROFILE:")

        for key, value in profile.items():
            context.append(f"- {key}: {value}")

    if memories:
        context.append("\nSAVED MEMORIES:")

        for memory in memories:
            context.append(
                f"- [{memory.get('category', 'general')}] "
                f"{memory.get('content', '')}"
            )

    if not context:
        return "No saved user information yet."

    return "\n".join(context)


