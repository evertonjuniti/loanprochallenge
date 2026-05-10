import { describe, it, expect } from "vitest";
import {
  validateWorkId,
  validateBranchName,
  validateCommitMessage,
  validatePrTitle,
  validateCommitMessages,
  extractWorkIdFromBranch,
  buildBranchName,
  buildCommitMessage,
  buildPrTitle,
  DEFAULT_WORK_ID_CONFIG,
} from "../src/index.js";

describe("validateWorkId", () => {
  it("accepts a valid Work ID", () => {
    expect(validateWorkId("FIN-123").valid).toBe(true);
    expect(validateWorkId("FIN-123").workId).toBe("FIN-123");
  });

  it("accepts Work IDs from different project prefixes", () => {
    expect(validateWorkId("PLAT-1").valid).toBe(true);
    expect(validateWorkId("DEVEX-9999").valid).toBe(true);
  });

  it("rejects lowercase", () => {
    expect(validateWorkId("fin-123").valid).toBe(false);
  });

  it("rejects missing number", () => {
    expect(validateWorkId("FIN").valid).toBe(false);
  });

  it("rejects free text", () => {
    expect(validateWorkId("add-transaction-validation").valid).toBe(false);
  });
});

describe("validateBranchName", () => {
  it("accepts a valid feature branch", () => {
    const result = validateBranchName("feature/FIN-123-add-transaction-validation");
    expect(result.valid).toBe(true);
    expect(result.workId).toBe("FIN-123");
  });

  it("accepts fix, chore, and hotfix prefixes", () => {
    expect(validateBranchName("fix/PLAT-99-fix-null-pointer").valid).toBe(true);
    expect(validateBranchName("chore/DEVEX-7-update-deps").valid).toBe(true);
    expect(validateBranchName("hotfix/FIN-1-critical-patch").valid).toBe(true);
  });

  it("rejects a branch with no Work ID", () => {
    const result = validateBranchName("feature/add-validation");
    expect(result.valid).toBe(false);
    expect(result.workId).toBeNull();
    expect(result.message).toMatch(/Work ID/);
  });

  it("rejects a bare branch name with no prefix", () => {
    expect(validateBranchName("FIN-123-my-change").valid).toBe(false);
  });

  it("rejects main and develop", () => {
    expect(validateBranchName("main").valid).toBe(false);
    expect(validateBranchName("develop").valid).toBe(false);
  });
});

describe("validateCommitMessage", () => {
  it("accepts a well-formed commit message", () => {
    const result = validateCommitMessage("[FIN-123] Add transaction validation");
    expect(result.valid).toBe(true);
    expect(result.workId).toBe("FIN-123");
  });

  it("only checks the first line of a multi-line message", () => {
    const message = "[FIN-123] Short summary\n\nLonger description here.";
    expect(validateCommitMessage(message).valid).toBe(true);
  });

  it("rejects a commit missing the Work ID", () => {
    const result = validateCommitMessage("Add transaction validation");
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Work ID/);
  });

  it("rejects a commit with an unbracketed Work ID", () => {
    expect(validateCommitMessage("FIN-123 Add transaction validation").valid).toBe(false);
  });
});

describe("validatePrTitle", () => {
  it("accepts a valid PR title", () => {
    const result = validatePrTitle("[FIN-123] Add transaction validation");
    expect(result.valid).toBe(true);
    expect(result.workId).toBe("FIN-123");
  });

  it("rejects a PR title without brackets", () => {
    expect(validatePrTitle("FIN-123: Add transaction validation").valid).toBe(false);
  });
});

describe("validateCommitMessages (batch)", () => {
  it("reports violations for a mixed set", () => {
    const messages = [
      "[FIN-123] Fix payment processor",
      "forgot the work id here",
      "[FIN-123] Add unit tests",
    ];
    const summary = validateCommitMessages(messages);
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.violations).toHaveLength(1);
    expect(summary.violations[0]).toContain("forgot the work id");
  });

  it("returns no violations when all messages are valid", () => {
    const messages = ["[FIN-1] First", "[FIN-2] Second"];
    const summary = validateCommitMessages(messages);
    expect(summary.violations).toHaveLength(0);
  });
});

describe("extractWorkIdFromBranch", () => {
  it("extracts Work ID from a branch name", () => {
    expect(extractWorkIdFromBranch("feature/FIN-123-desc")).toBe("FIN-123");
  });

  it("returns null when no Work ID is present", () => {
    expect(extractWorkIdFromBranch("main")).toBeNull();
  });
});

describe("buildBranchName", () => {
  it("builds a valid branch name", () => {
    expect(buildBranchName("feature", "FIN-123", "add transaction validation")).toBe(
      "feature/FIN-123-add-transaction-validation"
    );
  });

  it("strips special characters from description", () => {
    expect(buildBranchName("fix", "FIN-99", "fix: null/pointer (issue)")).toBe(
      "fix/FIN-99-fix-nullpointer-issue"
    );
  });

  it("produces a branch that passes validateBranchName", () => {
    const branch = buildBranchName("chore", "DEVEX-42", "update ci config");
    expect(validateBranchName(branch).valid).toBe(true);
  });
});

describe("buildCommitMessage", () => {
  it("produces a message that passes validateCommitMessage", () => {
    const msg = buildCommitMessage("FIN-123", "Add transaction validation");
    expect(validateCommitMessage(msg).valid).toBe(true);
  });
});

describe("buildPrTitle", () => {
  it("produces a title that passes validatePrTitle", () => {
    const title = buildPrTitle("FIN-123", "Add transaction validation");
    expect(validatePrTitle(title).valid).toBe(true);
  });
});
