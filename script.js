
const $ = s => document.querySelector(s);
const thread = $("#thread"), scroller = $("#scroller"), input = $("#input"),
      sendBtn = $("#send"), list = $("#chatList"), dock = $("#dock");

const SUGGESTIONS = [
  "Explain OOP simply",
  "Plan my day",
  "Help me debug code",
  "Tell me a fun fact"
];

let chats = [];
try {
  chats = JSON.parse(localStorage.getItem("sam.chats") || "[]");
  if (!Array.isArray(chats)) chats = [];
} catch {}

let active = null, busy = false, userName = "there", viewMode = "chat";
let abortCtl = null, menuEl = null, menuFor = null;

const save = () => localStorage.setItem("sam.chats", JSON.stringify(chats));
const cur = () => chats.find(c => c.id === active);
const down = () => scroller.scrollTo({top: scroller.scrollHeight, behavior: "auto"});
const isMobile = () => matchMedia("(max-width:860px)").matches;

function setView(mode) {
  viewMode = mode;
  $("#openMemory").classList.toggle("active", mode === "memory");
  $("#openSettings").classList.toggle("active", mode === "settings");
  dock.hidden = mode !== "chat";
  document.body.classList.remove("open");
}

/* ---------- Markdown renderer ---------- */

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

function md(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out = [];
  let para = [], listTag = null, i = 0;

  const flush = () => {
    if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
    para = [];
  };
  const close = () => {
    if (listTag) out.push(`</${listTag}>`);
    listTag = null;
  };
  const open = tag => {
    if (listTag !== tag) {
      close();
      out.push(`<${tag}>`);
      listTag = tag;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (/^```/.test(line)) {
      flush(); close();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) {
      flush(); close(); out.push(`<h3>${inline(m[1])}</h3>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush(); close(); out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      flush(); open("ul"); out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flush(); open("ol"); out.push(`<li>${inline(m[1])}</li>`);
    } else if (!line.trim()) {
      flush(); close();
    } else {
      close(); para.push(line.trim());
    }
    i++;
  }
  flush(); close();
  return out.join("");
}

/* ---------- Chat rendering ---------- */

function addMsg(role, text = "") {
  const m = document.createElement("div");
  m.className = "msg " + role;
  m.innerHTML = (role === "assistant" ? '<div class="av">S</div>' : "") + '<div class="body"></div>';
  const b = m.querySelector(".body");
  if (role === "user") b.textContent = text;
  else b.innerHTML = md(text);
  thread.append(m);
  down();
  return {m, b};
}

function addActions(m, text) {
  const a = document.createElement("div");
  a.className = "actions";
  a.innerHTML = '<button type="button">Copy</button>';
  a.firstChild.onclick = async e => {
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "Copied";
    } catch {
      e.target.textContent = "Copy failed";
    }
    setTimeout(() => e.target.textContent = "Copy", 1200);
  };
  m.querySelector(".body").after(a);
}

function typing() {
  const m = document.createElement("div");
  m.className = "msg assistant";
  m.innerHTML = '<div class="av">S</div><div class="body"><span class="typing"><i></i><i></i><i></i></span></div>';
  thread.append(m);
  down();
  return m;
}

function showWelcome() {
  setView("chat");
  thread.innerHTML = `
    <div class="welcome">
      <h1>Hello, ${esc(userName)}.</h1>
      <p>How can I help?</p>
      <div class="chips"></div>
    </div>`;
  const box = thread.querySelector(".chips");
  SUGGESTIONS.forEach(s => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = s;
    b.onclick = () => send(s);
    box.append(b);
  });
}

/* ---------- Chat list: pin, rename, delete ---------- */

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  menuFor = null;
  list.querySelectorAll(".menu-open").forEach(r => r.classList.remove("menu-open"));
}

function openMenu(btn, c) {
  closeMenu();
  menuFor = c.id;
  btn.closest(".chat-item")?.classList.add("menu-open");

  const menu = document.createElement("div");
  menu.className = "chat-menu";
  menu.setAttribute("role", "menu");

  const entries = [
    [c.pinned ? "Unpin" : "Pin", ICONS.pin, "", () => {
      c.pinned = !c.pinned;
      save();
      renderList();
    }],
    ["Rename", ICONS.edit, "", () => startRename(c.id)],
    ["Delete", ICONS.trash, "danger", () => deleteChat(c)]
  ];

  entries.forEach(([label, icon, cls, action]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (cls) b.className = cls;
    b.innerHTML = `${icon}<span>${label}</span>`;
    b.onclick = () => {
      closeMenu();
      action();
    };
    menu.append(b);
  });

  document.body.append(menu);

  const r = btn.getBoundingClientRect();
  const w = 164, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  let top = r.bottom + 4;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menuEl = menu;
}

function startRename(id) {
  const c = chats.find(x => x.id === id);
  const row = list.querySelector(`[data-id="${id}"]`);
  if (!c || !row) return;

  const field = document.createElement("input");
  field.className = "rename";
  field.type = "text";
  field.value = c.title;
  field.maxLength = 60;
  field.setAttribute("aria-label", "Rename chat");

  row.querySelector(".t").replaceWith(field);
  row.querySelector(".dots").hidden = true;
  field.focus();
  field.select();

  let finished = false;
  const finish = commit => {
    if (finished) return;
    finished = true;
    const value = field.value.trim();
    if (commit && value && value !== c.title) {
      c.title = value;
      save();
    }
    renderList();
  };

  field.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  field.onblur = () => finish(true);
}

function deleteChat(c) {
  if (busy && c.id === active) {
    alert("Stop the current reply before deleting this chat.");
    return;
  }
  if (!confirm("Delete this conversation?")) return;
  chats = chats.filter(x => x.id !== c.id);
  save();
  if (active === c.id) newChat();
  else renderList();
}

document.addEventListener("pointerdown", e => {
  if (menuEl && !menuEl.contains(e.target) && !e.target.closest(".dots")) closeMenu();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeMenu();
});
list.addEventListener("scroll", closeMenu);
addEventListener("resize", closeMenu);

function renderList() {
  closeMenu();
  list.innerHTML = "";

  const ordered = [...chats].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  ordered.forEach(c => {
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id === active && viewMode === "chat" ? " on" : "");
    row.dataset.id = c.id;
    row.innerHTML =
      (c.pinned ? `<span class="pin" aria-hidden="true">${ICONS.pin}</span>` : "") +
      '<button class="t" type="button"></button>' +
      `<button class="dots" type="button" aria-label="Chat options" aria-haspopup="menu">${ICONS.dots}</button>`;

    const title = row.querySelector(".t");
    title.textContent = c.title;
    title.onclick = () => openChat(c.id);

    const dots = row.querySelector(".dots");
    dots.onclick = e => {
      e.stopPropagation();
      if (menuEl && menuFor === c.id) closeMenu();
      else openMenu(dots, c);
    };

    list.append(row);
  });
}

function openChat(id) {
  if (busy) return;
  const chat = chats.find(c => c.id === id);
  if (!chat) return;
  active = id;
  setView("chat");
  thread.innerHTML = "";
  chat.messages.forEach(message => {
    const {m} = addMsg(message.role, message.content);
    if (message.role === "assistant") addActions(m, message.content);
  });
  renderList();
  down();
  document.body.classList.remove("open");
}

function newChat() {
  if (busy) return;
  active = null;
  showWelcome();
  renderList();
  document.body.classList.remove("open");
  input.focus();
}

/* ---------- Small UI helpers ---------- */

async function apiJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {"Content-Type": "application/json", ...(options.headers || {})},
    ...options
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

/* ---------- Memory manager ---------- */

const svg = (d, size = 18, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS = {
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>', 20),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>', 20),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 15),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 15),
  spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>', 18),
  check: svg('<path d="M20 6L9 17l-5-5"/>', 14, 2.4),
  pin: svg('<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>', 14),
  dots: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>', 18)
};

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const humanize = key => cap(String(key).replace(/[_-]+/g, " ").trim());

function tidyMemory(text) {
  const t = String(text).trim()
    .replace(/^the user\s+(is\s+)?/i, "")
    .replace(/\.+$/, "");
  return cap(t);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const time = d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  const opts = {month: "short", day: "numeric"};
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString([], opts)}, ${time}`;
}

async function openMemoryManager() {
  if (busy) return;
  setView("memory");
  renderList();
  thread.innerHTML = `
    <div class="memory-page">
      <div class="memory-bar">
        <button class="icon-btn outlined" id="backToChat" type="button" aria-label="Back to chat">${ICONS.back}</button>
        <button class="icon-btn outlined" id="refreshMemory" type="button" aria-label="Refresh">${ICONS.refresh}</button>
      </div>
      <div class="memory-heading">
        <h1>Memory</h1>
        <p>What Sam remembers about you.</p>
      </div>
      <div id="memoryContent" class="memory-loading">Loading saved information…</div>
    </div>`;
  $("#backToChat").onclick = () => active && cur() ? openChat(active) : newChat();
  $("#refreshMemory").onclick = loadMemoryManager;
  await loadMemoryManager();
}

/* ---------- Settings ---------- */

function openSettings() {
  if (busy) return;

  setView("settings");
  renderList();

  thread.innerHTML = `
    <div id="settingsContent" class="settings-loading">
      Loading settings…
    </div>`;

  window.SamSettings.mount($("#settingsContent"), {
    onBack: () => active && cur() ? openChat(active) : newChat()
  });
}

function makeMemoryCard(item, onEdit, onDelete) {
  const card = document.createElement("article");
  card.className = "mem-card";

  const top = document.createElement("div");
  top.className = "mem-top";
  const tag = document.createElement("span");
  tag.className = "mem-tag";
  tag.textContent = item.label;
  const time = document.createElement("span");
  time.className = "mem-time";
  const when = fmtTime(item.created);
  time.textContent = when ? `Added ${when}` : "";
  if (item.updated) time.textContent += `${when ? " (edited)" : "Edited"}`;
  top.append(tag, time);

  const text = document.createElement("p");
  text.className = "mem-text";
  text.textContent = item.text;

  const actions = document.createElement("div");
  actions.className = "mem-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "mem-btn edit";
  edit.innerHTML = `${ICONS.edit}<span>Edit</span>`;
  edit.onclick = onEdit;
  const del = document.createElement("button");
  del.type = "button";
  del.className = "mem-btn del";
  del.innerHTML = `${ICONS.trash}<span>Delete</span>`;
  del.onclick = onDelete;
  actions.append(edit, del);

  card.append(top, text, actions);
  return card;
}

async function loadMemoryManager() {
  const content = $("#memoryContent");
  if (!content) return;
  const refreshBtn = $("#refreshMemory");
  refreshBtn?.classList.add("spinning");

  try {
    const data = await apiJSON("/memory/list");
    const profile = data.user_profile || {};
    const meta = data.profile_meta || {};
    const memories = Array.isArray(data.memories) ? data.memories : [];

    const items = [
      ...Object.entries(profile).map(([key, value]) => ({
        kind: "profile",
        key,
        raw: String(value),
        label: humanize(key),
        text: cap(String(value)),
        created: meta[key]?.created_at || null,
        updated: meta[key]?.updated_at || null
      })),
      ...memories.map(m => ({
        kind: "memory",
        raw: m.content || "",
        label: cap(m.category || "general"),
        text: tidyMemory(m.content || ""),
        created: m.created_at || null,
        updated: m.updated_at || null
      }))
    ].sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0));

    const run = async (url, body) => {
      await apiJSON(url, {method: "POST", body: JSON.stringify(body)});
      await loadMemoryManager();
    };

    const nodes = [];

    const count = document.createElement("p");
    count.className = "memory-count";
    count.textContent = items.length === 1 ? "1 saved item" : `${items.length} saved items`;
    nodes.push(count);

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "memory-empty";
      empty.textContent = "Nothing saved yet. When you approve something Sam suggests, it will show up here.";
      nodes.push(empty);
    }

    items.forEach(item => {
      nodes.push(makeMemoryCard(
        item,
        async () => {
          try {
            if (item.kind === "profile") {
              const v = prompt(`Update "${item.label}":`, item.raw);
              if (v === null || !v.trim() || v.trim() === item.raw) return;
              await run("/memory/edit", {target: "profile", key: item.key, value: v.trim()});
            } else {
              const v = prompt("Edit this memory:", item.raw);
              if (v === null || !v.trim() || v.trim() === item.raw) return;
              await run("/memory/edit", {target: "memory", old_content: item.raw, new_content: v.trim()});
            }
          } catch (error) {
            alert(error.message);
          }
        },
        async () => {
          if (!confirm("Delete this from Sam's memory?")) return;
          try {
            if (item.kind === "profile") {
              await run("/memory/delete", {target: "profile", key: item.key});
            } else {
              await run("/memory/delete", {target: "memory", content: item.raw});
            }
          } catch (error) {
            alert(error.message);
          }
        }
      ));
    });

    content.className = "memory-list";
    content.replaceChildren(...nodes);
  } catch (error) {
    content.className = "memory-error";
    content.textContent = `Couldn't load Sam's memory: ${error.message}`;
  } finally {
    refreshBtn?.classList.remove("spinning");
  }
}

/* ---------- Memory approval card ---------- */

function makeProposalRow(proposal, onSettled) {
  const row = document.createElement("div");
  row.className = "mp-row";

  const tag = document.createElement("span");
  tag.className = "mem-tag";
  tag.textContent = proposal.type === "profile"
    ? humanize(proposal.key)
    : cap(proposal.category || "general");

  const text = document.createElement("p");
  text.className = "mp-text";
  text.textContent = proposal.type === "profile"
    ? cap(proposal.value)
    : tidyMemory(proposal.content);

  const actions = document.createElement("div");
  actions.className = "mp-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "mp-btn save";
  save.textContent = "Save";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "mp-btn skip";
  skip.textContent = "Skip";
  actions.append(save, skip);

  const status = document.createElement("div");
  status.className = "mp-status";
  status.hidden = true;

  let done = false;

  async function decide(decision) {
    if (done) return;
    save.disabled = skip.disabled = true;
    status.hidden = true;
    const endpoint = decision === "approve" ? "/memory/approve" : "/memory/reject";

    try {
      const result = await apiJSON(endpoint, {
        method: "POST",
        body: JSON.stringify({proposal_id: proposal.id})
      });
      done = true;
      row.classList.add("done");
      actions.hidden = true;
      status.hidden = false;

      if (decision === "approve" && result.success) {
        status.className = "mp-status ok";
        status.innerHTML = `${ICONS.check}<span>Saved</span>`;
      } else if (decision === "approve") {
        status.className = "mp-status muted";
        status.textContent = "Already saved";
      } else {
        status.className = "mp-status muted";
        status.textContent = "Skipped";
      }
      onSettled();
    } catch (error) {
      status.hidden = false;
      status.className = "mp-status err";
      status.textContent = error.message;
      save.disabled = skip.disabled = false;
    }
  }

  save.onclick = () => decide("approve");
  skip.onclick = () => decide("reject");

  row.append(tag, text, actions, status);
  return {row, decide, isDone: () => done};
}

function displayMemoryProposals(proposals) {
  if (!Array.isArray(proposals) || !proposals.length) return;

  const panel = document.createElement("section");
  panel.className = "memory-proposals";

  const head = document.createElement("div");
  head.className = "mp-head";
  head.innerHTML = `<span class="mp-icon">${ICONS.spark}</span><span class="mp-title">Remember this?</span>`;

  const rows = [];

  const onSettled = () => {
    if (!rows.every(r => r.isDone())) return;
    setTimeout(() => {
      panel.classList.add("leaving");
      setTimeout(() => panel.remove(), 300);
    }, 1600);
  };

  proposals.forEach(proposal => rows.push(makeProposalRow(proposal, onSettled)));

  if (proposals.length > 1) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "mp-all";
    all.textContent = "Save all";
    all.onclick = async () => {
      all.disabled = true;
      for (const r of rows) await r.decide("approve");
    };
    head.append(all);
  }

  panel.append(head, ...rows.map(r => r.row));
  thread.append(panel);
  down();
}

async function proposeMemories(userMessage) {
  try {
    const result = await apiJSON("/memory/propose", {
      method: "POST",
      body: JSON.stringify({message: userMessage})
    });
    displayMemoryProposals(result.proposals);
  } catch (error) {
    console.warn("Sam memory detection:", error);
  }
}

/* ---------- Sending messages ---------- */

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value ? false : !input.value.trim();
  sendBtn.classList.toggle("stop", value);
  sendBtn.setAttribute("aria-label", value ? "Stop generating" : "Send");
}

function stopReply() {
  abortCtl?.abort();
}

function grow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

async function send(text) {
  text = text.trim();
  if (!text || busy || viewMode !== "chat") return;

  if (!cur()) {
    const chat = {id: Date.now().toString(36), title: text.slice(0, 40), messages: []};
    chats.unshift(chat);
    active = chat.id;
    thread.innerHTML = "";
  }

  const chat = cur();
  const userMessage = text;
  chat.messages.push({role: "user", content: text});
  save();
  renderList();
  const userEl = addMsg("user", text).m;

  input.value = "";
  grow();
  setBusy(true);
  const typingIndicator = typing();
  let live = null;
  let full = "";
  let assistantCompleted = false;
  abortCtl = new AbortController();

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({messages: chat.messages.slice(-12)}),
      signal: abortCtl.signal
    });

    if (!response.ok) {
      let message = "Request failed";
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    if (!response.body) throw new Error("Streaming is not supported by this browser.");

    typingIndicator.remove();
    live = addMsg("assistant");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let queued = false;

    const paint = () => {
      queued = false;
      live.b.innerHTML = md(full);
      down();
    };

    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      full += decoder.decode(value, {stream: true});
      if (!queued) {
        queued = true;
        requestAnimationFrame(paint);
      }
    }
    full += decoder.decode();
    paint();

    if (!full.trim()) throw new Error("Sam sent an empty reply. Try again.");

    chat.messages.push({role: "assistant", content: full});
    save();
    addActions(live.m, full);
    assistantCompleted = true;

    await proposeMemories(userMessage);

  } catch (error) {
    typingIndicator.remove();
    const aborted = error && error.name === "AbortError";

    if (aborted && !assistantCompleted && full.trim()) {
      live.b.innerHTML = md(full);
      chat.messages.push({role: "assistant", content: full});
      save();
      addActions(live.m, full);
    } else if (aborted && !assistantCompleted) {
      if (live) live.m.remove();
      userEl.remove();
      chat.messages.pop();
      if (!chat.messages.length) {
        chats = chats.filter(x => x.id !== chat.id);
        active = null;
      }
      save();
      input.value = userMessage;
      grow();
      if (!cur()) showWelcome();
      renderList();
    } else {
      if (live && !assistantCompleted) live.m.remove();

      if (!assistantCompleted) {
        chat.messages.pop();
        save();
        const {b} = addMsg("assistant");
        b.classList.add("err");
        b.textContent = error instanceof TypeError
          ? "Couldn't reach the server. Is app.py running?"
          : error.message;
      } else {
        console.warn("Post-reply memory step failed:", error);
      }
    }
  }

  abortCtl = null;
  setBusy(false);
  input.focus();
}

/* ---------- Input & interface ---------- */

input.addEventListener("input", () => {
  grow();
  sendBtn.disabled = !busy && !input.value.trim();
});
input.addEventListener("keydown", event => {
  if (event.key === "Escape" && busy) {
    stopReply();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !isMobile()) {
    event.preventDefault();
    send(input.value);
  }
});
$("#form").addEventListener("submit", event => {
  event.preventDefault();
  if (busy) {
    stopReply();
    return;
  }
  send(input.value);
});
$("#newChat").onclick = newChat;
$("#openMemory").onclick = openMemoryManager;
$("#openSettings").onclick = openSettings;
$("#toggleSide").onclick = () => {
  document.body.classList.toggle(isMobile() ? "open" : "collapsed");
};
$("#scrim").onclick = () => document.body.classList.remove("open");

/* ---------- Initialization ---------- */

showWelcome();
renderList();

/* Load saved appearance settings */

fetch("/settings")
  .then(response => {
    if (!response.ok) throw new Error("Settings request failed.");
    return response.json();
  })
  .then(data => {
    if (data.settings && window.SamSettings) {
      window.SamSettings.applyAppearance(data.settings);
    }
  })
  .catch(error => {
    console.warn("SAM appearance settings:", error);
  });

/* Load user and assistant names */

fetch("/config")
  .then(response => response.json())
  .then(data => {
    userName = data.name || userName;

    if (data.assistant_name) {
      const brand = $(".brand");
      if (brand) brand.textContent = data.assistant_name;

      const title = $(".title");
      if (title && title.firstChild) {
        title.firstChild.textContent = data.assistant_name + " ";
      }
    }

    if (!cur() && viewMode === "chat") {
      showWelcome();
    }
  })
  .catch(error => {
    console.warn("SAM configuration:", error);
  });

