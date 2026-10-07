// Tiny tween engine (stands in for Roblox's TweenService). One requestAnimationFrame loop drives
// every tween; starting a tween on the same target+channel cancels the previous one.

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  quad: (t: number) => 1 - (1 - t) * (1 - t),
  quart: (t: number) => 1 - (1 - t) ** 4,
  back: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

interface Anim { start: number; delay: number; duration: number; from: number; to: number; apply: (v: number) => void; easing: Ease; done?: () => void }
const active = new Map<object, Map<string, Anim>>();
let running = false;

function frame(now: number) {
  for (const [target, channels] of active) {
    for (const [channel, a] of channels) {
      const elapsed = now - a.start - a.delay;
      if (elapsed < 0) continue;
      const k = a.duration <= 0 ? 1 : Math.min(1, elapsed / a.duration);
      a.apply(a.from + (a.to - a.from) * a.easing(k));
      if (k >= 1) {
        channels.delete(channel);
        a.done?.();
      }
    }
    if (!channels.size) active.delete(target);
  }
  if (active.size) requestAnimationFrame(frame); else running = false;
}

export function tween(target: object, channel: string, from: number, to: number, seconds: number,
  apply: (v: number) => void, easing: Ease = ease.quad, delay = 0, done?: () => void) {
  let channels = active.get(target);
  if (!channels) active.set(target, (channels = new Map()));
  channels.set(channel, { start: performance.now(), delay: delay * 1000, duration: seconds * 1000, from, to, apply, easing, done });
  if (seconds <= 0 && delay <= 0) {
    apply(to);
    channels.delete(channel);
    done?.();
    return;
  }
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

export function cancel(target: object, channel?: string) {
  const channels = active.get(target);
  if (!channels) return;
  if (channel) channels.delete(channel); else channels.clear();
}

// convenience helpers for elements

/** UIScale pop: snap to `from`, ease back to 1 */
export function pop(el: HTMLElement, from: number, seconds: number, easing: Ease = ease.quad) {
  tween(el, 'scale', from, 1, seconds, v => el.style.setProperty('--s', String(v)), easing);
}
export function fade(el: HTMLElement, to: number, seconds: number, delay = 0, easing: Ease = ease.quad, done?: () => void) {
  const from = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);
  tween(el, 'opacity', from, to, seconds, v => { el.style.opacity = String(v); }, easing, delay, done);
}
