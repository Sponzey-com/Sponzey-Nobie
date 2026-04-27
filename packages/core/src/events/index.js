class TypedEventBus {
    listeners = new Map();
    on(event, listener) {
        const key = event;
        let set = this.listeners.get(key);
        if (!set) {
            set = new Set();
            this.listeners.set(key, set);
        }
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