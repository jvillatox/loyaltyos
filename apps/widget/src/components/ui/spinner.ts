import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("loy-spinner")
export class LoySpinner extends LitElement {
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
    return html`<div class="spinner" aria-label="Loading"></div>`;
  }
}
