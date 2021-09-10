export default function arrayPush(): number[] {
    const n = 200000;
    const numberList: number[] = [];
    for (let i = 0; i < n; i++) {
        numberList.push(i * i, i + 1);
    }
    return numberList;
}
