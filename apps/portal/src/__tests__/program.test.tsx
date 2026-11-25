import { beforeEach, describe, expect, it } from "vitest";

import { resolveProgramId } from "../lib/program";

function setConfig(config: { programId?: string } | undefined): void {
  window.__LOYALTYOS_CONFIG__ = config;
}

describe("resolveProgramId", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setConfig(undefined);
    window.history.replaceState({}, "", "/");
  });

  it("returns null when nothing is configured", () => {
    expect(resolveProgramId()).toBeNull();
  });

  it("prefers sessionStorage program-id (post-login)", () => {
    sessionStorage.setItem("program-id", "prog_session");
    setConfig({ programId: "prog_config" });
    expect(resolveProgramId()).toBe("prog_session");
  });

  it("falls back to the ?program= URL param", () => {
    window.history.replaceState({}, "", "/?program=prog_url");
    expect(resolveProgramId()).toBe("prog_url");
  });

  it("falls back to the runtime config", () => {
    setConfig({ programId: "prog_config" });
    expect(resolveProgramId()).toBe("prog_config");
  });

  it("prefers the URL param over the runtime config", () => {
    window.history.replaceState({}, "", "/?program=prog_url");
    setConfig({ programId: "prog_config" });
    expect(resolveProgramId()).toBe("prog_url");
  });
});
