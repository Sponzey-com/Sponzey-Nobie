class TypedEventBus {
    listeners = new Map();
    on(event, listener) {
        const key = event;
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        const set = this.listeners.get(key);
        set.add(listener);
        return () => set.delete(listener);
    }
    emit(event, payload) {
        const key = event;
        const set = this.listeners.get(key);
        if (!set)
            return;
        for (const listener of set) {
            void Promise.resolve(listener(payload)).catch((err) => {
                console.error(`[events] Unhandled error in listener for "${key}":`, err);
            });
        }
    }
    once(event, listener) {
        const unsub = this.on(event, (payload) => {
            unsub();
            return listener(payload);
        });
        return unsub;
    }
}
export const eventBus = new TypedEventBus();
//# sourceMappingURL=index.js.map