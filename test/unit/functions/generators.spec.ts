import * as util from "../../util";

test("generator parameters", () => {
    util.testFunction`
        function* generator(value: number) {
            yield value;
        }

        return generator(5).next();
    `.expectToMatchJsResult();
});

test(".next()", () => {
    util.testFunction`
        function* generator() {
            yield 1;
            yield 2;
            return 3;
        }

        const it = generator();
        return [it.next(), it.next(), it.next(), it.next()];
    `.expectToMatchJsResult();
});

test(".next() with parameters", () => {
    util.testFunction`
        function* generator() {
            return yield 0;
        }

        const it = generator();
        return [it.next(1), it.next(2), it.next(3)];
    `.expectToMatchJsResult();
});

test("for..of", () => {
    util.testFunction`
        function* generator() {
            yield 1;
            yield 2;
            yield undefined;
            return 3;
        }

        const results = [];
        for (const value of generator()) {
            results.push({ value });
        }
        return results;
    `.expectToMatchJsResult();
});

describe("yield*", () => {
    test("generator", () => {
        util.testFunction`
            function* subGenerator() {
                yield 1;
                yield 2;
                yield 3;
            }

            function* generator() {
                yield 0;
                return yield* subGenerator();
            }

            const it = generator();
            return [it.next(), it.next(), it.next(), it.next(), it.next()];
        `.expectToMatchJsResult();
    });

    test("array", () => {
        util.testFunction`
            function* generator() {
                return yield* [1, 2, 3];
            }

            const it = generator();
            return [it.next(), it.next(), it.next(), it.next()];
        `.expectToMatchJsResult();
    });

    test("string", () => {
        util.testFunction`
            function* generator() {
                return yield* "abc";
            }

            const it = generator();
            return [it.next(), it.next(), it.next(), it.next()];
        `.expectToMatchJsResult();
    });

    test("iterable", () => {
        util.testFunction`
            function* generator() {
                return yield* new Set([1, 2, 3]);
            }

            const it = generator();
            return [it.next(), it.next(), it.next(), it.next()];
        `.expectToMatchJsResult();
    });
});

test("function expression", () => {
    util.testFunction`
        const generator = function*() {
            return true;
        }

        return generator().next();
    `.expectToMatchJsResult();
});

test("class method", () => {
    util.testFunction`
        class A {
            *generator() {
                return true;
            }
        }

        return new A().generator().next();
    `.expectToMatchJsResult();
});

test("object member", () => {
    util.testFunction`
        const a = {
            *generator() {
                return true;
            }
        }

        return a.generator().next();
    `.expectToMatchJsResult();
});

test("hoisting", () => {
    util.testFunction`
        return generator().next();

        function* generator() {
            return true;
        }
    `.expectToMatchJsResult();
});

util.testEachVersion(
    "generator yield inside try/catch",
    () => util.testFunction`
        function* generator() {
            try {
                yield 4;
            } catch {
                throw "something went wrong";
            }
        }
        return generator().next();
    `,
    // Cannot execute LuaJIT with test runner
    util.expectEachVersionExceptJit(builder => builder.expectToMatchJsResult())
);
