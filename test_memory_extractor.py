
from memory_extractor import extract_memory_candidates


print("=== SAM MEMORY EXTRACTION TEST ===")

test_messages = [
    "I'm planning to take BSIT and I'm currently learning Python."
]

for message in test_messages:
    print("\nUSER MESSAGE:")
    print(message)

    print("\nSAM'S MEMORY PROPOSALS:")

    try:
        result = extract_memory_candidates(message)

        print("\nPROFILE UPDATES:")
        for item in result["profile_updates"]:
            print(f"- {item['key']}: {item['value']}")

        print("\nSAVED MEMORY CANDIDATES:")
        for item in result["memories"]:
            print(f"- [{item['category']}] {item['content']}")

        if not result["profile_updates"] and not result["memories"]:
            print("No useful memories detected.")

    except Exception as error:
        print("TEST FAILED:")
        print(error)

print("\n=== TEST COMPLETE ===")
