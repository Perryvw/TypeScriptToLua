export default function arrayPush(): number[] {
    const n = 200000;
    const numberList: number[] = [];
    const numbers = [1, 2, 3];
    for (let i = 0; i < n; i++) {
        numberList.push(...numbers);
    }
    return numberList;
}
