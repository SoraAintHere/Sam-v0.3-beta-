
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  let current = null;
  let container = null;
  let onBack = null;
  let saveTimer = null;

  const accents = {
    violet: ["#7766d6", "#a083d8"],
    blue: ["#477ed8", "#75a8ed"],
    teal: ["#299b91", "#65c9b4"],
    amber: ["#c18b35", "#e6b45e"]
  };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  function applyAppearance(settings) {
    const appearance = settings.appearance || {};
    const theme = appearance.theme === "light" ? "light" : "dark";
    const accent = accents[appearance.accent] ? appearance.accent : "violet";

    document.documentElement.dataset.theme = theme;

    const [primary, secondary] = accents[accent];
    document.documentElement.style.setProperty("--p1", primary);
    document.documentElement.style.setProperty("--p2", secondary);
    document.documentElement.style.setProperty(
      "--grad",
      `linear-gradient(135deg,${primary},${secondary})`
    );
  }

  async function save(section, key, value) {
    const patch = {
      [section]: { [key]: value }
    };

    try {
      const result = await api("/settings", {
        method: "POST",
        body: JSON.stringify(patch)
      });

      current = result.settings;
      applyAppearance(current);

      const status = $("#settingsStatus", container);
      if (status) {
        status.textContent = "Saved";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          status.textContent = "";
        }, 1600);
      }

      return true;
    } catch (error) {
      alert(`Couldn't save settings: ${error.message}`);
      return false;
    }
  }

  function field(label, description, control) {
    const wrapper = document.createElement("div");
    wrapper.className = "setting-row";

    const info = document.createElement("div");
    info.className = "setting-info";

    const title = document.createElement("strong");
    title.textContent = label;

    const detail = document.createElement("p");
    detail.textContent = description;

    info.append(title, detail);
    wrapper.append(info, control);

    return wrapper;
  }

  function selectControl(options, selected, callback) {
    const select = document.createElement("select");
    select.className = "setting-select";

    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });

    select.value = selected;
    select.onchange = () => callback(select.value);

    return select;
  }

  function toggleControl(checked, callback) {
    const label = document.createElement("label");
    label.className = "setting-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;

    const track = document.createElement("span");
    track.className = "toggle-track";

    input.onchange = () => callback(input.checked);

    label.append(input, track);
    return label;
  }

  function textControl(value, placeholder, callback, multiline = false) {
    const input = document.createElement(multiline ? "textarea" : "input");

    if (!multiline) input.type = "text";

    input.className = "setting-input";
    input.value = value || "";
    input.placeholder = placeholder;

    if (multiline) {
      input.rows = 4;
      input.maxLength = 2000;
    } else {
      input.maxLength = 40;
    }

    let timer;

    input.addEventListener("change", () => callback(input.value));

    if (multiline) {
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => callback(input.value), 700);
      });
    }

    return input;
  }

  function rangeControl(value, min, max, step, callback, suffix = "") {
    const wrapper = document.createElement("div");
    wrapper.className = "setting-range";

    const output = document.createElement("span");
    output.textContent = `${value}${suffix}`;

    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;

    input.oninput = () => {
      output.textContent = `${input.value}${suffix}`;
    };

    input.onchange = () => callback(Number(input.value));

    wrapper.append(input, output);
    return wrapper;
  }

  function section(title, description) {
    const block = document.createElement("section");
    block.className = "settings-section";

    const heading = document.createElement("div");
    heading.className = "settings-section-heading";

    const h = document.createElement("h2");
    h.textContent = title;

    const p = document.createElement("p");
    p.textContent = description;

    heading.append(h, p);
    block.append(heading);

    return block;
  }

  function addRow(parent, label, description, control) {
    parent.append(field(label, description, control));
  }

  function render(settings) {
    current = settings;
    container.innerHTML = "";

    applyAppearance(settings);

    const page = document.createElement("div");
    page.className = "settings-page";

    const bar = document.createElement("div");
    bar.className = "memory-bar";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "icon-btn outlined";
    back.setAttribute("aria-label", "Back to chat");
    back.textContent = "←";
    back.onclick = () => onBack?.();

    const status = document.createElement("span");
    status.id = "settingsStatus";
    status.className = "settings-status";

    bar.append(back, status);

    const heading = document.createElement("div");
    heading.className = "memory-heading";
    heading.innerHTML = "<h1>Settings</h1><p>Customize how Sam looks and responds.</p>";

    page.append(bar, heading);

    // Appearance
    const appearance = section("Appearance", "Change the look of your workspace.");

    addRow(
      appearance,
      "Theme",
      "Choose your preferred interface theme.",
      selectControl(
        [["dark", "Dark"], ["light", "Light"]],
        settings.appearance.theme,
        value => save("appearance", "theme", value)
      )
    );

    addRow(
      appearance,
      "Accent color",
      "Choose the color used for highlights and buttons.",
      selectControl(
        [["violet", "Violet"], ["blue", "Blue"], ["teal", "Teal"], ["amber", "Amber"]],
        settings.appearance.accent,
        value => save("appearance", "accent", value)
      )
    );

    // Personalization
    const personal = section("Personalization", "Give Sam a name and define how it communicates.");

    addRow(
      personal,
      "Sam's name",
      "The display name used in the interface.",
      textControl(
        settings.personalization.assistant_name,
        "Sam",
        value => save("personalization", "assistant_name", value.trim())
      )
    );

    addRow(
      personal,
      "Your name",
      "How Sam addresses you. Leave your current name if you prefer.",
      textControl(
        settings.personalization.user_name,
        "Your name",
        value => save("personalization", "user_name", value.trim())
      )
    );

    addRow(
      personal,
      "Response style",
      "Choose the default level of detail.",
      selectControl(
        [
          ["concise", "Concise"],
          ["balanced", "Balanced"],
          ["detailed", "Detailed"]
        ],
        settings.personalization.response_style,
        value => save("personalization", "response_style", value)
      )
    );

    const custom = textControl(
      settings.personalization.custom_instructions,
      "Example: Explain technical topics with simple examples.",
      value => save("personalization", "custom_instructions", value),
      true
    );

    addRow(
      personal,
      "Custom instructions",
      "Extra guidance Sam should follow in conversations.",
      custom
    );

    // Memory
    const memory = section("Memory", "Control automatic memory suggestions.");

    addRow(
      memory,
      "Automatic memory detection",
      "Allow Sam to suggest information that may be useful to remember.",
      toggleControl(
        settings.memory.auto_detect,
        value => save("memory", "auto_detect", value)
      )
    );

    const memoryButton = document.createElement("button");
    memoryButton.type = "button";
    memoryButton.className = "setting-action";
    memoryButton.textContent = "Open Memory Manager";
    memoryButton.onclick = () => {
      document.querySelector("#openMemory")?.click();
    };

    addRow(
      memory,
      "Saved information",
      "Review, edit, or delete information Sam has saved.",
      memoryButton
    );

    // AI configuration
    const ai = section("AI Configuration", "Current engine and response generation.");

    const provider = document.createElement("div");
    provider.className = "setting-readonly";
    provider.textContent = "Google Gemini";

    addRow(ai, "Provider", "The AI service currently powering Sam.", provider);

    const model = document.createElement("div");
    model.className = "setting-readonly";
    model.textContent = settings.model || "Configured in .env";

    addRow(ai, "Model", "The model configured on the backend.", model);

    addRow(
      ai,
      "Temperature",
      "Lower values are more predictable; higher values are more varied.",
      rangeControl(
        settings.generation.temperature,
        0,
        1.5,
        0.1,
        value => save("generation", "temperature", value)
      )
    );

    addRow(
      ai,
      "Maximum output tokens",
      "The maximum length of a generated response.",
      selectControl(
        [["256", "256 tokens"], ["512", "512 tokens"], ["1024", "1024 tokens"], ["1536", "1536 tokens"], ["2048", "2048 tokens"]],
        String(settings.generation.max_output_tokens),
        value => save("generation", "max_output_tokens", Number(value))
      )
    );

    // About
    const about = section("About Sam", "Information about this build.");

    const version = document.createElement("div");
    version.className = "setting-readonly";
    version.textContent = "v0.3 beta";

    addRow(about, "Version", "Current project version.", version);

    const creator = document.createElement("div");
    creator.className = "setting-readonly";
    creator.textContent = "CJ";

    addRow(about, "Creator", "The person behind this project.", creator);

    page.append(appearance, personal, memory, ai, about);
    container.append(page);
  }

  async function mount(target, options = {}) {
    container = target;
    onBack = options.onBack;

    container.innerHTML = `
      <div class="settings-loading">Loading settings…</div>
    `;

    try {
      const result = await api("/settings");
      render(result.settings);
    } catch (error) {
      container.innerHTML = "";
      const message = document.createElement("p");
      message.className = "settings-error";
      message.textContent = `Couldn't load settings: ${error.message}`;
      container.append(message);
    }
  }

  window.SamSettings = {
    mount,
    applyAppearance
  };
})();
