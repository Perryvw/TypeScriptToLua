export default function arrayReverse(): void {
    const n = 500000;
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        numbers.reverse();
    }
}
