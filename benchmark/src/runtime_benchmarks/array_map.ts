export default function arrayMap() {
    const n = 100000;
    const array = [1, 2, 3, 4, 3, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        array.map(value => value * 2);
    }
}
