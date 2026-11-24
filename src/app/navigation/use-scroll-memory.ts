import { useEffect, useLayoutEffect, type RefObject } from "react";
import { useSettings } from "@/lib/settings";
import { useSmoothWheel } from "@/lib/smooth-scroll";
import { useView, type ScrollSnapshot } from "./view";

const RESTORE_RETRY_MS = 60;
const RESTORE_RETRIES = 20;

function anchorOffsetIn(scrollEl: HTMLElement, anchor: HTMLElement): number {
  return (
    anchor.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
  );
}

function pickAnchor(el: HTMLElement, scrollTop: number): { key: string; delta: number } | null {
  const anchors = el.querySelectorAll<HTMLElement>("[data-scroll-anchor]");
  if (anchors.length === 0) return null;
  let best: { key: string; offset: number } | null = null;
  for (const a of anchors) {
    const k = a.dataset.scrollAnchor;
    if (!k) continue;
    const off = anchorOffsetIn(el, a);
    if (off > scrollTop + 1) continue;
    if (!best || off > best.offset) best = { key: k, offset: off };
  }
  if (!best) {
    const first = anchors[0];
    const k = first.dataset.scrollAnchor;
    if (!k) return null;
    return { key: k, delta: scrollTop - anchorOffsetIn(el, first) };
  }
  return { key: best.key, delta: scrollTop - best.offset };
}

function targetForSnap(el: HTMLElement, snap: ScrollSnapshot): number | null {
  if (snap.anchor) {
    const sel = `[data-scroll-anchor="${CSS.escape(snap.anchor)}"]`;
    const anchorEl = el.querySelector<HTMLElement>(sel);
    if (anchorEl) return Math.max(0, anchorOffsetIn(el, anchorEl) + snap.delta);
  }
  return snap.fallback >= 0 ? snap.fallback : null;
}

export function useScrollMemory(
  key: string,
  ref: RefObject<HTMLElement | null>,
  active: boolean = true,
  hideUntilRestored: boolean = false,
) {
  const { rememberScroll, recallScroll } = useView();
  const { settings } = useSettings();
  useSmoothWheel(ref, active && settings.smoothScroll);

  useEffect(() => {
    const onReset = (e: Event) => {
      const detail = (e as CustomEvent<{ view?: string }>).detail;
      if (!detail?.view) return;
      if (detail.view !== key) return;
      const el = ref.current;
      if (!el) return;
      el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    window.addEventListener("harbor:scroll-top", onReset);
    return () => window.removeEventListener("harbor:scroll-top", onReset);
  }, [key, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;

    let restoring = true;
    let settleId: number | null = null;
    let saveTimer: number | null = null;
    let revealId: number | null = null;
    let pendingSnap: ScrollSnapshot | null = null;
    let parked = el.clientHeight === 0;
    let everVisible = !parked;
    let retries = 0;
    let retryId: number | null = null;

    const cancelRetry = () => {
      if (retryId !== null) {
        clearTimeout(retryId);
        retryId = null;
      }
    };

    const initialSnap = recallScroll(key);
    const wantsHide =
      hideUntilRestored && !!initialSnap && (targetForSnap(el, initialSnap) ?? 0) > 8;
    let revealed = !wantsHide;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      el.style.transition = "opacity 160ms ease-out";
      el.style.opacity = "1";
      window.setTimeout(() => {
        el.style.opacity = "";
        el.style.transition = "";
      }, 220);
    };
    if (wantsHide) el.style.opacity = "0";

    const cancelSettle = () => {
      if (settleId !== null) {
        clearTimeout(settleId);
        settleId = null;
      }
    };

    const armSettle = () => {
      cancelSettle();
      settleId = window.setTimeout(() => {
        restoring = false;
        settleId = null;
        reveal();
      }, 30000);
    };

    const tryRestore = (clamp = false) => {
      if (!restoring) return;
      const snap = recallScroll(key);
      if (!snap) {
        restoring = false;
        cancelSettle();
        cancelRetry();
        reveal();
        return;
      }
      if (el.clientHeight === 0) {
        /* The layer is parked, or it has just been shown and has not been laid out yet. Giving up
         * here is what loses the position: the effect runs in the same commit that lifts the park,
         * so the element can still report no height, and the resize observer does not fire for a
         * size that never changed — so nothing came back to try again and the view stayed at the
         * top. Asking again is bounded, so a view that is genuinely empty stops asking. */
        if (retryId === null && retries < RESTORE_RETRIES) {
          retries += 1;
          retryId = window.setTimeout(() => {
            retryId = null;
            tryRestore(clamp);
          }, RESTORE_RETRY_MS);
        }
        return;
      }
      const target = targetForSnap(el, snap);
      if (target === null) {
        restoring = false;
        cancelSettle();
        cancelRetry();
        reveal();
        return;
      }
      const max = el.scrollHeight - el.clientHeight;
      if (max < target - 4 && !clamp) return;
      el.scrollTop = Math.min(target, max);
      restoring = false;
      cancelSettle();
      cancelRetry();
      reveal();
    };

    const capture = (): ScrollSnapshot => {
      const top = el.scrollTop;
      const found = pickAnchor(el, top);
      return {
        anchor: found?.key,
        delta: found?.delta ?? 0,
        fallback: top,
      };
    };
    const saveNow = () => {
      if (el.clientHeight === 0) return;
      rememberScroll(key, capture());
    };

    const cancelSave = () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    };

    const flushParked = () => {
      if (saveTimer === null || restoring || !pendingSnap) return;
      cancelSave();
      rememberScroll(key, pendingSnap);
    };

    const onResize = () => {
      const hidden = el.clientHeight === 0;
      if (hidden && !parked) {
        parked = true;
        flushParked();
        return;
      }
      if (!hidden && parked) {
        parked = false;
        restoring = true;
        armSettle();
        tryRestore(everVisible);
        everVisible = true;
        return;
      }
      if (!hidden) everVisible = true;
      tryRestore();
    };

    const onScroll = () => {
      if (restoring) return;
      if (el.clientHeight === 0) return;
      // Capture geometry while the page is visible. Navigation can hide it
      // before the debounce runs, when anchor offsets can no longer be read.
      pendingSnap = capture();
      cancelSave();
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        if (pendingSnap) rememberScroll(key, pendingSnap);
      }, 200);
    };

    armSettle();
    if (wantsHide) revealId = window.setTimeout(reveal, 220);
    tryRestore();

    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (!restoring && el.clientHeight > 0 && el.scrollTop > 0) saveNow();
      else if (el.clientHeight === 0) flushParked();
      cancelSave();
      cancelSettle();
      cancelRetry();
      if (revealId !== null) clearTimeout(revealId);
      reveal();
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [active, key, ref, rememberScroll, recallScroll, hideUntilRestored]);
}
