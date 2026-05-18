import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("loy-empty")
export class LoyEmpty extends LitElement {
  @property({ type: String }) override title = "Nothing here yet";
  @property({ type: String }) description = "";

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--loy-space-sm);
      padding: var(--loy-space-xl);
      text-align: center;
      color: var(--loy-color-text-secondary);
    }
    .title {
      font-size: var(--loy-font-size-lg);
      font-weight: var(--loy-font-weight-semibold);
      color: var(--loy-color-text);
      font-family: var(--loy-font-family);
    }
    .description {
      font-size: var(--loy-font-size-md);
      font-family: var(--loy-font-family);
    }
  `;

  override render() {
    return html`
      <slot name="icon"></slot>
      <span class="title">${this.title}</span>
      ${this.description ? html`<span class="description">${this.description}</span>` : null}
    `;
  }
}
