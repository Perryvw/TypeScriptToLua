export default function arrayUnshift(): number[] {
    const n = 2000;
    const numberList: number[] = [];
    const numbers = [1, 2, 3];
    for (let i = 0; i < n; i++) {
        numberList.unshift(...numbers);
    }
    return numberList;
}
