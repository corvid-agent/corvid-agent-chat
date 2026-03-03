/**
 * Chat search — search bar UI, text highlighting, and match navigation
 */
import { store } from '../store.ts';

/** Debounce delay for search input (ms) */
const SEARCH_DEBOUNCE_MS = 150;

/* ── Module state ── */
let searchOpen = false;
let searchQuery = '';
let searchMatches: HTMLElement[] = [];
let searchCurrentIdx = -1;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Captured DOM refs (set during bind) ── */
let outputEl: HTMLElement | null = null;
let searchBar: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let searchCount: HTMLElement | null = null;
let searchPrev: HTMLButtonElement | null = null;
let searchNext: HTMLButtonElement | null = null;
let btnSearch: HTMLElement | null = null;

export function isSearchOpen(): boolean {
  return searchOpen;
}

export function openSearch(): void {
  if (!searchBar || !searchInput) return;
  searchOpen = true;
  searchBar.style.display = '';
  btnSearch?.setAttribute('aria-expanded', 'true');
  searchInput.value = searchQuery;
  searchInput.focus();
  if (searchQuery) {
    executeSearch(searchQuery);
  }
}

export function closeSearch(): void {
  if (!searchBar) return;
  searchOpen = false;
  searchBar.style.display = 'none';
  btnSearch?.setAttribute('aria-expanded', 'false');
  clearSearchHighlights();
  searchQuery = '';
  searchMatches = [];
  searchCurrentIdx = -1;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (searchCount) searchCount.textContent = '';
  btnSearch?.focus();
}

function clearSearchHighlights(): void {
  if (!outputEl) return;
  const highlighted = outputEl.querySelectorAll('.msg--search-match');
  highlighted.forEach((el) => el.classList.remove('msg--search-match'));
  const active = outputEl.querySelectorAll('.msg--search-active');
  active.forEach((el) => el.classList.remove('msg--search-active'));
  // Remove inline highlight spans
  const marks = outputEl.querySelectorAll('mark.search-highlight');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    }
  });
}

function highlightTextInNode(node: Node, regex: RegExp): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const match = regex.exec(text);
    if (!match) return false;

    const span = document.createElement('span');
    const before = text.substring(0, match.index);
    const matched = text.substring(match.index, match.index + match[0].length);
    const after = text.substring(match.index + match[0].length);

    if (before) span.appendChild(document.createTextNode(before));
    const mark = document.createElement('mark');
    mark.className = 'search-highlight';
    mark.textContent = matched;
    span.appendChild(mark);
    if (after) span.appendChild(document.createTextNode(after));

    node.parentNode?.replaceChild(span, node);

    // Recursively highlight the rest (the after text node)
    if (after) {
      const lastChild = span.lastChild;
      if (lastChild) highlightTextInNode(lastChild, regex);
    }
    return true;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    // Skip buttons, time stamps, prompts, and already-highlighted marks
    if (
      el.tagName === 'BUTTON' ||
      el.tagName === 'MARK' ||
      el.classList.contains('msg__time') ||
      el.classList.contains('msg__prompt') ||
      el.classList.contains('msg__copy') ||
      el.classList.contains('msg__status') ||
      el.classList.contains('msg__retry')
    ) {
      return false;
    }
    let found = false;
    // Iterate over a snapshot of child nodes (highlighting mutates the DOM)
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (highlightTextInNode(child, regex)) found = true;
    }
    return found;
  }

  return false;
}

function executeSearch(query: string): void {
  clearSearchHighlights();
  searchMatches = [];
  searchCurrentIdx = -1;

  if (!query || !outputEl) {
    updateSearchNav();
    return;
  }

  // Escape regex special chars and compile once
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRegex = new RegExp(escaped, 'i');

  // Search through the message store for matching content
  const messages = store.getState().chat.messages;
  const matchingIds = new Set<string>();
  for (const msg of messages) {
    if (matchRegex.test(msg.content)) {
      matchingIds.add(msg.id);
    }
  }

  // Highlight matching message elements
  const msgEls = outputEl.querySelectorAll('.msg');
  msgEls.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const msgId = htmlEl.id.replace(/^msg-/, '');
    if (matchingIds.has(msgId)) {
      htmlEl.classList.add('msg--search-match');
      searchMatches.push(htmlEl);
      // Highlight matching text within the .msg__text span
      const textSpan = htmlEl.querySelector('.msg__text');
      if (textSpan) {
        highlightTextInNode(textSpan, new RegExp(escaped, 'gi'));
      }
    }
  });

  if (searchMatches.length > 0) {
    searchCurrentIdx = 0;
    searchMatches[0]!.classList.add('msg--search-active');
    searchMatches[0]!.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  updateSearchNav();
}

function updateSearchNav(): void {
  const total = searchMatches.length;
  if (searchCount) {
    if (!searchQuery) {
      searchCount.textContent = '';
    } else if (total === 0) {
      searchCount.textContent = 'No matches';
    } else {
      searchCount.textContent = `${searchCurrentIdx + 1} of ${total} match${total !== 1 ? 'es' : ''}`;
    }
  }
  if (searchPrev) searchPrev.disabled = total < 2;
  if (searchNext) searchNext.disabled = total < 2;
}

function navigateSearch(direction: 'prev' | 'next'): void {
  if (searchMatches.length === 0) return;
  // Remove active class from current
  searchMatches[searchCurrentIdx]?.classList.remove('msg--search-active');

  if (direction === 'next') {
    searchCurrentIdx = (searchCurrentIdx + 1) % searchMatches.length;
  } else {
    searchCurrentIdx = (searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length;
  }

  searchMatches[searchCurrentIdx]!.classList.add('msg--search-active');
  searchMatches[searchCurrentIdx]!.scrollIntoView({ behavior: 'smooth', block: 'center' });
  updateSearchNav();
}

/**
 * Bind all search-related event listeners.
 * Captures DOM references and returns a cleanup function.
 */
export function bindSearchEvents(chatOutputEl: HTMLElement | null): () => void {
  outputEl = chatOutputEl;
  searchBar = document.getElementById('search-bar');
  searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  searchCount = document.getElementById('search-count');
  searchPrev = document.getElementById('search-prev') as HTMLButtonElement | null;
  searchNext = document.getElementById('search-next') as HTMLButtonElement | null;
  const searchCloseBtn = document.getElementById('search-close');
  btnSearch = document.getElementById('btn-search');

  btnSearch?.addEventListener('click', () => {
    if (searchOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput!.value;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      executeSearch(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateSearch('prev');
      } else {
        navigateSearch('next');
      }
    }
  });

  searchPrev?.addEventListener('click', () => navigateSearch('prev'));
  searchNext?.addEventListener('click', () => navigateSearch('next'));
  searchCloseBtn?.addEventListener('click', () => closeSearch());

  return () => {
    closeSearch();
  };
}

/** Reset search module state (for cleanup) */
export function resetSearchState(): void {
  searchOpen = false;
  searchQuery = '';
  searchMatches = [];
  searchCurrentIdx = -1;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  outputEl = null;
  searchBar = null;
  searchInput = null;
  searchCount = null;
  searchPrev = null;
  searchNext = null;
  btnSearch = null;
}
