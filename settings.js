(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  let current = null;
  let container = null;
  let onBack = null;
  let toastEl = null;
  let toastTimer = null;

  const accents = {
    violet: ["#7766d6", "#a083d8", "Violet"],
    blue: ["#477ed8", "#75a8ed", "Blue"],
    teal: ["#299b91", "#65c9b4", "Teal"],
    amber: ["#c18b35", "#e6b45e", "Amber"]
  };

  const STYLES = {
    concise: ["Concise", "Short, direct answers."],
    balanced: ["Balanced", "Clear, with useful examples."],
    detailed: ["Detailed", "Thorough, in-depth answers."]
  };

  const svg = d =>
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const ICON = {
    back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    appearance: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    memory: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
    cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/>')
  };

  /* ---------- helpers ---------- */

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

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

  function toast(message, kind = "ok") {
    if (!toastEl) {
      toastEl = h("div", "toast");
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.append(toastEl);
    }
    toastEl.className = `toast ${kind}`;
    toastEl.textContent = message;
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.classList.remove("show"), 1800);
  }

  function applyAppearance(settings) {
    const appearance = settings.appearance || {};
    const theme = appearance.theme === "light" ? "light" : "dark";
    const accent = accents[appearance.accent] ? appearance.accent : "violet";
    const root = document.documentElement;

    root.dataset.theme = theme;

    const [primary, secondary] = accents[accent];
    root.style.setProperty("--p1", primary);
    root.style.setProperty("--p2", secondary);
    root.style.setProperty("--grad", `linear-gradient(135deg,${primary},${secondary})`);
  }

  function syncNames() {
    const name = current?.personalization?.assistant_name;
    if (!name) return;
    const brand = $(".brand");
    if (brand) brand.textContent = name;
    const title = $(".title");
    if (title && title.firstChild) title.firstChild.textContent = name + " ";
  }

  function rerender() {
    const scroller = $("#scroller");
    const top = scroller ? scroller.scrollTop : 0;
    render(current);
    if (scroller) scroller.scrollTop = top;
  }

  async function save(section, key, value) {
    try {
      const result = await api("/settings", {
        method: "POST",
        body: JSON.stringify({ [section]: { [key]: value } })
      });
      current = result.settings;
      applyAppearance(current);
      syncNames();
      toast("Saved");
      return true;
    } catch (error) {
      toast(error.message, "err");
      rerender(); // revert controls to the last saved state
      return false;
    }
  }

  /* ---------- layout pieces ---------- */

  function section(icon, title, description) {
    const block = h("section", "settings-section");
    const head = h("div", "section-head");
    const ic = h("span", "section-icon");
    ic.innerHTML = icon;
    const text = h("div");
    text.append(h("h2", "", title), h("p", "", description));
    head.append(ic, text);
    block.append(head);
    return block;
  }

  function row(parent, label, description, control, stack = false) {
    const wrap = h("div", "setting-row" + (stack ? " stack" : ""));
    const info = h("div", "setting-info");
    info.append(h("strong", "", label));
    if (description) info.append(h("p", "", description));
    wrap.append(info);
    if (control) wrap.append(control);
    parent.append(wrap);
    return { wrap, info };
  }

  /* ---------- controls ---------- */

  // Radio-style group helper (keyboard: arrows move selection).
  function radioGroup(group, items, selected, onChange) {
    group.setAttribute("role", "radiogroup");
    const buttons = [];

    const select = (value, fire) => {
      buttons.forEach(([b, v]) => {
        const on = v === value;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (fire) onChange(value);
    };

    items.forEach(([value, button]) => {
      button.type = "button";
      button.setAttribute("role", "radio");
      button.onclick = () => select(value, true);
      button.onkeydown = e => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!keys[e.key]) return;
        e.preventDefault();
        const i = buttons.findIndex(([b]) => b === button);
        const [nextBtn, nextVal] = buttons[(i + keys[e.key] + buttons.length) % buttons.length];
        select(nextVal, true);
        nextBtn.focus();
      };
      buttons.push([button, value]);
      group.append(button);
    });

    select(selected, false);
    return group;
  }

  function segmented(options, selected, onChange, full = false) {
    const group = h("div", "seg" + (full ? " full" : ""));
    const items = options.map(([value, label]) => [value, h("button", "", label)]);
    return radioGroup(group, items, selected, onChange);
  }

  function cardChoice(options, selected, onChange) {
    const group = h("div", "choice-grid");
    const items = options.map(([value, label, desc, preview]) => {
      const b = h("button", "choice");
      if (preview) b.append(preview);
      b.append(h("strong", "", label));
      if (desc) b.append(h("span", "d", desc));
      b.append(h("span", "tick"));
      return [value, b];
    });
    return radioGroup(group, items, selected, onChange);
  }

  function themePreview(kind) {
    const p = h("div", "theme-prev " + kind);
    p.append(h("i"), h("i"), h("i"));
    return p;
  }

  function swatches(selected, onChange) {
    const group = h("div", "swatches");
    const items = Object.entries(accents).map(([key, [a, b, label]]) => {
      const btn = h("button", "swatch");
      btn.setAttribute("aria-label", label);
      const dot = h("b");
      dot.style.background = `linear-gradient(135deg,${a},${b})`;
      btn.append(dot, h("span", "", label));
      return [key, btn];
    });
    return radioGroup(group, items, selected, onChange);
  }

  function toggle(checked, label, onChange) {
    const sw = h("button", "switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-label", label);
    sw.setAttribute("aria-checked", String(checked));
    sw.onclick = () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      onChange(next);
    };
    return sw;
  }

  function textField(value, placeholder, onCommit) {
    const wrap = h("div", "field");
    const input = h("input", "setting-input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder;
    input.maxLength = 40;
    input.autocomplete = "off";

    let last = input.value;
    const commit = () => {
      const v = input.value.trim();
      input.value = v;
      if (v === last) return;
      last = v;
      onCommit(v);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });

    wrap.append(input);
    return wrap;
  }

  function textArea(value, placeholder, limit, onCommit) {
    const wrap = h("div", "area-wrap");
    const area = h("textarea", "setting-textarea");
    area.value = value || "";
    area.placeholder = placeholder;
    area.maxLength = limit;
    area.rows = 4;

    const counter = h("div", "counter");
    const update = () => { counter.textContent = `${area.value.length} / ${limit}`; };
    update();

    let last = area.value;
    let timer;
    const commit = () => {
      clearTimeout(timer);
      if (area.value === last) return;
      last = area.value;
      onCommit(area.value);
    };

    area.addEventListener("input", () => {
      update();
      clearTimeout(timer);
      timer = setTimeout(commit, 900);
    });
    area.addEventListener("blur", commit);

    wrap.append(area, counter);
    return wrap;
  }

  function slider(value, onCommit) {
    const min = 0, max = 1.5, step = 0.1;
    const wrap = h("div", "slider-wrap");

    const top = h("div", "slider-top");
    const left = h("div");
    const val = h("span", "slider-val");
    const tag = h("span", "slider-tag");
    left.append(val, tag);
    top.append(left);

    const input = h("input", "slider");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.setAttribute("aria-label", "Temperature");

    const paint = () => {
      const v = Number(input.value);
      val.textContent = v.toFixed(1);
      tag.textContent = v < 0.4 ? "Precise" : v <= 0.9 ? "Balanced" : "Creative";
      input.style.setProperty("--fill", ((v - min) / (max - min)) * 100 + "%");
    };
    paint();

    input.addEventListener("input", paint);
    input.addEventListener("change", () => onCommit(Number(input.value)));

    const ends = h("div", "slider-ends");
    ends.append(h("span", "", "More predictable"), h("span", "", "More varied"));

    wrap.append(top, input, ends);
    return wrap;
  }

  function button(label, cls = "", icon = "") {
    const b = h("button", "btn " + cls);
    b.type = "button";
    if (icon) b.insertAdjacentHTML("beforeend", icon);
    b.append(h("span", "", label));
    return b;
  }

  function chip(text, mono = false) {
    return h("div", "chip-ro" + (mono ? " mono" : ""), text);
  }

  /* ---------- actions ---------- */

  async function testConnection(btn, out) {
    btn.disabled = true;
    out.className = "conn-result";
    out.textContent = "Testing…";
    try {
      const response = await fetch("/connection/test", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      const ok = response.ok && data.success;
      out.className = "conn-result " + (ok ? "ok" : "err");
      out.textContent = data.message || (ok ? "Connected." : "Connection failed.");
    } catch {
      out.className = "conn-result err";
      out.textContent = "Couldn't reach the server.";
    } finally {
      btn.disabled = false;
    }
  }

  function armedReset(btn) {
    let armed = false;
    let timer;
    const label = btn.querySelector("span");

    const disarm = () => {
      armed = false;
      btn.classList.remove("armed");
      label.textContent = "Reset all settings";
    };

    btn.onclick = async () => {
      if (!armed) {
        armed = true;
        btn.classList.add("armed");
        label.textContent = "Tap again to confirm";
        clearTimeout(timer);
        timer = setTimeout(disarm, 3500);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      try {
        const result = await api("/settings/reset", { method: "POST" });
        current = result.settings;
        applyAppearance(current);
        syncNames();
        rerender();
        toast("Settings reset");
      } catch (error) {
        toast(error.message, "err");
        btn.disabled = false;
        disarm();
      }
    };
  }

  /* ---------- page ---------- */

  function render(settings) {
    current = settings;
    container.innerHTML = "";
    applyAppearance(settings);

    const page = h("div", "settings-page");

    // header
    const head = h("div", "settings-head");
    const back = h("button", "icon-btn outlined");
    back.type = "button";
    back.setAttribute("aria-label", "Back to chat");
    back.innerHTML = ICON.back;
    back.onclick = () => onBack?.();
    const heading = h("div");
    heading.append(h("h1", "", "Settings"), h("p", "", "Changes save automatically."));
    head.append(back, heading);
    page.append(head);

    // Appearance
    const appearance = section(ICON.appearance, "Appearance", "Make Sam look the way you like.");
    row(appearance, "Theme", "", cardChoice(
      [
        ["dark", "Dark", "Easy on the eyes", themePreview("dark")],
        ["light", "Light", "Bright and clean", themePreview("light")]
      ],
      settings.appearance.theme,
      value => {
        applyAppearance({ appearance: { ...current.appearance, theme: value } });
        save("appearance", "theme", value);
      }
    ), true);
    row(appearance, "Accent color", "Used for buttons and highlights.", swatches(
      settings.appearance.accent,
      value => {
        applyAppearance({ appearance: { ...current.appearance, accent: value } });
        save("appearance", "accent", value);
      }
    ), true);

    // Personalization
    const personal = section(ICON.person, "Personalization", "Names and how Sam talks to you.");
    row(personal, "Sam's name", "Shown in the sidebar and header.",
      textField(settings.personalization.assistant_name, "Sam", value => {
        if (!value) { toast("Name can't be empty", "err"); rerender(); return; }
        save("personalization", "assistant_name", value);
      }));
    row(personal, "Your name", "How Sam greets you.",
      textField(settings.personalization.user_name, "Your name",
        value => save("personalization", "user_name", value)));
    row(personal, "Response style", "Default level of detail.", cardChoice(
      Object.entries(STYLES).map(([k, [label, desc]]) => [k, label, desc]),
      settings.personalization.response_style,
      value => save("personalization", "response_style", value)
    ), true);
    row(personal, "Custom instructions", "Extra guidance Sam should always follow.",
      textArea(
        settings.personalization.custom_instructions,
        "Example: Explain technical topics with simple examples.",
        2000,
        value => save("personalization", "custom_instructions", value)
      ), true);

    // Memory
    const memory = section(ICON.memory, "Memory", "Control what Sam can remember.");
    row(memory, "Automatic memory detection",
      "Sam suggests things worth remembering. You approve each one.",
      toggle(settings.memory.auto_detect, "Automatic memory detection",
        value => save("memory", "auto_detect", value)));
    const mem = button("Open", "", ICON.memory);
    mem.onclick = () => document.querySelector("#openMemory")?.click();
    row(memory, "Saved information", "Review, edit, or delete what Sam has saved.", mem);

    // AI configuration
    const ai = section(ICON.cpu, "AI Configuration", "Engine and response generation.");
    row(ai, "Provider", "The service powering Sam.", chip("Google Gemini"));
    row(ai, "Model", "Configured on the backend.", chip(settings.model || "Set in .env", true));

    const test = button("Test");
    const result = h("div", "conn-result");
    const connRow = row(ai, "Connection", "Check that Sam can reach Gemini.", test);
    connRow.info.append(result);
    test.onclick = () => testConnection(test, result);

    row(ai, "Temperature", "Lower is more predictable, higher is more creative.",
      slider(settings.generation.temperature,
        value => save("generation", "temperature", value)), true);

    const tokenOptions = [[256, "256"], [512, "512"], [1024, "1K"], [1536, "1.5K"], [2048, "2K"]];
    row(ai, "Maximum response length", "Longest reply Sam can generate, in tokens.",
      segmented(
        tokenOptions.map(([v, l]) => [String(v), l]),
        String(settings.generation.max_output_tokens),
        value => save("generation", "max_output_tokens", Number(value)),
        true
      ), true);

    // About
    const about = section(ICON.info, "About Sam", "Information about this build.");
    const hero = h("div", "about-hero");
    const logo = h("div", "about-logo", "S");
    const meta = h("div");
    const nameLine = h("div", "about-name");
    nameLine.append(h("strong", "", settings.personalization.assistant_name || "Sam"),
      h("span", "badge", "v0.3 beta"));
    meta.append(nameLine, h("p", "", "A personal AI assistant, built from scratch."));
    hero.append(logo, meta);
    about.append(hero);

    row(about, "Creator", "", chip("CJ"));
    row(about, "Engine", "", chip("Google Gemini"));
    row(about, "Memory", "", chip("Local, approval-based"));

    // Reset
    const reset = button("Reset all settings", "danger", ICON.reset);
    armedReset(reset);
    row(about, "Reset", "Restore every setting to its default. Memories are kept.", reset);

    page.append(appearance, personal, memory, ai, about);
    container.append(page);
  }

  async function mount(target, options = {}) {
    container = target;
    onBack = options.onBack;
    container.innerHTML = '<div class="settings-loading">Loading settings…</div>';

    try {
      const result = await api("/settings");
      render(result.settings);
    } catch (error) {
      container.innerHTML = "";
      container.append(h("p", "settings-error", `Couldn't load settings: ${error.message}`));
    }
  }

  window.SamSettings = { mount, applyAppearance };
})();

