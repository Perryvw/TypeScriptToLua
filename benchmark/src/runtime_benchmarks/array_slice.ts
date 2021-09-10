export default function arraySlice() {
    const n = 50000;
    const array = [1, 2, 3, 4, 3, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < 6; j++) {
            array.slice(j, -j);
        }
    }
}
