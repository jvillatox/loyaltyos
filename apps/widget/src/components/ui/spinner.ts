import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import { widgetT } from "../../i18n.js";
import type { WidgetLocale } from "../../types.js";

@customElement("loy-spinner")
export class LoySpinner extends LitElement {
  @property({ type: String }) locale: WidgetLocale = "es-MX";

  static override styles = css`
    :host {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: var(--loy-space-xl);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--loy-color-border);
      border-top-color: var(--loy-color-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  override render() {
    return html`<div
      class="spinner"
      aria-label=${widgetT("widget.loading", undefined, this.locale)}
    ></div>`;
  }
}
