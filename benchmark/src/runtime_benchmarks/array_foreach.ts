export default function arrayForeach() {
    const n = 200000;
    const array = [1, 2, 3, 4, 3, 6, 7, 8, 9, 10];
    for (let i = 0; i < n; i++) {
        array.forEach(value => {
            let foo = value * 2;
            foo = foo;
        });
    }
}
