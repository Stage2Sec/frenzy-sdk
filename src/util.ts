import { EventEmitter } from "events"

function isEventEmitter(obj: any): obj is EventEmitter {
    return (obj as EventEmitter).on !== undefined
}

export function asEventEmitter(obj: any): EventEmitter | undefined {
    if (isEventEmitter(obj)) {
        return obj
    }

    return undefined
}

/**
 * Tests a "thing" for being falsy. See: https://developer.mozilla.org/en-US/docs/Glossary/Falsy
 *
 * @param x - The "thing" whose falsy-ness to test.
 */
export function isFalsy(x: any): x is 0 | '' | null | undefined {
    // NOTE: there's no way to type `x is NaN` currently (as of TypeScript v3.5)
    return x === 0 || x === '' || x === null || x === undefined || x === "null" || (typeof x === 'number' && isNaN(x));
}