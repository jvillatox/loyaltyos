/* eslint-disable @typescript-eslint/no-non-null-assertion */
import "../components/loyalty-widget.js";

import { fixture } from "@open-wc/testing";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { describe, expect, it } from "vitest";

import type { LoyaltyWidget } from "../components/loyalty-widget.js";
import { WidgetConfigController } from "../lib/widget-config.js";

describe("LoyaltyWidget", () => {
  it("renders mini mode with points card and portal link", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
        mode="mini"
      ></loyalty-widget>
    `);

    const root = el.shadowRoot!;

    // Portal link points to the full portal
    const link = root.querySelector(".portal-link");
    expect(link).not.toBeNull();
    expect(link!.textContent.trim()).toContain("View rewards in portal");

    // Points card is present
    const pointsCard = root.querySelector("loyalty-points-card");
    expect(pointsCard).not.toBeNull();
  });

  it("renders full mode with sections", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
        mode="full"
      ></loyalty-widget>
    `);

    const root = el.shadowRoot!;

    // All sections present
    expect(root.querySelector("loyalty-points-card")).not.toBeNull();
    expect(root.querySelector("loyalty-badges-gallery")).not.toBeNull();
    expect(root.querySelector("loyalty-rewards-top3")).not.toBeNull();
    expect(root.querySelector("loyalty-tier-card")).not.toBeNull();
  });

  it("shows auth CTA when no auth-token", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget program-id="pgm" api-base="http://localhost"></loyalty-widget>
    `);

    const root = el.shadowRoot!;
    const cta = root.querySelector(".auth-cta");
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain("Sign in");
  });

  it("shows message when config is missing", async () => {
    const el = await fixture<LoyaltyWidget>(html` <loyalty-widget></loyalty-widget> `);

    expect(el.shadowRoot!.textContent).toContain("Please provide configuration");
  });

  it("dismisses auth CTA when 'Not now' is clicked", async () => {
    const el = await fixture<LoyaltyWidget>(html`
      <loyalty-widget program-id="pgm" api-base="http://localhost"></loyalty-widget>
    `);

    const root = el.shadowRoot!;
    expect(root.querySelector(".auth-cta")).not.toBeNull();

    // Click "Not now"
    const notNow = root.querySelector("a")!;
    notNow.click();
    await el.updateComplete;

    // Auth CTA should be hidden, widget content shown
    expect(root.querySelector(".auth-cta")).toBeNull();
    expect(root.querySelector("loyalty-points-card")).not.toBeNull();
  });
});

describe("WidgetConfigController", () => {
  it("reads config from own attributes", async () => {
    @customElement("test-config-valid")
    class TestConfigElement extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const el = await fixture<TestConfigElement>(html`
      <test-config-valid
        program-id="pgm"
        api-base="http://localhost"
        auth-token="tok"
        mode="mini"
      ></test-config-valid>
    `);

    expect(el.controller.hasConfig).toBe(true);
    expect(el.controller.config).toMatchObject({
      programId: "pgm",
      apiBase: "http://localhost",
      authToken: "tok",
      mode: "mini",
    });
  });

  it("hasConfig is false when required attributes are missing", async () => {
    @customElement("test-config-invalid")
    class TestConfigIncomplete extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const el = await fixture<TestConfigIncomplete>(html`
      <test-config-invalid program-id="pgm"></test-config-invalid>
    `);

    expect(el.controller.hasConfig).toBe(false);
  });

  it("applies default values", async () => {
    // Mock navigator to return a non-matching locale so the hard fallback kicks in
    const origLanguage = navigator.language;
    Object.defineProperty(navigator, "language", { value: "fr-FR", configurable: true });

    @customElement("test-config-defaults")
    class TestConfigDefaults extends LitElement {
      controller = new WidgetConfigController(this);
    }

    const el = await fixture<TestConfigDefaults>(html`
      <test-config-defaults program-id="pgm" api-base="http://localhost"></test-config-defaults>
    `);

    expect(el.controller.config.theme).toBe("auto");
    expect(el.controller.config.locale).toBe("es-MX");
    expect(el.controller.config.mode).toBe("full");

    Object.defineProperty(navigator, "language", { value: origLanguage, configurable: true });
  });
});
