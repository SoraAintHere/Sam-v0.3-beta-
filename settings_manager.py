
import json
import os
import tempfile
import threading
from copy import deepcopy
from pathlib import Path

BASE = Path(__file__).resolve().parent
SETTINGS_FILE = BASE / "settings.json"

LOCK = threading.RLock()

DEFAULTS = {
    "appearance": {
        "theme": "dark",
        "accent": "violet"
    },
    "personalization": {
        "assistant_name": "Sam",
        "user_name": "",
        "response_style": "balanced",
        "custom_instructions": ""
    },
    "memory": {
        "auto_detect": True
    },
    "generation": {
        "temperature": 0.7,
        "max_output_tokens": 1024
    }
}


def _merge_defaults(saved):
    result = deepcopy(DEFAULTS)

    if not isinstance(saved, dict):
        return result

    for section, values in DEFAULTS.items():
        incoming = saved.get(section)

        if isinstance(incoming, dict):
            for key in values:
                if key in incoming:
                    result[section][key] = incoming[key]

    return result


def _validate(data):
    if not isinstance(data, dict):
        raise ValueError("Settings must be an object.")

    result = {}

    appearance = data.get("appearance", {})
    if isinstance(appearance, dict):
        theme = appearance.get("theme")
        accent = appearance.get("accent")

        if theme in ("dark", "light"):
            result.setdefault("appearance", {})["theme"] = theme

        if accent in ("violet", "blue", "teal", "amber"):
            result.setdefault("appearance", {})["accent"] = accent

    personal = data.get("personalization", {})
    if isinstance(personal, dict):
        fields = {
            "assistant_name": 40,
            "user_name": 40,
            "custom_instructions": 2000
        }

        for key, limit in fields.items():
            value = personal.get(key)

            if isinstance(value, str):
                value = value.strip()

                if len(value) > limit:
                    raise ValueError(f"{key} is too long.")

                if key == "assistant_name" and not value:
                    raise ValueError(f"{key} cannot be empty.")

                result.setdefault("personalization", {})[key] = value

        style = personal.get("response_style")
        if style in ("concise", "balanced", "detailed"):
            result.setdefault("personalization", {})[
                "response_style"
            ] = style

    memory = data.get("memory", {})
    if isinstance(memory, dict):
        auto_detect = memory.get("auto_detect")

        if isinstance(auto_detect, bool):
            result.setdefault("memory", {})[
                "auto_detect"
            ] = auto_detect

    generation = data.get("generation", {})
    if isinstance(generation, dict):
        temperature = generation.get("temperature")

        if isinstance(temperature, (int, float)) and not isinstance(temperature, bool):
            if 0 <= temperature <= 1.5:
                result.setdefault("generation", {})[
                    "temperature"
                ] = round(float(temperature), 2)
            else:
                raise ValueError("Temperature must be between 0 and 1.5.")

        max_tokens = generation.get("max_output_tokens")

        if isinstance(max_tokens, int) and not isinstance(max_tokens, bool):
            if 256 <= max_tokens <= 2048:
                result.setdefault("generation", {})[
                    "max_output_tokens"
                ] = max_tokens
            else:
                raise ValueError("Output length must be between 256 and 2048.")

    return result


def load_settings():
    with LOCK:
        try:
            with SETTINGS_FILE.open("r", encoding="utf-8") as file:
                saved = json.load(file)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            saved = {}

        settings = _merge_defaults(saved)

        # Keep a usable settings file even on first launch.
        _save_unlocked(settings)

        return deepcopy(settings)


def _save_unlocked(settings):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(
        prefix="settings_",
        suffix=".tmp",
        dir=str(SETTINGS_FILE.parent)
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(settings, file, indent=4, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, SETTINGS_FILE)

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def update_settings(changes):
    if not isinstance(changes, dict):
        raise ValueError("Invalid settings data.")

    clean = _validate(changes)

    with LOCK:
        current = _merge_defaults(load_settings())

        for section, values in clean.items():
            current[section].update(values)

        _save_unlocked(current)
        return deepcopy(current)


def reset_settings():
    with LOCK:
        settings = deepcopy(DEFAULTS)
        _save_unlocked(settings)
        return settings

