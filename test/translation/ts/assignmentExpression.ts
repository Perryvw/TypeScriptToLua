declare const a: string[];
declare const o: { x: string };
declare let ta: [string, string];
declare let tb: [string, string];
declare let tc: [string, string];
/** !TupleReturn */
declare function tr(): [string, string];
declare let x: string;
declare let y: string;
declare let z: string;
x = y;
z = (x = y);
x = a[0];
x = o.x;
a[0] = "foo";
o.x = "foo";
x = (a[0] = "foo");
x = (o.x = "foo");
x = (a[0] = o.x);
x = (o.x = a[0]);
ta = tb;
ta = tr();
[x, y] = tb;
[x, y] = tr();
[a[0], o.x] = tb;
[a[0], o.x] = tr();
[x, y] = (ta = tb);
[x, y] = (ta = tr());
tc = (ta = tb);
tc = (ta = tr());
tc = ([x, y] = ta);
tc = ([x, y] = tr());
tc = ([a[0], o.x] = ta);
tc = ([a[0], o.x] = tr());
[x, y] = ([a[0], o.x] = ta);
[x, y] = ([a[0], o.x] = tr());
