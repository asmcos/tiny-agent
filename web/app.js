const MODULES = [
  ["code", "编程"],
  ["desktop", "电脑控制"],
  ["system", "系统维修"],
  ["word", "Word"],
  ["ppt", "PPT"],
  ["robot", "小车"]
];

const modules = document.querySelector("#modules");
const transcript = document.querySelector("#transcript");
const empty = document.querySelector("#empty");
const approval = document.querySelector("#approval");
const form = document.querySelector("#composer");
const input = document.querySelector("#input");
const send = document.querySelector("#send");

let active = "";
let busy = false;

for (const [key, label] of MODULES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "module";
  button.dataset.key = key;
  button.innerHTML = `<span>${label}</span><span class="key">${key}</span>`;
  modules.append(button);
}

function setActive(target) {
  active = target;
  for (const button of modules.querySelectorAll(".module")) {
    button.classList.toggle("active", button.dataset.key === target);
  }
}

function setBusy(next) {
  busy = next;
  send.disabled = next;
}

function add(node) {
  empty.hidden = true;
  const turn = document.createElement("div");
  turn.className = "turn";
  turn.append(node);
  transcript.append(turn);
  transcript.scrollTop = transcript.scrollHeight;
}

function render(event) {
  if (event.type === "reset") {
    transcript.querySelectorAll(".turn").forEach((node) => node.remove());
    empty.hidden = false;
    approval.classList.add("hidden");
    setActive("");
    setBusy(false);
    return;
  }
  if (event.type === "user") {
    const node = document.createElement("div");
    node.className = "user";
    node.textContent = event.text;
    add(node);
    setBusy(true);
    approval.classList.add("hidden");
  }
  if (event.type === "route") {
    const node = document.createElement("div");
    node.className = "route";
    const label = MODULES.find(([key]) => key === event.target)?.[1] ?? event.target;
    node.textContent = label;
    add(node);
    setActive(event.target);
  }
  if (event.type === "tool") {
    const node = document.createElement("div");
    node.className = "tool";
    node.textContent = `${event.phase === "proposed" ? "调用" : "结果"} ${event.name} ${event.phase === "proposed" ? "" : event.phase}`.trim();
    add(node);
  }
  if (event.type === "approval") {
    approval.classList.remove("hidden");
    approval.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = `批准 ${event.toolName}`;
    const pre = document.createElement("pre");
    pre.textContent = event.argumentsJson || event.reason;
    const actions = document.createElement("div");
    actions.className = "actions";
    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "allow";
    allow.textContent = "允许";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = "拒绝";
    allow.onclick = () => decide(true);
    deny.onclick = () => decide(false);
    actions.append(allow, deny);
    approval.append(title, pre, actions);
  }
  if (event.type === "report") {
    const node = document.createElement("div");
    node.className = event.ok ? "report" : "report fail";
    node.textContent = event.text || "(没有正文)";
    add(node);
    approval.classList.add("hidden");
    setBusy(false);
  }
  if (event.type === "error") {
    const node = document.createElement("div");
    node.className = "error";
    node.textContent = event.message;
    add(node);
    setBusy(false);
  }
}

async function decide(allow) {
  approval.classList.add("hidden");
  await fetch("/api/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allow })
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  const response = await fetch("/api/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const body = await response.json();
    render({ type: "error", message: body.error || "发送失败" });
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector("#new-chat").onclick = () => fetch("/api/reset", { method: "POST" });

const source = new EventSource("/api/events");
source.onmessage = (event) => render(JSON.parse(event.data));

fetch("/api/meta")
  .then((response) => response.json())
  .then((meta) => {
    document.querySelector("#workspace").textContent = meta.workspace;
    document.querySelector("#model").textContent = `${meta.model} · ${meta.mode}`;
    document.querySelector("#meta").textContent = meta.mode;
  });
