export default function arraySplice() {
    const n = 20000;
    const array = [1, 2, 3, 4, 3, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < 10; j++) {
            array.splice(j, 2, 1, 2);
        }
    }
}
