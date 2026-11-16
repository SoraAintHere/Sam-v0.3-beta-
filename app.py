
import json
import os
import secrets
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    jsonify,
    request,
    send_from_directory,
    stream_with_context,
)

from identity import SYSTEM_PROMPT
from memory_manager import (
    add_memory,
    edit_memory,
    delete_memory,
    update_profile,
    delete_profile,
    get_all_memories,
    format_memory_context,
)
from memory_extractor import extract_memory_candidates
from settings_manager import (
    load_settings,
    update_settings,
    reset_settings,
)


# ==========================================
# SETUP
# ==========================================

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

app = Flask(__name__)

USER_NAME = os.getenv("USER_NAME", "CJ")
API_KEY = os.getenv("API_KEY") or os.getenv("GEMINI_API_KEY", "")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
NO_THINKING = os.getenv(
    "GEMINI_NO_THINKING", "false"
).lower() == "true"

URL = (
    f"https://generativelanguage.googleapis.com/v1beta/"
    f"models/{MODEL}:streamGenerateContent?alt=sse"
)

http = requests.Session()
pending_proposals = {}


# ==========================================
# MEMORY PROPOSAL VALIDATION
# ==========================================

def clean_proposals(extracted):

    proposals = []

    for item in extracted.get("profile_updates", []):

        if not isinstance(item, dict):
            continue

        key = item.get("key")
        value = item.get("value")

        if not isinstance(key, str) or not isinstance(value, str):
            continue

        key = key.strip()
        value = value.strip()

        if not key or not value:
            continue

        proposals.append({
            "id": secrets.token_urlsafe(16),
            "type": "profile",
            "key": key,
            "value": value,
        })

    for item in extracted.get("memories", []):

        if not isinstance(item, dict):
            continue

        content = item.get("content")
        category = item.get("category", "general")

        if not isinstance(content, str) or not isinstance(category, str):
            continue

        content = content.strip()
        category = category.strip() or "general"

        if not content:
            continue

        proposals.append({
            "id": secrets.token_urlsafe(16),
            "type": "memory",
            "content": content,
            "category": category,
        })

    return proposals


# ==========================================
# GEMINI STREAMING
# ==========================================

def open_stream(messages):

    settings = load_settings()

    personalization = settings["personalization"]
    generation = settings["generation"]

    memory_context = format_memory_context()

    response_styles = {
        "concise": (
            "Prefer concise, direct answers. "
            "Avoid unnecessary explanations."
        ),
        "balanced": (
            "Balance clarity and detail. "
            "Explain important points with useful examples."
        ),
        "detailed": (
            "Give thorough explanations, context, "
            "and examples when useful."
        ),
    }

    response_style = personalization["response_style"]

    combined_prompt = f"""
{SYSTEM_PROMPT}

RESPONSE STYLE:
{response_styles.get(response_style, response_styles["balanced"])}

CUSTOM USER INSTRUCTIONS:
{personalization["custom_instructions"] or "None provided."}

ASSISTANT DISPLAY NAME:
{personalization["assistant_name"]}

IMPORTANT: The following is saved information about the user.
Use it when relevant to the current conversation.

{memory_context}

MEMORY RULES:
- Use saved information naturally when relevant.
- Do not mention memories unnecessarily.
- Do not assume saved information is always current.
- If no relevant memory exists, answer normally.
- Never invent memories or claim to remember something
  that is not included in the saved information.
"""

    body = {
        "system_instruction": {
            "parts": [{"text": combined_prompt}]
        },
        "contents": [
            {
                "role": (
                    "model"
                    if message["role"] == "assistant"
                    else "user"
                ),
                "parts": [{"text": message["content"]}],
            }
            for message in messages
        ],
        "generationConfig": {
            "maxOutputTokens": generation["max_output_tokens"],
            "temperature": generation["temperature"],
        },
    }

    if NO_THINKING:
        body["generationConfig"]["thinkingConfig"] = {
            "thinkingBudget": 0
        }

    return http.post(
        URL,
        json=body,
        headers={"x-goog-api-key": API_KEY},
        stream=True,
        timeout=(10, 60),
    )


# ==========================================
# RESPONSE TOKEN PROCESSING
# ==========================================

def tokens(resp):

    for line in resp.iter_lines():

        if not line:
            continue

        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="replace")

        if not line.startswith("data:"):
            continue

        try:
            data = json.loads(line[5:].strip())
            parts = data["candidates"][0]["content"]["parts"]

        except (KeyError, IndexError, ValueError, TypeError):
            continue

        for part in parts:

            if part.get("text") and not part.get("thought"):
                yield part["text"]


# ==========================================
# FRONTEND ROUTES
# ==========================================

@app.get("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.get("/style.css")
def css():
    return send_from_directory(BASE, "style.css")


@app.get("/script.js")
def js():
    return send_from_directory(BASE, "script.js")


@app.get("/settings.js")
def settings_js():
    return send_from_directory(BASE, "settings.js")


# ==========================================
# CONFIGURATION
# ==========================================

@app.get("/config")
def config():

    settings = load_settings()
    personalization = settings["personalization"]

    return jsonify(
        name=personalization["user_name"] or USER_NAME,
        assistant_name=personalization["assistant_name"],
    )


# ==========================================
# SETTINGS API
# ==========================================

@app.get("/settings")
def get_app_settings():

    settings = load_settings()

    return jsonify(
        success=True,
        settings={
            **settings,
            "model": MODEL,
        },
    )


@app.post("/settings")
def save_app_settings():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="Invalid settings data."), 400

    try:
        settings = update_settings(data)

        return jsonify(
            success=True,
            settings={
                **settings,
                "model": MODEL,
            },
        )

    except ValueError as error:

        return jsonify(error=str(error)), 400

    except Exception:

        app.logger.exception("Settings save failed")

        return jsonify(
            error="Couldn't save settings."
        ), 500


@app.post("/settings/reset")
def reset_app_settings():

    try:
        settings = reset_settings()

        return jsonify(
            success=True,
            settings={
                **settings,
                "model": MODEL,
            },
        )

    except Exception:

        app.logger.exception("Settings reset failed")

        return jsonify(
            error="Couldn't reset settings."
        ), 500


# ==========================================
# GEMINI CONNECTION TEST
# ==========================================

@app.post("/connection/test")
def test_connection():

    if not API_KEY:

        return jsonify(
            success=False,
            message="API key is missing from .env."
        ), 500

    try:

        response = http.post(
            (
                "https://generativelanguage.googleapis.com/"
                f"v1beta/models/{MODEL}:generateContent"
            ),
            json={
                "contents": [
                    {
                        "parts": [
                            {"text": "Reply with OK."}
                        ]
                    }
                ],
                "generationConfig": {
                    "maxOutputTokens": 8,
                    "temperature": 0,
                },
            },
            headers={"x-goog-api-key": API_KEY},
            timeout=(10, 20),
        )

        if response.status_code != 200:

            app.logger.warning(
                "Gemini connection test failed: %s",
                response.text[:300],
            )

            return jsonify(
                success=False,
                message=(
                    f"Gemini returned error "
                    f"{response.status_code}."
                ),
            ), 502

        return jsonify(
            success=True,
            message="Gemini connection successful.",
        )

    except requests.RequestException:

        app.logger.exception(
            "Gemini connection test failed"
        )

        return jsonify(
            success=False,
            message=(
                "Couldn't reach Gemini. "
                "Check your internet connection."
            ),
        ), 502


# ==========================================
# CHAT ROUTE
# ==========================================

@app.post("/chat")
def chat():

    data = request.get_json(silent=True) or {}
    messages = data.get("messages")

    if not isinstance(messages, list) or not messages:
        return jsonify(error="No messages provided."), 400

    if len(messages) > 12:
        return jsonify(error="Too many messages."), 400

    valid_messages = []

    for message in messages:

        if not isinstance(message, dict):
            return jsonify(error="Invalid message format."), 400

        role = message.get("role")
        content = message.get("content")

        if role not in ("user", "assistant"):
            return jsonify(error="Invalid message role."), 400

        if not isinstance(content, str) or not content.strip():
            return jsonify(error="Invalid message content."), 400

        valid_messages.append({
            "role": role,
            "content": content,
        })

    if not API_KEY:
        return jsonify(error="Missing API key in .env"), 500

    try:
        resp = open_stream(valid_messages)

    except requests.RequestException:

        app.logger.exception("Gemini connection failed")

        return jsonify(
            error="Couldn't reach Gemini. Check your connection."
        ), 502

    if resp.status_code != 200:

        status = resp.status_code
        error_details = resp.text[:300]
        resp.close()

        app.logger.error(
            "Gemini %s: %s",
            status,
            error_details,
        )

        if status == 429:
            return jsonify(
                error=(
                    "Gemini rate limit reached. "
                    "Wait a little and try again."
                )
            ), 429

        return jsonify(
            error=(
                f"Gemini error {status}. "
                "Check your model name and API key."
            )
        ), 502

    def generate():

        try:
            yield from tokens(resp)

        except requests.RequestException:

            app.logger.exception(
                "Gemini stream interrupted"
            )

        finally:
            resp.close()

    return Response(
        stream_with_context(generate()),
        mimetype="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ==========================================
# MEMORY PROPOSAL ROUTE
# ==========================================

@app.post("/memory/propose")
def propose_memory():

    settings = load_settings()

    if not settings["memory"]["auto_detect"]:
        return jsonify(proposals=[])

    data = request.get_json(silent=True) or {}
    message = data.get("message")

    if not isinstance(message, str) or not message.strip():
        return jsonify(error="Invalid message."), 400

    if len(message) > 5000:
        return jsonify(error="Message is too long."), 400

    try:

        extracted = extract_memory_candidates(message)
        proposals = clean_proposals(extracted)

        for proposal in proposals:
            pending_proposals[proposal["id"]] = proposal

        public_proposals = [
            {
                key: value
                for key, value in proposal.items()
                if key != "id"
            } | {"id": proposal["id"]}
            for proposal in proposals
        ]

        return jsonify(proposals=public_proposals)

    except Exception:

        app.logger.exception("Memory extraction failed")

        return jsonify(
            error="Memory extraction failed."
        ), 502


# ==========================================
# APPROVE MEMORY
# ==========================================

@app.post("/memory/approve")
def approve_memory():

    data = request.get_json(silent=True) or {}
    proposal_id = data.get("proposal_id")

    if not isinstance(proposal_id, str):
        return jsonify(error="Invalid proposal ID."), 400

    proposal = pending_proposals.pop(proposal_id, None)

    if not proposal:
        return jsonify(
            error="Proposal not found or expired."
        ), 404

    if proposal["type"] == "profile":

        success = update_profile(
            proposal["key"],
            proposal["value"],
        )

    else:

        success = add_memory(
            proposal["content"],
            proposal["category"],
        )

    if not success:

        return jsonify(
            success=False,
            message="This information may already be saved.",
        )

    return jsonify(
        success=True,
        message="Memory saved.",
    )


# ==========================================
# REJECT MEMORY
# ==========================================

@app.post("/memory/reject")
def reject_memory():

    data = request.get_json(silent=True) or {}
    proposal_id = data.get("proposal_id")

    if not isinstance(proposal_id, str):
        return jsonify(error="Invalid proposal ID."), 400

    proposal = pending_proposals.pop(proposal_id, None)

    if not proposal:
        return jsonify(
            error="Proposal not found or expired."
        ), 404

    return jsonify(
        success=True,
        message="Proposal rejected.",
    )


# ==========================================
# VIEW ALL MEMORIES
# ==========================================

@app.get("/memory/list")
def list_memories():

    data = get_all_memories()

    return jsonify(
        success=True,
        user_profile=data.get("user_profile", {}),
        profile_meta=data.get("profile_meta", {}),
        memories=data.get("memories", []),
        last_updated=data.get("last_updated"),
    )


# ==========================================
# EDIT MEMORY OR PROFILE
# ==========================================

@app.post("/memory/edit")
def edit_saved_memory():

    data = request.get_json(silent=True) or {}
    target = data.get("target")

    if target == "memory":

        old_content = data.get("old_content")
        new_content = data.get("new_content")

        if (
            not isinstance(old_content, str)
            or not isinstance(new_content, str)
        ):
            return jsonify(
                error="Invalid memory content."
            ), 400

        success = edit_memory(
            old_content,
            new_content,
        )

    elif target == "profile":

        key = data.get("key")
        value = data.get("value")

        if not isinstance(key, str) or not isinstance(value, str):
            return jsonify(
                error="Invalid profile information."
            ), 400

        if not key.strip() or not value.strip():
            return jsonify(
                error="Profile key and value cannot be empty."
            ), 400

        success = update_profile(
            key.strip(),
            value.strip(),
        )

    else:

        return jsonify(
            error="Unknown memory target."
        ), 400

    if not success:

        return jsonify(
            error="Memory not found or update failed."
        ), 404

    return jsonify(
        success=True,
        message="Memory updated.",
    )


# ==========================================
# DELETE MEMORY OR PROFILE
# ==========================================

@app.post("/memory/delete")
def delete_saved_memory():

    data = request.get_json(silent=True) or {}
    target = data.get("target")

    if target == "memory":

        content = data.get("content")

        if not isinstance(content, str) or not content.strip():
            return jsonify(
                error="Invalid memory content."
            ), 400

        success = delete_memory(content)

    elif target == "profile":

        key = data.get("key")

        if not isinstance(key, str) or not key.strip():
            return jsonify(
                error="Invalid profile key."
            ), 400

        success = delete_profile(key.strip())

    else:

        return jsonify(
            error="Unknown memory target."
        ), 400

    if not success:

        return jsonify(
            error="Memory not found."
        ), 404

    return jsonify(
        success=True,
        message="Memory deleted.",
    )


# ==========================================
# START SERVER
# ==========================================

if __name__ == "__main__":

    print("SAM v0.3 Beta is starting...")

    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", 5000)),
        debug=False,
        threaded=True,
    )

