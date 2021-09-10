export default function arrayFlat() {
    const n = 50000;
    const array = [1, 2, [3, [4, 5], 6], 7, [8, 9], 10];
    for (let i = 0; i < n; i++) {
        array.flat(2);
    }
}
