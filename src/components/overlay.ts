// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson

/**
 * THE MODAL DISMISSAL CONTRACT.
 *
 * A visitor who opens an overlay must ALWAYS be able to get out of it. There is
 * no such thing as an overlay with one way out, so every overlay opened through
 * this module ships all four exits and they are not alternatives:
 *
 *   1. A close control with a real 44x44 hit area, INSIDE the overlay bounds.
 *   2. A tap anywhere outside the panel — a `pointerdown` listener on a scrim
 *      that genuinely covers the viewport. `pointerdown` covers mouse, touch and
 *      pen in ONE handler and fires where a synthetic click would not.
 *   3. Escape, from anywhere on the page.
 *   4. The scrim is reachable: position:fixed, inset:0, below the panel but
 *      above the page, and never pointer-events:none.
 *
 * Two rules that look like details and are not:
 *
 * - ONE EVENT FAMILY PER CONTROL. Attaching both `touchstart` and `click` to the
 *   same button makes a single tap fire twice: it closes and instantly reopens,
 *   which a user experiences as "the close button does nothing".
 *
 * - THE PANEL IS DETACHED FROM THE DOM WHEN CLOSED, never parked at
 *   translateX(100%). An off-canvas panel that is merely transformed is still a
 *   real box on iOS Safari and silently scrolls the page sideways; `overflow-x:
 *   clip` on the body neither fixes that nor lets scrollWidth detect it.
 *
 * Dismissal is verified by COMPUTED STYLE in the test suite, never by "the
 * handler ran" — a handler can fire correctly every time and still be unable to
 * take effect if CSS keeps the element displayed.
 */

import { hideTooltip } from './tooltip';

let openCount = 0;

export interface OverlayHandle {
  close(): void;
  readonly panel: HTMLElement;
}

interface OverlayOptions {
  className: string;
  labelledBy?: string;
  onClose?: () => void;
}

function lockScroll(): void {
  openCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockScroll(): void {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) document.body.style.overflow = '';
}

export function openOverlay(build: (panel: HTMLElement) => void, opts: OverlayOptions): OverlayHandle {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const panel = document.createElement('div');
  panel.className = opts.className;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (opts.labelledBy) panel.setAttribute('aria-labelledby', opts.labelledBy);
  panel.tabIndex = -1;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'close-btn';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';

  build(panel);
  panel.appendChild(closeBtn);

  const previouslyFocused = document.activeElement as HTMLElement | null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    // Remove, do not hide. See the iOS note above.
    scrim.remove();
    panel.remove();
    unlockScroll();
    opts.onClose?.();
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  };

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    // Focus trap: keep Tab inside the panel while it is open.
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // `pointerdown` on the scrim only — one event family, so a tap cannot
  // double-fire and reopen what it just closed.
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  closeBtn.addEventListener('click', close);
  // A pointerdown that starts inside the panel must not bubble to a document
  // handler and close the overlay mid-drag.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.addEventListener('keydown', onKeydown, true);

  document.body.appendChild(scrim);
  document.body.appendChild(panel);
  lockScroll();
  // The pointer has not moved, so whatever it was hovering will never receive a
  // mouseout and its tooltip would hang over the overlay.
  hideTooltip();
  panel.focus();

  return { close, panel };
}

/** The About / methodology modal. */
export function openModal(html: string, titleId = 'modal-title'): OverlayHandle {
  return openOverlay((panel) => { panel.innerHTML = html; }, { className: 'modal', labelledBy: titleId });
}

/** The right-hand drill-down drawer. */
export function openDrawer(html: string, onClose?: () => void, labelledBy = 'dd-title'): OverlayHandle {
  // A dialog with no accessible name announces only as "dialog". The company
  // drawer is where every view routes, so the reader would have no idea which
  // company they had just opened.
  return openOverlay((panel) => { panel.innerHTML = html; },
    { className: 'drawer', labelledBy, onClose });
}

/**
 * The glossary popover. Lighter than a modal — no scrim — but it still must be
 * dismissible by Escape, by clicking anywhere else, and by scroll/resize, or it
 * becomes a sticker on the page.
 */
let activePop: HTMLElement | null = null;

export function closeGlossary(): void {
  if (activePop) { activePop.remove(); activePop = null; }
}

export function showGlossary(anchor: Element, term: string, definition: string): void {
  closeGlossary();
  const pop = document.createElement('div');
  pop.className = 'glossary-pop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `<h4></h4><p></p>`;
  pop.querySelector('h4')!.textContent = term;
  pop.querySelector('p')!.textContent = definition;
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 8;
  if (left + pr.width > window.innerWidth - 12) left = window.innerWidth - pr.width - 12;
  if (top + pr.height > window.innerHeight - 12) top = Math.max(12, r.top - pr.height - 8);
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${top}px`;
  activePop = pop;

  // Deferred so the click that opened it does not immediately close it.
  setTimeout(() => {
    const off = (e: Event) => {
      if (activePop && !activePop.contains(e.target as Node)) {
        closeGlossary();
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGlossary(); });
window.addEventListener('scroll', closeGlossary, true);
window.addEventListener('resize', closeGlossary);
