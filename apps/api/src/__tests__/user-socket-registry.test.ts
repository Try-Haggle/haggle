/**
 * Per-user socket registry.
 *
 * The original implementation (and the Django app this was ported from) kept a
 * single socket per user, so opening a second tab silently stopped delivery to
 * the first one. These tests pin the multi-socket behaviour.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearUserSocketsForTests,
  countUserSockets,
  pushToUser,
  registerUserSocket,
  unregisterUserSocket,
} from "../notification/ws-registry.js";

const OPEN = 1;
const CLOSED = 3;

function fakeSocket(readyState = OPEN) {
  return {
    OPEN,
    readyState,
    send: vi.fn(),
    on: vi.fn(),
  };
}

type FakeSocket = ReturnType<typeof fakeSocket>;

function register(userId: string, socket: FakeSocket) {
  registerUserSocket(userId, socket as unknown as Parameters<typeof registerUserSocket>[1]);
}

beforeEach(() => {
  __clearUserSocketsForTests();
});

describe("pushToUser", () => {
  it("delivers to every socket a user has open", () => {
    const tabA = fakeSocket();
    const tabB = fakeSocket();
    register("u1", tabA);
    register("u1", tabB);

    pushToUser("u1", { type: "message.new" });

    expect(tabA.send).toHaveBeenCalledWith('{"type":"message.new"}');
    expect(tabB.send).toHaveBeenCalledWith('{"type":"message.new"}');
  });

  it("does not deliver to other users", () => {
    const mine = fakeSocket();
    const theirs = fakeSocket();
    register("u1", mine);
    register("u2", theirs);

    pushToUser("u1", { type: "message.new" });

    expect(theirs.send).not.toHaveBeenCalled();
  });

  it("prunes sockets that are no longer open", () => {
    const dead = fakeSocket(CLOSED);
    register("u1", dead);

    pushToUser("u1", { type: "message.new" });

    expect(dead.send).not.toHaveBeenCalled();
    expect(countUserSockets("u1")).toBe(0);
  });

  it("keeps delivering to the surviving socket when one send throws", () => {
    const broken = fakeSocket();
    broken.send.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    const healthy = fakeSocket();
    register("u1", broken);
    register("u1", healthy);

    expect(() => pushToUser("u1", { type: "message.new" })).not.toThrow();
    expect(healthy.send).toHaveBeenCalled();
  });

  it("is a no-op for a user with no sockets here", () => {
    expect(() => pushToUser("nobody", { type: "message.new" })).not.toThrow();
  });
});

describe("unregisterUserSocket", () => {
  it("removes only the socket that closed", () => {
    const tabA = fakeSocket();
    const tabB = fakeSocket();
    register("u1", tabA);
    register("u1", tabB);

    unregisterUserSocket("u1", tabA as unknown as Parameters<typeof unregisterUserSocket>[1]);

    expect(countUserSockets("u1")).toBe(1);
    pushToUser("u1", { type: "message.new" });
    expect(tabA.send).not.toHaveBeenCalled();
    expect(tabB.send).toHaveBeenCalled();
  });

  it("drops the user entry once the last socket is gone", () => {
    const only = fakeSocket();
    register("u1", only);

    unregisterUserSocket("u1", only as unknown as Parameters<typeof unregisterUserSocket>[1]);

    expect(countUserSockets("u1")).toBe(0);
  });
});
