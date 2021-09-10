function __TS__ArrayReverse(this: void, arr: any[]): any[] {
    let i = 1;
    let j = arr.length;
    while (i < j) {
        const temp = arr[j - 1];
        arr[j - 1] = arr[i - 1];
        arr[i - 1] = temp;
        i++;
        j--;
    }
    return arr;
}
