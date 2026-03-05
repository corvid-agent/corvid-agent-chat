/**
 * Tests for chat-search — search bar UI, highlighting, and match navigation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage } from '../types.ts';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Hoisted mocks ──
const { mockStore } = vi.hoisted(() => {
  const messages: ChatMessage[] = [];
  return {
    mockStore: {
      getState: vi.fn(() => ({
        chat: { messages },
      })),
      _setMessages(msgs: ChatMessage[]) {
        messages.length = 0;
        messages.push(...msgs);
      },
    },
  };
});

vi.mock('../store.ts', () => ({ store: mockStore }));

import {
  isSearchOpen,
  bindSearchEvents,
  resetSearchState,
} from './chat-search.ts';

function makeMsg(id: string, content: string): ChatMessage {
  return {
    id,
    content,
    direction: 'sent',
    timestamp: new Date('2026-03-05T12:00:00Z'),
    status: 'confirmed',
  };
}

/** Set up the full search bar HTML and bind events */
function setupSearchDOM(messages: ChatMessage[] = []): HTMLElement {
  mockStore._setMessages(messages);

  document.body.innerHTML = `
    <button id="btn-search" aria-expanded="false">Search</button>
    <div id="search-bar" style="display: none;">
      <input id="search-input" type="text" />
      <span id="search-count"></span>
      <button id="search-prev" disabled>Prev</button>
      <button id="search-next" disabled>Next</button>
      <button id="search-close">Close</button>
    </div>
    <div id="output">
      ${messages.map((m) => `
        <div class="msg" id="msg-${m.id}">
          <span class="msg__time">12:00</span>
          <span class="msg__prompt">[you]</span>
          <span class="msg__text">${m.content}</span>
          <button class="msg__copy">Copy</button>
        </div>
      `).join('')}
    </div>
  `;

  const outputEl = document.getElementById('output');
  bindSearchEvents(outputEl);
  return outputEl!;
}

describe('chat-search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetSearchState();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('open/close search', () => {
    it('starts with search closed', () => {
      setupSearchDOM();
      expect(isSearchOpen()).toBe(false);
    });

    it('opens search bar on button click', () => {
      setupSearchDOM();
      const btn = document.getElementById('btn-search')!;
      btn.click();
      expect(isSearchOpen()).toBe(true);
      expect(document.getElementById('search-bar')?.style.display).toBe('');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('focuses search input when opened', () => {
      setupSearchDOM();
      const input = document.getElementById('search-input') as HTMLInputElement;
      const focusSpy = vi.spyOn(input, 'focus');
      document.getElementById('btn-search')!.click();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('closes search bar on close button click', () => {
      setupSearchDOM();
      document.getElementById('btn-search')!.click();
      expect(isSearchOpen()).toBe(true);
      document.getElementById('search-close')!.click();
      expect(isSearchOpen()).toBe(false);
      expect(document.getElementById('search-bar')?.style.display).toBe('none');
    });

    it('toggles search bar on search button click', () => {
      setupSearchDOM();
      const btn = document.getElementById('btn-search')!;
      btn.click();
      expect(isSearchOpen()).toBe(true);
      btn.click();
      expect(isSearchOpen()).toBe(false);
    });

    it('sets aria-expanded to false when closed', () => {
      setupSearchDOM();
      const btn = document.getElementById('btn-search')!;
      btn.click();
      document.getElementById('search-close')!.click();
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('returns focus to search button on close', () => {
      setupSearchDOM();
      const btn = document.getElementById('btn-search')!;
      const focusSpy = vi.spyOn(btn, 'focus');
      btn.click();
      document.getElementById('search-close')!.click();
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('search execution', () => {
    it('highlights matching messages', () => {
      const msgs = [
        makeMsg('1', 'Hello world'),
        makeMsg('2', 'Goodbye world'),
        makeMsg('3', 'Hello again'),
      ];
      setupSearchDOM(msgs);

      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));

      // Debounce timer
      vi.advanceTimersByTime(200);

      const matches = document.querySelectorAll('.msg--search-match');
      expect(matches.length).toBe(2);
      const count = document.getElementById('search-count')!;
      expect(count.textContent).toContain('1 of 2');
    });

    it('shows "No matches" for unmatched query', () => {
      setupSearchDOM([makeMsg('1', 'Hello')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'zzzzz';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.getElementById('search-count')!.textContent).toBe('No matches');
    });

    it('shows empty count text when query is cleared', () => {
      setupSearchDOM([makeMsg('1', 'Hello')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      input.value = '';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.getElementById('search-count')!.textContent).toBe('');
    });

    it('case-insensitive search', () => {
      setupSearchDOM([makeMsg('1', 'Hello World')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'hello';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.querySelectorAll('.msg--search-match').length).toBe(1);
    });

    it('escapes regex special characters in query', () => {
      setupSearchDOM([makeMsg('1', 'price is $10.00')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = '$10.00';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.querySelectorAll('.msg--search-match').length).toBe(1);
    });

    it('activates first match with msg--search-active class', () => {
      setupSearchDOM([makeMsg('1', 'Hello'), makeMsg('2', 'Hello')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      const active = document.querySelectorAll('.msg--search-active');
      expect(active.length).toBe(1);
      expect(active[0]!.id).toBe('msg-1');
    });

    it('scrolls active match into view', () => {
      setupSearchDOM([makeMsg('1', 'Hello')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('inserts highlight marks in matching text nodes', () => {
      setupSearchDOM([makeMsg('1', 'Hello world')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'world';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      const marks = document.querySelectorAll('mark.search-highlight');
      expect(marks.length).toBeGreaterThanOrEqual(1);
      expect(marks[0]!.textContent).toBe('world');
    });
  });

  describe('search navigation', () => {
    function setupWithMatches() {
      setupSearchDOM([
        makeMsg('1', 'Match here'),
        makeMsg('2', 'Match there'),
        makeMsg('3', 'Match everywhere'),
      ]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Match';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);
    }

    it('navigates to next match on Next button click', () => {
      setupWithMatches();
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-1');

      document.getElementById('search-next')!.click();
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-2');
    });

    it('wraps around to first match after last', () => {
      setupWithMatches();
      document.getElementById('search-next')!.click(); // -> 2
      document.getElementById('search-next')!.click(); // -> 3
      document.getElementById('search-next')!.click(); // -> 1 (wrap)
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-1');
    });

    it('navigates to previous match on Prev button click', () => {
      setupWithMatches();
      document.getElementById('search-next')!.click(); // -> 2
      document.getElementById('search-prev')!.click(); // -> 1
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-1');
    });

    it('wraps to last match when pressing Prev at first', () => {
      setupWithMatches();
      document.getElementById('search-prev')!.click(); // wrap -> 3
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-3');
    });

    it('updates count display on navigation', () => {
      setupWithMatches();
      expect(document.getElementById('search-count')!.textContent).toBe('1 of 3 matches');
      document.getElementById('search-next')!.click();
      expect(document.getElementById('search-count')!.textContent).toBe('2 of 3 matches');
    });

    it('disables nav buttons when fewer than 2 matches', () => {
      setupSearchDOM([makeMsg('1', 'Unique text')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Unique';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect((document.getElementById('search-prev') as HTMLButtonElement).disabled).toBe(true);
      expect((document.getElementById('search-next') as HTMLButtonElement).disabled).toBe(true);
      expect(document.getElementById('search-count')!.textContent).toBe('1 of 1 match');
    });
  });

  describe('keyboard shortcuts', () => {
    it('closes search on Escape key', () => {
      setupSearchDOM();
      document.getElementById('btn-search')!.click();
      expect(isSearchOpen()).toBe(true);

      const input = document.getElementById('search-input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(isSearchOpen()).toBe(false);
    });

    it('navigates to next match on Enter key', () => {
      setupSearchDOM([makeMsg('1', 'Test'), makeMsg('2', 'Test')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Test';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-1');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-2');
    });

    it('navigates to previous match on Shift+Enter', () => {
      setupSearchDOM([makeMsg('1', 'Test'), makeMsg('2', 'Test'), makeMsg('3', 'Test')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Test';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      expect(document.querySelector('.msg--search-active')?.id).toBe('msg-3');
    });
  });

  describe('clearSearchHighlights', () => {
    it('removes highlight marks and classes on close', () => {
      setupSearchDOM([makeMsg('1', 'Hello world')]);
      document.getElementById('btn-search')!.click();
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200);

      expect(document.querySelectorAll('.msg--search-match').length).toBe(1);
      expect(document.querySelectorAll('mark.search-highlight').length).toBeGreaterThan(0);

      document.getElementById('search-close')!.click();

      expect(document.querySelectorAll('.msg--search-match').length).toBe(0);
      expect(document.querySelectorAll('mark.search-highlight').length).toBe(0);
    });
  });

  describe('resetSearchState', () => {
    it('clears all module state', () => {
      setupSearchDOM();
      document.getElementById('btn-search')!.click();
      expect(isSearchOpen()).toBe(true);
      resetSearchState();
      expect(isSearchOpen()).toBe(false);
    });
  });
});
