// 시드 기반 난수 (전투 재현/디버깅용). 전역 인스턴스 하나를 공유한다.
export class RNG {
  constructor(seed = Date.now()) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    // xorshift32
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  float(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.float(min, max + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  pickMany(arr, n) {
    const pool = arr.slice(), out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    return out;
  }
  // [{w:가중치, ...}] 배열에서 가중 추출
  weighted(entries, key = 'w') {
    let total = 0;
    for (const e of entries) total += e[key];
    let r = this.next() * total;
    for (const e of entries) { r -= e[key]; if (r <= 0) return e; }
    return entries[entries.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export const rng = new RNG();
export const uid = (() => { let n = 0; return (p = 'id') => `${p}_${(++n).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`; })();
