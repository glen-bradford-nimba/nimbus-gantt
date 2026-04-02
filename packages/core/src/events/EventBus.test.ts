import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('on/emit basic pub/sub', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('test', handler);
    bus.emit('test');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off removes listener', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('test', handler);
    bus.off('test', handler);
    bus.emit('test');

    expect(handler).not.toHaveBeenCalled();
  });

  it('on returns unsubscribe function', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsub = bus.on('test', handler);
    unsub();
    bus.emit('test');

    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple listeners on same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('test', handler1);
    bus.on('test', handler2);
    bus.emit('test');

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('emit with arguments', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('data', handler);
    bus.emit('data', 42, 'hello', { key: 'value' });

    expect(handler).toHaveBeenCalledWith(42, 'hello', { key: 'value' });
  });

  it('unsubscribe during emit does not crash', () => {
    const bus = new EventBus();
    const calls: string[] = [];

    const unsub1 = bus.on('test', () => {
      calls.push('first');
      unsub1(); // unsubscribe self during emit
    });

    bus.on('test', () => {
      calls.push('second');
    });

    // Should not throw
    bus.emit('test');
    expect(calls).toEqual(['first', 'second']);

    // Emit again — first handler should be gone
    calls.length = 0;
    bus.emit('test');
    expect(calls).toEqual(['second']);
  });

  it('emitting an event with no listeners does nothing', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nonexistent')).not.toThrow();
  });

  it('off on non-existent event does nothing', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    expect(() => bus.off('nonexistent', handler)).not.toThrow();
  });

  it('different events are independent', () => {
    const bus = new EventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bus.on('eventA', handlerA);
    bus.on('eventB', handlerB);

    bus.emit('eventA');

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });
});
