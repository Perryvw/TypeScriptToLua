export default function arrayFlatMap() {
    const n = 50000;
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        array.flatMap((el, index) => {
            if (index < 5) {
                return [el, el + 1];
            } else {
                return el + 2;
            }
        });
    }
}
