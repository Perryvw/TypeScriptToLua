export default function arrayReduce() {
    const n = 200000;
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 7, 10];
    for (let i = 0; i < n; i++) {
        array.reduce((prev, cur, i) => prev + cur + i, 1);
    }
}
