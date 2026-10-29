export const ROOMMATES = ["Alex", "Jordan", "Casey", "Riley"];
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

const ACTIVE_REQUEST_STATUSES = new Set(["pending", "approved"]);

export function createId(prefix = "id") {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

export function createDemoState() {
  const now = Date.now();
  return {
    items: [
      { id: "food-pz-104", name: "Margherita pizza", owner: "Alex", quantity: 25, status: "fresh", createdAt: now - 60 * 60 * 1000 },
      { id: "food-ps-218", name: "Leftover pasta", owner: "Alex", quantity: 100, status: "fresh", createdAt: now - 3 * 60 * 60 * 1000 },
      { id: "food-kh-331", name: "Heinz ketchup", owner: "Jordan", quantity: 82, status: "fresh", createdAt: now - 5 * 60 * 60 * 1000 },
      { id: "food-kh-847", name: "Heinz ketchup", owner: "Casey", quantity: 100, status: "fresh", createdAt: now - 4 * 60 * 60 * 1000 },
      { id: "food-oj-509", name: "Orange juice", owner: "Riley", quantity: 100, status: "fresh", createdAt: now - 2 * 60 * 60 * 1000 },
    ],
    requests: [],
    activity: [
      { id: "activity-welcome", message: "Demo fridge loaded with five individually identified items.", at: now - 60 * 1000 },
    ],
  };
}

export function getItem(state, itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("That food item no longer exists.");
  return item;
}

export function getRequest(state, requestId) {
  const request = state.requests.find((candidate) => candidate.id === requestId);
  if (!request) throw new Error("That portion request no longer exists.");
  return request;
}

export function isRequestActive(request) {
  return ACTIVE_REQUEST_STATUSES.has(request.status);
}

export function getReservedQuantity(state, itemId) {
  return state.requests
    .filter((request) => request.itemId === itemId && isRequestActive(request))
    .reduce((total, request) => total + request.portion, 0);
}

export function getAvailableQuantity(state, item) {
  return Math.max(0, item.quantity - getReservedQuantity(state, item.id));
}

function logActivity(state, message, at) {
  state.activity.unshift({ id: createId("activity"), message, at });
  state.activity = state.activity.slice(0, 30);
}

function expireRequest(state, request, reason, at) {
  request.status = "expired";
  request.closedAt = at;
  request.closeReason = reason;
  logActivity(state, `${request.requester}'s ${request.portion}% request for ${getItem(state, request.itemId).name} expired (${reason}).`, at);
}

export function expireOverdueRequests(state, now = Date.now()) {
  let changed = false;
  for (const request of state.requests) {
    if (isRequestActive(request) && request.expiresAt <= now) {
      expireRequest(state, request, "24-hour timeout", now);
      changed = true;
    }
  }
  return changed;
}

function requireOwner(item, actor) {
  if (item.owner !== actor) throw new Error(`Only ${item.owner}, the item owner, can do that.`);
}

function requireRoommate(roommate) {
  if (!ROOMMATES.includes(roommate)) throw new Error("Choose a roommate from the household list.");
}

function validateQuantity(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a number from 0 to 100%.`);
  }
}

export function addItem(state, { name, owner, quantity }, now = Date.now()) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 60) throw new Error("Enter a food name (up to 60 characters).");
  requireRoommate(owner);
  validateQuantity(quantity, "Quantity");
  if (quantity === 0) throw new Error("A new item needs some stock. Enter at least 1%.");
  const item = { id: createId("food"), name: cleanName, owner, quantity, status: "fresh", createdAt: now };
  state.items.unshift(item);
  logActivity(state, `${owner} logged ${cleanName} (${quantity}%).`, now);
  return item;
}

export function requestPortion(state, { itemId, requester, portion }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const item = getItem(state, itemId);
  requireRoommate(requester);
  if (item.status !== "fresh") throw new Error("This item is not available for requests.");
  if (requester === item.owner) throw new Error("The owner cannot request a portion of their own item.");
  if (!Number.isFinite(portion) || portion <= 0) throw new Error("Enter a portion greater than 0%.");
  const available = getAvailableQuantity(state, item);
  if (portion > available) throw new Error(`Only ${available}% is available. Another request may have reserved the rest.`);
  const request = {
    id: createId("request"),
    itemId,
    requester,
    portion,
    status: "pending",
    requestedAt: now,
    expiresAt: now + REQUEST_TTL_MS,
  };
  state.requests.unshift(request);
  logActivity(state, `${requester} requested ${portion}% of ${item.name}; that portion is now reserved.`, now);
  return request;
}

export function approveRequest(state, { requestId, actor }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const request = getRequest(state, requestId);
  const item = getItem(state, request.itemId);
  requireOwner(item, actor);
  if (request.status !== "pending") throw new Error("Only a pending request can be approved.");
  request.status = "approved";
  request.approvedAt = now;
  logActivity(state, `${actor} approved ${request.requester}'s ${request.portion}% of ${item.name}.`, now);
  return request;
}

export function consumePortion(state, { requestId, actor }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const request = getRequest(state, requestId);
  const item = getItem(state, request.itemId);
  if (request.status !== "approved") throw new Error("Only an approved, unexpired request can be consumed.");
  if (request.requester !== actor) throw new Error(`Only ${request.requester} can mark this portion consumed.`);
  if (item.status !== "fresh" || item.quantity < request.portion) {
    throw new Error("The physical inventory no longer covers this portion. Reconcile it before consuming.");
  }
  item.quantity -= request.portion;
  request.status = "consumed";
  request.consumedAt = now;
  logActivity(state, `${actor} consumed ${request.portion}% of ${item.name}.`, now);
  return request;
}

export function closeRequest(state, { requestId, actor }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const request = getRequest(state, requestId);
  const item = getItem(state, request.itemId);
  requireOwner(item, actor);
  if (!isRequestActive(request)) throw new Error("This request is already closed.");
  request.status = "declined";
  request.closedAt = now;
  logActivity(state, `${actor} released ${request.requester}'s reservation for ${item.name}.`, now);
  return request;
}

export function spoilItem(state, { itemId, actor }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const item = getItem(state, itemId);
  requireOwner(item, actor);
  if (item.status !== "fresh") throw new Error("Only fresh inventory can be marked spoiled.");
  const discarded = item.quantity;
  item.quantity = 0;
  item.status = "spoiled";
  for (const request of state.requests) {
    if (request.itemId === itemId && isRequestActive(request)) {
      expireRequest(state, request, "item spoiled", now);
    }
  }
  logActivity(state, `${actor} marked ${item.name} as spoiled; ${discarded}% was discarded and active requests were released.`, now);
}

export function reconcileInventory(state, { itemId, actor, actualQuantity }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const item = getItem(state, itemId);
  requireOwner(item, actor);
  if (item.status === "spoiled") throw new Error("This item is marked spoiled. Log a fresh item instead.");
  validateQuantity(actualQuantity, "Fridge quantity");
  const previous = item.quantity;
  for (const request of state.requests) {
    if (request.itemId === itemId && isRequestActive(request)) {
      expireRequest(state, request, "inventory reconciled", now);
    }
  }
  item.quantity = actualQuantity;
  item.status = actualQuantity === 0 ? "empty" : "fresh";
  logActivity(state, `${actor} corrected ${item.name} from ${previous}% to ${actualQuantity}% after checking the fridge.`, now);
  return item;
}

export function simulateRequestExpiry(state, { itemId, actor }, now = Date.now()) {
  expireOverdueRequests(state, now);
  const item = getItem(state, itemId);
  requireOwner(item, actor);
  let count = 0;
  for (const request of state.requests) {
    if (request.itemId === itemId && isRequestActive(request)) {
      expireRequest(state, request, "simulated 24-hour timeout", now);
      count += 1;
    }
  }
  if (count === 0) throw new Error("There are no open requests to expire for this item.");
  logActivity(state, `${actor} simulated 24 hours passing for ${item.name}; ${count} request(s) expired.`, now);
  return count;
}
