// Renders to the G2. Two layouts, switched via rebuildPageContainer:
//   - text: a single full-screen text container (mirror / transcript / status)
//   - list: a native List container for session selection (firmware handles
//           highlight + up/down navigation, which a text container can't).
//
// Text updates use textContainerUpgrade (flicker-free). Switching layout or
// changing list items requires a rebuild.

import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';

const CONTAINER_ID = 1;
const TEXT_NAME = 'main';
const LIST_NAME = 'list';
// Lines that fit one glasses screen (below the 1-line header). Keep small enough
// that content never overflows — otherwise the firmware adds its own scroll that
// fights our paging. Tune on hardware.
const VISIBLE_LINES = 9;
const PAGE_STEP = 7; // lines moved per swipe (slight overlap with VISIBLE_LINES)

type Layout = 'none' | 'text' | 'list';

export class GlassesUI {
  private header = '';
  private body = '';
  private pageStart = 0;
  private layout: Layout = 'none';
  private bridge: EvenAppBridge;
  private mirror: HTMLElement | null = null;

  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge;
    this.mirror = createMirror();
  }

  async init(): Promise<void> {
    await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [this.textContainer(this.compose())],
      }),
    );
    this.layout = 'text';
  }

  setHeader(text: string): void {
    this.header = text;
    void this.flush();
  }

  // Replace the body text. follow=true keeps the view pinned to the latest tail.
  setBody(text: string, follow = true): void {
    this.body = text;
    if (follow) this.pageStart = this.maxStart();
    else this.pageStart = Math.min(this.pageStart, this.maxStart());
    void this.flush();
  }

  // Switch to a native scrollable selection list. Called once when entering the
  // picker; the firmware then handles highlight movement on swipe.
  async showList(items: string[]): Promise<void> {
    const itemName = items.map((s) => s.slice(0, 60));
    const list = new ListContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID: CONTAINER_ID,
      containerName: LIST_NAME,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: itemName.length,
        itemWidth: 568,
        isItemSelectBorderEn: 1,
        itemName,
      }),
    });
    try {
      await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum: 1, listObject: [list] }),
      );
      this.layout = 'list';
    } catch {
      /* transient; caller may retry */
    }
    if (this.mirror) {
      this.mirror.textContent =
        'Select a session:\n\n' + itemName.map((n) => `  ${n}`).join('\n');
    }
  }

  pageDown(): void {
    this.pageStart = Math.min(this.maxStart(), this.pageStart + PAGE_STEP);
    void this.flush();
  }

  pageUp(): void {
    this.pageStart = Math.max(0, this.pageStart - PAGE_STEP);
    void this.flush();
  }

  atTop(): boolean {
    return this.pageStart === 0;
  }

  atBottom(): boolean {
    return this.pageStart >= this.maxStart();
  }

  // pageStart is a LINE index into the body.
  private maxStart(): number {
    return Math.max(0, this.body.split('\n').length - VISIBLE_LINES);
  }

  private compose(): string {
    const all = this.body.split('\n');
    const slice = all
      .slice(this.pageStart, this.pageStart + VISIBLE_LINES)
      .join('\n');
    const hasAbove = this.pageStart > 0;
    const hasBelow = this.pageStart < this.maxStart();
    const nav = `${hasAbove ? '▲' : ' '} ${hasBelow ? '▼' : ' '}`;
    const head = this.header ? `${this.header}   ${nav}\n` : `${nav}\n`;
    return `${head}${slice}`;
  }

  private textContainer(content: string): TextContainerProperty {
    return new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID: CONTAINER_ID,
      containerName: TEXT_NAME,
      content,
      isEventCapture: 1,
    });
  }

  // Pushes the current text content. If we're on the list layout, rebuild back
  // to the text container first.
  private async flush(): Promise<void> {
    const content = this.compose();
    if (this.mirror) this.mirror.textContent = content;
    try {
      if (this.layout !== 'text') {
        await this.bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 1,
            textObject: [this.textContainer(content)],
          }),
        );
        this.layout = 'text';
        return;
      }
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER_ID,
          containerName: TEXT_NAME,
          content,
        }),
      );
    } catch {
      /* host not ready or transient; next update will retry */
    }
  }
}

// Mirrors the glasses display into the phone WebView DOM so it's visible/
// debuggable on the phone (the WebView is otherwise blank — UI lives on glasses).
function createMirror(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('pre');
  el.id = 'mirror';
  el.style.cssText = [
    'margin:0',
    'padding:12px',
    'min-height:100vh',
    'box-sizing:border-box',
    'background:#000',
    'color:#36ff6a',
    'font:14px/1.4 ui-monospace,Menlo,Consolas,monospace',
    'white-space:pre-wrap',
    'word-break:break-word',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
