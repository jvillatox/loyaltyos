import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("loy-pagination")
export class LoyPagination extends LitElement {
  @property({ type: Number }) page = 1;
  @property({ type: Number }) totalPages = 1;

  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--loy-space-md);
      padding: var(--loy-space-md);
      font-family: var(--loy-font-family);
      font-size: var(--loy-font-size-md);
      color: var(--loy-color-text-secondary);
    }
    button {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      padding: var(--loy-space-xs) var(--loy-space-md);
      border-radius: var(--loy-radius-sm);
      font-size: var(--loy-font-size-md);
      font-family: var(--loy-font-family);
      cursor: pointer;
      color: var(--loy-color-text);
      transition: background var(--loy-transition);
    }
    button:hover:not(:disabled) {
      background: var(--loy-color-surface-secondary);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .info {
      font-size: var(--loy-font-size-sm);
    }
  `;

  private go(step: number): void {
    this.dispatchEvent(
      new CustomEvent("loy-page-change", {
        detail: { page: this.page + step },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <button
        ?disabled=${this.page <= 1}
        @click=${() => {
          this.go(-1);
        }}
      >
        Previous
      </button>
      <span class="info">Page ${this.page} of ${this.totalPages}</span>
      <button
        ?disabled=${this.page >= this.totalPages}
        @click=${() => {
          this.go(1);
        }}
      >
        Next
      </button>
    `;
  }
}
