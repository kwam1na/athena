export class LocalStorageSync<T extends { [key: string]: any }> { // Now T is expected to be an object with string keys.
    key: string;

    constructor(key: string) {
        this.key = key;
    }

    save(data: T) {
        localStorage.setItem(this.key, JSON.stringify(data));
    }

    update(id: string, updatedData: Partial<T>) {
        const items = this.getAll();
        items[id] = updatedData;
        this.save(items);
    }

    remove(id: string) {
        const items = this.getAll();
        delete items[id];
        this.save(items);
    }

    getAll() {
        return JSON.parse(localStorage.getItem(this.key) || '{}');
    }

    get(id: string): T[keyof T] | undefined {
        const items = this.getAll();
        return items[id];
    }

    getAllWithAlternateKey(key: string) {
        return JSON.parse(localStorage.getItem(key) || '{}');
    }

    getWithAlternateKey(key: string, id: string): T[keyof T] | undefined {
        const items = this.getAllWithAlternateKey(key);
        return items[id];
    }

    removeWithAlternateKey(key: string, id: string) {
        const items = this.getAllWithAlternateKey(key);
        delete items[id];
        this.save(items);
    }

    saveWithAlternateKey(key: string, data: T) {
        console.log('received key:', key)
        localStorage.setItem(key, JSON.stringify(data));
    }

    updateWithAlternateKey(key: string, id: string, updatedData: Partial<T>) {
        const items = this.getAllWithAlternateKey(key);
        items[id] = updatedData;
        this.saveWithAlternateKey(key, items);
    }
}