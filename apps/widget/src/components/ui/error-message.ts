import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("loy-error")
export class LoyError extends LitElement {
  @property({ type: String }) message = "Something went wrong";
  @property({ type: Boolean }) retryable = false;

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--loy-space-md);
      padding: var(--loy-space-xl);
      text-align: center;
      color: var(--loy-color-text-secondary);
    }
    .icon {
      font-size: 24px;
    }
    .message {
      font-size: var(--loy-font-size-md);
      font-family: var(--loy-font-family);
    }
    button {
      background: var(--loy-color-primary);
      color: var(--loy-color-primary-text);
      border: none;
      padding: var(--loy-space-sm) var(--loy-space-lg);
      border-radius: var(--loy-radius-md);
      font-size: var(--loy-font-size-md);
      font-family: var(--loy-font-family);
      cursor: pointer;
      transition: opacity var(--loy-transition);
    }
    button:hover {
      opacity: 0.9;
    }
  `;

  private handleRetry(): void {
    this.dispatchEvent(new CustomEvent("loy-retry", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <span class="icon">&#9888;</span>
      <span class="message">${this.message}</span>
      ${this.retryable
        ? html`<button
            @click=${() => {
              this.handleRetry();
            }}
          >
            Retry
          </button>`
        : null}
    `;
  }
}
