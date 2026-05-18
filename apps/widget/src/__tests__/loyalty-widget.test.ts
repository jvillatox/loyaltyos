/* eslint-disable @typescript-eslint/no-non-null-assertion */

import "../components/loyalty-widget.js";

import { fixture } from "@open-wc/testing";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { describe, expect, it } from "vitest";

import type { LoyaltyWidget } from "../components/loyalty-widget.js";
import { WidgetConfigController } from "../lib/widget-config.js";

describe("LoyaltyWidget", () => {
  it("renders tab navigation", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-widget>
    `);

    const tabs = Array.from(el.shadowRoot!.querySelectorAll(".tab-btn"));
    expect(tabs.length).toBe(7);
    expect(tabs[0]!.textContent.trim()).toBe("Home");
  });

  it("switches active tab on click", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget
        api-key="key1"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></loyalty-widget>
    `);

    const tabs = Array.from(el.shadowRoot!.querySelectorAll(".tab-btn"));

    // Click "Points" tab (index 1)
    (tabs[1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect(tabs[1]!.classList.contains("active")).toBe(true);
    expect(tabs[0]!.classList.contains("active")).toBe(false);
  });

  it("shows message when config is missing", async () => {
    const el = await fixture<LoyaltyWidget>(html` <loyalty-widget></loyalty-widget> `);

    expect(el.shadowRoot!.textContent).toContain("Please provide configuration");
  });
});

describe("WidgetConfigController", () => {
  it("reads config from own attributes", async () => {
    @customElement("test-config-element")
    class TestConfigElement extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const el = await fixture<TestConfigElement>(html`
      <test-config-element
        api-key="my-key"
        api-url="http://localhost"
        program-id="pgm"
        member-id="mem"
      ></test-config-element>
    `);

    expect(el.controller.hasConfig).toBe(true);
    expect(el.controller.config).toMatchObject({
      apiKey: "my-key",
      apiUrl: "http://localhost",
      programId: "pgm",
      memberId: "mem",
    });
  });

  it("hasConfig is false when attributes are missing", async () => {
    @customElement("test-config-incomplete")
    class TestConfigIncomplete extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const el = await fixture<TestConfigIncomplete>(html`
      <test-config-incomplete api-key="key1"></test-config-incomplete>
    `);

    expect(el.controller.hasConfig).toBe(false);
  });

  it("falls back to parent loyalty-widget config", async () => {
    @customElement("test-config-child")
    class TestConfigChild extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const parent = await fixture<LoyaltyWidget>(html`
      <loyalty-widget
        api-key="parent-key"
        api-url="http://parent"
        program-id="parent-pgm"
        member-id="parent-mem"
      ></loyalty-widget>
    `);

    const child = document.createElement("test-config-child") as TestConfigChild;
    parent.appendChild(child);
    await parent.updateComplete;

    expect(child.controller.hasConfig).toBe(true);
    expect(child.controller.config.apiKey).toBe("parent-key");
  });
});
