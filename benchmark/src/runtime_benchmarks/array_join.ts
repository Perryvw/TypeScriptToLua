const array = [1, 2, "3", 4, 3, "6", { foo: 3 }, 8, 9, 10];

const k = 500;
for (let i = 0; i < k; i++) {
    if (i % 2 === 0) {
        array[i] = i.toString();
    } else {
        array[i] = i % 3;
    }
}

export default function arrayJoin() {
    const n = 3000;
    for (let i = 0; i < n; i++) {
        array.join("|");
    }
}
