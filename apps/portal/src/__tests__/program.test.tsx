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

  it("prefers the ?program= URL param over the saved session program", () => {
    sessionStorage.setItem("program-id", "prog_session");
    window.history.replaceState({}, "", "/?program=prog_url");
    expect(resolveProgramId()).toBe("prog_url");
  });

  it("falls back to sessionStorage program-id when there is no URL param", () => {
    sessionStorage.setItem("program-id", "prog_session");
    setConfig({ programId: "prog_config" });
    expect(resolveProgramId()).toBe("prog_session");
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

  it("closes the previous session when ?program= differs from the saved program", () => {
    sessionStorage.setItem("auth-token", "tok");
    sessionStorage.setItem("member-id", "mem-1");
    sessionStorage.setItem("program-id", "prog_old");
    window.history.replaceState({}, "", "/?program=prog_new");

    expect(resolveProgramId()).toBe("prog_new");
    expect(sessionStorage.getItem("program-id")).toBe("prog_new");
    expect(sessionStorage.getItem("auth-token")).toBeNull();
    expect(sessionStorage.getItem("member-id")).toBeNull();
  });

  it("keeps the session when ?program= matches the saved program", () => {
    sessionStorage.setItem("auth-token", "tok");
    sessionStorage.setItem("member-id", "mem-1");
    sessionStorage.setItem("program-id", "prog_same");
    window.history.replaceState({}, "", "/?program=prog_same");

    expect(resolveProgramId()).toBe("prog_same");
    expect(sessionStorage.getItem("auth-token")).toBe("tok");
    expect(sessionStorage.getItem("member-id")).toBe("mem-1");
  });
});
