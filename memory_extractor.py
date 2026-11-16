
import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv


# --- Setup ---
BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

API_KEY = os.getenv("API_KEY") or os.getenv("GEMINI_API_KEY", "")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

URL = (
    f"https://generativelanguage.googleapis.com/v1beta/"
    f"models/{MODEL}:generateContent"
)


# --- Memory Extraction ---
def extract_memory_candidates(user_message):

    if not API_KEY:
        raise ValueError("Missing Gemini API key in .env")

    if not isinstance(user_message, str) or not user_message.strip():
        return {
            "profile_updates": [],
            "memories": []
        }

    prompt = f"""
You are SAM's memory extraction system.

Analyze the user's message and identify information
that could be useful to remember in future conversations.

RULES:
1. Only extract information explicitly stated by the user.
2. Do not invent, assume, or infer personal details.
3. Prioritize stable preferences, goals, ongoing projects,
   education, skills, and important decisions.
4. Ignore casual conversation and temporary statements.
5. Never extract passwords, API keys, or other credentials.
6. Do not extract sensitive personal information.
7. Do not save information merely because it sounds interesting.
8. If nothing is worth remembering, return empty arrays.
9. Write memory "content" as a short, natural phrase WITHOUT
   "The user" (e.g. "Currently learning Python", "Loves chocolate drinks").
10. Never put the same fact in both "profile_updates" and "memories".
    Use profile_updates for single stable facts (degree, main language,
    name) and memories for everything else.
11. Profile keys must be short lowercase snake_case (e.g. "intended_degree").

Return ONLY valid JSON using this structure:

{{
    "profile_updates": [
        {{
            "key": "descriptive_key",
            "value": "explicitly stated information"
        }}
    ],
    "memories": [
        {{
            "content": "useful information to remember",
            "category": "education, project, preference, goal, or general"
        }}
    ]
}}

USER MESSAGE:
{user_message}
"""

    body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 512,
            "responseMimeType": "application/json"
        }
    }

    response = requests.post(
        URL,
        json=body,
        headers={"x-goog-api-key": API_KEY},
        timeout=(10, 60)
    )

    response.raise_for_status()

    result = response.json()

    text = (
        result["candidates"][0]
        ["content"]["parts"][0]["text"]
    )

    extracted = json.loads(text)

    # Validate the returned structure
    if not isinstance(extracted, dict):
        raise ValueError("Invalid memory extraction result.")

    profile_updates = extracted.get("profile_updates", [])
    memories = extracted.get("memories", [])

    if not isinstance(profile_updates, list):
        profile_updates = []

    if not isinstance(memories, list):
        memories = []

    return {
        "profile_updates": [
            item for item in profile_updates
            if isinstance(item, dict)
            and isinstance(item.get("key"), str)
            and isinstance(item.get("value"), str)
        ],
        "memories": [
            item for item in memories
            if isinstance(item, dict)
            and isinstance(item.get("content"), str)
            and isinstance(item.get("category"), str)
        ]
    }

