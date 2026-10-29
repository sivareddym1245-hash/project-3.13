import test from "node:test";
import assert from "node:assert/strict";
import {
  addItem,
  approveRequest,
  consumePortion,
  createDemoState,
  getAvailableQuantity,
  getReservedQuantity,
  reconcileInventory,
  requestPortion,
  simulateRequestExpiry,
  spoilItem,
} from "../model.js";

test("only one roommate can reserve the final 25% portion", () => {
  const state = createDemoState();
  const pizza = state.items.find((item) => item.id === "food-pz-104");

  requestPortion(state, { itemId: pizza.id, requester: "Jordan", portion: 25 }, 1_000);
  assert.equal(getAvailableQuantity(state, pizza), 0);
  assert.equal(getReservedQuantity(state, pizza.id), 25);
  assert.throws(
    () => requestPortion(state, { itemId: pizza.id, requester: "Casey", portion: 25 }, 1_001),
    /Only 0% is available/,
  );
  assert.equal(state.requests.length, 1);
});

test("spoilage expires pending and approved requests and releases stock", () => {
  const state = createDemoState();
  const pasta = state.items.find((item) => item.id === "food-ps-218");
  const pending = requestPortion(state, { itemId: pasta.id, requester: "Jordan", portion: 25 }, 2_000);
  const approved = requestPortion(state, { itemId: pasta.id, requester: "Casey", portion: 25 }, 2_001);
  approveRequest(state, { requestId: approved.id, actor: "Alex" }, 2_002);

  spoilItem(state, { itemId: pasta.id, actor: "Alex" }, 2_003);
  assert.equal(pasta.status, "spoiled");
  assert.equal(pasta.quantity, 0);
  assert.equal(pending.status, "expired");
  assert.equal(approved.status, "expired");
  assert.equal(getReservedQuantity(state, pasta.id), 0);
});

test("requests for identical names remain attached to distinct item IDs", () => {
  const state = createDemoState();
  const bottles = state.items.filter((item) => item.name === "Heinz ketchup");
  assert.equal(bottles.length, 2);
  assert.notEqual(bottles[0].id, bottles[1].id);

  const request = requestPortion(state, { itemId: bottles[0].id, requester: "Casey", portion: 10 }, 3_000);
  assert.equal(request.itemId, bottles[0].id);
  assert.equal(getReservedQuantity(state, bottles[0].id), 10);
  assert.equal(getReservedQuantity(state, bottles[1].id), 0);
});

test("reconciliation corrects missing food and releases stale reservations", () => {
  const state = createDemoState();
  const juice = state.items.find((item) => item.id === "food-oj-509");
  const request = requestPortion(state, { itemId: juice.id, requester: "Jordan", portion: 50 }, 4_000);
  approveRequest(state, { requestId: request.id, actor: "Riley" }, 4_001);

  reconcileInventory(state, { itemId: juice.id, actor: "Riley", actualQuantity: 0 }, 4_002);
  assert.equal(juice.quantity, 0);
  assert.equal(juice.status, "empty");
  assert.equal(request.status, "expired");
  assert.equal(getAvailableQuantity(state, juice), 0);
});

test("an unconsumed reservation automatically expires after 24 hours", () => {
  const state = createDemoState();
  const pizza = state.items.find((item) => item.id === "food-pz-104");
  const request = requestPortion(state, { itemId: pizza.id, requester: "Jordan", portion: 25 }, 5_000);

  assert.throws(
    () => approveRequest(state, { requestId: request.id, actor: "Alex" }, 5_000 + 24 * 60 * 60 * 1000),
    /Only a pending request can be approved/,
  );
  assert.equal(request.status, "expired");
  assert.equal(getAvailableQuantity(state, pizza), 25);
});

test("only the approved requester can consume and consumption updates physical stock", () => {
  const state = createDemoState();
  const pizza = state.items.find((item) => item.id === "food-pz-104");
  const request = requestPortion(state, { itemId: pizza.id, requester: "Jordan", portion: 25 }, 6_000);
  approveRequest(state, { requestId: request.id, actor: "Alex" }, 6_001);

  assert.throws(
    () => consumePortion(state, { requestId: request.id, actor: "Casey" }, 6_002),
    /Only Jordan can mark this portion consumed/,
  );
  consumePortion(state, { requestId: request.id, actor: "Jordan" }, 6_003);
  assert.equal(pizza.quantity, 0);
  assert.equal(request.status, "consumed");
});

test("adding items validates the owner and gives identical names unique IDs", () => {
  const state = createDemoState();
  const first = addItem(state, { name: "Ketchup", owner: "Alex", quantity: 100 }, 7_000);
  const second = addItem(state, { name: "Ketchup", owner: "Alex", quantity: 100 }, 7_001);
  assert.notEqual(first.id, second.id);
  assert.throws(() => addItem(state, { name: " ", owner: "Alex", quantity: 100 }, 7_002), /Enter a food name/);
});
