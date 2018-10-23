class Map<TKey, TValue> {
    public size: number;

    private items: {[key: string]: TValue}; // Type of key is actually TKey

    constructor(other: Map<TKey, TValue> | Array<[TKey, TValue]>) {
        this.items = {};
        this.size = 0;

        if (other instanceof Map) {
            this.size = other.size;
            for (const kvp of other.entries()) {
                this.items[kvp[0] as any] = kvp[1];
            }
        } else if (other !== undefined) {
            this.size = other.length;
            for (const kvp of other) {
                this.items[kvp[0] as any] = kvp[1];
            }
        }
    }

    public clear(): void {
        this.items = {};
        this.size = 0;
        return;
    }

    public delete(key: TKey): boolean {
        const contains = this.has(key);
        if (contains) {
            this.size--;
        }
        this.items[key as any] = undefined;
        return contains;
    }

    public entries(): Array<[TKey, TValue]> {
        const out = [];
        for (const key in this.items) {
            out[out.length] = [key, this.items[key]];
        }
        return out;
    }

    public forEach(callback: (value: TValue, key: TKey, map: Map<TKey, TValue>) => any): void {
        for (const key in this.items) {
            callback(this.items[key], key as any, this);
        }
        return;
    }

    public get(key: TKey): TValue {
        return this.items[key as any];
    }

    public has(key: TKey): boolean {
        return this.items[key as any] !== undefined;
    }

    public keys(): TKey[] {
        const out = [];
        for (const key in this.items) {
            out[out.length] = key;
        }
        return out;
    }

    public set(key: TKey, value: TValue): Map<TKey, TValue> {
        if (!this.has(key)) {
            this.size++;
        }
        this.items[key as any] = value;
        return this;
    }

    public values(): TValue[] {
        const out = [];
        for (const key in this.items) {
            out[out.length] = this.items[key];
        }
        return out;
    }
}
