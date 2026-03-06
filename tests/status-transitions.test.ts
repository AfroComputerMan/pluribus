import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  VALID_TRANSITIONS,
  type AgentStatus,
} from "@/lib/orchestration/agent-status";

const ALL_STATUSES: AgentStatus[] = [
  "queued",
  "running",
  "error",
  "waiting-approval",
  "completed",
];

describe("AgentStatus FSM", () => {
  describe("valid transitions", () => {
    const validCases: [AgentStatus, AgentStatus][] = [
      ["queued", "running"],
      ["queued", "error"],
      ["running", "completed"],
      ["running", "error"],
      ["running", "waiting-approval"],
      ["waiting-approval", "running"],
      ["waiting-approval", "error"],
      ["completed", "running"],
      ["error", "running"],
      ["error", "queued"],
    ];

    for (const [from, to] of validCases) {
      it(`${from} -> ${to} is valid`, () => {
        expect(isValidTransition(from, to)).toBe(true);
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidCases: [AgentStatus, AgentStatus][] = [
      ["queued", "completed"],
      ["queued", "waiting-approval"],
      ["completed", "error"],
      ["completed", "queued"],
      ["completed", "waiting-approval"],
      ["error", "completed"],
      ["error", "waiting-approval"],
      ["waiting-approval", "completed"],
      ["waiting-approval", "queued"],
      ["running", "queued"],
    ];

    for (const [from, to] of invalidCases) {
      it(`${from} -> ${to} is invalid`, () => {
        expect(isValidTransition(from, to)).toBe(false);
      });
    }
  });

  it("self-transitions are invalid", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidTransition(status, status)).toBe(false);
    }
  });

  it("VALID_TRANSITIONS covers all 5 statuses as keys", () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });
});
