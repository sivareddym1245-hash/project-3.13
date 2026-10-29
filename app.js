import {
  ROOMMATES,
  addItem,
  approveRequest,
  closeRequest,
  consumePortion,
  createDemoState,
  createId,
  expireOverdueRequests,
  getAvailableQuantity,
  getReservedQuantity,
  isRequestActive,
  reconcileInventory,
  requestPortion,
  simulateRequestExpiry,
  spoilItem,
} from "./model.js";

const STORAGE_KEY = "fridgepolice-demo-v1";
const ICONS = [
  ["pizza", "🍕"],
  ["pasta", "🍝"],
  ["ketchup", "🍅"],
  ["juice", "🧃"],
  ["milk", "🥛"],
  ["cheese", "🧀"],
  ["apple", "🍎"],
  ["bread", "🍞"],
];
const elements = {
  inventory: document.querySelector("#inventory-list"),
  activity: document.querySelector("#activity-list"),
  currentUser: document.querySelector("#current-user"),
  addForm: document.querySelector("#add-item-form"),
  name: document.querySelector("#new-item-name"),
  quantity: document.querySelector("#new-item-quantity"),
  owner: document.querySelector("#new-item-owner"),
  notice: document.querySelector("#notice"),
  storageWarning: document.querySelector("#storage-warning"),
  reset: document.querySelector("#reset-demo"),
  itemCount: document.querySelector("#item-count"),
  requestCount: document.querySelector("#request-count"),
  inventoryCount: document.querySelector("#inventory-count"),
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { state: createDemoState(), error: "" };
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.requests) || !Array.isArray(parsed.activity)) {
      throw new Error("Saved fridge data has an unexpected format.");
    }
    return { state: parsed, error: "" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown storage error.";
    return { state: createDemoState(), error: `Saved data could not be loaded (${detail}). Reset the demo to continue safely.` };
  }
}

let { state, error: storageError } = loadState();
let activeNoticeTimer;
let reconciliationItemId = "";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function itemIcon(name) {
  const normalized = name.toLowerCase();
  const match = ICONS.find(([keyword]) => normalized.includes(keyword));
  return match?.[1] ?? "🥬";
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatExpiry(timestamp) {
  const remaining = timestamp - Date.now();
  if (remaining <= 0) return "expires now";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  return hours <= 1 ? "expires in <1h" : `expires in ${hours}h`;
}

function showNotice(message, isError = false) {
  clearTimeout(activeNoticeTimer);
  elements.notice.textContent = message;
  elements.notice.hidden = false;
  elements.notice.classList.toggle("notice-error", isError);
  activeNoticeTimer = setTimeout(() => {
    elements.notice.hidden = true;
  }, 6500);
}

function persist(nextState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function transact(action) {
  if (storageError) {
    showNotice("Reset the demo before making changes; the saved state could not be read.", true);
    return false;
  }
  const nextState = structuredClone(state);
  try {
    const message = action(nextState);
    persist(nextState);
    state = nextState;
    render();
    if (message) showNotice(message);
    return true;
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "The change could not be completed.", true);
    return false;
  }
}

function buildActionButton(label, action, className = "button button-small button-secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function renderRequestRow(request, item, actor) {
  const row = document.createElement("div");
  row.className = "request-row";
  const info = document.createElement("div");
  info.className = "request-info";
  const stateLabel = request.status === "approved" ? "APPROVED" : "AWAITING APPROVAL";
  const stateClass = request.status === "approved" ? "request-state approved" : "request-state";
  info.innerHTML = `<span><strong>${escapeHtml(request.requester)}</strong> · ${request.portion}%</span><span class="${stateClass}">${stateLabel}</span><span>${formatExpiry(request.expiresAt)}</span>`;
  const controls = document.createElement("div");
  controls.className = "request-controls";

  if (actor === item.owner && request.status === "pending") {
    controls.append(
      buildActionButton("Approve", () => transact((next) => {
        approveRequest(next, { requestId: request.id, actor });
        return "Portion approved. The reservation stays held until it is consumed or expires.";
      })),
      buildActionButton("Decline", () => transact((next) => {
        closeRequest(next, { requestId: request.id, actor });
        return "Request declined and the reserved portion released.";
      }), "button button-small button-danger"),
    );
  } else if (actor === item.owner && request.status === "approved") {
    controls.append(buildActionButton("Revoke", () => transact((next) => {
      closeRequest(next, { requestId: request.id, actor });
      return "Approval revoked and the reserved portion released.";
    }), "button button-small button-danger"));
  }

  if (actor === request.requester && request.status === "approved") {
    controls.append(buildActionButton("Mark eaten", () => transact((next) => {
      consumePortion(next, { requestId: request.id, actor });
      return `${request.portion}% marked consumed; the inventory has been updated.`;
    }), "button button-small button-primary"));
  }

  row.append(info, controls);
  return row;
}

function renderItem(item, actor) {
  const available = getAvailableQuantity(state, item);
  const reserved = getReservedQuantity(state, item.id);
  const itemRequests = state.requests.filter((request) => request.itemId === item.id);
  const card = document.createElement("article");
  card.className = "item-card";
  card.dataset.status = item.status;

  const top = document.createElement("div");
  top.className = "item-top";
  const titleWrap = document.createElement("div");
  titleWrap.className = "item-title-wrap";
  titleWrap.innerHTML = `
    <div class="item-title-row"><span class="food-emoji" aria-hidden="true">${itemIcon(item.name)}</span><h3 class="item-title">${escapeHtml(item.name)}</h3></div>
    <p class="item-subtitle">Owned by ${escapeHtml(item.owner)} · logged ${formatTime(item.createdAt)}</p>`;
  const id = document.createElement("span");
  id.className = "item-id";
  id.title = `Unique item ID: ${item.id}`;
  id.textContent = item.id.toUpperCase();
  top.append(titleWrap, id);

  const stats = document.createElement("div");
  stats.className = "item-stats";
  const itemStatus = item.status === "spoiled" ? "SPOILED" : item.status === "empty" ? "GONE" : "IN FRIDGE";
  stats.innerHTML = `
    <div class="item-stat"><strong>${item.quantity}%</strong><span>In fridge</span></div>
    <div class="item-stat"><strong>${reserved}%</strong><span>Reserved</span></div>
    <div class="item-stat available"><strong>${available}%</strong><span>Available</span></div>`;

  const itemActions = document.createElement("div");
  itemActions.className = "item-actions";
  if (item.status === "fresh" && actor !== item.owner && available > 0) {
    const form = document.createElement("form");
    form.className = "request-form";
    form.innerHTML = `
      <label>Request %<input type="number" min="1" max="${available}" step="1" value="${Math.min(25, available)}" required aria-label="Portion to request from ${escapeHtml(item.name)} ${escapeHtml(item.id)}" /></label>
      <button class="button button-small button-primary" type="submit">Request portion</button>`;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const portion = Number(form.querySelector("input").value);
      transact((next) => {
        requestPortion(next, { itemId: item.id, requester: actor, portion });
        return `${portion}% reserved for ${actor}; the owner's approval is needed next.`;
      });
    });
    itemActions.append(form);
  } else if (item.status === "fresh" && actor === item.owner) {
    const ownerHint = document.createElement("span");
    ownerHint.className = "form-hint";
    ownerHint.textContent = available > 0 ? "Switch roommate profile to request a portion." : "No unreserved portions remain.";
    itemActions.append(ownerHint);
  } else if (item.status === "fresh" && available === 0 && reserved > 0) {
    const reservedHint = document.createElement("span");
    reservedHint.className = "form-hint";
    reservedHint.textContent = "All remaining stock is reserved.";
    itemActions.append(reservedHint);
  }

  if (actor === item.owner && item.status !== "spoiled") {
    const ownerActions = document.createElement("div");
    ownerActions.className = "owner-actions";
    ownerActions.append(buildActionButton(
      reconciliationItemId === item.id ? "Close correction" : "Correct stock",
      () => {
        reconciliationItemId = reconciliationItemId === item.id ? "" : item.id;
        render();
      },
    ));
    if (item.status === "fresh") {
      ownerActions.append(buildActionButton("Mark spoiled", () => {
        if (!window.confirm(`Mark ${item.name} as spoiled? This will discard the stock and expire active requests.`)) return;
        transact((next) => {
          spoilItem(next, { itemId: item.id, actor });
          return `${item.name} discarded. All active requests have expired and their reservations released.`;
        });
      }, "button button-small button-danger"));
    }
    itemActions.append(ownerActions);
  }

  card.append(top);
  const status = document.createElement("div");
  status.className = `status-pill ${item.status === "fresh" ? "" : `status-${item.status}`}`;
  status.textContent = itemStatus;
  top.append(status);
  card.append(stats, itemActions);

  if (reconciliationItemId === item.id) {
    const form = document.createElement("form");
    form.className = "reconcile-form";
    form.innerHTML = `
      <label>What is physically left? Enter 0 if it is gone.
        <input type="number" min="0" max="100" step="1" value="${item.quantity}" required />
      </label>
      <button class="button button-small button-primary" type="submit">Save correction</button>`;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const actualQuantity = Number(form.querySelector("input").value);
      transact((next) => {
        reconcileInventory(next, { itemId: item.id, actor, actualQuantity });
        reconciliationItemId = "";
        return `Fridge record corrected to ${actualQuantity}%. Any outstanding requests were released to avoid stale allocations.`;
      });
    });
    card.append(form);
  }

  if (itemRequests.length) {
    const requestList = document.createElement("div");
    requestList.className = "request-list";
    for (const request of itemRequests) requestList.append(renderRequestRow(request, item, actor));
    card.append(requestList);
  }

  if (actor === item.owner && item.status === "fresh" && itemRequests.some(isRequestActive)) {
    const controls = document.createElement("div");
    controls.className = "item-controls";
    controls.append(buildActionButton("Simulate 24h expiry", () => transact((next) => {
      const count = simulateRequestExpiry(next, { itemId: item.id, actor });
      return `${count} request(s) expired; reserved stock is available again.`;
    }), "button button-small button-secondary"));
    card.append(controls);
  }
  return card;
}

function renderActivity() {
  elements.activity.replaceChildren();
  if (!state.activity.length) {
    const empty = document.createElement("li");
    empty.className = "no-activity";
    empty.textContent = "No activity yet. Changes will show up here.";
    elements.activity.append(empty);
    return;
  }
  for (const entry of state.activity.slice(0, 6)) {
    const row = document.createElement("li");
    row.innerHTML = `${escapeHtml(entry.message)}<span class="activity-time">${formatTime(entry.at)}</span>`;
    elements.activity.append(row);
  }
}

function render() {
  const actor = elements.currentUser.value;
  const activeRequests = state.requests.filter(isRequestActive).length;
  elements.itemCount.textContent = String(state.items.length);
  elements.requestCount.textContent = String(activeRequests);
  elements.inventoryCount.textContent = String(state.items.length);
  elements.inventory.replaceChildren();
  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-inventory";
    empty.textContent = "Nothing logged yet. Add the first item to get started.";
    elements.inventory.append(empty);
  } else {
    for (const item of state.items) elements.inventory.append(renderItem(item, actor));
  }
  elements.owner.value = actor;
  renderActivity();
  elements.storageWarning.hidden = !storageError;
  elements.storageWarning.textContent = storageError;
}

elements.currentUser.addEventListener("change", () => {
  reconciliationItemId = "";
  render();
});

elements.owner.addEventListener("change", () => {
  if (elements.currentUser.value !== elements.owner.value) {
    showNotice("The selected owner will be used when the item is logged.");
  }
});

elements.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = elements.name.value;
  const quantity = Number(elements.quantity.value);
  const owner = elements.owner.value;
  const saved = transact((next) => {
    const item = addItem(next, { name, owner, quantity });
    return `${item.name} added with unique ID ${item.id}.`;
  });
  if (!saved) return;
  elements.addForm.reset();
  elements.quantity.value = "100";
  elements.owner.value = elements.currentUser.value;
});

elements.reset.addEventListener("click", () => {
  if (!window.confirm("Reset the fridge and requests to the original demo data?")) return;
  const nextState = createDemoState();
  try {
    persist(nextState);
    state = nextState;
    storageError = "";
    reconciliationItemId = "";
    render();
    showNotice("Demo reset. Try requesting the last 25% of pizza as Jordan, then try as Casey.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown storage error.";
    showNotice(`The demo could not be reset because browser storage failed: ${detail}`, true);
  }
});

function runExpirySweep() {
  if (storageError) return;
  const nextState = structuredClone(state);
  if (!expireOverdueRequests(nextState)) return;
  try {
    persist(nextState);
    state = nextState;
    render();
    showNotice("A portion request expired after 24 hours and its reservation was released.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown storage error.";
    showNotice(`An expired request could not be saved: ${detail}`, true);
  }
}

render();
runExpirySweep();
setInterval(runExpirySweep, 30_000);
