import { describe, expect, it, vi } from 'vitest';
import { EventChannel } from '../src/utils/eventChannel';

function make() {
  const onFirstListener = vi.fn();
  const onNoListeners = vi.fn();
  return { channel: new EventChannel<number>({ onFirstListener, onNoListeners }), onFirstListener, onNoListeners };
}

describe('EventChannel', () => {
  it('attaches upstream on the first listener only, and detaches when the last leaves', () => {
    const { channel, onFirstListener, onNoListeners } = make();
    const u1 = channel.subscribe(() => {});
    const u2 = channel.subscribe(() => {});
    expect(onFirstListener).toHaveBeenCalledTimes(1);
    u1();
    expect(onNoListeners).not.toHaveBeenCalled();
    u2();
    expect(onNoListeners).toHaveBeenCalledTimes(1);
  });

  it('delivers values to every listener', () => {
    const { channel } = make();
    const a = vi.fn();
    const b = vi.fn();
    channel.subscribe(a);
    channel.subscribe(b);
    channel.emit(7);
    expect(a).toHaveBeenCalledWith(7);
    expect(b).toHaveBeenCalledWith(7);
  });

  it('unsubscribe is idempotent and does not detach twice', () => {
    const { channel, onNoListeners } = make();
    const unsubscribe = channel.subscribe(() => {});
    unsubscribe();
    unsubscribe();
    expect(onNoListeners).toHaveBeenCalledTimes(1);
  });

  it('counts the same function subscribed twice as two listeners', () => {
    const { channel, onNoListeners } = make();
    const fn = vi.fn();
    const u1 = channel.subscribe(fn);
    const u2 = channel.subscribe(fn);
    u1();
    expect(channel.size).toBe(1);
    expect(onNoListeners).not.toHaveBeenCalled();
    u2();
    expect(onNoListeners).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener is logged and does not block the others', () => {
    const { channel } = make();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    channel.subscribe(() => {
      throw new Error('boom');
    });
    channel.subscribe(after);
    channel.emit(1);
    expect(after).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('clear removes everyone, detaches once, and is safe to repeat', () => {
    const { channel, onNoListeners } = make();
    channel.subscribe(() => {});
    channel.clear();
    channel.clear();
    expect(channel.size).toBe(0);
    expect(onNoListeners).toHaveBeenCalledTimes(1);
  });

  it('works without hooks', () => {
    const channel = new EventChannel<string>();
    const fn = vi.fn();
    channel.subscribe(fn)();
    channel.emit('x');
    expect(fn).not.toHaveBeenCalled();
  });
});
