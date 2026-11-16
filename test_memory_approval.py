
from memory_extractor import extract_memory_candidates
from memory_manager import add_memory, update_profile


print("=== SAM MEMORY APPROVAL TEST ===")

message = input("\nWhat would you like to tell SAM?\n> ")

try:
    result = extract_memory_candidates(message)

    proposals = result["profile_updates"] + result["memories"]

    if not proposals:
        print("\nSAM found nothing worth remembering.")
    else:
        print("\nSAM wants to remember:")

        for index, item in enumerate(proposals, start=1):
            if "key" in item:
                print(f"\n{index}. PROFILE")
                print(f"   {item['key']}: {item['value']}")
            else:
                print(f"\n{index}. MEMORY")
                print(f"   [{item['category']}] {item['content']}")

            answer = input("Save this? (y/n): ").strip().lower()

            if answer == "y":
                if "key" in item:
                    update_profile(item["key"], item["value"])
                else:
                    add_memory(item["content"], item["category"])

                print("Saved!")
            else:
                print("Skipped.")

except Exception as error:
    print("\nSomething went wrong:")
    print(error)

print("\n=== APPROVAL TEST COMPLETE ===")
