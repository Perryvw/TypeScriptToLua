export default function arrayPush(): number[] {
    const n = 500000;
    const numberList: number[] = [];
    for (let i = 0; i < n; i++) {
        numberList.push(i * i);
    }
    return numberList;
}
