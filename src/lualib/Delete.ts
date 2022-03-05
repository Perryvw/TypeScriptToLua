import { __TS__ObjectGetOwnPropertyDescriptors } from "./ObjectGetOwnPropertyDescriptors";

export function __TS__Delete(this: void, target: any, key: any): boolean {
    const descriptors = __TS__ObjectGetOwnPropertyDescriptors(target);
    const descriptor = descriptors[key];
    if (descriptor) {
        if (!descriptor.configurable) {
            throw new TypeError(`Cannot delete property ${key} of ${target}.`);
        }

        descriptors[key] = undefined;
        return true;
    }

    target[key] = undefined;
    return true;
}
